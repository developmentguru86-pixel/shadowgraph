import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { outageEventStudy } from "./outageEventStudy";

/**
 * Terminal "at a glance" layer. Three plain-language views over data we already verify:
 *  1. dependency shifts  — how a company's dependence on a major customer changed between the two fiscal years of its
 *                          latest annual SEC filing (rising, falling, new 10% customer, no longer a 10% customer)
 *  2. scoreboard         — every trading hypothesis we tested, its sample, key number and verdict
 *  3. tenders            — one row per official EU tender notice: buyer, country, what is bought (CPV), fitting capability
 * Nothing here is a forecast; every row links to its source.
 */
const CPV: Record<string, string> = {
  "03": "Agriculture", "09": "Fuels & energy", "14": "Mining products", "15": "Food", "18": "Clothing", "22": "Printed matter",
  "24": "Chemicals", "30": "Computers & office equipment", "31": "Electrical equipment", "32": "Telecom & network equipment",
  "33": "Medical equipment", "34": "Transport equipment", "35": "Security & defence equipment", "38": "Lab & measuring instruments",
  "39": "Furniture", "42": "Industrial machinery", "43": "Construction machinery", "44": "Construction materials", "45": "Construction work",
  "48": "Software", "50": "Repair & maintenance", "51": "Installation services", "55": "Hospitality", "60": "Transport services",
  "63": "Logistics services", "64": "Postal & telecom services", "65": "Utilities", "66": "Financial services", "71": "Engineering services",
  "72": "IT services", "73": "Research & development", "75": "Public administration", "76": "Oil & gas services", "77": "Agricultural services",
  "79": "Business services", "80": "Education & training", "85": "Health services", "90": "Environmental services", "92": "Culture & sport", "98": "Other services",
};
const LEGAL = /\b(inc|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|plc|ag|gmbh|s\.?a|n\.?v|b\.?v|ab|asa|oyj|s\.?p\.?a|k\.?k|holdings?|group|pharmaceuticals?|technologies|laboratories|bank|motors|airlines|systems)\b\.?/i;
const GOV = /\b(government|department of|navy|army|air force|nasa|ministry|federal|agency|centers for medicare|veterans)\b/i;
const NOT_A_CUSTOMER = /\b(direct to consumer|international|domestic|distributors?|wholesale|retail|segment|channel|other customers|customers?|sources)\b/i;
// anonymous placeholders a filer uses instead of a name ("Company A", "Customer 2", "Client B")
const PLACEHOLDER = /^(the\s+)?(company|customer|client|party|partner|distributor|vendor|entity|licensee)\s+[a-z0-9]{1,2}$/i;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const title = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Inc|Corp|Ltd|Llc|Plc)\b\.?/g, (m) => m) : s);

type ShiftKind = "rising" | "falling" | "new_major" | "dropped";
type Shift = { kind: ShiftKind; supplier: string; supplierTicker: string; customer: string; customerTicker: string | null;
  previous: number | null; current: number | null; periodEnd: string; filedAt: string; sourceUrl: string; sentence: string; magnitude: number };

async function dependencyShifts() {
  const rows = (await sql<{ cik: string; ticker: string; name: string; customer: string; cticker: string | null; share: number; period: string; filed: string; doc: string }>`
    SELECT f.filer_cik AS cik, f.filer_ticker AS ticker, f.filer_name AS name, coalesce(f.customer_display, f.customer_name) AS customer, f.customer_ticker AS cticker,
           f.share, f.period_end::text AS period, f.filed_at::text AS filed, f.doc_url AS doc
    FROM customer_concentration_facts f
    JOIN concentration_filer_scans s ON s.filer_cik = f.filer_cik AND s.last_accession = f.accession
    WHERE f.benchmark = 'revenue' AND f.name_source <> 'anonymous' AND f.customer_name IS NOT NULL AND f.entry_kind = 'customer'
      AND f.filed_at > now() - interval '15 months'`.execute(db)).rows;
  const realCustomer = (name: string, ticker: string | null, supplier: string) => {
    if (PLACEHOLDER.test(name.trim())) return false;
    // the filer's own division or site is not a customer ("Optex Systems OPX Richardson Texas" in Optex's filing)
    const root = supplier.toLowerCase().split(/[\s,.]+/).find((w) => w.length >= 4);
    if (root && name.toLowerCase().includes(root)) return false;
    return Boolean(ticker) || GOV.test(name) || (LEGAL.test(name) && !NOT_A_CUSTOMER.test(name));
  };
  const byFiler = new Map<string, typeof rows>();
  for (const r of rows) byFiler.set(r.cik, [...(byFiler.get(r.cik) ?? []), r]);
  const out: Shift[] = [];
  for (const list of byFiler.values()) {
    const periods = [...new Set(list.map((r) => r.period))].sort().reverse();
    const p1 = periods[0], p2 = periods.find((p) => p < p1 && Date.parse(p1) - Date.parse(p) < 400 * 86_400_000);
    const byCust = new Map<string, typeof rows>();
    for (const r of list) { const k = r.cticker ?? r.customer.toUpperCase(); byCust.set(k, [...(byCust.get(k) ?? []), r]); }
    for (const recs of byCust.values()) {
      const any = recs[0];
      if (!realCustomer(any.customer, any.cticker, any.name)) continue;
      const cur = recs.find((r) => r.period === p1)?.share ?? null, prev = p2 ? recs.find((r) => r.period === p2)?.share ?? null : null;
      const supplier = title(any.name), customer = title(any.customer);
      const base = { supplier, supplierTicker: any.ticker, customer, customerTicker: any.cticker, previous: prev, current: cur, periodEnd: p1, filedAt: any.filed.slice(0, 10), sourceUrl: any.doc };
      if (cur !== null && prev !== null && Math.abs(cur - prev) >= 0.05) {
        out.push(cur > prev
          ? { ...base, kind: "rising", magnitude: cur - prev, sentence: `${customer} now accounts for ${pct(cur)} of ${supplier}'s revenue, up from ${pct(prev)} a year earlier.` }
          : { ...base, kind: "falling", magnitude: prev - cur, sentence: `${customer}'s share of ${supplier}'s revenue fell from ${pct(prev)} to ${pct(cur)}.` });
      } else if (cur !== null && prev === null && p2 && list.some((r) => r.period === p2)) {
        out.push({ ...base, kind: "new_major", magnitude: cur, sentence: `${customer} became a major customer of ${supplier}: ${pct(cur)} of revenue, below the 10% disclosure line a year earlier.` });
      } else if (cur === null && prev !== null) {
        out.push({ ...base, kind: "dropped", magnitude: prev, sentence: `${customer} is no longer disclosed as a 10% customer of ${supplier} (it was ${pct(prev)} a year earlier).` });
      }
    }
  }
  const rank = (s: Shift) => s.magnitude * (s.customerTicker ? 1.4 : 1) * (s.current !== null && s.current >= 0.3 ? 1.2 : 1);
  out.sort((a, b) => rank(b) - rank(a));
  // camelCase keys: values cached in mpp_store pass through Kysely's CamelCasePlugin, which rewrites snake_case JSON keys
  const counts = { rising: 0, falling: 0, newMajor: 0, dropped: 0 };
  for (const s of out) counts[s.kind === "new_major" ? "newMajor" : s.kind]++;
  return { events: out.slice(0, 40), counts, filersCompared: byFiler.size };
}

async function scoreboard() {
  const cm = (await mppStore.get("research:customer-momentum:v1")) as { primary?: { linkedMinusPlacebo?: { n: number; mean: number; t: number }; supplierDay0SameSign?: { t: number } } } | null;
  const cc = (await mppStore.get("research:concentration-signal:v1")) as { verdict?: string; sample?: { priced: number; firstFiled: string | null; lastFiled: string | null };
    primary?: { spread: number | null; p: number | null; nA: number; nB: number } } | null;
  const cl = (await mppStore.get("research:concentration-level:v1")) as { verdict?: string; primary?: { spread: number | null; p: number | null; nA: number; nB: number };
    calendar?: { alphaMonthly: number | null; tAlpha: number | null } } | null;
  const lag = await db.selectFrom("leadLagRuns").select(["testsPerformed", "trainSurvivors", "generatedAt"]).orderBy("generatedAt", "desc").limit(1).executeTakeFirst();
  const study = await outageEventStudy.get().catch(() => null);
  const arb = (await sql<{ n: number; best: number | null; net: number }>`
    WITH b AS (SELECT s.observed_at, x->>'venue' v, x->>'symbol' sym, (x->'bids'->0->>0)::float bid, (x->'asks'->0->>0)::float ask, (x->>'feeBps')::float fee
               FROM economic_book_snapshots s, jsonb_array_elements(s.payload->'books') x
               WHERE jsonb_array_length(x->'bids') > 0 AND jsonb_array_length(x->'asks') > 0)
    SELECT count(*)::int AS n, max((a.bid - c.ask) / ((a.bid + c.ask) / 2) * 10000)::float AS best,
           count(*) FILTER (WHERE (a.bid - c.ask) / ((a.bid + c.ask) / 2) * 10000 > a.fee + c.fee)::int AS net
    FROM b a JOIN b c ON a.observed_at = c.observed_at AND a.sym = c.sym AND a.v <> c.v`.execute(db)).rows[0];
  const ew = (await sql<{ n: number; scored: number; hits: number }>`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE outcome IS NOT NULL)::int AS scored, count(*) FILTER (WHERE outcome = 'incident')::int AS hits
    FROM radar_warnings WHERE evidence->>'rule' = 'ew-v2'`.execute(db)).rows[0];
  const lp = cm?.primary?.linkedMinusPlacebo, infra = study?.results.infrastructureOnly;
  return [
    { id: "customer-shock", title: "When a big customer's stock jumps, does its supplier follow later?",
      sample: lp ? `${lp.n.toLocaleString("en-US")} customer shocks, 2021–2026` : "SEC customer links",
      finding: lp ? `Suppliers move the same day (t ${cm?.primary?.supplierDay0SameSign?.t.toFixed(1)}), then no extra drift beyond random suppliers (+${(lp.mean * 100).toFixed(2)}%, t ${lp.t.toFixed(1)}).` : "Pending",
      verdict: lp ? "not_supported" : "pending", url: "/_api/research/customer_momentum" },
    { id: "concentration-change", title: "When a company's dependence on its biggest customers rises or falls, does the stock drift afterwards?",
      sample: cc?.primary ? `${(cc.primary.nA + cc.primary.nB).toLocaleString("en-US")} annual reports, ${cc.sample?.firstFiled?.slice(0, 4)}–${cc.sample?.lastFiled?.slice(0, 4)}` : "SEC annual reports",
      finding: cc?.primary?.spread != null ? `Rising minus falling concentration over the next three months: ${cc.primary.spread >= 0 ? "+" : "−"}${Math.abs(cc.primary.spread * 100).toFixed(2)} points against the S&P 500 (p ${cc.primary.p?.toFixed(2)}).` : "Pending",
      verdict: cc?.verdict === "supported" ? "supported" : cc?.verdict ? "not_supported" : "pending", url: "/research/concentration-signal" },
    { id: "concentration-level", title: "Do companies that depend most on their biggest customers underperform similar-volatility peers?",
      sample: cl?.primary ? `${(cl.primary.nA + cl.primary.nB).toLocaleString("en-US")} annual reports, volatility-matched` : "SEC annual reports",
      finding: cl?.primary?.spread != null ? `Most minus least concentrated over the next year: ${cl.primary.spread >= 0 ? "+" : "−"}${Math.abs(cl.primary.spread * 100).toFixed(1)} points (p ${cl.primary.p?.toFixed(2)}); calendar-time alpha t ${cl.calendar?.tAlpha?.toFixed(1) ?? "—"}.${cl.verdict === "supported" ? "" : " The earlier gap came from log returns of volatile stocks."}` : "Pending",
      verdict: cl?.verdict === "supported" ? "supported" : cl?.verdict ? "not_supported" : "pending", url: "/research/concentration-signal#level" },
    { id: "lead-lag", title: "Does one stock predictably lead another by 1–5 days?",
      sample: lag ? `${lag.testsPerformed.toLocaleString("en-US")} pair × lag tests` : "31 stocks",
      finding: lag ? `${lag.trainSurvivors} relationship${lag.trainSurvivors === 1 ? "" : "s"} survived false-discovery control and out-of-sample checks.` : "Pending",
      verdict: lag ? (lag.trainSurvivors > 0 ? "supported" : "not_supported") : "pending", url: "/research/methods" },
    { id: "outage-stock", title: "Do major outages create a tradable move in the provider's stock?",
      sample: infra ? `${infra.reactionDay0.events} outages, 2011–2025` : "Historical outages",
      finding: infra ? `Outage-day move ${infra.reactionDay0.meanPct?.toFixed(2)}% (t ${infra.reactionDay0.t?.toFixed(2)}); a short afterwards lost ${Math.abs(infra.shortNetOfCosts.meanPct ?? 0).toFixed(2)}% per trade after costs.` : "Pending",
      verdict: study ? (study.signalSupported ? "supported" : "not_supported") : "pending", url: "/_api/research/outage_impact" },
    { id: "crypto-spread", title: "Can BTC/ETH price gaps between Kraken and Coinbase be traded?",
      sample: `${arb.n} live order-book comparisons`,
      finding: arb.n ? `Largest gap ${(arb.best ?? 0).toFixed(1)} bps against about 100 bps of fees; ${arb.net} comparisons profitable after fees.` : "Pending",
      verdict: arb.n ? (arb.net > 0 ? "supported" : "not_supported") : "pending", url: "/_api/event_execution" },
    { id: "early-warning", title: "Can we see provider outages coming before they are declared?",
      sample: `${ew.n} warnings under rule ew-v2`,
      finding: ew.scored ? `${ew.hits} of ${ew.scored} warnings were followed by an incident.` : "No scored warnings yet; the rule went live on 2026-10-09 after the first version was retired (0 of 10).",
      verdict: ew.scored >= 10 ? (ew.hits / ew.scored >= 0.5 ? "supported" : "not_supported") : "collecting", url: "/outlook" },
  ];
}

async function tenders() {
  const rows = await db.selectFrom("leadSignals").select(["sourceId", "sourceUrl", "rationale", "evidence", "targetName", "theme", "firstSeen", "lastSeen"])
    .where("sourceType", "=", "ted").where("lastSeen", ">", new Date(Date.now() - 21 * 86_400_000)).execute();
  const by = new Map<string, { url: string; buyer: string; country: string; categories: Set<string>; capability: string | null; suppliers: Set<string>; firstSeen: string; lastSeen: string }>();
  for (const r of rows) {
    const ev = (typeof r.evidence === "string" ? JSON.parse(r.evidence) : r.evidence) as Array<{ type: string; detail?: string }>;
    const official = ev.find((e) => e.type === "TED-official")?.detail ?? "";
    const m = r.rationale.match(/procurement from (.+?) \(([A-Z]{3})\) matches/);
    const cur = by.get(r.sourceUrl) ?? { url: r.sourceUrl, buyer: m?.[1] ?? "Public buyer", country: m?.[2] ?? official.slice(0, 3),
      categories: new Set<string>(), capability: ev.find((e) => e.type === "capability-match")?.detail ?? null, suppliers: new Set<string>(),
      firstSeen: new Date(r.firstSeen).toISOString(), lastSeen: new Date(r.lastSeen).toISOString() };
    for (const code of official.match(/\b\d{8}\b/g) ?? []) { const label = CPV[code.slice(0, 2)]; if (label) cur.categories.add(label); }
    cur.suppliers.add(r.targetName);
    by.set(r.sourceUrl, cur);
  }
  const list = [...by.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .map((t) => ({ ...t, buyer: t.buyer.length > 90 ? `${t.buyer.slice(0, 88)}…` : t.buyer, categories: [...t.categories], suppliers: [...t.suppliers] }));
  const countries = new Set(list.map((t) => t.country)).size;
  return { notices: list.slice(0, 30), total: list.length, countries };
}

export const signalsBoard = {
  async get() {
    const key = "cache:signals-board:v2";
    const cached = (await mppStore.get(key)) as { at: number; data: Awaited<ReturnType<typeof build>> } | null;
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.data;
    const data = await build();
    await mppStore.put(key, { at: Date.now(), data });
    return data;
  },
};

async function build() {
  const [shifts, board, tenderList] = await Promise.all([dependencyShifts(), scoreboard(), tenders()]);
  return { generatedAt: new Date().toISOString(), shifts, scoreboard: board, tenders: tenderList };
}
