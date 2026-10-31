import { z } from "zod";

export const schema = z.object({ id: z.string().min(16).max(40), sessionId: z.string().min(10).max(300) });
export type OutputType = { status: "paid" | "not_paid" | "not_found" };

export const postVendorReportClaim = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/vendors/report_claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};