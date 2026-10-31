import { statusBoards } from "../../helpers/statusBoards";
import { withinHourlyLimit } from "../../helpers/rateLimit";

// Live preview of a board over public radar services (board builder, example boards). Nothing is stored.
export async function handle(request: Request) {
  const u = new URL(request.url).searchParams;
  const ids = (u.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{2,120}$/.test(s)).slice(0, 50);
  if (!ids.length) return Response.json({ error: "Pick at least one service" }, { status: 400 });
  if (!(await withinHourlyLimit(request, "board-preview", 300))) return Response.json({ error: "Too many previews this hour. Please try again later." }, { status: 429 });
  try {
    const board = await statusBoards.preview({ serviceIds: ids, title: u.get("title") ?? undefined, accent: u.get("accent") ?? undefined, theme: u.get("theme") ?? undefined,
      logoUrl: u.get("logo"), slaTarget: u.get("sla") ? Number(u.get("sla")) : null });
    return Response.json({ board }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60", "X-Robots-Tag": "noindex" } });
  } catch (e) {
    console.error("board preview failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Preview unavailable" }, { status: 500 });
  }
}