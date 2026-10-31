import { unsubscribeAlerts } from "../../helpers/reportMonitoring";

/** GET /_api/vendors/report_alert_off?id=&t= → stops alert emails for this report (monitoring continues for the report). */
export async function handle(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return new Response("Invalid link", { status: 400 });
  const ok = await unsubscribeAlerts(id, t);
  return new Response(ok ? "Benachrichtigungen abbestellt. / Alerts unsubscribed." : "Ungültiger Link. / Invalid link.", {
    status: ok ? 200 : 400, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}