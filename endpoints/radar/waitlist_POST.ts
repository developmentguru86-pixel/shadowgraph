import { randomUUID } from "crypto";
import { schema } from "../radar_waitlist_POST.schema";
import { db } from "../../helpers/db";
import { withinHourlyLimit } from "../../helpers/rateLimit";

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Please enter a valid email." }, { status: 400 }); }
  if (!(await withinHourlyLimit(request, "waitlist", 8))) return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  await db.insertInto("radarWaitlist").values({
    id: randomUUID(), email: input.email.toLowerCase(), services: input.services ?? null, channel: input.channel ?? null,
  }).execute();
  return Response.json({ ok: true });
}