import { z } from "zod";

export const schema = z.object({ t: z.string().min(10).max(200) });
export type OutputType = { ok: true; name: string; serviceIds: string[] } | { error: string };

export const postConfirmFreeAlert = async (t: string): Promise<OutputType> => {
  const r = await fetch("/_api/free_alert/confirm", { method: "POST", body: JSON.stringify({ t }), headers: { "Content-Type": "application/json" } });
  return r.json();
};
