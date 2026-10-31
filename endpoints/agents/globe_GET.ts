import { getAgentGlobe } from "../../helpers/agentGlobe";
import { jsonResponse } from "../../helpers/jsonResponse";

export async function handle(request: Request) {
  try {
    return jsonResponse(request, await getAgentGlobe(), { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
