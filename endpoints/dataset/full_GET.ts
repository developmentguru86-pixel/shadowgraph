import { dependencyDataset } from "../../helpers/dependencyDataset";

// Full dataset for subscribers. Key via "Authorization: Bearer sgd_..." or "x-api-key: sgd_...".
export async function handle(request: Request) {
  const auth = request.headers.get("authorization");
  const key = (auth?.startsWith("Bearer ") ? auth.slice(7) : null) ?? request.headers.get("x-api-key");
  const check = await dependencyDataset.authorize(key?.trim() ?? null);
  if (!check.ok) {
    return Response.json(
      { error: check.reason, subscribe: "https://shadowalpha.online/data" },
      { status: check.reason === "subscription_inactive" ? 402 : 401 },
    );
  }
  const rows = await dependencyDataset.rows();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new Response(dependencyDataset.toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="shadowgraph-dependencies.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json({ stats: dependencyDataset.stats(rows), rows }, { headers: { "Cache-Control": "no-store" } });
}