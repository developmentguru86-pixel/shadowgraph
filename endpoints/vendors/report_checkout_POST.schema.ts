import { z } from "zod";

export const schema = z.object({ id: z.string().min(16).max(40) });
export type OutputType = { url: string } | { error: string };

export const postVendorReportCheckout = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/vendors/report_checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};