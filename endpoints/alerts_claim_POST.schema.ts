import { z } from "zod";

export const schema = z.object({ sessionId: z.string().min(10).max(300) });
export type OutputType = { status: "issued"; token: string } | { status: "already_claimed" | "not_paid" | "not_found" };

export const postAlertsClaim = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/alerts/claim", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};