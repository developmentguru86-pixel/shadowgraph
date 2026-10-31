import { z } from "zod";

export const schema = z.object({
  email: z.string().email().max(200),
  services: z.string().max(1000).optional(),
  channel: z.string().max(40).optional(),
});
export type OutputType = { ok: true } | { error: string };

export const postRadarWaitlist = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/radar/waitlist", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};