import { schema } from "./subscribe_POST.schema";
import { freeAlerts } from "../../helpers/freeAlerts";

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  try {
    return Response.json(await freeAlerts.subscribe(input), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Sign-up failed." }, { status: 400 });
  }
}
