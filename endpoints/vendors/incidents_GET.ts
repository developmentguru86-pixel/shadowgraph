import { db } from "../../helpers/db";
import { incidentFiles } from "../../helpers/doraIncident";
import { isReportLang } from "../../helpers/doraReportText";
import { maskEmail } from "../../helpers/reportMonitoring";

/** GET /_api/vendors/incidents?id=<scan id>&lang=de|en → DORA incident files of a paid report (402 otherwise). */
export async function handle(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const q = url.searchParams.get("lang");
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const row = await db.selectFrom("vendorScans").select(["reportPaidAt"]).where("id", "=", id).executeTakeFirst();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  if (!row.reportPaidAt) return Response.json({ error: "Part of the paid report." }, { status: 402 });
  const monitors = await db.selectFrom("customMonitors").select(["url", "createdAt"]).where("subscriptionId", "=", `dora_${id}`).where("active", "=", true).execute();
  const sub = await db.selectFrom("alertSubscriptions").select(["email"]).where("id", "=", `dora_${id}`).executeTakeFirst();
  const incidents = await incidentFiles(id, isReportLang(q) ? q : "de");
  return Response.json({
    monitoring: { hosts: [...new Set(monitors.map((m) => new URL(m.url).hostname))], checks: monitors.length, since: monitors.length ? monitors.map((m) => new Date(m.createdAt).toISOString()).sort()[0] : null },
    alertEmail: sub?.email ? maskEmail(sub.email) : null,
    incidents,
  }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}