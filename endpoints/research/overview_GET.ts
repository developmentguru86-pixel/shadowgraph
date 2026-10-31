import { getResearch } from "../../helpers/researchJob";

// Public research results (validation against official status pages, shared-fate study, concentration).
// Recomputed hourly by researchJob; served from cache.
export async function handle(_request: Request) {
  try {
    return Response.json(await getResearch(), { headers: { "Cache-Control": "public, s-maxage=600" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Research unavailable" }, { status: 503 });
  }
}
