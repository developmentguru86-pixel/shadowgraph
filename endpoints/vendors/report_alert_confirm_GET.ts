import { confirmAlertEmail } from "../../helpers/reportMonitoring";

/** GET /_api/vendors/report_alert_confirm?id=&t= → activates the alert address, then back to the report. */
export async function handle(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id) || !/^[A-Za-z0-9_-]{10,60}$/.test(t)) return new Response("Invalid link", { status: 400 });
  const r = await confirmAlertEmail(id, t);
  const to = `/vendors/report?id=${encodeURIComponent(id)}&lang=${r.lang}&alerts=${r.ok ? "on" : "invalid"}#vorfaelle`;
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}