import { doraReport } from "../../helpers/doraReport";
import { buildRegisterExtract } from "../../helpers/registerExtract";

/** GET /_api/vendors/register_csv?id=<scan id> → pre-filled register-of-information extract (CSV). Part of the paid report: 402 otherwise. */
export async function handle(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const report = await doraReport.get(id, "en");
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  if (!report.paid) return Response.json({ error: "The register extract is part of the paid report." }, { status: 402 });
  try {
    const csv = await buildRegisterExtract(report);
    const slug = (report.company ?? "scan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scan";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="register-of-information-extract-${slug}-${report.scannedAt.slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "export failed" }, { status: 500 });
  }
}
