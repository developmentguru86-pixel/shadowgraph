import { queueTask } from "@runtime/queueTask";
import { mppStore } from "../helpers/mppStore";

// Starts the background SEC backfill chain. Public but idempotent: a new chain can only start
// when the previous one finished or has been silent for 3 hours, so it cannot be spammed.
const STATE_KEY = "job:sec-concentration:backfill";
const STALE_MS = 3 * 3600 * 1000;

export async function handle(_request: Request) {
  const runId = new Date().toISOString();
  const started = await mppStore.update<boolean>(STATE_KEY, (current) => {
    const c = current as { done?: boolean; updatedAt?: string } | null;
    const active = c && !c.done && c.updatedAt && Date.now() - Date.parse(c.updatedAt) < STALE_MS;
    if (active) return { op: "noop", result: false };
    return { op: "set", value: { runId, step: -1, done: false, updatedAt: runId, scanned: 0, facts: 0 }, result: true };
  });
  if (!started) return Response.json({ started: false, reason: "already running", state: await mppStore.get(STATE_KEY) });
  await queueTask("secBackfill", { step: 0, runId });
  return Response.json({ started: true, runId });
}
