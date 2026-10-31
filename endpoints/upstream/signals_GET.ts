import { getUpstream } from "../../helpers/upstreamJob";

// Public: live upstream signals (rule cs-v1) and their retrospective track record.
export async function handle(_request: Request) {
  try {
    return Response.json(await getUpstream(), { headers: { "Cache-Control": "public, s-maxage=120", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upstream signals unavailable" }, { status: 503 });
  }
}
