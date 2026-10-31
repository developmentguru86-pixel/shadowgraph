import { z } from "zod";

export const schema = z.object({ t: z.string().min(10).max(200) });
export type OutputType = { ok: true; slugs: string[]; names: string[] } | { error: string };

export const postWatchConfirm = async (t: string): Promise<OutputType> => {
  const r = await fetch("/_api/watch/confirm", { method: "POST", body: JSON.stringify({ t }), headers: { "Content-Type": "application/json" } });
  return r.json();
};
