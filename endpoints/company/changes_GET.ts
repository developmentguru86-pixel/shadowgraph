import { concentrationWatch } from "../../helpers/concentrationWatch";

/** GET /_api/company/changes → annual filings of the last 90 days whose major customers changed. */
export async function handle(_request: Request) {
  try {
    const list = await concentrationWatch.recentChanges(90);
    return Response.json({ filings: list }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unavailable" }, { status: 503 });
  }
}
