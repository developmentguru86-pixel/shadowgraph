import { dependencyReport } from "../../helpers/dependencyReport";

// Dated snapshot of the "Who runs the internet?" report (recomputed at most once per UTC day). Free, citable JSON.
export async function handle(_request: Request) {
  try {
    return Response.json(await dependencyReport(), { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch (e) {
    console.error("report failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Report temporarily unavailable." }, { status: 503 });
  }
}