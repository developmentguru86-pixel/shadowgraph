/**
 * Measured evidence for the DORA report: outages the ShadowGraph radar recorded on a vendor's endpoint (5-minute checks).
 * A vendor row is matched to a radar service on the same host or domain, or on the same registrable domain served by the
 * same hosting provider (banking.bank99.at → bank99.at, both on Internex). Overlapping episodes are merged into outages;
 * only outages of 30 minutes or more count. "sharedWith" lists other radar services on the same hoster whose outage began
 * within 15 minutes, which points at the hoster rather than the vendor.
 */
import { sql } from "kysely";
import { db } from "./db";
import { reportMonitorEvidence } from "./reportMonitoring";

export type ObservedOutage = {
  vendor: string;
  critical: boolean;
  measuredOn: string;
  basis: "host" | "same-hoster" | "report-monitor";
  since: string | null;
  uptimePct: number | null;
  outages: number;
  totalMinutes: number;
  longestMinutes: number;
  longestStart: string | null;
  sharedWith: string[];
  /** each outage: start, end (null while ongoing), other services on the same hoster that failed within 15 minutes */
  episodes: Array<{ start: string; end: string | null; shared: string[] }>;
  /** worldwide cross-check of the longest outage: independent probe locations that checked during it and how many of them failed */
  confirm?: { checked: number; failed: number; countries: string[]; rounds: number } | null;
  /** set by the report: this vendor was not measured itself; the figures belong to the named vendor's endpoint on the same hoster */
  inferredFrom?: string | null;
};

type Row = { name: string; domain: string; host: string | null; hosting: string | null; critical: boolean; status: string };
const reg = (h: string) => h.toLowerCase().replace(/\.$/, "").split(".").slice(-2).join(".");
const MIN = 30;

function merge(eps: Array<{ startedAt: Date; recoveredAt: Date | null }>, now: number) {
  const iv = eps.map((e) => [new Date(e.startedAt).getTime(), e.recoveredAt ? new Date(e.recoveredAt).getTime() : now] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out.filter(([s, e]) => (e - s) / 60_000 >= MIN);
}

export async function observedOutages(rows: Row[], days = 30, scanId?: string): Promise<ObservedOutage[]> {
  const ok = rows.filter((r) => r.status === "ok");
  if (!ok.length) return [];
  const radar = await radarOutages(ok, days);
  if (!scanId) return radar;
  // endpoints without radar history: the report's own private monitors (from the day the report was unlocked)
  const have = new Set(radar.map((o) => o.vendor));
  const sinceMs = Date.now() - days * 86_400_000;
  const mon = await reportMonitorEvidence(scanId, sinceMs).catch(() => new Map());
  const extra: ObservedOutage[] = [];
  for (const r of ok) {
    if (have.has(r.name) || !r.host) continue;
    const e = mon.get(r.host.toLowerCase());
    if (!e || !e.n) continue;
    const mins = e.outages.map(([s, en]: [number, number]) => (en - s) / 60_000);
    const li = mins.indexOf(Math.max(0, ...mins));
    extra.push({
      vendor: r.name, critical: r.critical, measuredOn: e.host, basis: "report-monitor", since: e.since,
      uptimePct: Math.round((e.ok / e.n) * 1000) / 10, outages: e.outages.length, totalMinutes: Math.round(mins.reduce((a: number, b: number) => a + b, 0)),
      longestMinutes: Math.round(mins[li] ?? 0), longestStart: e.outages[li] ? new Date(e.outages[li][0]).toISOString() : null, sharedWith: [],
      episodes: e.outages.map(([s, en]: [number, number]) => ({ start: new Date(s).toISOString(), end: en >= Date.now() - 60_000 ? null : new Date(en).toISOString(), shared: [] })),
    });
  }
  return [...radar, ...extra];
}

async function radarOutages(ok: Row[], days: number): Promise<ObservedOutage[]> {
  const regs = [...new Set(ok.map((r) => reg(r.domain)))];
  const services = await db.selectFrom("radarServices").select(["id", "name", "domain", "hostingProvider"]).where("active", "=", true)
    .where((eb) => eb.or(regs.flatMap((r) => [eb("domain", "=", r), eb("domain", "like", `%.${r}`)]))).execute();
  if (!services.length) return [];

  const matched = ok.map((r) => {
    const host = (r.host ?? "").toLowerCase(), dom = r.domain.toLowerCase();
    const direct = services.find((s) => s.domain.toLowerCase() === host || s.domain.toLowerCase() === dom);
    if (direct) return { r, s: direct, basis: "host" as const };
    const same = r.hosting ? services.find((s) => reg(s.domain) === reg(dom) && s.hostingProvider === r.hosting) : undefined;
    return same ? { r, s: same, basis: "same-hoster" as const } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!matched.length) return [];

  const now = Date.now();
  const since = new Date(now - days * 86_400_000);
  const ids = [...new Set(matched.map((m) => m.s.id))];
  const provs = [...new Set(matched.map((m) => m.s.hostingProvider).filter((p): p is string => !!p))];
  const peers = provs.length
    ? await db.selectFrom("radarServices").select(["id", "name", "hostingProvider"]).where("active", "=", true).where("hostingProvider", "in", provs).execute()
    : [];
  const allIds = [...new Set([...ids, ...peers.map((p) => p.id)])];
  const eps = await db.selectFrom("radarEpisodes").select(["serviceId", "startedAt", "recoveredAt"]).where("serviceId", "in", allIds)
    .where((eb) => eb.or([eb("recoveredAt", "is", null), eb("recoveredAt", ">", since)])).execute();
  const hourly = await db.selectFrom("radarServiceHourly")
    .select(["serviceId", sql<string>`sum(n)`.as("n"), sql<string>`sum(n_ok)`.as("nOk"), sql<Date>`min(hour)`.as("first")])
    .where("serviceId", "in", ids).where("hour", ">", since).groupBy("serviceId").execute();
  // independent worldwide probes (other networks and continents) that ran during the outages
  const names = [...new Set(matched.map((m) => m.s.name))];
  const world = await db.selectFrom("globalProbeResults").select(["targetName", "runAt", "country", "city", "network", "ok"])
    .where("targetName", "in", names).where("runAt", ">", since).execute().catch(() => []);

  const bySvc = new Map<string, Array<[number, number]>>();
  for (const id of allIds) bySvc.set(id, merge(eps.filter((e) => e.serviceId === id), now).filter(([, e]) => e > since.getTime()));

  return matched.map(({ r, s, basis }) => {
    const iv = bySvc.get(s.id) ?? [];
    const h = hourly.find((x) => x.serviceId === s.id);
    const total = iv.reduce((a, [st, en]) => a + (en - Math.max(st, since.getTime())) / 60_000, 0);
    const longest = iv.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), [0, 0] as [number, number]);
    const shared = new Set<string>();
    const episodes: ObservedOutage["episodes"] = [];
    for (const [st, en] of iv) {
      const here: string[] = [];
      for (const p of peers) {
        if (p.id === s.id || p.hostingProvider !== s.hostingProvider) continue;
        if ((bySvc.get(p.id) ?? []).some(([ps]) => Math.abs(ps - st) <= 15 * 60_000)) here.push(p.name.replace(/\s*\((AT|DE|CH)\)$/, ""));
      }
      if ((en - st) / 60_000 >= 60) here.forEach((x) => shared.add(x));
      episodes.push({ start: new Date(st).toISOString(), end: en >= now - 60_000 ? null : new Date(en).toISOString(), shared: here.sort() });
    }
    const n = Number(h?.n ?? 0);
    // a location counts as failed when most of its checks during the longest outage failed
    let confirm: ObservedOutage["confirm"] = null;
    if (iv.length) {
      const per = new Map<string, { ok: number; fail: number; country: string }>();
      const rounds = new Set<number>();
      for (const w of world) {
        const at = new Date(w.runAt).getTime();
        if (w.targetName !== s.name || at < longest[0] || at > longest[1]) continue;
        rounds.add(Math.round(at / 60_000));
        const k = `${w.city}|${w.network}`;
        const x = per.get(k) ?? { ok: 0, fail: 0, country: w.country ?? "" };
        if (w.ok) x.ok++; else x.fail++;
        per.set(k, x);
      }
      if (per.size) {
        const failed = [...per.values()].filter((x) => x.fail > x.ok);
        confirm = { checked: per.size, failed: failed.length, countries: [...new Set(failed.map((x) => x.country).filter(Boolean))].sort(), rounds: rounds.size };
      }
    }
    return {
      vendor: r.name, critical: r.critical, measuredOn: s.domain, basis,
      since: h?.first ? new Date(h.first).toISOString() : null,
      uptimePct: n ? Math.round((Number(h?.nOk ?? 0) / n) * 1000) / 10 : null,
      outages: iv.length, totalMinutes: Math.round(total), longestMinutes: Math.round((longest[1] - longest[0]) / 60_000),
      longestStart: iv.length ? new Date(longest[0]).toISOString() : null,
      sharedWith: [...shared].sort(),
      episodes,
      confirm,
    };
  });
}

/**
 * Measurement log behind the observed outages, for the customer's own verification: hourly check counts of our
 * 5-minute probe and every worldwide probe result during each outage (raw 5-minute results are kept for 48 hours only).
 */
export async function outageEvidenceLog(observed: ObservedOutage[]): Promise<string[][]> {
  const measured = observed.filter((o) => !o.inferredFrom && o.basis !== "report-monitor" && o.episodes.length);
  if (!measured.length) return [];
  const svcs = await db.selectFrom("radarServices").select(["id", "name", "domain"]).where("domain", "in", [...new Set(measured.map((o) => o.measuredOn))]).execute();
  const out: string[][] = [];
  for (const o of measured) {
    const s = svcs.find((x) => x.domain === o.measuredOn);
    if (!s) continue;
    for (const e of o.episodes) {
      const from = new Date(new Date(e.start).getTime() - 2 * 3600_000), to = new Date((e.end ? new Date(e.end).getTime() : Date.now()) + 2 * 3600_000);
      const hours = await db.selectFrom("radarServiceHourly").select(["hour", "n", "nOk"]).where("serviceId", "=", s.id)
        .where("hour", ">=", from).where("hour", "<=", to).orderBy("hour").execute();
      for (const h of hours) out.push([o.vendor, o.measuredOn, "own probe (hourly, 5-min checks)", new Date(h.hour).toISOString(), "", "", String(h.n), String(h.nOk), String(Number(h.n) - Number(h.nOk)), ""]);
      const world = await db.selectFrom("globalProbeResults").select(["runAt", "country", "city", "network", "ok", "statusCode", "error"])
        .where("targetName", "=", s.name).where("runAt", ">=", new Date(e.start)).where("runAt", "<=", e.end ? new Date(e.end) : new Date()).orderBy("runAt").execute();
      for (const w of world) out.push([o.vendor, o.measuredOn, "worldwide probe", new Date(w.runAt).toISOString(), `${w.city ?? ""} (${w.country ?? ""})`, w.network ?? "", "1", w.ok ? "1" : "0", w.ok ? "0" : "1", w.ok ? `HTTP ${w.statusCode ?? ""}` : (w.error ?? `HTTP ${w.statusCode ?? ""}`)]);
    }
  }
  return out;
}
