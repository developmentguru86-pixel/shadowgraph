import type { DoraReport } from "../../helpers/doraReport";
import type { ReportLang } from "../../helpers/doraReportText";

export type OutputType = DoraReport;

export const getVendorReport = async (id: string, lang: ReportLang = "en"): Promise<OutputType> => {
  const r = await fetch(`/_api/vendors/report?id=${encodeURIComponent(id)}&lang=${lang}`);
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error("Report unavailable");
  return r.json();
};

/** URL of the server-generated PDF (paid reports only). */
export const vendorReportPdfUrl = (id: string, lang: ReportLang) => `/_api/vendors/report_pdf?id=${encodeURIComponent(id)}&lang=${lang}`;
