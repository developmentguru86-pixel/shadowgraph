import { secConcentration, type ConcentrationRunSummary } from "./secConcentration";
import { mppStore } from "./mppStore";
import { concentrationWatch } from "./concentrationWatch";
import { COMPANY_INDEX_KEY } from "./companyDependencies";

// Daily rolling SEC customer-concentration scan (~300 filers/run). The 20h claim is shared with the
// public /_api/dependencies_refresh endpoint, so neither path can run more than once per day.
const KEY = "job:sec-concentration:last-run";
const COOLDOWN_MS = 20 * 3600 * 1000;

export async function secConcJob(): Promise<{ ran: boolean; reason?: string; last?: unknown; summary?: ConcentrationRunSummary }> {
  const claimed = await mppStore.update<boolean>(KEY, (current) => {
    const last = (current as { startedAt?: string } | null)?.startedAt;
    if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) return { op: "noop", result: false };
    return { op: "set", value: { startedAt: new Date().toISOString(), status: "running" }, result: true };
  });
  if (!claimed) return { ran: false, reason: "cooldown", last: await mppStore.get(KEY) };
  const summary = await secConcentration();
  await mppStore.put(KEY, { ...summary, status: "done" });
  await mppStore.delete("cache:relationship-graph:v5").catch(() => undefined); // next graph read picks up new edges
  await mppStore.delete(COMPANY_INDEX_KEY).catch(() => undefined);
  // concentration watch emails for filings that arrived in this run
  try { console.log("concentration watch", JSON.stringify(await concentrationWatch.dispatch())); }
  catch (e) { console.error("concentration watch failed", e instanceof Error ? e.message : e); }
  return { ran: true, summary };
}
