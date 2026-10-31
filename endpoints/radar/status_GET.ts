import { sql } from "kysely";
import { db } from "../../helpers/db";
import { mppStore } from "../../helpers/mppStore";
import { jsonResponse } from "../../helpers/jsonResponse";
import { GEO_ATTRIBUTION } from "../../helpers/licensing";

type Run = { runId: string; at: string; total: number; up: number; degraded: number; down: number; vantageSuspect: boolean; medianLatencyMs: number | null };

type SweepAggregates = {
  runId: string;
  uptime: Array<{ serviceId: string; uptime: number; samples: number }>;
  timeline: Array<{ bucket: string; checks: number; failed: number; services: number }>;
  events: Array<{ serviceId: string; at: string; ok: boolean; error: string | null; httpStatus: number | null }>;
};
const AGG_KEY = "radar:statusAggregates";
let memo: SweepAggregates | null = null;

async function sweepAggregates(runId: string): Promise<SweepAggregates> {
  if (memo?.runId === runId) return memo;
  const stored = (await mppStore.get(AGG_KEY)) as SweepAggregates | null;
  if (stored?.runId === runId) return (memo = stored);

  const uptime = (await sql<SweepAggregates["uptime"][number]>`
    SELECT service_id AS "serviceId", avg(CASE WHEN ok THEN 1.0 ELSE 0.0 END)::float AS uptime, count(*)::int AS samples
    FROM radar_checks WHERE checked_at > now() - interval '24 hours' GROUP BY service_id`.execute(db)).rows;
  // 24h timeline in 30-minute buckets: share of failed probes and number of services with errors
  const timeline = (await sql<SweepAggregates["timeline"][number]>`
    SELECT to_char(date_bin('30 minutes', checked_at, timestamp '2000-01-01'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
           count(*)::int AS checks, count(*) FILTER (WHERE NOT ok)::int AS failed,
           count(DISTINCT service_id) FILTER (WHERE NOT ok)::int AS services
    FROM radar_checks WHERE checked_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 1`.execute(db)).rows;
  // state changes in the last 6 hours (service went from ok -> failing or back)
  const events = (await sql<SweepAggregates["events"][number]>`
    SELECT service_id AS "serviceId", checked_at AS at, ok, error, http_status AS "httpStatus" FROM (
      SELECT service_id, checked_at, ok, error, http_status, lag(ok) OVER (PARTITION BY service_id ORDER BY checked_at) AS prev
      FROM radar_checks WHERE checked_at > now() - interval '6 hours') t
    WHERE prev IS NOT NULL AND prev <> ok ORDER BY checked_at DESC LIMIT 40`.execute(db)).rows;

  const fresh: SweepAggregates = { runId, uptime, timeline, events: events.map((e) => ({ ...e, at: new Date(e.at).toISOString() })) };
  memo = fresh;
  try { await mppStore.put(AGG_KEY, fresh); } catch { /* cache only */ }
  return fresh;
}

// Public live state of the Internet Outage Radar.
export async function handle(request: Request) {
  const run = (await mppStore.get("radar:lastRun")) as Run | null;
  if (!run) return Response.json({ status: "warming_up" }, { headers: { "Cache-Control": "no-store" } });

  const services = await db.selectFrom("radarServices")
    .leftJoin("serviceGeo", "serviceGeo.serviceId", "radarServices.id")
    .select(["radarServices.id", "radarServices.name", "radarServices.category", "radarServices.hostingProvider", "radarServices.hostingRegion", "radarServices.hostingCountry",
      "radarServices.cdn", "radarServices.dnsProvider", "radarServices.emailProvider", "radarServices.analyzedHost",
      "serviceGeo.city as hostingCity", "serviceGeo.country as geoCountry", "serviceGeo.lat as hostingLat", "serviceGeo.lon as hostingLon"])
    .where("radarServices.active", "=", true).orderBy("radarServices.category").orderBy("radarServices.name").execute();

  // index-friendly: only the last 30 minutes of checks (radar_checks_checked_at_idx) instead of a DISTINCT over the whole table
  const recentRuns = (await sql<{ runId: string }>`
    SELECT run_id AS "runId" FROM radar_checks
    WHERE checked_at > (SELECT max(checked_at) FROM radar_checks) - interval '30 minutes'
    GROUP BY run_id ORDER BY run_id DESC LIMIT 2`.execute(db)).rows;
  const runIds = recentRuns.map((r) => r.runId);
  const checks = runIds.length
    ? await db.selectFrom("radarChecks").select(["serviceId", "runId", "ok", "httpStatus", "latencyMs", "error"]).where("runId", "in", runIds).execute()
    : [];
  const latest = new Map(checks.filter((c) => c.runId === runIds[0]).map((c) => [c.serviceId, c]));
  const previous = new Map(checks.filter((c) => c.runId === runIds[1]).map((c) => [c.serviceId, c]));

  // The 24h aggregates (uptime, timeline, state changes) read ~700k radar_checks rows. They only change when a new
  // sweep lands, so they are computed once per sweep and shared via mpp_store (plus the warm instance's memory).
  const agg = await sweepAggregates(run.runId);
  const uptime = new Map(agg.uptime.map((r) => [r.serviceId, r]));

  const rows = services.map((s) => {
    const c = latest.get(s.id);
    const p = previous.get(s.id);
    const state = !c ? "unknown" : c.ok ? "up" : p && !p.ok ? "down" : "degraded";
    return { ...s, state, httpStatus: c?.httpStatus ?? null, latencyMs: c?.latencyMs ?? null, error: c?.error ?? null,
      uptime24h: uptime.get(s.id)?.uptime ?? null, samples24h: uptime.get(s.id)?.samples ?? 0 };
  });

  // infrastructure table: provider x region with live health
  const infra = new Map<string, { provider: string; region: string | null; services: number; up: number; down: number; degraded: number }>();
  for (const r of rows) {
    if (!r.hostingProvider) continue;
    const k = `${r.hostingProvider}|${r.hostingRegion ?? ""}`;
    if (!infra.has(k)) infra.set(k, { provider: r.hostingProvider, region: r.hostingRegion, services: 0, up: 0, down: 0, degraded: 0 });
    const g = infra.get(k)!;
    g.services++; if (r.state === "up") g.up++; else if (r.state === "down") g.down++; else if (r.state === "degraded") g.degraded++;
  }

  const incidentsRaw = await db.selectFrom("radarIncidents").selectAll()
    .where(({ or, eb }) => or([eb("status", "=", "open"), eb("startedAt", ">", new Date(Date.now() - 7 * 86_400_000))]))
    .orderBy("startedAt", "desc").limit(30).execute();
  // tolerate rows written as JSON-encoded strings by an earlier version
  const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v);
  const incidents = incidentsRaw.map((i) => ({ ...i, affected: parse(i.affected) ?? [], atRisk: parse(i.atRisk) ?? [], evidence: parse(i.evidence) ?? {} }));

  const { timeline, events } = agg;
  const nameOf = new Map(services.map((s) => [s.id, s.name]));

  // provider + concentration statistics from the latest run
  const share = (key: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = key(r); if (k && !/^Other \(/.test(k)) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([provider, n]) => ({ provider, services: n, share: n / Math.max(rows.length, 1) }))
      .sort((a, b) => b.services - a.services).slice(0, 8);
  };
  const latencyOf = (list: typeof rows) => {
    const l = list.map((r) => r.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return l.length ? l[Math.floor(l.length / 2)] : null;
  };
  const providerNames = [...new Set(rows.flatMap((r) => [r.hostingProvider, r.cdn]).filter((x): x is string => !!x && !/^Other \(/.test(x)))];
  const providers = providerNames.map((p) => {
    const list = rows.filter((r) => r.hostingProvider === p || r.cdn === p);
    return { provider: p, services: list.length, up: list.filter((r) => r.state === "up").length,
      errors: list.filter((r) => r.state === "down" || r.state === "degraded").length, medianLatencyMs: latencyOf(list) };
  }).sort((a, b) => b.services - a.services).slice(0, 12);

  return jsonResponse(request, {
    status: "live", run, services: rows,
    attribution: { geolocation: GEO_ATTRIBUTION },
    infrastructure: [...infra.values()].sort((a, b) => b.services - a.services),
    incidents,
    timeline,
    events: events.map((e) => ({ ...e, name: nameOf.get(e.serviceId) ?? e.serviceId })),
    providers,
    concentration: { hosting: share((r) => r.hostingProvider), cdn: share((r) => r.cdn), dns: share((r) => r.dnsProvider), email: share((r) => r.emailProvider) },
    categories: [...new Set(rows.map((r) => r.category))].map((c) => {
      const list = rows.filter((r) => r.category === c);
      return { category: c, services: list.length, errors: list.filter((r) => r.state === "down" || r.state === "degraded").length, medianLatencyMs: latencyOf(list) };
    }),
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
}