import { sql } from "kysely";
import { db } from "../../helpers/db";
import { statusBoards } from "../../helpers/statusBoards";

// SLA evidence for a saved board (Team plan): one row per system and UTC day with check counts, availability and downtime,
// plus every disruption our probes recorded. Default period: the current and previous calendar month.
export async function handle(request: Request) {
  const u = new URL(request.url).searchParams;
  const b = await statusBoards.forEvidence(u.get("id") ?? "");
  if (!b) return new Response("board not found\n", { status: 404 });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const sids = b.serviceIds as string[], mids = b.monitorIds as string[];
  const names = new Map<string, string>();
  const rows: string[] = [];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  if (sids.length) {
    for (const s of await db.selectFrom("radarServices").select(["id", "name", "domain"]).where("id", "in", sids).execute()) names.set(s.id, `${s.name} (${s.domain})`);
    const d = await sql<{ sid: string; d: string; ok: number; n: number; p50: number | null }>`
      SELECT service_id AS sid, (hour AT TIME ZONE 'UTC')::date::text AS d, sum(n_ok)::int AS ok, sum(n)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY p50_ms)::float AS p50
      FROM radar_service_hourly WHERE hour >= ${from} AND service_id IN (${sql.join(sids)}) GROUP BY 1, 2 ORDER BY 1, 2`.execute(db);
    for (const r of d.rows) rows.push([q(names.get(r.sid) ?? r.sid), "third-party", r.d, r.n, r.ok, (r.ok / Math.max(1, r.n)).toFixed(5), (r.n - r.ok) * 5, r.p50 === null ? "" : Math.round(r.p50)].join(","));
  }
  if (mids.length) {
    for (const m of await db.selectFrom("customMonitors").select(["id", "name"]).where("id", "in", mids).where("subscriptionId", "=", b.subscriptionId).execute()) names.set(m.id, m.name);
    const d = await sql<{ id: string; d: string; ok: number; n: number; p50: number | null }>`
      SELECT monitor_id AS id, (checked_at AT TIME ZONE 'UTC')::date::text AS d, count(*) FILTER (WHERE ok)::int AS ok, count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::float AS p50
      FROM custom_checks WHERE checked_at >= ${from} AND monitor_id IN (${sql.join(mids)}) GROUP BY 1, 2 ORDER BY 1, 2`.execute(db);
    for (const r of d.rows) if (names.has(r.id)) rows.push([q(names.get(r.id)!), "own endpoint", r.d, r.n, r.ok, (r.ok / Math.max(1, r.n)).toFixed(5), (r.n - r.ok) * 5, r.p50 === null ? "" : Math.round(r.p50)].join(","));
  }
  const episodes = sids.length ? await db.selectFrom("radarEpisodes").select(["serviceId", "startedAt", "recoveredAt", "nFailed", "reason"])
    .where("serviceId", "in", sids).where("startedAt", ">=", from).orderBy("startedAt").execute() : [];
  const target = b.slaTarget ? `${(b.slaTarget * 100).toFixed(2)}%` : "not set";
  const body = [
    `# ShadowGraph availability evidence · board "${b.title.replace(/"/g, "'")}" · generated ${now.toISOString()}`,
    `# Contract SLA target on this board: ${target}. Method: HTTPS reachability check every 5 minutes from AWS us-east-1; downtime_minutes = failed checks x 5.`,
    `# Independent external measurement. It does not see partial failures behind a working front door and is not the vendor's own SLA report.`,
    "system,type,date_utc,checks,successful_checks,availability,downtime_minutes,median_response_ms",
    ...rows,
    "",
    "# Disruptions detected (two or more consecutive failed checks)",
    "system,started_utc,recovered_utc,failed_checks,reason",
    ...episodes.map((e) => [q(names.get(e.serviceId) ?? e.serviceId), new Date(e.startedAt).toISOString(), e.recoveredAt ? new Date(e.recoveredAt).toISOString() : "ongoing", e.nFailed, q(e.reason ?? "")].join(",")),
  ].join("\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sla-evidence-${b.publicId}-${now.toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" } });
}