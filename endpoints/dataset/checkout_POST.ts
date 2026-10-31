import { dependencyDataset } from "../../helpers/dependencyDataset";

const DEFAULT_ORIGIN = "https://shadowalpha.online";
const ALLOWED = /^((www\.)?shadowalpha\.online|(www\.)?shadowalphatrade\.com)$/;

// Creates a Stripe Checkout subscription session. Redirect origin is allow-listed (no open redirect).
import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  const origin = ALLOWED.test(host) ? `https://${host}` : DEFAULT_ORIGIN;
  try {
    return Response.json({ url: await dependencyDataset.createCheckout(origin) });
  } catch (e) {
    console.error("dataset checkout failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Checkout is temporarily unavailable." }, { status: 503 });
  }
}