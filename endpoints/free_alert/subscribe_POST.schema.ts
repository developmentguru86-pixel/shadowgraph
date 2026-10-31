import { z } from "zod";

export const schema = z.object({
  email: z.string().max(254),
  serviceIds: z.array(z.string().max(120)).min(1).max(25),
  name: z.string().min(1).max(120),
  source: z.string().max(80).optional(),
});
export type OutputType = { status: "sent" | "queued" } | { error: string };

export const postFreeAlert = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/free_alert/subscribe", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return r.json();
};
