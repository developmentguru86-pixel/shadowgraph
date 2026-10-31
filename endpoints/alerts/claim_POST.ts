import { schema } from "../alerts_claim_POST.schema";
import { stackAlerts } from "../../helpers/stackAlerts";

export async function handle(request: Request) {
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ status: "not_found" }, { status: 400 }); }
  return Response.json(await stackAlerts.claim(input.sessionId), { headers: { "Cache-Control": "no-store" } });
}