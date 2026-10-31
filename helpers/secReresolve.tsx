import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { resolveCustomer, secTitles } from "./secConcentration";

/**
 * Re-resolve customer tickers for all named facts with the current resolver (no SEC document refetch).
 * Run after resolver fixes so stored rows match the new rules. Writes a before/after audit to mpp_store.
 */
export async function secReresolve() {
  const titles = await secTitles();
  const rows = await db.selectFrom("customerConcentrationFacts")
    .select(["factId", "customerName", "customerTicker"])
    .where("nameSource", "!=", "anonymous").where("customerName", "is not", null)
    .execute();
  const changes: Array<{ name: string; from: string | null; to: string | null }> = [];
  for (const r of rows) {
    const next = resolveCustomer(r.customerName!, titles).ticker;
    if (next === r.customerTicker) continue;
    changes.push({ name: r.customerName!, from: r.customerTicker, to: next });
    await db.updateTable("customerConcentrationFacts")
      .set({ customerTicker: next, updatedAt: sql`now()` })
      .where("factId", "=", r.factId).execute();
  }
  const distinct = [...new Map(changes.map((c) => [`${c.name}|${c.from}|${c.to}`, c])).values()];
  await mppStore.put("job:sec-concentration:reresolve", { at: new Date().toISOString(), checked: rows.length, changed: changes.length, distinct });
  await mppStore.delete("cache:relationship-graph:v5");
  return { checked: rows.length, changed: changes.length, distinct };
}
