import { statusBoards } from "../helpers/statusBoards";

// Public read-only data of a white-label status board. Unguessable id; no private URLs in the payload.
export async function handle(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    const board = await statusBoards.publicView(id);
    if (!board) return Response.json({ error: "Board not found" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60", "X-Robots-Tag": "noindex" } });
    return Response.json({ board }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60", "X-Robots-Tag": "noindex", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    console.error("board failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Board unavailable" }, { status: 500 });
  }
}