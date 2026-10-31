import { randomUUID } from "crypto";
import { schema } from "../dora_lead_POST.schema";
import { db } from "../../helpers/db";
import { withinHourlyLimit } from "../../helpers/rateLimit";

// Pilot request from the fintech third-party-risk landing page.
import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Please provide a valid work email and company." }, { status: 400 }); }
  if (!(await withinHourlyLimit(request, "dora-lead", 8))) return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  await db.insertInto("fintechLeads").values({
    id: randomUUID(), email: input.email.toLowerCase(), company: input.company, role: input.role ?? null,
    vendorCount: input.vendorCount ?? null, message: input.message ?? null,
    scannedDomains: input.scannedDomains?.join(", ") ?? null,
  }).execute();
  return Response.json({ ok: true });
}
