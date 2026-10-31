import { sql } from "kysely";
import { db } from "./db";
import { callerGeoFromHeaders } from "./agentSignals";

/** "discovery" = protocol handshake / tool listing (MCP initialize, tools/list, server/discover); not part of the sales funnel. */
export type AgentFunnelEventType = "preview" | "challenge" | "paid" | "payment_failed" | "discovery";

/** Header set on ShadowGraph's own server-to-server calls, so one agent request is not logged twice. */
export const INTERNAL_HEADER = "x-shadowgraph-internal";

/**
 * ShadowGraph's own tests (regression checks after a publish): still recorded, so a test can verify the funnel, but flagged
 * `internal` and excluded from every statistic and from the globe. Tests send this user agent or the TEST_HEADER.
 */
export const TEST_USER_AGENT = "shadowgraph-regression-test";
export const TEST_HEADER = "x-shadowgraph-test";
export function isInternalTest(request?: Request, userAgent?: string | null) {
  return userAgent === TEST_USER_AGENT || !!request?.headers.get(TEST_HEADER) || request?.headers.get("user-agent") === TEST_USER_AGENT;
}

export async function recordAgentFunnelEvent(input: {
  eventType: AgentFunnelEventType;
  channel: "mcp" | "a2a" | "rest" | "preview";
  mode?: string | null;
  priceUsd?: number | null;
  userAgent?: string | null;
  /** The incoming request: used only for the sender's approximate location (CDN geo headers). The IP is never stored. */
  request?: Request;
}) {
  if (input.request?.headers.get(INTERNAL_HEADER)) return;
  const g = input.request ? callerGeoFromHeaders(input.request.headers) : null;
  await sql`
    INSERT INTO agent_funnel_events
      (event_type, channel, mode, price_usd, user_agent, caller_city, caller_country, caller_lat, caller_lon, geo_precision, internal, created_at)
    VALUES
      (${input.eventType}, ${input.channel}, ${input.mode ?? null}, ${input.priceUsd ?? null}, ${input.userAgent?.slice(0, 300) ?? null},
       ${g?.city ?? null}, ${g?.country ?? null}, ${g?.lat ?? null}, ${g?.lon ?? null}, ${g?.precision ?? null},
       ${isInternalTest(input.request, input.userAgent)}, now())
  `.execute(db).catch(() => undefined);
}

export async function getAgentFunnelMetrics() {
  const summary = await sql<{
    previews24h: number;
    challenges24h: number;
    paid24h: number;
    previews7d: number;
    challenges7d: number;
    paid7d: number;
  }>`
    SELECT
      count(*) FILTER (WHERE event_type='preview' AND created_at >= now() - interval '24 hours')::int AS "previews24h",
      count(*) FILTER (WHERE event_type='challenge' AND created_at >= now() - interval '24 hours')::int AS "challenges24h",
      count(*) FILTER (WHERE event_type='paid' AND created_at >= now() - interval '24 hours')::int AS "paid24h",
      count(*) FILTER (WHERE event_type='preview' AND created_at >= now() - interval '7 days')::int AS "previews7d",
      count(*) FILTER (WHERE event_type='challenge' AND created_at >= now() - interval '7 days')::int AS "challenges7d",
      count(*) FILTER (WHERE event_type='paid' AND created_at >= now() - interval '7 days')::int AS "paid7d"
    FROM agent_funnel_events
    WHERE NOT internal
  `.execute(db);

  const channels = await sql<{
    channel: string;
    previews: number;
    challenges: number;
    paid: number;
  }>`
    SELECT
      channel,
      count(*) FILTER (WHERE event_type='preview')::int AS previews,
      count(*) FILTER (WHERE event_type='challenge')::int AS challenges,
      count(*) FILTER (WHERE event_type='paid')::int AS paid
    FROM agent_funnel_events
    WHERE created_at >= now() - interval '30 days' AND NOT internal
    GROUP BY channel
    ORDER BY paid DESC, challenges DESC, previews DESC
  `.execute(db);

  const modes = await sql<{
    mode: string | null;
    challenges: number;
    paid: number;
    revenue_opportunity_usd: number;
  }>`
    SELECT
      mode,
      count(*) FILTER (WHERE event_type='challenge')::int AS challenges,
      count(*) FILTER (WHERE event_type='paid')::int AS paid,
      coalesce(sum(price_usd) FILTER (WHERE event_type='paid'),0)::float8 AS revenue_opportunity_usd
    FROM agent_funnel_events
    WHERE created_at >= now() - interval '30 days' AND NOT internal
    GROUP BY mode
    ORDER BY revenue_opportunity_usd DESC, challenges DESC
  `.execute(db);

  const s = summary.rows[0] ?? {
    previews24h: 0, challenges24h: 0, paid24h: 0,
    previews7d: 0, challenges7d: 0, paid7d: 0,
  };

  const conversion = (paid: number, challenges: number) =>
    challenges > 0 ? Math.round((paid / challenges) * 10_000) / 100 : 0;

  return {
    last24h: {
      previews: s.previews24h,
      challenges: s.challenges24h,
      paid: s.paid24h,
      challengeToPaidPct: conversion(s.paid24h, s.challenges24h),
    },
    last7d: {
      previews: s.previews7d,
      challenges: s.challenges7d,
      paid: s.paid7d,
      challengeToPaidPct: conversion(s.paid7d, s.challenges7d),
    },
    channels: channels.rows,
    modes: modes.rows,
  };
}
