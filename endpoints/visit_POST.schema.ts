import { z } from "zod";

export const schema = z.object({
  path: z.string().max(400),
  referrer: z.string().max(600).optional(),
});
export type OutputType = { ok: true };

/** Fire-and-forget page-view ping. keepalive lets it finish when the visitor navigates away. */
export const postVisit = (body: z.infer<typeof schema>) =>
  fetch("/_api/visit", { method: "POST", body: JSON.stringify(body), keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => undefined);
