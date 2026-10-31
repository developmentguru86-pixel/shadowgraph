import { queueTask } from "@runtime/queueTask";
import { mppStore } from "../../helpers/mppStore";

// Re-runs the customer-concentration level test (cc-v2) in the background. Public, once per 6 hours.
const CLAIM = "job:concentration-level:last-start";
const COOLDOWN_MS = 6 * 3600 * 1000;

export async function handle(_request: Request) {
  const ok = await mppStore.update<boolean>(CLAIM, (cur) => {
    const last = (cur as { at?: string } | null)?.at;
    if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) return { op: "noop", result: false };
    return { op: "set", value: { at: new Date().toISOString() }, result: true };
  });
  if (!ok) return Response.json({ started: false, reason: "cooldown" });
  await queueTask("concentrationLevel", {});
  return Response.json({ started: true });
}