import { queueTask } from "@runtime/queueTask";
import { secConcentration } from "./secConcentration";
import { mppStore } from "./mppStore";

/**
 * One-off backfill of the discovered SEC universe (concentration_filer_scans).
 * Each step scans 150 due filers (~1-2 min, far under the 15-min limit) and queues the next step.
 * The chain ends by itself when no filer is due (every scanned filer gets last_scanned_at, so it is
 * not due again for 7 days) or after MAX_STEPS. The daily secConcJob keeps it fresh afterwards.
 */
const STATE_KEY = "job:sec-concentration:backfill";
const MAX_STEPS = 40;

export async function secBackfill(payload: { step?: number; runId?: string } = {}) {
  const step = payload.step ?? 0;
  const runId = payload.runId ?? new Date().toISOString();
  const s = await secConcentration(150);
  const prev = ((await mppStore.get(STATE_KEY)) ?? {}) as { scanned?: number; facts?: number; named?: number; textAttributed?: number; errors?: number };
  const done = s.filers === 0 || step + 1 >= MAX_STEPS;
  await mppStore.put(STATE_KEY, {
    runId, step, done, updatedAt: new Date().toISOString(),
    scanned: (step === 0 ? 0 : prev.scanned ?? 0) + s.filers,
    facts: (step === 0 ? 0 : prev.facts ?? 0) + s.facts,
    named: (step === 0 ? 0 : prev.named ?? 0) + s.named,
    textAttributed: (step === 0 ? 0 : prev.textAttributed ?? 0) + s.textAttributed,
    errors: (step === 0 ? 0 : prev.errors ?? 0) + s.errors.length,
    candidates: s.candidates,
  });
  await mppStore.delete("cache:relationship-graph:v5");
  if (!done) await queueTask("secBackfill", { step: step + 1, runId });
}
