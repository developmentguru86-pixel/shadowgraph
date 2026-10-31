import { getGlobalView } from "../../helpers/globalProbeJob";

// Public: latest worldwide reachability checks (Globalping probes on 6 continents) and 24h availability per continent.
export async function handle(_request: Request) {
  try {
    return Response.json(await getGlobalView(), { headers: { "Cache-Control": "public, s-maxage=120", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Worldwide checks unavailable" }, { status: 503 });
  }
}
