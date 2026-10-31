import { sql } from "kysely";
import { db } from "../helpers/db";

export async function handle() {
  const total = await db
    .selectFrom("machineUsage")
    .select([
      sql<number>`count(*)::int`.as("paidCalls"),
      sql<number>`coalesce(sum(price_usd), 0)::float8`.as("revenueUsd"),
      sql<Date | null>`max(created_at)`.as("lastPaidCallAt"),
    ])
    .executeTakeFirstOrThrow();

  const modes = await db
    .selectFrom("machineUsage")
    .select([
      "mode",
      sql<number>`count(*)::int`.as("calls"),
      sql<number>`coalesce(sum(price_usd), 0)::float8`.as("revenueUsd"),
    ])
    .groupBy("mode")
    .orderBy(sql`sum(price_usd)`, "desc")
    .execute();

  return new Response(JSON.stringify({
    paidCalls: total.paidCalls,
    revenueUsd: total.revenueUsd,
    lastPaidCallAt: total.lastPaidCallAt?.toISOString() ?? null,
    byMode: modes,
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}