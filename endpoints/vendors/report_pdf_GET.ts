import { doraReport } from "../../helpers/doraReport";
import { isReportLang } from "../../helpers/doraReportText";
import { renderReportPdf } from "../../helpers/doraReportPdf";

/** GET /_api/vendors/report_pdf?id=<scan id>&lang=en|de → the paid assessment as an A4 PDF file. Unpaid reports: 402. */
export async function handle(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const q = url.searchParams.get("lang");
  const lang = isReportLang(q) ? q : "en";
  const report = await doraReport.get(id, lang);
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  if (!report.paid) return Response.json({ error: "The PDF is part of the paid report." }, { status: 402 });
  try {
    const bytes = await renderReportPdf(report, lang);
    const slug = (report.company ?? "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
    const name = `${lang === "de" ? "IKT-Konzentrationsrisiko" : "ICT-concentration-risk"}-${slug}-${report.doc.id}.pdf`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "PDF generation failed" }, { status: 500 });
  }
}
