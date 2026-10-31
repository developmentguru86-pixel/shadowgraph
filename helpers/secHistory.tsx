import { queueTask } from "@runtime/queueTask";
import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { buildFactRows, parseConcentrationFacts, plainText, secTitles, upsertFactRows } from "./secConcentration";

/**
 * Historical backfill: every annual filing (10-K / 20-F / 40-F) since 2014 for filers that ever disclosed a
 * customer concentration. True point-in-time: each fact keeps the filing date of the document it came from.
 *  - 2019+ filings: inline XBRL in the primary .htm
 *  - older filings: classic XBRL instance .xml from the filing index (text attribution uses the primary .htm)
 * Each step handles FILERS_PER_STEP filers and re-queues itself; sec_history_scans guarantees each document
 * is fetched once, so the chain is safe to restart.
 */
const UA = { "user-agent": "ShadowGraph research ops@shadowalpha.online", accept: "*/*" };
const SINCE = "2014-01-01";
const STATE = "job:sec-history:backfill";
const FILERS_PER_STEP = 12;
const MAX_STEPS = 400;
const ANNUAL = new Set(["10-K", "20-F", "40-F", "10-K405"]);

type Filing = { accession: string; form: string; filedAt: string; doc: string };

async function get(url: string, json: true): Promise<any>;
async function get(url: string, json: false): Promise<string>;
async function get(url: string, json: boolean) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url.split("/").pop()}`);
    return json ? r.json() : r.text();
  }
  throw new Error(`retries exhausted ${url.split("/").pop()}`);
}
const pause = () => new Promise((res) => setTimeout(res, 150));

async function annualFilings(cik: string): Promise<Filing[]> {
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`, true);
  const blocks = [sub.filings.recent];
  for (const f of sub.filings.files ?? []) {
    if (f.filingTo && f.filingTo < SINCE) continue;
    await pause();
    blocks.push(await get(`https://data.sec.gov/submissions/${f.name}`, true));
  }
  const out: Filing[] = [];
  for (const b of blocks) for (let i = 0; i < (b.form?.length ?? 0); i++) {
    if (ANNUAL.has(b.form[i]) && b.filingDate[i] >= SINCE) {
      out.push({ accession: b.accessionNumber[i], form: b.form[i], filedAt: b.filingDate[i], doc: b.primaryDocument[i] ?? "" });
    }
  }
  return out;
}

async function scanFiling(cik: string, ticker: string, name: string, f: Filing, titles: Awaited<ReturnType<typeof secTitles>>) {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession.replace(/-/g, "")}`;
  const primaryUrl = f.doc ? `${base}/${f.doc}` : null;
  let kind: "inline" | "instance" | "none" = "none";
  let docUrl = primaryUrl;
  let source = "";
  let primaryHtml: string | null = null;

  if (primaryUrl && /\.htm/i.test(f.doc)) {
    primaryHtml = await get(primaryUrl, false);
    if (/<ix:nonFraction/i.test(primaryHtml)) { kind = "inline"; source = primaryHtml; }
  }
  if (kind === "none") {
    await pause();
    const idx = await get(`${base}/index.json`, true);
    const names: string[] = (idx?.directory?.item ?? []).map((i: { name: string }) => i.name);
    const instance = names.find((n) => /_htm\.xml$/i.test(n))
      ?? names.find((n) => /\.xml$/i.test(n) && !/(_cal|_def|_lab|_pre|FilingSummary)\.xml$/i.test(n) && !/^Financial_Report/i.test(n));
    if (instance) { await pause(); source = await get(`${base}/${instance}`, false); kind = "instance"; }
  }
  const facts = source ? parseConcentrationFacts(source) : [];
  if (facts.length) {
    const textDoc = primaryHtml;
    const built = buildFactRows(facts, () => (textDoc ? plainText(textDoc) : ""), {
      filerTicker: ticker, filerCik: cik, filerName: name, accession: f.accession, form: f.form, filedAt: f.filedAt,
      docUrl: docUrl ?? base,
    }, titles);
    await upsertFactRows(built.rows);
    return { kind, facts: built.rows.length, named: built.named + built.textAttributed, docUrl };
  }
  return { kind, facts: 0, named: 0, docUrl };
}

export async function secHistory(payload: { step?: number } = {}) {
  const step = payload.step ?? 0;
  const titles = await secTitles();
  const filers = await db.selectFrom("customerConcentrationFacts")
    .select(["filerCik", "filerTicker", "filerName"]).distinctOn("filerCik").orderBy("filerCik").execute();
  const state = ((await mppStore.get(STATE)) ?? {}) as { cursor?: number; filings?: number; facts?: number; named?: number; errors?: number };
  const cursor = step === 0 ? 0 : state.cursor ?? 0;
  const batch = filers.slice(cursor, cursor + FILERS_PER_STEP);
  let filings = 0, facts = 0, named = 0, errors = 0;

  for (const filer of batch) {
    try {
      const all = await annualFilings(filer.filerCik);
      const seen = new Set([
        ...(await db.selectFrom("secHistoryScans").select("accession").where("filerCik", "=", filer.filerCik).execute()).map((r) => r.accession),
        ...(await db.selectFrom("customerConcentrationFacts").select("accession").distinct().where("filerCik", "=", filer.filerCik).execute()).map((r) => r.accession),
      ]);
      const todo = all.filter((f) => !seen.has(f.accession));
      const queue = [...todo];
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift()!;
          let res: { kind: string; facts: number; named: number; docUrl: string | null } = { kind: "none", facts: 0, named: 0, docUrl: null };
          let error: string | null = null;
          try { res = await scanFiling(filer.filerCik, filer.filerTicker, filer.filerName, f, titles); }
          catch (e) { error = e instanceof Error ? e.message.slice(0, 300) : String(e); errors++; }
          filings++; facts += res.facts; named += res.named;
          await db.insertInto("secHistoryScans").values({
            accession: f.accession, filerCik: filer.filerCik, filerTicker: filer.filerTicker, form: f.form,
            filedAt: f.filedAt, docUrl: res.docUrl, sourceKind: res.kind, factsFound: res.facts, error,
          }).onConflict((oc) => oc.column("accession").doUpdateSet({ factsFound: res.facts, error, scannedAt: sql`now()` })).execute();
          await pause();
        }
      };
      await Promise.all([worker(), worker()]);
    } catch (e) {
      errors++;
      console.error("secHistory filer failed", filer.filerTicker, e instanceof Error ? e.message : e);
    }
  }

  const nextCursor = cursor + batch.length;
  const done = nextCursor >= filers.length || step + 1 >= MAX_STEPS;
  await mppStore.put(STATE, {
    step, cursor: nextCursor, totalFilers: filers.length, done, updatedAt: new Date().toISOString(),
    filings: (step === 0 ? 0 : state.filings ?? 0) + filings,
    facts: (step === 0 ? 0 : state.facts ?? 0) + facts,
    named: (step === 0 ? 0 : state.named ?? 0) + named,
    errors: (step === 0 ? 0 : state.errors ?? 0) + errors,
  });
  if (!done) await queueTask("secHistory", { step: step + 1 });
}
