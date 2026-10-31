import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Concentration-change signal test ("cc-v1"). Registered 2026-10-18, before the first run; the design below is fixed.
 *
 * Question a quant would ask about our SEC feed: when an annual report (10-K / 20-F) shows that a company's dependence
 * on its 10% customers ROSE or FELL, does the stock drift afterwards, i.e. is the change not priced on the filing day?
 *
 * Events: one per annual filing of a US-listed filer (ticker ^[A-Z]{1,5}(-[A-Z])?$, amendments excluded).
 *   C1 = sum of disclosed 10%-customer revenue shares (named and anonymous, sales channels and intra-group excluded)
 *        for the fiscal year the filing reports; C0 = the same for the prior fiscal year, taken from the SAME filing
 *        (comparative column), so both numbers were public on the filing date. Shares are capped at 100%.
 *   If the filing reports no 10% customer for the current year but does for the prior year, C1 = 0.
 *   If the filing has no prior-year column, the change is unknown and the event is left out of the change tests.
 *   RISE: C1 - C0 >= +5 points · FALL: C1 - C0 <= -5 points · otherwise STEADY.
 * Returns: daily adjusted closes (Yahoo Finance). Day 0 = first trading day on or after the EDGAR filing date.
 *   Abnormal return over [a, b] = log(P_b / P_{a-1}) - log(SPY_b / SPY_{a-1}) (buy-and-hold, market-adjusted).
 *   Events with a price below $1 on day +1 are excluded. Abnormal returns are winsorised at the 1st/99th percentile.
 * PRIMARY: spread = mean abnormal return of RISE minus FALL over trading days [+2, +61] (about three months, starting
 *   after the filing has certainly been public for a full day).
 *   Inference: labels shuffled within filing month (5,000 permutations) so market moves shared by firms filing at the
 *   same time cannot create a result; 95% CI by bootstrap over filing months (2,000 draws).
 *   Verdict "supported" only if ALL hold: two-sided permutation p < 0.01, the spread has the same sign in both halves
 *   of the sample (filed before / from 2021-01-01), and |spread| >= 1.0 point (enough to survive ~1% round-trip costs).
 * SECONDARY (reported, never used to pick a result): the filing-day reaction [0, +1]; windows [+2, +21] and [+2, +250];
 *   the primary against the Russell 2000 ETF (IWM) instead of SPY; the level test of Patatoukas (2012): top vs bottom
 *   third of C1 (terciles within filing year) over [+2, +250].
 */

export const STUDY_KEY = "research:concentration-signal:v1";
export const EVENTS_KEY = "research:concentration-signal:events:v1";
export const STUDY_VERSION = "cc-v1.1";
/**
 * Changelog
 *  cc-v1   2026-10-18 first run. Implementation error: XBRL members that are GROUPS of customers ("Top ten customers",
 *          "Two customers", "United States and Europe based end customers") were added to the single-customer shares,
 *          which pushed 854 of 6,575 filings to 100% concentration. Result: spread -0.19 pts, p 0.88, no signal.
 *  cc-v1.1 2026-10-18 same design; group members excluded (patterns below). A year reported only as a group is
 *          "unknown", not zero. Published result.
 */
// XBRL member local names that describe several customers (Postgres ARE)
const AGGREGATE_MEMBER = "(Customers|Clients|Partners|Distributors|Wholesalers|Payors|Payers|Providers|Licensees|Charterers|Retailers|Others|Combined|Aggregate|Total|Subcontractors|^All|^Other|^No[A-Z]|^Any[A-Z]|^Division|^(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Fifteen|Twenty)[A-Z]|^Top(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|[0-9]+)|Group(One|Two|Three|[A-Z]$|$))"; // applied to anonymous members only
// ...except numbered single customers spelled with a plural ("CustomersOne", "MajorCustomersB")
const INDIVIDUAL_MEMBER = "^(Major|Top|Significant|Largest|Key|Principal|Single)?(Customer|Client)s(One|Two|Three|Four|Five|Six|[A-Z]|[0-9]+)$";
const UA = { "user-agent": "Mozilla/5.0 ShadowGraph-Research/1.0" };
const DAY = 86_400_000;
const US_TICKER = /^[A-Z]{1,5}(-[A-Z])?$/;

/** c: sum of single-customer shares for the period, null when the filing reports that year only as customer groups */
type Row = { accession: string; cik: string; ticker: string; form: string; filed: string; period: string; c: number | null; n: number };
export type StudyEvent = {
  accession: string; ticker: string; form: string; filed: string; fiscalYearEnd: string | null;
  c1: number | null; c0: number | null; delta: number | null; group: "rise" | "fall" | "steady" | "unknown";
  arDay0: number | null; arM1: number | null; arM3: number | null; arY1: number | null; arM3Iwm: number | null;
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---------- events ----------
export function buildEvents(rows: Row[]): Array<Omit<StudyEvent, "arDay0" | "arM1" | "arM3" | "arY1" | "arM3Iwm">> {
  const tickersByCik = new Map<string, Set<string>>();
  for (const r of rows) tickersByCik.set(r.cik, (tickersByCik.get(r.cik) ?? new Set()).add(r.ticker));
  const canon = (cik: string) => [...(tickersByCik.get(cik) ?? [])].filter((t) => US_TICKER.test(t))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  const byAcc = new Map<string, Row[]>();
  for (const r of rows) byAcc.set(r.accession, [...(byAcc.get(r.accession) ?? []), r]);
  const seen = new Set<string>();
  const out: ReturnType<typeof buildEvents> = [];
  for (const [acc, rs] of byAcc) {
    const r0 = rs[0];
    const ticker = canon(r0.cik);
    if (!ticker || /\/A$/i.test(r0.form)) continue;
    const filedT = Date.parse(r0.filed);
    const periods = [...new Map(rs.map((r) => [r.period, r.c])).entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const [pMax, cMax] = periods[0];
    let c1: number | null, c0: number | null, fy: string | null;
    if (Date.parse(pMax) < filedT - 270 * DAY) {
      if (Date.parse(pMax) < filedT - 640 * DAY) continue; // stale comparative only
      c1 = 0; c0 = cMax; fy = null; // nothing at all reported for the current year: no 10% customer
    } else {
      c1 = cMax; fy = pMax;
      const prev = periods.find(([p]) => { const d = (Date.parse(pMax) - Date.parse(p)) / DAY; return d >= 330 && d <= 400; });
      c0 = prev ? prev[1] : null;
    }
    const key = `${r0.cik}|${r0.filed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const delta = c0 === null || c1 === null ? null : c1 - c0;
    out.push({ accession: acc, ticker, form: r0.form, filed: r0.filed, fiscalYearEnd: fy, c1, c0, delta,
      group: delta === null ? "unknown" : delta >= 0.05 ? "rise" : delta <= -0.05 ? "fall" : "steady" });
  }
  return out.sort((a, b) => a.filed.localeCompare(b.filed));
}

// ---------- prices ----------
export type PriceSeries = Map<string, number> & { raw?: Map<string, number>; volume?: Map<string, number> };
/** Daily adjusted closes by ISO date; `.raw` unadjusted closes, `.volume` shares traded. */
export async function fetchCloses(symbol: string, period1: number): Promise<PriceSeries | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`,
        { headers: UA, signal: AbortSignal.timeout(15_000) });
      if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      const res = (await r.json())?.chart?.result?.[0];
      const ts: number[] = res?.timestamp ?? [];
      const cl: Array<number | null> = res?.indicators?.adjclose?.[0]?.adjclose ?? [];
      const raw: Array<number | null> = res?.indicators?.quote?.[0]?.close ?? [];
      const vol: Array<number | null> = res?.indicators?.quote?.[0]?.volume ?? [];
      const m: PriceSeries = new Map<string, number>();
      for (let i = 0; i < ts.length; i++) { const c = cl[i]; if (typeof c === "number" && c > 0) m.set(iso(ts[i] * 1000), c); }
      // unadjusted close for the $1 filter
      const u = new Map<string, number>();
      for (let i = 0; i < ts.length; i++) { const c = raw[i]; if (typeof c === "number" && c > 0) u.set(iso(ts[i] * 1000), c); }
      const v = new Map<string, number>();
      for (let i = 0; i < ts.length; i++) { const x = vol[i]; if (typeof x === "number" && x >= 0) v.set(iso(ts[i] * 1000), x); }
      m.raw = u; m.volume = v;
      return m.size > 20 ? m : null;
    } catch { await new Promise((res) => setTimeout(res, 800)); }
  }
  return null;
}

// ---------- statistics ----------
export function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function quantile(sorted: number[], q: number) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }

export type SpreadStat = {
  nA: number; nB: number; months: number; meanA: number | null; meanB: number | null; spread: number | null;
  ciLo: number | null; ciHi: number | null; p: number | null; hitA: number | null; hitB: number | null;
};

/** Mean(A) - mean(B) with a within-month permutation p-value and a month-bootstrap CI. */
export function spreadTest(items: Array<{ month: string; a: boolean; v: number }>, seed = 7, perms = 5000, boots = 2000): SpreadStat {
  const A = items.filter((x) => x.a).map((x) => x.v), B = items.filter((x) => !x.a).map((x) => x.v);
  const months = new Map<string, Array<{ a: boolean; v: number }>>();
  for (const x of items) months.set(x.month, [...(months.get(x.month) ?? []), x]);
  const base = { nA: A.length, nB: B.length, months: months.size };
  if (A.length < 20 || B.length < 20) return { ...base, meanA: A.length ? mean(A) : null, meanB: B.length ? mean(B) : null, spread: null, ciLo: null, ciHi: null, p: null, hitA: null, hitB: null };
  const obs = mean(A) - mean(B);
  const rnd = mulberry32(seed);
  const groups = [...months.values()];
  let extreme = 0;
  for (let k = 0; k < perms; k++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (const g of groups) {
      const nA = g.filter((x) => x.a).length;
      const vals = g.map((x) => x.v);
      for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
      for (let i = 0; i < vals.length; i++) { if (i < nA) { sa += vals[i]; na++; } else { sb += vals[i]; nb++; } }
    }
    if (Math.abs(sa / na - sb / nb) >= Math.abs(obs) - 1e-12) extreme++;
  }
  const bs: number[] = [];
  for (let k = 0; k < boots; k++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (let m = 0; m < groups.length; m++) {
      const g = groups[Math.floor(rnd() * groups.length)];
      for (const x of g) { if (x.a) { sa += x.v; na++; } else { sb += x.v; nb++; } }
    }
    if (na && nb) bs.push(sa / na - sb / nb);
  }
  bs.sort((a, b) => a - b);
  return {
    ...base, meanA: mean(A), meanB: mean(B), spread: obs, ciLo: quantile(bs, 0.025), ciHi: quantile(bs, 0.975),
    p: (extreme + 1) / (perms + 1), hitA: A.filter((v) => v > 0).length / A.length, hitB: B.filter((v) => v > 0).length / B.length,
  };
}

export function winsorise(values: Array<number | null>) {
  const s = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const lo = quantile(s, 0.01), hi = quantile(s, 0.99);
  return values.map((v) => (v === null || !Number.isFinite(v) ? null : Math.min(hi, Math.max(lo, v))));
}

// ---------- run ----------
/** Annual-filing events with C1/C0 from the database (no prices). Shared by cc-v1.1 and cc-v2. */
export async function loadBaseEvents() {
  const rows = (await sql<Row>`
    WITH r AS (
      SELECT accession, filer_cik AS cik, filer_ticker AS ticker, form, filed_at::date::text AS filed, period_end::date::text AS period,
             coalesce(customer_key, lower(customer_name), xbrl_member) AS k, max(share) AS s,
             -- single customers only: groups such as "Top ten customers", "Two customers", "All other" or "Delta/United combined" are not 10% customers
             bool_and(NOT (
               (entry_kind = 'anonymous' AND regexp_replace(split_part(xbrl_member, ':', 2), '(ConcentrationRisk)?Member$', '') ~ ${AGGREGATE_MEMBER}
                 AND regexp_replace(split_part(xbrl_member, ':', 2), '(ConcentrationRisk)?Member$', '') !~ ${INDIVIDUAL_MEMBER})
               OR (entry_kind = 'customer' AND split_part(xbrl_member, ':', 2) ~ '(Customers|Clients|Combined)'))) AS single
      FROM customer_concentration_facts
      WHERE benchmark = 'revenue' AND coalesce(entry_kind, 'customer') IN ('customer', 'anonymous') AND share > 0 AND share <= 1
      GROUP BY 1, 2, 3, 4, 5, 6, 7)
    SELECT accession, cik, ticker, form, filed, period, least(1, sum(s) FILTER (WHERE single))::float AS c, count(*) FILTER (WHERE single)::int AS n
    FROM r GROUP BY 1, 2, 3, 4, 5, 6`.execute(db)).rows;
  return buildEvents(rows.map((r) => ({ ...r, c: r.n > 0 && r.c !== null ? Number(r.c) : null })));
}

export async function concentrationSignal() {
  const startedAt = new Date().toISOString();
  const base = await loadBaseEvents();

  // prices
  const period1 = Math.floor(Date.parse("2013-12-01") / 1000);
  const symbols = [...new Set(["SPY", "IWM", ...base.map((e) => e.ticker)])];
  const px = new Map<string, PriceSeries>();
  for (let i = 0; i < symbols.length; i += 8) {
    const got = await Promise.all(symbols.slice(i, i + 8).map(async (s) => [s, await fetchCloses(s, period1)] as const));
    for (const [s, m] of got) if (m) px.set(s, m);
    await new Promise((r) => setTimeout(r, 120));
  }
  const spy = px.get("SPY"), iwm = px.get("IWM");
  if (!spy || !iwm) throw new Error("benchmark prices unavailable");
  const dates = [...spy.keys()].sort();
  const N = dates.length;
  const firstOnOrAfter = (d: string) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; } return lo; };
  // close at trading day i, or the nearest earlier close within 5 trading days
  const closeAt = (m: Map<string, number>, i: number) => { for (let k = i; k >= Math.max(0, i - 5); k--) { const v = m.get(dates[k]); if (v) return v; } return null; };
  const ar = (sym: string, bench: Map<string, number>, d0: number, a: number, b: number) => {
    const m = px.get(sym); if (!m || d0 + b >= N || d0 + a - 1 < 0) return null;
    const p0 = closeAt(m, d0 + a - 1), p1 = closeAt(m, d0 + b), b0 = closeAt(bench, d0 + a - 1), b1 = closeAt(bench, d0 + b);
    if (!p0 || !p1 || !b0 || !b1) return null;
    return Math.log(p1 / p0) - Math.log(b1 / b0);
  };

  let priced = 0, penny = 0;
  const events: StudyEvent[] = [];
  for (const e of base) {
    const m = px.get(e.ticker);
    const d0 = firstOnOrAfter(e.filed);
    const raw1 = m?.raw ? closeAt(m.raw, d0 + 1) : null;
    const listed = !!m && d0 + 1 < N && !!closeAt(m, d0 + 1) && !!closeAt(m, Math.max(0, d0 - 1));
    if (listed) priced++;
    if (listed && raw1 !== null && raw1 < 1) penny++;
    const ok = listed && (raw1 === null || raw1 >= 1);
    events.push({ ...e,
      arDay0: ok ? ar(e.ticker, spy, d0, 0, 1) : null, arM1: ok ? ar(e.ticker, spy, d0, 2, 21) : null,
      arM3: ok ? ar(e.ticker, spy, d0, 2, 61) : null, arY1: ok ? ar(e.ticker, spy, d0, 2, 250) : null,
      arM3Iwm: ok ? ar(e.ticker, iwm, d0, 2, 61) : null });
  }
  for (const k of ["arDay0", "arM1", "arM3", "arY1", "arM3Iwm"] as const) {
    const w = winsorise(events.map((e) => e[k]));
    events.forEach((e, i) => { e[k] = w[i]; });
  }

  const month = (e: StudyEvent) => e.filed.slice(0, 7);
  const change = (k: keyof StudyEvent, filter: (e: StudyEvent) => boolean = () => true) =>
    spreadTest(events.filter((e) => (e.group === "rise" || e.group === "fall") && e[k] !== null && filter(e)).map((e) => ({ month: month(e), a: e.group === "rise", v: e[k] as number })));

  const primary = change("arM3");
  const firstHalf = change("arM3", (e) => e.filed < "2021-01-01");
  const secondHalf = change("arM3", (e) => e.filed >= "2021-01-01");
  // level: terciles of C1 within filing year
  const byYear = new Map<string, StudyEvent[]>();
  for (const e of events) if (e.arY1 !== null && e.c1 !== null) byYear.set(e.filed.slice(0, 4), [...(byYear.get(e.filed.slice(0, 4)) ?? []), e]);
  const level: Array<{ month: string; a: boolean; v: number }> = [];
  for (const list of byYear.values()) {
    const s = [...list].sort((a, b) => a.c1! - b.c1!); const t = Math.floor(s.length / 3);
    if (t < 5) continue;
    for (const e of s.slice(-t)) level.push({ month: month(e), a: true, v: e.arY1! });
    for (const e of s.slice(0, t)) level.push({ month: month(e), a: false, v: e.arY1! });
  }
  const secondary = {
    filingDay: change("arDay0"), month1: change("arM1"), year1: change("arY1"), primaryVsIwm: change("arM3Iwm"),
    levelTopVsBottom: spreadTest(level),
  };
  const sameSign = firstHalf.spread !== null && secondHalf.spread !== null && Math.sign(firstHalf.spread) === Math.sign(secondHalf.spread);
  const supported = primary.p !== null && primary.p < 0.01 && sameSign && Math.abs(primary.spread ?? 0) >= 0.01;

  // per filing year, for the chart
  const years = [...new Set(events.map((e) => e.filed.slice(0, 4)))].sort().map((y) => {
    const ys = events.filter((e) => e.filed.startsWith(y) && e.arM3 !== null);
    const r = ys.filter((e) => e.group === "rise").map((e) => e.arM3!), f = ys.filter((e) => e.group === "fall").map((e) => e.arM3!);
    return { year: y, rise: r.length, fall: f.length, meanRise: r.length ? mean(r) : null, meanFall: f.length ? mean(f) : null };
  });

  const counts = { rise: 0, fall: 0, steady: 0, unknown: 0 };
  for (const e of events) counts[e.group]++;
  const largest = events.filter((e) => e.delta !== null && e.arM3 !== null && e.filed >= "2024-01-01")
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 12);

  const result = {
    version: STUDY_VERSION, generatedAt: new Date().toISOString(), startedAt, registeredAt: "2026-10-18",
    question: "When an annual report shows a company's dependence on its largest customers rose or fell, does the stock drift afterwards?",
    verdict: supported ? "supported" : "not_supported",
    rule: "Supported only if the within-month permutation p < 0.01, the spread has the same sign before and from 2021, and |spread| >= 1.0 point.",
    sample: {
      filings: events.length, priced, pennyExcluded: penny, symbols: symbols.length - 2, symbolsPriced: px.size - 2,
      firstFiled: events[0]?.filed ?? null, lastFiled: events[events.length - 1]?.filed ?? null, counts,
    },
    primary: { window: [2, 61], benchmark: "SPY", ...primary, firstHalf, secondHalf, sameSign },
    secondary, years,
    largest: largest.map((e) => ({ ticker: e.ticker, filed: e.filed, c0: e.c0, c1: e.c1, delta: e.delta, arM3: e.arM3, accession: e.accession })),
    caveats: [
      "Survivorship: prices come from current tickers, so companies that were delisted or acquired since are missing; this flatters average returns but affects both groups.",
      "Only companies that disclose at least one 10% customer are in the sample, so the level test compares concentrated companies with less concentrated ones, not with unconcentrated ones.",
      "Market-adjusted returns do not remove size, industry or momentum effects; the IWM row shows the result against small caps.",
      "Gross of trading costs; many filers are small and illiquid.",
      "Returns are log returns, which sit below simple returns for volatile stocks (a 70% annual volatility costs about 25 points a year). Both groups carry this, so the spread compares like with like, but the absolute averages look worse than an investor's experience.",
    ],
    changelog: [
      { version: "cc-v1", date: "2026-10-18", note: "First run. Implementation error: groups of customers in the filings (\"top ten customers\", \"two customers\") were added to single-customer shares, which pushed 854 of 6,575 filings to 100%. Result: spread −0.19 points, p 0.88, no signal." },
      { version: "cc-v1.1", date: "2026-10-18", note: "Same design and rule. Customer groups excluded, and a year that a filing reports only as groups counts as unknown instead of zero (an intermediate run without that second fix gave −1.13 points, p 0.42). This is the published result." },
    ],
  };
  await mppStore.put(STUDY_KEY, result);
  await mppStore.put(EVENTS_KEY, { generatedAt: result.generatedAt, events });
  return result;
}
