import { schema } from "./report_claim_POST.schema";
import { doraReport } from "../../helpers/doraReport";

// Confirms a paid Checkout session for this scan and unlocks its report.
export async function handle(request: Request) {
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ status: "not_found" }, { status: 400 }); }
  return Response.json({ status: await doraReport.claim(input.id, input.sessionId) }, { headers: { "Cache-Control": "no-store" } });
}