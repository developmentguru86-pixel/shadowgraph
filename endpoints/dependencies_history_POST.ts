import { queueTask } from "@runtime/queueTask";
import { mppStore } from "../helpers/mppStore";

// Starts the historical (2014+) SEC concentration backfill. Public but idempotent: a new chain only starts
// when the previous one finished or has been silent for 3 hours.
const STATE = "job:sec-history:backfill";

export async function handle(_request: Request) {
  const started = await mppStore.update<boolean>(STATE, (cur) => {
    const c = cur as { done?: boolean; updatedAt?: string } | null;
    if (c && !c.done && c.updatedAt && Date.now() - Date.parse(c.updatedAt) < 3 * 3600_000) return { op: "noop", result: false };
    return { op: "set", value: { step: -1, cursor: 0, done: false, updatedAt: new Date().toISOString() }, result: true };
  });
  if (!started) return Response.json({ started: false, reason: "already running", state: await mppStore.get(STATE) });
  await queueTask("secHistory", { step: 0 });
  return Response.json({ started: true });
}