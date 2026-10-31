import { z } from "zod";
import { db } from "../../helpers/db";
import { requestAlertEmail } from "../../helpers/reportMonitoring";

const schema = z.object({ id: z.string().min(16).max(40), email: z.string().max(200), consent: z.literal(true), lang: z.enum(["de", "en"]).default("de") });

/** POST /_api/vendors/report_alert_email → sends a confirmation link; alerts start only after the owner confirms. */
export async function handle(request: Request) {
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Bitte E-Mail eingeben und Zustimmung bestätigen." }, { status: 400 }); }
  const row = await db.selectFrom("vendorScans").select(["reportPaidAt"]).where("id", "=", input.id).executeTakeFirst();
  if (!row?.reportPaidAt) return Response.json({ error: "not found" }, { status: 404 });
  try {
    await requestAlertEmail(input.id, input.email, input.lang);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}