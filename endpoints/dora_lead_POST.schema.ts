import { z } from "zod";

export const schema = z.object({
  email: z.string().email().max(200),
  company: z.string().min(2).max(200),
  role: z.string().max(120).optional(),
  vendorCount: z.string().max(40).optional(),
  message: z.string().max(2000).optional(),
  scannedDomains: z.array(z.string().max(260)).max(10).optional(),
});
export type OutputType = { ok: true } | { error: string };

export const postDoraLead = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/dora/lead", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};
