import { geoRefreshJob } from "../../helpers/geoRefreshJob";

// Manual trigger for the weekly location refresh. Safe to expose: the job holds a 6-hour lock.
export async function handle(_request: Request) {
  try {
    return Response.json(await geoRefreshJob(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ran: false, error: e instanceof Error ? e.message : "refresh failed" }, { status: 500 });
  }
}
