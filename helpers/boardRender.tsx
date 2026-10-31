import { sql } from "kysely";
import { db } from "./db";
import { withLiveState } from "./statusPage";
import { orgOf, slaBudget, monthMinutes as minutesOfMonth, leadMinutes as leadOf, type MonthSla } from "./boardMath";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
export { orgOf };
export type { MonthSla };

/**
 * Data behind a status board. Beyond "up or down" it answers what an IT team actually needs:
 *  - how reliable each tool has been (30 daily availability bars from our 5-minute probes, median response time);
 *  - what happened recently, from three independent sources: disruptions our probes detected, incidents the vendor
 *    declared on its own status page, and severe notices of the cloud / CDN / DNS provider underneath;
 *  - where the shared risk sits: which hosting, CDN and DNS providers several tools on the board depend on.
 * Days before our measurements started are "no data", never green.
 */
export type DayBar = { d: string; up: number | null; disruptions: number };
export type BoardItem = {
  key: string; name: string; group: "service" | "endpoint"; state: "up" | "degraded" | "down" | "unknown";
  uptime24h: number | null; uptime30: number | null; latencyMs: number | null; p50: number | null; since: string | null;
  runsOn: string | null; days: DayBar[]; statusPage: string | null; month: MonthSla;
};
export type BoardEvent = { at: string; endedAt: string | null; kind: "detected" | "declared" | "provider"; source: string; title: string; affects: string[]; link: string | null; severe: boolean;
  /** declared incidents: minutes between our first failed check and the vendor posting it (only when we were first) */
  leadMinutes: number | null };
export type BoardDependency = { layer: "hosting" | "cdn" | "dns"; providers: Array<{ name: string; count: number; services: string[] }>; known: number };
export type PublicBoard = {
  title: string; logoUrl: string | null; accent: string; theme: string; note: string | null; showPowered: boolean;
  overall: "operational" | "degraded" | "outage" | "unknown"; checkedAt: string | null;
  summary: { uptime30: number | null; disruptions30: number; daysWithData: number; medianMs: number | null;
    slaTarget: number | null; monthLabel: string; withinBudget: number; overBudget: number; earlierThanVendor: number };
  evidenceUrl: string | null;
  items: BoardItem[];
  incidents: Array<{ provider: string; layer: string; startedAt: string; affects: string[] }>;
  events: BoardEvent[];
  dependencies: BoardDependency[];
};
export type BoardMeta = { title: string; logoUrl: string | null; accent: string; theme: string; note: string | null; showPowered: boolean;
  slaTarget: number | null; evidenceUrl: string | null };

const DAYS = 30;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_KEYS = () => { const out: string[] = []; const t = Date.now(); for (let i = DAYS - 1; i >= 0; i--) out.push(iso(new Date(t - i * 86_400_000))); return out; };

// official status pages of vendors that do not publish a machine-readable incident feed we ingest
const KNOWN_STATUS: Array<[RegExp, string]> = [
  [/^(mail|calendar|drive|docs|meet|accounts|chat|sites)\.google\.com$/, "https://www.google.com/appsstatus/dashboard/"],
  [/(^console\.cloud\.google\.com$|\.googleapis\.com$|^firebase\.google\.com$)/, "https://status.cloud.google.com"],
  [/(microsoft\.com|microsoftonline\.com|office\.com|microsoft365\.com|cloud\.microsoft)$/, "https://status.cloud.microsoft"],
  [/slack\.com$/, "https://slack-status.com"], [/stripe\.com$/, "https://status.stripe.com"], [/salesforce\.com$/, "https://status.salesforce.com"],
  [/hubspot\.com$/, "https://status.hubspot.com"], [/zendesk\.com$/, "https://status.zendesk.com"], [/docusign\.com$/, "https://status.docusign.com"],
  [/okta\.com$/, "https://status.okta.com"], [/(reddit\.com|redditstatic\.com|redd\.it)$/, "https://www.redditstatus.com"],
];
const knownStatus = (domain: string | null | undefined) => (domain ? KNOWN_STATUS.find(([rx]) => rx.test(domain.toLowerCase()))?.[1] ?? null : null);

type Mon = { id: string; name: string; lastOk: boolean | null; consecutiveFailures: number; lastLatencyMs: number | null; downSince: Date | null;
  hostingProvider: string | null; hostingRegion: string | null; cdn: string | null; dnsProvider: string | null; url: string };

export async function renderBoard(meta: BoardMeta, sids: string[], mids: string[], subscriptionId: string | null): Promise<PublicBoard> {
  const keys = DAY_KEYS();
  const since = new Date(Date.parse(keys[0] + "T00:00:00Z"));
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const target = meta.slaTarget;
  const sla = (ok: number, n: number): MonthSla => slaBudget(ok, n, target, minutesOfMonth(now));

  // ---------- services ----------
  const svcRows = sids.length ? await db.selectFrom("radarServices").select(["id", "name", "category", "domain", "hostingProvider", "hostingRegion", "hostingCountry", "cdn", "dnsProvider", "emailProvider", "analyzedHost"])
    .where("id", "in", sids).where("active", "=", true).execute() : [];
  const base = svcRows.map((s) => ({ ...s, state: "unknown", httpStatus: null, latencyMs: null, error: null, uptime24h: null, samples24h: 0 }) as unknown as RadarServiceRow);
  const live = await withLiveState(base);
  const meta2 = new Map(svcRows.map((s) => [s.id, s]));
  const ids = svcRows.map((s) => s.id);

  const [daily, p50, episodes, monthly] = ids.length ? await Promise.all([
    sql<{ sid: string; d: string; ok: number; n: number }>`
      SELECT service_id AS sid, (hour AT TIME ZONE 'UTC')::date::text AS d, sum(n_ok)::int AS ok, sum(n)::int AS n
      FROM radar_service_hourly WHERE hour >= ${since} AND service_id IN (${sql.join(ids)}) GROUP BY 1, 2`.execute(db),
    sql<{ sid: string; ms: number | null }>`
      SELECT service_id AS sid, percentile_cont(0.5) WITHIN GROUP (ORDER BY p50_ms)::float AS ms
      FROM radar_service_hourly WHERE hour > now() - interval '7 days' AND p50_ms IS NOT NULL AND service_id IN (${sql.join(ids)}) GROUP BY 1`.execute(db),
    db.selectFrom("radarEpisodes").select(["serviceId", "startedAt", "recoveredAt", "reason", "nFailed"]).where("serviceId", "in", ids).where("startedAt", ">=", since).orderBy("startedAt", "desc").execute(),
    sql<{ sid: string; ok: number; n: number }>`
      SELECT service_id AS sid, sum(n_ok)::int AS ok, sum(n)::int AS n FROM radar_service_hourly
      WHERE hour >= ${monthStart} AND service_id IN (${sql.join(ids)}) GROUP BY 1`.execute(db),
  ]) : [{ rows: [] }, { rows: [] }, [], { rows: [] }];
  const monthMap = new Map(monthly.rows.map((r) => [r.sid, r]));
  const dayMap = new Map<string, { ok: number; n: number }>();
  for (const r of daily.rows) dayMap.set(`${r.sid}|${r.d}`, { ok: r.ok, n: r.n });
  const epiByDay = new Map<string, number>();
  for (const e of episodes) { const k = `${e.serviceId}|${iso(new Date(e.startedAt))}`; epiByDay.set(k, (epiByDay.get(k) ?? 0) + 1); }
  const p50Map = new Map(p50.rows.map((r) => [r.sid, r.ms]));

  // vendor status pages (official incident records) for the services' organisations
  const orgs = [...new Set(svcRows.map((s) => orgOf(s.domain)).filter((o): o is string => !!o))];
  const declared = orgs.length ? await sql<{ org: string; host: string; name: string; impact: string; at: Date; posted: Date | null; resolved: Date | null; link: string | null }>`
    SELECT org, page_host AS host, name, impact, coalesce(started_at, created_at) AS at, created_at AS posted, resolved_at AS resolved, shortlink AS link
    FROM status_incidents WHERE org IN (${sql.join(orgs)}) AND coalesce(started_at, created_at) >= ${since} AND coalesce(impact, 'none') <> 'none'
    ORDER BY at DESC LIMIT 60`.execute(db) : { rows: [] };
  const pageHosts = orgs.length ? new Map((await sql<{ org: string; host: string }>`
    SELECT DISTINCT ON (org) org, page_host AS host FROM status_incidents WHERE org IN (${sql.join(orgs)}) AND page_host IS NOT NULL ORDER BY org, fetched_at DESC`.execute(db)).rows.map((r) => [r.org, r.host])) : new Map<string, string>();

  const items: BoardItem[] = live.rows.sort((a, c) => sids.indexOf(a.id) - sids.indexOf(c.id)).map((s) => {
    const m = meta2.get(s.id)!;
    const days = keys.map((d) => { const x = dayMap.get(`${s.id}|${d}`); return { d, up: x && x.n > 0 ? x.ok / x.n : null, disruptions: epiByDay.get(`${s.id}|${d}`) ?? 0 }; });
    const tot = keys.reduce((acc, d) => { const x = dayMap.get(`${s.id}|${d}`); return x ? { ok: acc.ok + x.ok, n: acc.n + x.n } : acc; }, { ok: 0, n: 0 });
    const host = pageHosts.get(orgOf(m.domain) ?? "");
    return {
      key: s.id, name: s.name, group: "service" as const, state: (s.state as BoardItem["state"]) ?? "unknown", uptime24h: s.uptime24h,
      uptime30: tot.n ? tot.ok / tot.n : null, latencyMs: s.latencyMs, p50: p50Map.get(s.id) ?? null, since: null,
      runsOn: [m.hostingProvider, m.cdn].filter(Boolean).join(" · ") || null, days, statusPage: host ? `https://${host}` : knownStatus(m.domain),
      month: sla(monthMap.get(s.id)?.ok ?? 0, monthMap.get(s.id)?.n ?? 0),
    };
  });

  // ---------- the owner's own endpoints ----------
  const mons: Mon[] = mids.length && subscriptionId ? await db.selectFrom("customMonitors")
    .select(["id", "name", "lastOk", "consecutiveFailures", "lastLatencyMs", "downSince", "hostingProvider", "hostingRegion", "cdn", "dnsProvider", "url"])
    .where("id", "in", mids).where("subscriptionId", "=", subscriptionId).where("active", "=", true).execute() : [];
  if (mons.length) {
    const md = (await sql<{ id: string; d: string; ok: number; n: number; ms: number | null }>`
      SELECT monitor_id AS id, (checked_at AT TIME ZONE 'UTC')::date::text AS d, count(*) FILTER (WHERE ok)::int AS ok, count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::float AS ms
      FROM custom_checks WHERE monitor_id IN (${sql.join(mons.map((m) => m.id))}) AND checked_at >= ${since} GROUP BY 1, 2`.execute(db)).rows;
    const by = new Map(md.map((r) => [`${r.id}|${r.d}`, r]));
    for (const m of mons.sort((a, c) => mids.indexOf(a.id) - mids.indexOf(c.id))) {
      const days = keys.map((d) => { const x = by.get(`${m.id}|${d}`); return { d, up: x && x.n ? x.ok / x.n : null, disruptions: 0 }; });
      const rows = md.filter((r) => r.id === m.id), n = rows.reduce((s, r) => s + r.n, 0), ok = rows.reduce((s, r) => s + r.ok, 0);
      const last = by.get(`${m.id}|${keys[keys.length - 1]}`);
      const mrows = md.filter((r) => r.id === m.id && r.d >= iso(monthStart));
      items.push({ key: m.id, name: m.name, group: "endpoint",
        state: m.lastOk === null ? "unknown" : m.lastOk ? "up" : m.consecutiveFailures >= 2 ? "down" : "degraded",
        uptime24h: null, uptime30: n ? ok / n : null, latencyMs: m.lastLatencyMs, p50: last?.ms ?? null,
        since: m.downSince ? new Date(m.downSince).toISOString() : null, runsOn: [m.hostingProvider, m.cdn].filter(Boolean).join(" · ") || null, days, statusPage: null,
        month: sla(mrows.reduce((s, r) => s + r.ok, 0), mrows.reduce((s, r) => s + r.n, 0)) });
    }
  }

  // ---------- open provider incidents (radar) ----------
  const open = await db.selectFrom("radarIncidents").select(["provider", "layer", "startedAt", "affected", "atRisk"]).where("status", "=", "open").execute();
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Array<{ id: string; name: string }>;
  const names = new Map(items.map((i) => [i.key, i.name]));
  const onProvider = (layer: string, provider: string, x: { hostingProvider: string | null; hostingRegion: string | null; cdn: string | null; dnsProvider: string | null }) =>
    (layer === "hosting" && x.hostingProvider === provider) || (layer === "cdn" && x.cdn === provider) || (layer === "dns" && x.dnsProvider === provider)
    || (layer === "region" && `${x.hostingProvider} ${x.hostingRegion}` === provider);
  const incidents: PublicBoard["incidents"] = [];
  for (const inc of open) {
    const touched = new Set<string>();
    for (const a of [...parse(inc.affected), ...parse(inc.atRisk)]) if (names.has(a.id)) touched.add(names.get(a.id)!);
    for (const m of mons) if (onProvider(inc.layer, inc.provider, m)) touched.add(m.name);
    if (touched.size) incidents.push({ provider: inc.provider, layer: inc.layer, startedAt: new Date(inc.startedAt).toISOString(), affects: [...touched] });
  }

  // ---------- recent events from three sources ----------
  const events: BoardEvent[] = [];
  for (const e of episodes) {
    const s = meta2.get(e.serviceId); if (!s) continue;
    events.push({ at: new Date(e.startedAt).toISOString(), endedAt: e.recoveredAt ? new Date(e.recoveredAt).toISOString() : null, kind: "detected", source: "Our probes",
      title: `${s.name} unreachable${e.reason ? ` (${e.reason.slice(0, 60)})` : ""}`, affects: [s.name], link: null, severe: e.nFailed >= 6, leadMinutes: null });
  }
  const svcByOrg = new Map<string, string[]>();
  const idsByOrg = new Map<string, string[]>();
  for (const s of svcRows) { const o = orgOf(s.domain); if (o) { svcByOrg.set(o, [...(svcByOrg.get(o) ?? []), s.name]); idsByOrg.set(o, [...(idsByOrg.get(o) ?? []), s.id]); } }
  const perOrg = new Map<string, number>();
  for (const d of declared.rows) {
    const n = perOrg.get(d.org) ?? 0; if (n >= 5) continue; perOrg.set(d.org, n + 1);
    // were we first? our failing checks on one of the vendor's services began up to 3 h before the vendor posted, and were still on 30 min before
    const posted = new Date(d.posted ?? d.at).getTime();
    const lead = leadOf(posted, episodes.filter((e) => (idsByOrg.get(d.org) ?? []).includes(e.serviceId))
      .map((e) => ({ start: new Date(e.startedAt).getTime(), end: e.recoveredAt ? new Date(e.recoveredAt).getTime() : null })));
    events.push({ at: new Date(d.at).toISOString(), endedAt: d.resolved ? new Date(d.resolved).toISOString() : null, kind: "declared", source: d.org,
      title: d.name, affects: svcByOrg.get(d.org) ?? [], link: d.link, severe: d.impact === "major" || d.impact === "critical",
      leadMinutes: lead });
  }
  const providerSet = new Set<string>();
  for (const s of [...svcRows, ...mons]) for (const p of [s.hostingProvider, s.cdn, s.dnsProvider]) if (p) providerSet.add(p);
  if (providerSet.size) {
    const pis = await db.selectFrom("providerIncidents").select(["provider", "region", "title", "startedAt", "resolvedAt", "link", "severe"])
      .where("provider", "in", [...providerSet]).where("severe", "=", true).where("startedAt", ">=", since).orderBy("startedAt", "desc").limit(20).execute();
    for (const p of pis) {
      // DNS-only customers are not hit by a provider's network or product incidents, only by DNS ones
      const dnsIncident = /\bdns\b/i.test(p.title);
      const affected = [...svcRows, ...mons].filter((s) => (s.hostingProvider === p.provider && (!p.region || p.region === s.hostingRegion)) || s.cdn === p.provider
        || (dnsIncident && s.dnsProvider === p.provider)).map((s) => s.name);
      if (!affected.length) continue;
      events.push({ at: new Date(p.startedAt).toISOString(), endedAt: p.resolvedAt ? new Date(p.resolvedAt).toISOString() : null, kind: "provider", source: p.provider,
        title: p.title.trim(), affects: affected, link: p.link, severe: true, leadMinutes: null });
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  // ---------- shared dependencies ----------
  const all = [...svcRows.map((s) => ({ name: s.name, hosting: s.hostingProvider, cdn: s.cdn, dns: s.dnsProvider })), ...mons.map((m) => ({ name: m.name, hosting: m.hostingProvider, cdn: m.cdn, dns: m.dnsProvider }))];
  const dependencies: BoardDependency[] = (["hosting", "cdn", "dns"] as const).map((layer) => {
    const by = new Map<string, string[]>();
    for (const x of all) { const p = x[layer]; if (p && !/^Other \(/.test(p)) by.set(p, [...(by.get(p) ?? []), x.name]); }
    const providers = [...by.entries()].map(([name, services]) => ({ name, count: services.length, services })).sort((a, b) => b.count - a.count);
    return { layer, providers, known: providers.reduce((s, p) => s + p.count, 0) };
  });

  // ---------- summary ----------
  let ok = 0, n = 0; const withData = new Set<string>();
  for (const r of daily.rows) { ok += r.ok; n += r.n; withData.add(r.d); }
  const states = items.map((i) => i.state);
  const overall: PublicBoard["overall"] = !items.length || states.every((s) => s === "unknown") ? "unknown"
    : states.includes("down") ? "outage" : states.includes("degraded") || incidents.length ? "degraded" : "operational";
  const lat = items.map((i) => i.p50).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const budgeted = items.filter((i) => i.month.usedShare !== null && i.month.up !== null);
  return {
    ...meta, overall, checkedAt: live.checkedAt,
    summary: { uptime30: n ? ok / n : null, disruptions30: episodes.length, daysWithData: withData.size, medianMs: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      slaTarget: target, monthLabel: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      withinBudget: budgeted.filter((i) => (i.month.usedShare ?? 0) <= 1).length, overBudget: budgeted.filter((i) => (i.month.usedShare ?? 0) > 1).length,
      earlierThanVendor: events.filter((e) => e.leadMinutes !== null).length },
    items, incidents, events: events.slice(0, 20), dependencies,
  };
}
