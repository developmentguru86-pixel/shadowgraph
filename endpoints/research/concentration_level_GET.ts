import { mppStore } from "../../helpers/mppStore";
import { LEVEL_KEY } from "../../helpers/concentrationLevel";

// Customer-concentration level test (cc-v2): full result as JSON, including the monthly long-short series.
export async function handle(_request: Request) {
  const result = await mppStore.get(LEVEL_KEY);
  if (!result) return Response.json({ status: "not_run" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" } });
}