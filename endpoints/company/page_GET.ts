import { companyDependencies } from "../../helpers/companyDependencies";

/** GET /_api/company/page?slug=crus → major customers (with history) and dependent suppliers of one company. */
export async function handle(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  try {
    const page = await companyDependencies.page(slug);
    if (!page) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(page, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unavailable" }, { status: 503 });
  }
}
