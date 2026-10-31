import { companyDependencies } from "../../helpers/companyDependencies";

/** GET /_api/company/index → every company with a disclosed major-customer relationship (A–Z). */
export async function handle(_request: Request) {
  try {
    const list = await companyDependencies.index();
    return Response.json({ companies: list }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "unavailable" }, { status: 503 });
  }
}
