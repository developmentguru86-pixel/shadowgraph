import { z } from "zod";

export const schema = z.object({ email: z.string().email().max(200), serviceIds: z.array(z.string().max(200)).min(1).max(100), plan: z.enum(["alerts", "team"]).optional() });
export type OutputType = { url?: string; error?: string };

export const postAlertsCheckout = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/alerts/checkout", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};