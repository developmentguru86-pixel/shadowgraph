import { z } from "zod";

export const schema = z.object({
  email: z.string().max(254),
  slug: z.string().min(1).max(80),
  source: z.string().max(80).optional(),
});
export type OutputType = { status: "sent" | "queued" | "added"; count: number } | { error: string };

export const postWatchSubscribe = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/watch/subscribe", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return r.json();
};
