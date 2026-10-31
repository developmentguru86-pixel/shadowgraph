import { schema } from "./scan_start_POST.schema";
import { parseVendorList } from "../../helpers/vendorList";
import { startVendorScan } from "../../helpers/vendorBulkScan";
import { clientIp } from "../../helpers/visitorStats";

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Paste or upload a vendor list (one domain per line, or a CSV)." }, { status: 400 }); }
  const parsed = parseVendorList(input.text);
  if (!parsed.vendors.length) return Response.json({ error: "No valid vendor domains found. Use e.g. stripe.com or https://www.salesforce.com", rejected: parsed.rejected }, { status: 400 });
  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ error: "Please check the email address." }, { status: 400 });
  try {
    const { id } = await startVendorScan({ vendors: parsed.vendors, company: input.company?.trim() || null, email, clientIp: clientIp(request) });
    return Response.json({ id, accepted: parsed.vendors.length, rejected: parsed.rejected, truncated: parsed.truncated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not start the scan." }, { status: 429 });
  }
}
