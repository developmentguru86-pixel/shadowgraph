import { dependencyDataset } from "../../helpers/dependencyDataset";

// Free sample: top official (XBRL-tagged customer + percentage) relationships by revenue share.
export async function handle(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const rows = await dependencyDataset.rows();
  const sample = rows.filter((r) => r.attribution === "official").slice(0, 25);
  if (format === "csv") {
    return new Response(dependencyDataset.toCsv(sample), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="shadowgraph-dependencies-sample.csv"',
        "Cache-Control": "public, s-maxage=900",
      },
    });
  }
  return Response.json(
    { stats: dependencyDataset.stats(rows), price: dependencyDataset.priceLabel, sampleSize: sample.length, rows: sample },
    { headers: { "Cache-Control": "public, s-maxage=900" } },
  );
}