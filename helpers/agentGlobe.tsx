import { sql } from "kysely";
import { db } from "./db";
import { agentNameOf, isGenericClient } from "./agentSignals";
import { lastAgentDirectoryRun } from "./agentDirectoryJob";
import { lastAgentProbe } from "./agentProbeJob";

/** ShadowGraph itself: the receiving end of every signal arc (operated from Vienna). */
export const AGENT_HOME = { lat: 48.21, lon: 16.37, label: "ShadowGraph", sub: "receiver · Vienna" };

export type AgentSignalKind = "discovery" | "preview" | "challenge" | "paid" | "payment_failed";
export type AgentGlobeData = {
  home: typeof AGENT_HOME;
  /** Located senders of the last 7 days, one arc per agent + place. */
  signals: Array<{
    key: string; agent: string; generic: boolean; channels: string[]; lat: number; lon: number; place: string; precision: "city" | "country";
    count: number; kinds: Partial<Record<AgentSignalKind, number>>; lastAt: string;
    /** only handshakes in 7 days: an uptime / registry robot that never asks for data */
    monitor: boolean;
    /** requests in the last 24 hours */
    count24h: number;
    /** epoch ms of each request in the last 15 minutes: the globe replays exactly these, nothing else */
    recent: number[];
  }>;
  /** Latest individual requests (also those without a recorded location). */
  feed: Array<{ at: string; agent: string; channel: string; kind: string; mode: string | null; place: string | null }>;
  /** Public agent endpoints grouped by location. */
  hubs: Array<{ key: string; lat: number; lon: number; label: string; sub: string; placement: "city" | "region"; count: number; mcp: number; a2a: number; reachable: number; checked: number; sample: Array<{ n: string; p: string; h: string; s: number | null }> }>;
  /** last hourly reachability check of the placed agent endpoints */
  probe: { at: string; hosts: number; checked: number; reachable: number } | null;
  totals: {
    directory: number; mcp: number; a2a: number; placed: number; edge: number; unresolved: number;
    edgeNetworks: Array<{ network: string; n: number }>;
    signals7d: number; located7d: number; agents7d: number; signals24h: number;
    /** requests of the last 7 days per funnel step ("paid" = settled payment, the only step that is revenue) */
    kinds7d: Record<AgentSignalKind, number>;
  };
  directoryCheckedAt: string | null;
  locationSince: string;
};

const LOCATION_SINCE = "2026-10-13";
// own regression tests are flagged agent_funnel_events.internal and never shown (see agentFunnel.isInternalTest)

export async function getAgentGlobe(): Promise<AgentGlobeData> {
  const [sig, feed, hubs, dir, nets, tot, last] = await Promise.all([
    sql<{ ua: string | null; channel: string; kind: string; lat: number; lon: number; city: string | null; country: string | null; precision: string; n: number; n24: number; lastat: Date; recent: number[] | null }>`
      SELECT user_agent AS ua, channel, event_type AS kind, caller_lat AS lat, caller_lon AS lon, caller_city AS city, caller_country AS country,
             geo_precision AS precision, count(*)::int AS n, max(created_at) AS lastat,
             count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS n24,
             (array_agg((extract(epoch FROM created_at) * 1000)::bigint ORDER BY created_at DESC)
               FILTER (WHERE created_at >= now() - interval '15 minutes'))[1:30] AS recent
      FROM agent_funnel_events
      WHERE created_at >= now() - interval '7 days' AND caller_lat IS NOT NULL AND NOT internal
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      ORDER BY max(created_at) DESC
      LIMIT 600`.execute(db),
    sql<{ at: Date; ua: string | null; channel: string; kind: string; mode: string | null; city: string | null; country: string | null }>`
      SELECT created_at AS at, user_agent AS ua, channel, event_type AS kind, mode, caller_city AS city, caller_country AS country
      FROM agent_funnel_events
      WHERE created_at >= now() - interval '7 days' AND NOT internal
      ORDER BY created_at DESC
      LIMIT 40`.execute(db),
    sql<{ placement: "city" | "region"; region: string | null; city: string | null; country: string | null; lat: number; lon: number; n: number; mcp: number; a2a: number; okn: number; chk: number; sample: Array<{ n: string; p: string; h: string; s: number | null }> }>`
      SELECT placement, region, city, country, round(lat::numeric, 1)::float8 AS lat, round(lon::numeric, 1)::float8 AS lon,
             count(*)::int AS n,
             count(*) FILTER (WHERE protocol = 'mcp')::int AS mcp,
             count(*) FILTER (WHERE protocol = 'a2a')::int AS a2a,
             count(*) FILTER (WHERE last_ok)::int AS okn,
             count(last_checked_at)::int AS chk,
             (array_agg(json_build_object('n', coalesce(title, name), 'p', protocol, 'h', host,
               's', CASE WHEN last_checked_at IS NULL THEN NULL WHEN last_ok THEN 1 ELSE 0 END) ORDER BY last_ok NULLS LAST, protocol, name))[1:8] AS sample
      FROM agent_directory
      WHERE placement IN ('city', 'region') AND lat IS NOT NULL
      GROUP BY 1, 2, 3, 4, 5, 6
      ORDER BY n DESC
      LIMIT 900`.execute(db),
    sql<{ placement: string; protocol: string; n: number }>`
      SELECT placement, protocol, count(*)::int AS n FROM agent_directory GROUP BY 1, 2`.execute(db),
    sql<{ network: string; n: number }>`
      SELECT network, count(*)::int AS n FROM agent_directory WHERE placement = 'edge' AND network IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`.execute(db),
    sql<{ s7: number; l7: number; s24: number; kdisc: number; kprev: number; kchal: number; kpaid: number; kfail: number }>`
      SELECT count(*)::int AS s7, count(*) FILTER (WHERE caller_lat IS NOT NULL)::int AS l7,
             count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS s24,
             count(*) FILTER (WHERE event_type = 'discovery')::int AS kdisc,
             count(*) FILTER (WHERE event_type = 'preview')::int AS kprev,
             count(*) FILTER (WHERE event_type = 'challenge')::int AS kchal,
             count(*) FILTER (WHERE event_type = 'paid')::int AS kpaid,
             count(*) FILTER (WHERE event_type = 'payment_failed')::int AS kfail
      FROM agent_funnel_events WHERE created_at >= now() - interval '7 days' AND NOT internal`.execute(db),
    lastAgentDirectoryRun(),
  ]);

  // one arc per agent + location; kinds and channels merged
  const arcs = new Map<string, AgentGlobeData["signals"][number]>();
  const agents = new Set<string>();
  for (const r of sig.rows) {
    const agent = agentNameOf(r.ua);
    agents.add(agent);
    const key = `${agent}|${r.lat},${r.lon}`;
    const place = r.precision === "city" ? [r.city, r.country].filter(Boolean).join(", ") || `${r.lat}, ${r.lon}` : (r.country ?? "unknown");
    const a: AgentGlobeData["signals"][number] = arcs.get(key) ?? {
      key, agent, generic: isGenericClient(agent), channels: [], lat: r.lat, lon: r.lon, place,
      precision: r.precision === "city" ? "city" : "country", count: 0, kinds: {}, lastAt: new Date(r.lastat).toISOString(),
      monitor: true, count24h: 0, recent: [],
    };
    a.count += r.n;
    a.count24h += r.n24;
    if (r.kind !== "discovery") a.monitor = false;
    // postgres bigint arrives as string: normalise, newest first, at most 30 per arc
    a.recent = [...a.recent, ...(r.recent ?? []).map(Number)].sort((x, y) => y - x).slice(0, 30);
    a.kinds[r.kind as AgentSignalKind] = (a.kinds[r.kind as AgentSignalKind] ?? 0) + r.n;
    if (!a.channels.includes(r.channel)) a.channels.push(r.channel);
    if (new Date(r.lastat).toISOString() > a.lastAt) a.lastAt = new Date(r.lastat).toISOString();
    arcs.set(key, a);
  }

  const by = (placement: string, protocol?: string) => dir.rows.filter((r) => r.placement === placement && (!protocol || r.protocol === protocol)).reduce((s, r) => s + r.n, 0);
  const all = dir.rows.reduce((s, r) => s + r.n, 0);
  const t = tot.rows[0] ?? { s7: 0, l7: 0, s24: 0, kdisc: 0, kprev: 0, kchal: 0, kpaid: 0, kfail: 0 };

  return {
    home: AGENT_HOME,
    signals: [...arcs.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 150),
    feed: feed.rows.map((r) => ({
      at: new Date(r.at).toISOString(), agent: agentNameOf(r.ua), channel: r.channel, kind: r.kind, mode: r.mode,
      place: r.city ? [r.city, r.country].filter(Boolean).join(", ") : r.country,
    })),
    hubs: hubs.rows.map((h) => ({
      key: `a:${h.placement}:${h.region ?? h.city ?? ""}:${h.lat},${h.lon}`, lat: h.lat, lon: h.lon,
      label: h.placement === "region" ? `${h.city ?? h.region}` : (h.city ?? "—"),
      sub: h.placement === "region" ? (h.region ?? "") : (h.country ?? ""),
      placement: h.placement, count: h.n, mcp: h.mcp, a2a: h.a2a, reachable: h.okn, checked: h.chk, sample: h.sample ?? [],
    })),
    totals: {
      directory: all,
      mcp: dir.rows.filter((r) => r.protocol === "mcp").reduce((s, r) => s + r.n, 0),
      a2a: dir.rows.filter((r) => r.protocol === "a2a").reduce((s, r) => s + r.n, 0),
      placed: by("city") + by("region"), edge: by("edge"), unresolved: by("unresolved"),
      edgeNetworks: nets.rows,
      signals7d: t.s7, located7d: t.l7, agents7d: agents.size, signals24h: t.s24,
      kinds7d: { discovery: t.kdisc, preview: t.kprev, challenge: t.kchal, paid: t.kpaid, payment_failed: t.kfail },
    },
    directoryCheckedAt: last?.at ?? null,
    probe: await lastAgentProbe(),
    locationSince: LOCATION_SINCE,
  };
}
