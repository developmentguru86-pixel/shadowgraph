import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Worldwide reachability checks via the Globalping probe network (jsDelivr; free tier 250 tests/hour, commercial use permitted).
 * Every 30 minutes: 10 fixed infrastructure anchors + up to 4 services the EU radar currently sees failing,
 * each from one probe on each of 6 continents => at most 84 tests per run, 168 per hour (inside the free limit).
 * A target counts as reachable from a probe when it returns any HTTP status below 500 (same rule as the radar).
 */

export const CONTINENTS = ["NA", "SA", "EU", "AS", "OC", "AF"] as const;
export type Continent = (typeof CONTINENTS)[number];
export const CONTINENT_NAME: Record<Continent, string> = { NA: "North America", SA: "South America", EU: "Europe", AS: "Asia", OC: "Oceania", AF: "Africa" };

type Target = { id: string; name: string; host: string; path: string; kind: "anchor" | "confirm" };
export const ANCHORS: Target[] = [
  { id: "anchor-cloudflare", name: "Cloudflare edge", host: "www.cloudflare.com", path: "/", kind: "anchor" },
  { id: "anchor-akamai", name: "Akamai edge", host: "www.akamai.com", path: "/", kind: "anchor" },
  { id: "anchor-fastly", name: "Fastly edge", host: "www.fastly.com", path: "/", kind: "anchor" },
  { id: "anchor-aws-use1", name: "AWS us-east-1 (S3)", host: "s3.us-east-1.amazonaws.com", path: "/", kind: "anchor" },
  { id: "anchor-aws-euc1", name: "AWS eu-central-1 (S3)", host: "s3.eu-central-1.amazonaws.com", path: "/", kind: "anchor" },
  { id: "anchor-google", name: "Google front end", host: "www.google.com", path: "/generate_204", kind: "anchor" },
  { id: "anchor-azure", name: "Microsoft Azure", host: "azure.microsoft.com", path: "/", kind: "anchor" },
  { id: "anchor-stripe", name: "Stripe API", host: "api.stripe.com", path: "/", kind: "anchor" },
  { id: "anchor-github", name: "GitHub", host: "github.com", path: "/", kind: "anchor" },
  { id: "anchor-vercel", name: "Vercel edge", host: "vercel.com", path: "/", kind: "anchor" },
];

const API = "https://api.globalping.io/v1/measurements";
const UA = { "user-agent": "ShadowGraph-OutageRadar/1.0 (+https://shadowalpha.online/radar)" };
const MIN = 60_000;

type ProbeResult = {
  probe: { continent: string; country?: string; city?: string; latitude?: number; longitude?: number; network?: string };
  result: { status: string; statusCode?: number; timings?: { total?: number }; rawOutput?: string };
};

async function createMeasurement(t: Target): Promise<string | null> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", ...UA },
    body: JSON.stringify({
      type: "http", target: t.host, inProgressUpdates: false,
      locations: CONTINENTS.map((c) => ({ continent: c, limit: 1 })),
      measurementOptions: { protocol: "HTTPS", request: { method: "HEAD", path: t.path } },
    }),
  });
  if (r.status === 429) throw new Error("globalping rate limit");
  if (!r.ok) return null;
  return ((await r.json()) as { id?: string }).id ?? null;
}

async function awaitMeasurement(id: string): Promise<ProbeResult[]> {
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, i < 5 ? 1000 : 2000));
    const r = await fetch(`${API}/${id}`, { headers: UA });
    if (!r.ok) continue;
    const m = (await r.json()) as { status: string; results?: ProbeResult[] };
    if (m.status !== "in-progress") return m.results ?? [];
  }
  return [];
}

async function failingTargets(): Promise<Target[]> {
  const run = await db.selectFrom("radarRuns").select(["failing", "vantageSuspect"]).orderBy("at", "desc").limit(1).executeTakeFirst();
  if (!run || run.vantageSuspect || !run.failing?.length) return [];
  const rows = await db.selectFrom("radarServices").select(["id", "name", "probeUrl"]).where("id", "in", run.failing.slice(0, 60)).execute();
  // rotate: the services checked least recently go first, so a long outage is cross-checked every hour or so, not once
  const last = await db.selectFrom("globalProbeResults").select(["targetName", sql<Date>`max(run_at)`.as("at")])
    .where("targetName", "in", rows.length ? rows.map((r) => r.name) : ["-"]).where("runAt", ">", new Date(Date.now() - 2 * 86_400_000))
    .groupBy("targetName").execute().catch(() => []);
  const lastAt = new Map(last.map((l) => [l.targetName, new Date(l.at).getTime()]));
  rows.sort((a, b) => (lastAt.get(a.name) ?? 0) - (lastAt.get(b.name) ?? 0));
  // 10 anchors + 6 confirmations, 6 continents each: 96 tests per run, 192 per hour (free limit 250)
  return rows.slice(0, 6).flatMap((s) => {
    try { const u = new URL(s.probeUrl); return [{ id: s.id, name: s.name, host: u.hostname, path: u.pathname + u.search, kind: "confirm" as const }]; }
    catch { return []; }
  });
}

export async function globalProbeJob() {
  const gotLock = await mppStore.update<boolean>("global-probe:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 20 * MIN) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };

  const runAt = new Date();
  const targets = [...ANCHORS, ...(await failingTargets())];
  const ids = await Promise.all(targets.map((t) => createMeasurement(t).catch(() => null)));
  const results = await Promise.all(ids.map((id) => (id ? awaitMeasurement(id).catch(() => []) : Promise.resolve([] as ProbeResult[]))));

  const rows = targets.flatMap((t, i) => results[i].map((x) => {
    const code = x.result.statusCode ?? null;
    const ok = x.result.status === "finished" && code !== null && code > 0 && code < 500;
    return {
      runAt, targetId: t.id, targetName: t.name, kind: t.kind, continent: x.probe.continent,
      country: x.probe.country ?? null, city: x.probe.city ?? null, lat: x.probe.latitude ?? null, lon: x.probe.longitude ?? null,
      network: x.probe.network?.slice(0, 120) ?? null, ok, statusCode: code, ms: x.result.timings?.total != null ? Math.round(x.result.timings.total) : null,
      error: ok ? null : (x.result.status !== "finished" ? x.result.status : code && code >= 500 ? `HTTP ${code}` : (x.result.rawOutput ?? "no response").slice(0, 200)),
    };
  }));
  if (rows.length) await db.insertInto("globalProbeResults").values(rows).execute();
  await db.deleteFrom("globalProbeResults").where("runAt", "<", new Date(Date.now() - 14 * 24 * 60 * MIN)).execute();
  return { ran: true, targets: targets.length, rows: rows.length, failed: rows.filter((r) => !r.ok).length };
}

export type GlobalView = {
  runAt: string | null;
  continents: Array<{ code: Continent; name: string; reachable: number; total: number; medianMs: number | null; availability24h: number | null }>;
  probes: Array<{ continent: string; city: string | null; country: string | null; lat: number; lon: number; network: string | null; ok: number; total: number }>;
  targets: Array<{ id: string; name: string; kind: string; cells: Partial<Record<Continent, { ok: boolean; ms: number | null; city: string | null; country: string | null; error: string | null }>> }>;
  regionalOutages: Array<{ id: string; name: string; downIn: string[]; upIn: string[] }>;
};

/** Latest worldwide run + 24h availability per continent. */
export async function getGlobalView(): Promise<GlobalView> {
  const last = await db.selectFrom("globalProbeResults").select("runAt").orderBy("runAt", "desc").limit(1).executeTakeFirst();
  const empty: GlobalView = { runAt: null, continents: CONTINENTS.map((c) => ({ code: c, name: CONTINENT_NAME[c], reachable: 0, total: 0, medianMs: null, availability24h: null })), probes: [], targets: [], regionalOutages: [] };
  if (!last) return empty;
  const rows = await db.selectFrom("globalProbeResults").selectAll().where("runAt", "=", last.runAt).execute();
  const avail = await sql<{ continent: string; okn: string; n: string }>`
    select continent, count(*) filter (where ok) as okn, count(*) as n from global_probe_results
    where run_at > now() - interval '24 hours' and kind = 'anchor' group by continent`.execute(db);
  const availBy = new Map(avail.rows.map((r) => [r.continent, Number(r.okn) / Math.max(1, Number(r.n))]));
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

  const continents = CONTINENTS.map((c) => {
    const rs = rows.filter((r) => r.continent === c && r.kind === "anchor");
    return { code: c, name: CONTINENT_NAME[c], reachable: rs.filter((r) => r.ok).length, total: rs.length, medianMs: med(rs.filter((r) => r.ok && r.ms != null).map((r) => r.ms!)), availability24h: availBy.get(c) ?? null };
  });
  const probeMap = new Map<string, GlobalView["probes"][number]>();
  for (const r of rows) {
    if (r.lat == null || r.lon == null) continue;
    const k = `${r.continent}|${r.city}|${r.country}`;
    const p = probeMap.get(k) ?? { continent: r.continent, city: r.city, country: r.country, lat: r.lat, lon: r.lon, network: r.network, ok: 0, total: 0 };
    p.total++; if (r.ok) p.ok++;
    probeMap.set(k, p);
  }
  const targetMap = new Map<string, GlobalView["targets"][number]>();
  for (const r of rows) {
    const t = targetMap.get(r.targetId) ?? { id: r.targetId, name: r.targetName, kind: r.kind, cells: {} };
    t.cells[r.continent as Continent] = { ok: r.ok, ms: r.ms, city: r.city, country: r.country, error: r.error };
    targetMap.set(r.targetId, t);
  }
  const targets = [...targetMap.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "confirm" ? -1 : 1));
  const regionalOutages = targets.flatMap((t) => {
    const cells = Object.entries(t.cells) as Array<[Continent, { ok: boolean }]>;
    const down = cells.filter(([, c]) => !c.ok).map(([k]) => CONTINENT_NAME[k]);
    const up = cells.filter(([, c]) => c.ok).map(([k]) => CONTINENT_NAME[k]);
    return down.length && up.length ? [{ id: t.id, name: t.name, downIn: down, upIn: up }] : [];
  });
  return { runAt: new Date(last.runAt).toISOString(), continents, probes: [...probeMap.values()], targets, regionalOutages };
}
