import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Customer-concentration extraction from SEC annual filings (10-K / 20-F / 40-F).
 *
 * Numbers come ONLY from inline XBRL facts `us-gaap:ConcentrationRiskPercentage1` with
 * ConcentrationRiskByTypeAxis = CustomerConcentrationRiskMember and a MajorCustomersAxis member.
 * The customer NAME comes from, in order of strength:
 *   1. xbrl_member  - the filer named the member (e.g. fn:NvidiaCorporationMember)  -> official
 *   2. filing_text  - member is anonymous ("Customer A"), but a sentence in the SAME filing
 *                     states the same percentage next to exactly one resolvable company -> inferred
 *   3. anonymous    - stored for concentration stats, never linked to a company
 * Every row keeps filed_at so backtests can use point-in-time graphs.
 */

const UA = { "user-agent": "ShadowGraph research ops@shadowalpha.online", accept: "*/*" };
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

export const SEC_CONCENTRATION_UNIVERSE = [
  // existing ShadowGraph SEC universe
  "NVDA", "MSFT", "AMZN", "GOOGL", "META", "AAPL", "AVGO", "AMD", "ORCL", "CRM",
  "JPM", "GS", "BAC", "XOM", "CVX", "GEV", "ETN", "CSCO", "UPS", "FDX", "CAT",
  "ASML", "SAP", "TSM", "SHEL", "TTE", "NVO", "BABA", "TM",
  // AI / data-center supply chain (suppliers that disclose named customers)
  "ANET", "FN", "CRWV", "CLS", "SMCI", "VRT", "SWKS", "QRVO", "CRUS", "MU", "COHR",
  "CRDO", "DELL", "HPE", "INTC", "QCOM", "TXN", "ON", "LRCX", "AMAT", "KLAC", "TER",
  "JBL", "FLEX", "MRVL", "LITE", "AAOI", "ALAB", "NBIS", "APLD", "IREN", "CIEN",
] as const;

// Explicit aliases for names that fuzzy title matching gets wrong or that have no SEC ticker.
const ALIASES: Record<string, { name: string; ticker: string | null }> = {
  microsoft: { name: "Microsoft", ticker: "MSFT" },
  meta: { name: "Meta Platforms", ticker: "META" },
  "meta platforms": { name: "Meta Platforms", ticker: "META" },
  facebook: { name: "Meta Platforms", ticker: "META" },
  amazon: { name: "Amazon", ticker: "AMZN" },
  "amazon web services": { name: "Amazon", ticker: "AMZN" },
  aws: { name: "Amazon", ticker: "AMZN" },
  google: { name: "Alphabet", ticker: "GOOGL" },
  alphabet: { name: "Alphabet", ticker: "GOOGL" },
  apple: { name: "Apple", ticker: "AAPL" },
  nvidia: { name: "NVIDIA", ticker: "NVDA" },
  oracle: { name: "Oracle", ticker: "ORCL" },
  cisco: { name: "Cisco", ticker: "CSCO" },
  "cisco systems": { name: "Cisco", ticker: "CSCO" },
  dell: { name: "Dell Technologies", ticker: "DELL" },
  "hewlett packard enterprise": { name: "Hewlett Packard Enterprise", ticker: "HPE" },
  samsung: { name: "Samsung Electronics", ticker: "005930.KS" },
  "samsung electronics": { name: "Samsung Electronics", ticker: "005930.KS" },
  nokia: { name: "Nokia", ticker: "NOK" },
  walmart: { name: "Walmart", ticker: "WMT" },
  tesla: { name: "Tesla", ticker: "TSLA" },
  openai: { name: "OpenAI", ticker: null },
  huawei: { name: "Huawei", ticker: null },
  foxconn: { name: "Hon Hai Precision (Foxconn)", ticker: "2317.TW" },
  "hon hai": { name: "Hon Hai Precision (Foxconn)", ticker: "2317.TW" },
  lenovo: { name: "Lenovo Group", ticker: "0992.HK" },
  "lenovo group": { name: "Lenovo Group", ticker: "0992.HK" },
  luxshare: { name: "Luxshare Precision", ticker: "002475.SZ" },
  hp: { name: "HP Inc.", ticker: "HPQ" },
  // Brands that appear without legal suffix in XBRL members / filing text (verified one-to-one).
  costco: { name: "Costco", ticker: "COST" },
  merck: { name: "Merck & Co.", ticker: "MRK" },
  "merck co": { name: "Merck & Co.", ticker: "MRK" },
  spotify: { name: "Spotify", ticker: "SPOT" },
  verizon: { name: "Verizon", ticker: "VZ" },
  "verizon wireless": { name: "Verizon", ticker: "VZ" },
  micron: { name: "Micron Technology", ticker: "MU" },
  gilead: { name: "Gilead Sciences", ticker: "GILD" },
  l3harris: { name: "L3Harris Technologies", ticker: "LHX" },
  northrop: { name: "Northrop Grumman", ticker: "NOC" },
  "northrop grumman": { name: "Northrop Grumman", ticker: "NOC" },
  lockheed: { name: "Lockheed Martin", ticker: "LMT" },
  "lockheed martin": { name: "Lockheed Martin", ticker: "LMT" },
  lowes: { name: "Lowe's", ticker: "LOW" },
  stellantis: { name: "Stellantis", ticker: "STLA" },
  darden: { name: "Darden Restaurants", ticker: "DRI" },
  carnival: { name: "Carnival", ticker: "CCL" },
  "norwegian cruise": { name: "Norwegian Cruise Line", ticker: "NCLH" },
  deere: { name: "Deere & Company", ticker: "DE" },
  humana: { name: "Humana", ticker: "HUM" },
  "patterson companies": { name: "Patterson Companies", ticker: "PDCO" },
  "taylor morrison": { name: "Taylor Morrison Home", ticker: "TMHC" },
  valero: { name: "Valero Energy", ticker: "VLO" },
  conmed: { name: "CONMED", ticker: "CNMD" },
  onity: { name: "Onity Group", ticker: "ONIT" },
  "barrick gold": { name: "Barrick", ticker: "B" },
  "home depot": { name: "Home Depot", ticker: "HD" },
  target: { name: "Target", ticker: "TGT" },
  "best buy": { name: "Best Buy", ticker: "BBY" },
  kroger: { name: "Kroger", ticker: "KR" },
  "u s government": { name: "U.S. Government", ticker: null },
  "us government": { name: "U.S. Government", ticker: null },
  "united states government": { name: "U.S. Government", ticker: null },
};

const LEGAL = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited",
  "plc", "ag", "se", "sa", "nv", "bv", "gmbh", "lp", "the", "holdings", "holding", "group", "operations", "com"]);

export function normalizeCompanyName(name: string) {
  const ascii = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\/[a-z]{1,4}\/?/g, " "); // SEC title suffixes: "/DE/", "/NEW/", "/MD"
  return ascii.replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((t) => t && !LEGAL.has(t)).join(" ");
}
const compact = (norm: string) => norm.replace(/\s+/g, "").replace(/stores$/, "");

function memberToName(member: string) {
  const local = (member.split(":")[1] ?? member).replace(/Member$/, "");
  return local.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
}

// A member is NOT a named counterparty when it is a placeholder ("Customer A", "Undisclosed Customer"),
// an aggregate ("Three Largest Customers", "Eighty Seven Customers") or a channel class ("Global Channel Partner").
const ANON_WORDS = /\b(customers?|clients?|resellers?|distributors?|partners?|channel|oems?|hyperscalers?|largest|unidentified|undisclosed|unnamed|anonymous|significant|major|other|end)\b/i;
function isAnonymous(name: string) {
  const n = name.replace(/\s+/g, " ").trim();
  return !n || /^(company|the company|entity|one|two|three)$/i.test(n) || ANON_WORDS.test(n)
    || /(customer|client|reseller|distributor|partner|channel|largest|undisclosed|unidentified)/i.test(n.replace(/\s+/g, ""));
}

export type SecTitles = { byTicker: Map<string, { cik: string; title: string }>; byNorm: Map<string, string>; byCompact: Map<string, string | null> };

export async function secTitles(): Promise<SecTitles> {
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`SEC tickers ${r.status}`);
  const json = (await r.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const byTicker = new Map<string, { cik: string; title: string }>();
  const byNorm = new Map<string, string>();
  const byCompact = new Map<string, string | null>();
  for (const v of Object.values(json)) {
    const ticker = String(v.ticker).toUpperCase();
    if (!byTicker.has(ticker)) byTicker.set(ticker, { cik: String(v.cik_str).padStart(10, "0"), title: String(v.title) });
    const norm = normalizeCompanyName(v.title);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, ticker);
    // compact form ("walmart", "fedex", "mcdonalds") matches XBRL camel-split names ("Wal Mart", "Fed Ex", "Mc Donalds").
    // Ambiguous compact keys (two different CIKs) are poisoned with null and never used.
    const c = compact(norm);
    if (c.length >= 4) {
      const cik = String(v.cik_str);
      const prev = byCompact.get(c);
      if (prev === undefined) byCompact.set(c, ticker);
      else if (prev !== null && byTicker.get(prev)?.cik !== cik.padStart(10, "0")) byCompact.set(c, null);
    }
  }
  return { byTicker, byNorm, byCompact };
}

export function resolveCustomer(name: string, titles: SecTitles): { name: string; ticker: string | null; resolved: boolean } {
  const norm = normalizeCompanyName(name);
  if (ALIASES[norm]) return { ...ALIASES[norm], resolved: true };
  const first2 = norm.split(" ").slice(0, 2).join(" ");
  if (ALIASES[first2]) return { ...ALIASES[first2], resolved: true };
  const first = norm.split(" ")[0];
  if (ALIASES[first]) return { ...ALIASES[first], resolved: true };
  const exact = titles.byNorm.get(norm);
  if (exact) return { name, ticker: exact, resolved: true };
  const c = titles.byCompact.get(compact(norm));
  if (c) return { name, ticker: c, resolved: true };
  // No first-word fallback: "Third Party Processor" must not resolve to "Third Coast Bancshares".
  return { name, ticker: null, resolved: false };
}

type Fact = { member: string; benchmark: "revenue" | "receivables"; start: string | null; end: string; share: number };

/**
 * Parses ConcentrationRiskPercentage1 facts from either
 *  - inline XBRL (2019+ primary .htm: <ix:nonFraction name="us-gaap:ConcentrationRiskPercentage1" ...>), or
 *  - a classic XBRL instance (pre-2019 EX-101.INS .xml: <us-gaap:ConcentrationRiskPercentage1 contextRef=...>0.66</...>).
 * Context elements may or may not carry the "xbrli:" prefix.
 */
export function parseConcentrationFacts(doc: string): Fact[] {
  const ctx = new Map<string, { dims: Record<string, string>; start: string | null; end: string | null }>();
  const cre = /<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m: RegExpExecArray | null;
  while ((m = cre.exec(doc))) {
    const dims: Record<string, string> = {};
    for (const d of m[2].matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g)) dims[d[1]] = d[2];
    const start = m[2].match(/<(?:xbrli:)?startDate>\s*([^<\s]+)/)?.[1] ?? null;
    const end = m[2].match(/<(?:xbrli:)?endDate>\s*([^<\s]+)/)?.[1] ?? m[2].match(/<(?:xbrli:)?instant>\s*([^<\s]+)/)?.[1] ?? null;
    ctx.set(m[1], { dims, start, end });
  }
  const raw: Array<{ attrs: string; value: string; inline: boolean }> = [];
  for (const f of doc.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    if (/name="us-gaap:ConcentrationRiskPercentage1"/.test(f[1])) raw.push({ attrs: f[1], value: f[2], inline: true });
  }
  for (const f of doc.matchAll(/<us-gaap:ConcentrationRiskPercentage1\b([^>]*)>([^<]*)<\/us-gaap:ConcentrationRiskPercentage1>/g)) {
    raw.push({ attrs: f[1], value: f[2], inline: false });
  }
  const out = new Map<string, Fact>();
  for (const { attrs, value, inline } of raw) {
    const c = ctx.get(attrs.match(/contextRef="([^"]+)"/)?.[1] ?? "");
    if (!c?.end) continue;
    // MajorCustomersAxis moved from the us-gaap namespace to srt in the 2018 taxonomy; older filings use us-gaap.
    const member = c.dims["srt:MajorCustomersAxis"] ?? c.dims["us-gaap:MajorCustomersAxis"];
    if (!member || !/CustomerConcentrationRiskMember/.test(c.dims["us-gaap:ConcentrationRiskByTypeAxis"] ?? "")) continue;
    const bench = c.dims["us-gaap:ConcentrationRiskByBenchmarkAxis"] ?? "";
    const benchmark = /Receivable/i.test(bench) ? "receivables" : /Revenue|Sales/i.test(bench) ? "revenue" : null;
    if (!benchmark) continue;
    const scale = inline ? Number(attrs.match(/scale="(-?\d+)"/)?.[1] ?? 0) : 0; // instance values are already decimals
    let share = Number(value.replace(/<[^>]+>/g, "").replace(/,/g, "").trim()) * Math.pow(10, scale);
    if (inline && /sign="-"/.test(attrs)) share = -share;
    if (!Number.isFinite(share) || share <= 0 || share > 1) continue;
    const key = `${member}|${benchmark}|${c.end}`;
    if (!out.has(key)) out.set(key, { member, benchmark, start: c.start, end: c.end, share });
  }
  return [...out.values()];
}

export function plainText(html: string) {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/g, " ").replace(/&#8217;|&#x2019;/g, "'").replace(/&amp;/g, "&").replace(/&#[0-9]+;/g, " ")
    .replace(/\s+/g, " ");
}

/** Find the single resolvable company named in a sentence that states this exact percentage. */
export function attributeFromText(text: string, share: number, filerTicker: string, titles: SecTitles) {
  const pct = Math.round(share * 1000) / 10;
  const pctRx = Number.isInteger(pct) ? `${pct}(?:\\.0)?` : `${pct}`.replace(".", "\\.");
  const sentences = text.match(new RegExp(`[^.]{0,260}\\b${pctRx}\\s?%[^.]{0,160}\\.`, "g")) ?? [];
  for (const s of sentences) {
    if (!/(customer|revenue|sales|net sales)/i.test(s)) continue;
    const found = new Map<string, { name: string; ticker: string | null }>();
    for (const p of s.matchAll(/\b([A-Z][A-Za-z0-9&.\-]+(?:\s+(?:[A-Z][A-Za-z0-9&.\-]+|&))*)/g)) {
      const phrase = p[1].replace(/[.,]+$/, "");
      const norm = normalizeCompanyName(phrase);
      if (!norm || norm.length < 3) continue;
      const alias = ALIASES[norm] ?? ALIASES[norm.split(" ").slice(0, 2).join(" ")];
      // Single generic words ("Senior", "Federal", "General") collide with SEC titles; only aliases may be one token.
      const titleHit = norm.includes(" ") && titles.byNorm.get(norm) ? { name: phrase, ticker: titles.byNorm.get(norm)! } : null;
      const hit = alias ?? titleHit;
      if (hit && hit.ticker !== filerTicker) found.set(hit.ticker ?? hit.name, hit);
    }
    if (found.size === 1) {
      const [hit] = [...found.values()];
      return { ...hit, evidence: s.trim().slice(0, 400) };
    }
  }
  return null;
}

async function latestAnnualFiling(cik: string) {
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`submissions ${r.status}`);
  const j = await r.json();
  const rec = j?.filings?.recent ?? {};
  for (let i = 0; i < (rec.form?.length ?? 0); i++) {
    if (ANNUAL_FORMS.has(rec.form[i]) && rec.primaryDocument[i]) {
      const acc = String(rec.accessionNumber[i]);
      return {
        form: String(rec.form[i]), filedAt: String(rec.filingDate[i]), accession: acc,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${rec.primaryDocument[i]}`,
      };
    }
  }
  // Large filers (e.g. XOM) push their last 10-K out of "recent"; walk the older submission pages.
  for (const f of (j?.filings?.files ?? []).slice(0, 3)) {
    const p = await fetch(`https://data.sec.gov/submissions/${f.name}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!p.ok) continue;
    const old = await p.json();
    for (let i = 0; i < (old.form?.length ?? 0); i++) {
      if (ANNUAL_FORMS.has(old.form[i]) && old.primaryDocument[i]) {
        const acc = String(old.accessionNumber[i]);
        return {
          form: String(old.form[i]), filedAt: String(old.filingDate[i]), accession: acc,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${old.primaryDocument[i]}`,
        };
      }
    }
  }
  return null;
}

// ---------- universe discovery (SEC full-text search) ----------

const FTS_QUERIES = [
  '"accounted for" "of our total revenue" customer',
  '"accounted for" "of total revenue" customer',
  '"accounted for" "of net sales" customer',
  '"accounted for" "of our net revenue" customer',
  '"accounted for" "of our revenue" customer',
  '"accounted for" "of total net revenue" customer',
  '"accounted for" "of consolidated revenue" customer',
  '"largest customer" "of our revenue"',
];
const CANDIDATES_KEY = "job:sec-concentration:candidates";
const CANDIDATES_TTL_MS = 7 * 24 * 3600 * 1000;
const RESCAN_AFTER_MS = 7 * 24 * 3600 * 1000;
const CORE_PRIORITY = 1_000_000;

async function discoverFilers(): Promise<Map<string, number>> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 460 * 86_400_000).toISOString().slice(0, 10);
  const hits = new Map<string, number>();
  for (const q of FTS_QUERIES) {
    for (let from = 0; from < 2000; from += 100) {
      const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=10-K,20-F,40-F&startdt=${start}&enddt=${end}&from=${from}`;
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) break;
      const page = (await r.json())?.hits?.hits ?? [];
      for (const h of page) for (const d of (h._source?.display_names ?? []) as string[]) {
        const m = d.match(/\(([A-Z0-9.\-, ]+)\)\s+\(CIK \d+\)/);
        if (m) for (const t of m[1].split(",").map((s) => s.trim()).filter(Boolean)) hits.set(t, (hits.get(t) ?? 0) + 1);
      }
      if (page.length < 100) break;
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  return hits;
}

async function refreshCandidates(titles: SecTitles) {
  const cached = (await mppStore.get(CANDIDATES_KEY)) as { refreshedAt?: string } | null;
  if (cached?.refreshedAt && Date.now() - Date.parse(cached.refreshedAt) < CANDIDATES_TTL_MS) return;
  const hits = await discoverFilers();
  for (const t of SEC_CONCENTRATION_UNIVERSE) hits.set(t, CORE_PRIORITY);
  const rows = [...hits].flatMap(([ticker, priority]) => {
    const meta = titles.byTicker.get(ticker);
    return meta ? [{ filerTicker: ticker, filerCik: meta.cik, filerName: meta.title, priority }] : [];
  });
  for (let i = 0; i < rows.length; i += 500) {
    await db.insertInto("concentrationFilerScans").values(rows.slice(i, i + 500))
      .onConflict((oc) => oc.column("filerTicker").doUpdateSet((eb) => ({
        priority: eb.ref("excluded.priority"), filerCik: eb.ref("excluded.filerCik"), filerName: eb.ref("excluded.filerName"),
      })))
      .execute();
  }
  await mppStore.put(CANDIDATES_KEY, { refreshedAt: new Date().toISOString(), candidates: rows.length });
}

type FilingRef = { filerTicker: string; filerCik: string; filerName: string; accession: string; form: string; filedAt: string; docUrl: string };

/**
 * Shared classification for current and historical scans: XBRL-named member -> official; single anonymous
 * placeholder -> same-filing text attribution; aggregates/classes -> anonymous. Ambiguity guard: one company
 * attributed to several anonymous members in one period, or a ~100% share, reverts to anonymous.
 * `text` is lazy so filings without anonymous revenue facts never pay for HTML-to-text conversion.
 */
export function buildFactRows(facts: Fact[], text: () => string, ref: FilingRef, titles: SecTitles) {
  let plain: string | null = null;
  const rows = facts.map((f) => {
    let customerName: string | null = null;
    let customerTicker: string | null = null;
    let nameSource: "xbrl_member" | "filing_text" | "anonymous" = "anonymous";
    let nameEvidence: string | null = null;
    const memberName = memberToName(f.member);
    if (!isAnonymous(memberName)) {
      const res = resolveCustomer(memberName, titles);
      customerName = res.resolved ? res.name : memberName;
      customerTicker = res.ticker;
      nameSource = "xbrl_member";
      nameEvidence = `XBRL member ${f.member}`;
    } else if (f.benchmark === "revenue" && !/(largest|customers|clients|partners|resellers|distributors|channel|end customers|based)/i.test(memberName)) {
      plain ??= text();
      const hit = plain ? attributeFromText(plain, f.share, ref.filerTicker, titles) : null;
      if (hit) { customerName = hit.name; customerTicker = hit.ticker; nameSource = "filing_text"; nameEvidence = hit.evidence; }
    }
    return {
      factId: `${ref.accession}|${f.member}|${f.benchmark}|${f.end}`,
      ...ref,
      xbrlMember: f.member, customerName, nameSource, nameEvidence,
      benchmark: f.benchmark, periodStart: f.start, periodEnd: f.end, share: f.share, customerTicker,
    };
  });
  const textKeys = new Map<string, number>();
  for (const row of rows) if (row.nameSource === "filing_text") {
    const k = `${row.periodEnd}|${row.customerTicker ?? row.customerName}`;
    textKeys.set(k, (textKeys.get(k) ?? 0) + 1);
  }
  for (const row of rows) if (row.nameSource === "filing_text"
    && ((textKeys.get(`${row.periodEnd}|${row.customerTicker ?? row.customerName}`) ?? 0) > 1 || row.share >= 0.995)) {
    row.customerName = null; row.customerTicker = null; row.nameSource = "anonymous"; row.nameEvidence = null;
  }
  return {
    rows,
    named: rows.filter((r) => r.nameSource === "xbrl_member").length,
    textAttributed: rows.filter((r) => r.nameSource === "filing_text").length,
    anonymous: rows.filter((r) => r.nameSource === "anonymous").length,
  };
}

export async function upsertFactRows(rows: ReturnType<typeof buildFactRows>["rows"]) {
  if (!rows.length) return;
  await db.insertInto("customerConcentrationFacts").values(rows)
    .onConflict((oc) => oc.column("factId").doUpdateSet((eb) => ({
      customerName: eb.ref("excluded.customerName"),
      customerTicker: eb.ref("excluded.customerTicker"),
      nameSource: eb.ref("excluded.nameSource"),
      nameEvidence: eb.ref("excluded.nameEvidence"),
      share: eb.ref("excluded.share"),
      updatedAt: sql`now()`,
    })))
    .execute();
}

export type ConcentrationRunSummary = {
  startedAt: string; finishedAt: string; candidates: number; filers: number; unchanged: number; filingsParsed: number; facts: number;
  named: number; textAttributed: number; anonymous: number; errors: Array<{ ticker: string; error: string }>;
};

/**
 * Rolling scan: refreshes the discovered universe weekly, then scans up to `batch` filers that were
 * never scanned or not in the last 7 days (core AI-supply-chain universe first, then by search hits).
 * A filer whose latest annual accession is unchanged costs one SEC request and is skipped.
 */
export async function secConcentration(batch = 300): Promise<ConcentrationRunSummary> {
  const startedAt = new Date().toISOString();
  const titles = await secTitles();
  await refreshCandidates(titles);
  const candidates = Number((await db.selectFrom("concentrationFilerScans").select(({ fn }) => fn.countAll<number>().as("n")).executeTakeFirst())?.n ?? 0);
  const due = await db.selectFrom("concentrationFilerScans").selectAll()
    .where(({ eb, or }) => or([eb("lastScannedAt", "is", null), eb("lastScannedAt", "<", new Date(Date.now() - RESCAN_AFTER_MS))]))
    .orderBy(sql`priority desc, last_scanned_at asc nulls first`)
    .limit(batch)
    .execute();
  const summary: ConcentrationRunSummary = { startedAt, finishedAt: "", candidates, filers: due.length, unchanged: 0, filingsParsed: 0, facts: 0, named: 0, textAttributed: 0, anonymous: 0, errors: [] };

  const queue = [...due];
  const worker = async () => {
    while (queue.length) {
      const scan = queue.shift()!;
      const ticker = scan.filerTicker;
      let factsFound = 0;
      let accession: string | null = scan.lastAccession;
      let error: string | null = null;
      try {
        const meta = { cik: scan.filerCik, title: scan.filerName };
        const filing = await latestAnnualFiling(meta.cik);
        if (!filing) throw new Error("no annual filing");
        if (filing.accession === scan.lastAccession) {
          summary.unchanged++;
          factsFound = scan.factsFound;
        } else {
          accession = filing.accession;
          const r = await fetch(filing.url, { headers: UA, signal: AbortSignal.timeout(60_000) });
          if (!r.ok) throw new Error(`document ${r.status}`);
          const html = await r.text();
          const facts = parseConcentrationFacts(html);
          summary.filingsParsed++;
          factsFound = facts.length;
          if (facts.length) {
            const built = buildFactRows(facts, () => plainText(html), {
              filerTicker: ticker, filerCik: meta.cik, filerName: meta.title,
              accession: filing.accession, form: filing.form, filedAt: filing.filedAt, docUrl: filing.url,
            }, titles);
            summary.named += built.named; summary.textAttributed += built.textAttributed; summary.anonymous += built.anonymous;
            summary.facts += built.rows.length;
            await upsertFactRows(built.rows);
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        summary.errors.push({ ticker, error });
      }
      await db.updateTable("concentrationFilerScans")
        .set({ lastScannedAt: new Date(), lastAccession: accession, factsFound, lastError: error })
        .where("filerTicker", "=", ticker)
        .execute()
        .catch(() => undefined);
      await new Promise((res) => setTimeout(res, 250)); // SEC fair access: stay well below 10 req/s
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  summary.finishedAt = new Date().toISOString();
  return summary;
}
