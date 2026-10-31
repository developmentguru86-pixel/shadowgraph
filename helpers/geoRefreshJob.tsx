import { gunzipSync } from "zlib";
import { Reader, type CityResponse } from "mmdb-lib";
import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Weekly refresh of city-level hosting locations (table service_geo).
 * Source: DB-IP IP-to-City Lite (CC BY 4.0, https://db-ip.com), published monthly; the current month's file is used,
 * falling back to the previous month early in a month.
 * Eligible: active services whose origin server is directly visible (no CDN, no cloud region from official ranges)
 * and not on Google's anycast front end (those IPs geolocate to the HQ, not to a server).
 * New services get a location, changed IPs are re-located, services that became ineligible lose their row.
 */

const H = 60 * 60_000;
const LAST = "geo-refresh:last";
type City = { city?: { names?: { en?: string } }; subdivisions?: Array<{ names?: { en?: string } }>; country?: { iso_code?: string }; location?: { latitude?: number; longitude?: number } };

const month = (d: Date) => d.toISOString().slice(0, 7);
export async function loadReader(): Promise<{ reader: Reader<CityResponse>; source: string }> {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  for (const m of [month(now), month(prev)]) {
    const r = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`);
    if (!r.ok) continue;
    const buf = gunzipSync(Buffer.from(await r.arrayBuffer()));
    return { reader: new Reader<CityResponse>(buf), source: `dbip-city-lite-${m}` };
  }
  throw new Error("DB-IP city lite download failed for this and last month");
}

async function resolveA(host: string): Promise<string | null> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: "application/dns-json" } });
  if (!r.ok) return null;
  const j = (await r.json()) as { Answer?: Array<{ type: number; data: string }> };
  return j.Answer?.find((a) => a.type === 1)?.data ?? null;
}

export function hostOf(analyzedHost: string | null, probeUrl: string): string | null {
  if (analyzedHost) return analyzedHost;
  try { return new URL(probeUrl).hostname; } catch { return null; }
}

/** Decide what to store for one lookup; null = no usable location (unknown city, or Google anycast HQ). */
export function geoRow(serviceId: string, ip: string, g: City | null, source: string) {
  const lat = g?.location?.latitude, lon = g?.location?.longitude, city = g?.city?.names?.en?.replace(/ \(.*\)$/, "");
  if (lat == null || lon == null || !city || city === "Mountain View") return null;
  return { serviceId, ip, city, regionName: g?.subdivisions?.[0]?.names?.en ?? null, country: g?.country?.iso_code ?? null, lat, lon, source, checkedAt: new Date() };
}

export async function geoRefreshJob() {
  const gotLock = await mppStore.update<boolean>("geo-refresh:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 6 * H) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };

  const { reader, source } = await loadReader();
  const eligible = await db.selectFrom("radarServices")
    .leftJoin("serviceGeo", "serviceGeo.serviceId", "radarServices.id")
    .select(["radarServices.id", "radarServices.analyzedHost", "radarServices.probeUrl", "serviceGeo.ip as oldIp", "serviceGeo.city as oldCity"])
    .where("radarServices.active", "=", true)
    .where("radarServices.category", "<>", "Cloud region canary")
    .where("radarServices.cdn", "is", null)
    .where("radarServices.hostingRegion", "is", null)
    .where("radarServices.hostingProvider", "is not", null)
    .where("radarServices.hostingProvider", "not like", "Google%")
    .execute();

  let added = 0, changed = 0, unchanged = 0, failed = 0;
  for (let i = 0; i < eligible.length; i += 20) {
    await Promise.all(eligible.slice(i, i + 20).map(async (s) => {
      const host = hostOf(s.analyzedHost, s.probeUrl);
      const ip = host ? await resolveA(host).catch(() => null) : null;
      if (!ip) { failed++; return; }
      const row = geoRow(s.id, ip, reader.get(ip) as unknown as City | null, source);
      if (!row) { failed++; return; }
      if (s.oldIp === ip && s.oldCity === row.city) unchanged++; else if (s.oldIp) changed++; else added++;
      await db.insertInto("serviceGeo").values(row).onConflict((oc) => oc.column("serviceId").doUpdateSet({
        ip: row.ip, city: row.city, regionName: row.regionName, country: row.country, lat: row.lat, lon: row.lon, source: row.source, checkedAt: row.checkedAt,
      })).execute();
    }));
  }
  // services that are no longer eligible (now behind a CDN, mapped to a cloud region, or inactive) lose their row
  const keep = eligible.map((s) => s.id);
  const removed = keep.length
    ? Number((await db.deleteFrom("serviceGeo").where("serviceId", "not in", keep).executeTakeFirst()).numDeletedRows ?? 0)
    : 0;
  const summary = { at: new Date().toISOString(), source, eligible: eligible.length, added, changed, unchanged, failed, removed };
  await mppStore.put(LAST, summary);
  return { ran: true, ...summary };
}

export async function lastGeoRefresh() {
  return (await mppStore.get(LAST)) as null | { at: string; source: string; eligible: number; added: number; changed: number; unchanged: number; failed: number; removed: number };
}
