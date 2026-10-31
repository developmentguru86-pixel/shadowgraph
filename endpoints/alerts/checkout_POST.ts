import { schema } from "../alerts_checkout_POST.schema";
import { stackAlerts } from "../../helpers/stackAlerts";

const ALLOWED = /^((www\.)?shadowalpha\.online|(www\.)?shadowalphatrade\.com)$/;

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Enter a valid email and at least one service." }, { status: 400 }); }
  const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  const origin = ALLOWED.test(host) ? `https://${host}` : "https://shadowalpha.online";
  try {
    return Response.json({ url: await stackAlerts.createCheckout(origin, input.email, input.serviceIds, input.plan ?? "alerts") });
  } catch (e) {
    console.error("alerts checkout failed", e instanceof Error ? e.message : e);
    const m = e instanceof Error ? e.message : "";
    return Response.json({ error: /^(Too many requests|The activation email)/.test(m) ? m : "Checkout is temporarily unavailable." }, { status: 503 });
  }
}