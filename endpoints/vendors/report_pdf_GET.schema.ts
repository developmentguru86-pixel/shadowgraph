import type { ReportLang } from "../../helpers/doraReportText";

/** The endpoint returns a PDF file; link to it directly. */
export const reportPdfUrl = (id: string, lang: ReportLang) => `/_api/vendors/report_pdf?id=${encodeURIComponent(id)}&lang=${lang}`;
