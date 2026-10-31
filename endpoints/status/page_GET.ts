import { getStatusPageData } from "../../helpers/statusPage";

// Public: data behind one "Is X down?" page (provider, single service or brand), refreshed with every 5-minute sweep.
export async function handle(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug") ?? "";
  try {
    return Response.json(await getStatusPageData(slug, { full: params.get("full") === "1" }), { headers: { "Cache-Control": "public, s-maxage=60", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Status unavailable" }, { status: 503 });
  }
}
