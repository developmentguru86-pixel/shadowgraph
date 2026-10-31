export type InputType = { id: string; email: string; consent: true; lang: "de" | "en" };
export type OutputType = { ok: true } | { error: string };

export const postReportAlertEmail = async (body: InputType): Promise<OutputType> => {
  const r = await fetch("/_api/vendors/report_alert_email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};