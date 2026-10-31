import { doraReport } from "../../helpers/doraReport";
import { isReportLang } from "../../helpers/doraReportText";

/** GET /_api/vendors/report?id=<scan id>[&lang=en|de] → the assessment report (full when paid, a preview otherwise). */
export async function handle(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const lang = url.searchParams.get("lang");
  const report = await doraReport.get(id, isReportLang(lang) ? lang : "en");
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(report, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
