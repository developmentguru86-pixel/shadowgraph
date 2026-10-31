import { schema } from "./report_checkout_POST.schema";
import { doraReport } from "../../helpers/doraReport";

const DEFAULT_ORIGIN = "https://shadowalpha.online";
const ALLOWED = /^((www\.)?shadowalpha\.online)$/;

// One-time Stripe Checkout for the assessment report of one scan. Redirect origin is allow-listed (no open redirect).
import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Missing scan id." }, { status: 400 }); }
  const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  const origin = ALLOWED.test(host) ? `https://${host}` : DEFAULT_ORIGIN;
  try {
    return Response.json({ url: await doraReport.createCheckout(input.id, origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "not_found") return Response.json({ error: "This scan does not exist or was deleted." }, { status: 404 });
    console.error("report checkout failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Checkout is temporarily unavailable." }, { status: 503 });
  }
}