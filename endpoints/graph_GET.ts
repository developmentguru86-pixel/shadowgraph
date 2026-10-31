import { buildRelationshipGraph } from "../helpers/relationshipGraphEngine";

export async function handle() {
  try {
    const output = await buildRelationshipGraph();
    return new Response(JSON.stringify(output), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Relationship graph unavailable",
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}