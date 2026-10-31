import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Customer-momentum event study (daily adaptation of Cohen & Frazzini 2008, "Economic Links and
 * Predictable Returns"). ONE pre-registered hypothesis, no parameter search:
 *
 *   When a major customer's stock has a >= 3 sigma market-model abnormal return on day 0, does its
 *   disclosed supplier earn a same-signed abnormal return on days +1..+5 — beyond what random,
 *   unlinked suppliers earn on the same dates?
 *
 * Links: customer_concentration_facts (revenue benchmark, named customer with ticker). A fact for
 * fiscal period P is treated as public from its filing date when known (latest filing) or from
 * P + 75 days for prior-period comparatives (approximation, reported as a caveat), valid for 365 days.
 * Abnormal returns: market model vs SPY, estimated on [-250, -11] trading days, re-estimated every
 * 21 days. t-stats cluster by event date. Robustness rows are reported, never selected from.
 */

const KEY = "research:customer-momentum:v1";
const UA = { "user-agent": "Mozilla/5.0 ShadowGraph-Research/1.0" };

type Px = Map<string, number>;

async function fetchYahoo(symbol: string): Promise<Px | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`,
      { headers: UA, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const cl: Array<number | null> = res?.indicators?.adjclose?.[0]?.adjclose ?? res?.indicators?.quote?.[0]?.close ?? [];
    const m: Px = new Map();
    for (let i = 0; i < ts.length; i++) {
      const c = cl[i];
      if (typeof c === "number" && c > 0) m.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), c);
    }
    return m.size > 300 ? m : null;
  } catch { return null; }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

function clusteredStats(rows: Array<{ date: string; v: number }>) {
  const byDate = new Map<string, number[]>();
  for (const r of rows) if (Number.isFinite(r.v)) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.v]);
  const m = [...byDate.values()].map((a) => a.reduce((s, x) => s + x, 0) / a.length);
  const n = m.length;
  if (n < 5) return { n: rows.length, dates: n, mean: null as number | null, t: null as number | null, p: null as number | null };
  const mean = m.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(m.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  const p = erfc(Math.abs(t) / Math.SQRT2);
  return { n: rows.length, dates: n, mean, t, p };
}
function erfc(x: number) { // Abramowitz-Stegun 7.1.26
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const y = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
}

export async function customerMomentum() {
  const startedAt = new Date().toISOString();
  // ---------- links ----------
  const facts = await db.selectFrom("customerConcentrationFacts")
    .select(["filerCik", "filerTicker", "customerTicker", "share", "periodEnd", "filedAt", "accession"])
    .where("benchmark", "=", "revenue").where("nameSource", "!=", "anonymous").where("customerTicker", "is not", null)
    .execute();
  const tickersByCik = new Map<string, Set<string>>();
  for (const f of facts) tickersByCik.set(f.filerCik, (tickersByCik.get(f.filerCik) ?? new Set()).add(f.filerTicker));
  const canon = (cik: string) => [...(tickersByCik.get(cik) ?? [])].sort((a, b) =>
    ((/(W|WS|U|R)$/.test(a) && a.length > 3 ? 1 : 0) - (/(W|WS|U|R)$/.test(b) && b.length > 3 ? 1 : 0)) || a.length - b.length || a.localeCompare(b))[0];
  const latestPeriodByAcc = new Map<string, string>();
  for (const f of facts) {
    const pe = new Date(f.periodEnd).toISOString().slice(0, 10);
    if (!latestPeriodByAcc.has(f.accession) || pe > latestPeriodByAcc.get(f.accession)!) latestPeriodByAcc.set(f.accession, pe);
  }
  type Link = { cust: string; sup: string; share: number; from: string; to: string; approxDate: boolean };
  const linkMap = new Map<string, Link>();
  for (const f of facts) {
    const sup = canon(f.filerCik); const cust = f.customerTicker!;
    if (!sup || sup === cust || !/^[A-Z]{1,5}(-[A-Z])?$/.test(sup) || !/^[A-Z]{1,5}(-[A-Z])?$/.test(cust)) continue; // US listings only
    const pe = new Date(f.periodEnd).toISOString().slice(0, 10);
    const isLatest = latestPeriodByAcc.get(f.accession) === pe;
    const from = isLatest ? new Date(f.filedAt).toISOString().slice(0, 10) : addDays(pe, 75);
    const key = `${cust}|${sup}|${from}`;
    if (!linkMap.has(key)) linkMap.set(key, { cust, sup, share: f.share, from, to: addDays(from, 365), approxDate: !isLatest });
  }
  const links = [...linkMap.values()];

  // ---------- prices ----------
  const symbols = [...new Set(["SPY", ...links.flatMap((l) => [l.cust, l.sup])])];
  const px = new Map<string, Px>();
  for (let i = 0; i < symbols.length; i += 8) {
    const got = await Promise.all(symbols.slice(i, i + 8).map(async (s) => [s, await fetchYahoo(s)] as const));
    for (const [s, m] of got) if (m) px.set(s, m);
    await new Promise((r) => setTimeout(r, 150));
  }
  const spy = px.get("SPY");
  if (!spy) throw new Error("SPY prices unavailable");
  const dates = [...spy.keys()].sort();
  const N = dates.length;
  const ret = (m: Px) => { const out = new Float64Array(N).fill(NaN); for (let i = 1; i < N; i++) { const a = m.get(dates[i - 1]), b = m.get(dates[i]); if (a && b) out[i] = Math.log(b / a); } return out; };
  const R = new Map<string, Float64Array>(); for (const [s, m] of px) R.set(s, ret(m));
  const rm = R.get("SPY")!;

  // market-model params per (symbol, 21-day block)
  const paramCache = new Map<string, { a: number; b: number; s: number } | null>();
  const params = (sym: string, t0: number) => {
    const blk = Math.floor(t0 / 21), key = `${sym}|${blk}`;
    if (paramCache.has(key)) return paramCache.get(key)!;
    const r = R.get(sym); let out: { a: number; b: number; s: number } | null = null;
    if (r) {
      const end = blk * 21 - 11, start = end - 240; const xs: number[] = [], ys: number[] = [];
      for (let i = Math.max(1, start); i <= end; i++) if (Number.isFinite(r[i]) && Number.isFinite(rm[i])) { xs.push(rm[i]); ys.push(r[i]); }
      if (xs.length >= 120) {
        const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
        let sxy = 0, sxx = 0; for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; }
        const b = sxx > 0 ? sxy / sxx : 1, a = my - b * mx;
        let ss = 0; for (let k = 0; k < xs.length; k++) ss += (ys[k] - a - b * xs[k]) ** 2;
        out = { a, b, s: Math.sqrt(ss / (xs.length - 2)) };
      }
    }
    paramCache.set(key, out); return out;
  };
  const ar = (sym: string, t0: number, i: number) => { const p = params(sym, t0); const r = R.get(sym); if (!p || !r || !Number.isFinite(r[i]) || !Number.isFinite(rm[i])) return NaN; return r[i] - p.a - p.b * rm[i]; };
  const car = (sym: string, t0: number, k1: number, k2: number) => { let s = 0; for (let k = k1; k <= k2; k++) { if (t0 + k >= N) return NaN; const v = ar(sym, t0, t0 + k); if (!Number.isFinite(v)) return NaN; s += v; } return s; };

  // ---------- events ----------
  const supplierUniverse = [...new Set(links.map((l) => l.sup))].filter((s) => R.has(s));
  const byCustomer = new Map<string, Link[]>(); for (const l of links) if (R.has(l.cust) && R.has(l.sup)) byCustomer.set(l.cust, [...(byCustomer.get(l.cust) ?? []), l]);

  const runSpec = (threshold: number, k2: number) => {
    const linked: Array<{ date: string; v: number }> = [], placebo: Array<{ date: string; v: number }> = [], diff: Array<{ date: string; v: number }> = [];
    const day0: Array<{ date: string; v: number }> = [], unpriced: Array<{ date: string; v: number }> = [];
    const examples: Array<Record<string, unknown>> = [];
    let hits = 0, total = 0;
    for (const [cust, ls] of byCustomer) {
      let lastEvent = -999;
      for (let t = 262; t < N - k2; t++) {
        const p = params(cust, t); if (!p) continue;
        const z = ar(cust, t, t) / p.s;
        if (!Number.isFinite(z) || Math.abs(z) < threshold || t - lastEvent < 10) continue;
        lastEvent = t;
        const d = dates[t], sign = Math.sign(z);
        const active = ls.filter((l) => l.from <= d && d <= l.to);
        if (!active.length) continue;
        const linkedSups = new Set(ls.map((l) => l.sup));
        const pool = supplierUniverse.filter((s) => !linkedSups.has(s) && s !== cust);
        const rnd = mulberry32(hash(`${cust}|${d}`));
        for (const l of active) {
          const v = car(l.sup, t, 1, k2); if (!Number.isFinite(v)) continue;
          const sv = sign * v; linked.push({ date: d, v: sv }); total++; if (sv > 0) hits++;
          const a0 = ar(l.sup, t, t), ps = params(l.sup, t)?.s ?? NaN;
          if (Number.isFinite(a0)) day0.push({ date: d, v: sign * a0 });
          if (Number.isFinite(a0) && Number.isFinite(ps) && Math.abs(a0) < ps) unpriced.push({ date: d, v: sv });
          const pv: number[] = [];
          for (let k = 0; k < 5 && pool.length; k++) { const s = pool[Math.floor(rnd() * pool.length)]; const x = car(s, t, 1, k2); if (Number.isFinite(x)) pv.push(sign * x); }
          if (pv.length) { const pm = pv.reduce((s, x) => s + x, 0) / pv.length; placebo.push({ date: d, v: pm }); diff.push({ date: d, v: sv - pm }); }
          if (examples.length < 400) examples.push({ date: d, customer: cust, supplier: l.sup, revenueShare: l.share, customerZ: Math.round(z * 10) / 10, supplierDay0: a0, supplierCar: v, approxLinkDate: l.approxDate });
        }
      }
    }
    return {
      threshold, window: [1, k2],
      linked: { ...clusteredStats(linked), hitRate: total ? hits / total : null },
      placebo: clusteredStats(placebo),
      linkedMinusPlacebo: clusteredStats(diff),
      supplierDay0SameSign: clusteredStats(day0),
      unpricedOnDay0: clusteredStats(unpriced),
      examples,
    };
  };

  const primary = runSpec(3, 5);
  const robustness = [runSpec(2.5, 5), runSpec(3, 10)].map(({ examples: _e, ...rest }) => rest);
  const { examples, ...primaryStats } = primary;
  const result = {
    generatedAt: new Date().toISOString(), startedAt,
    hypothesis: "Supplier earns same-signed abnormal return on days +1..+5 after a >=3 sigma abnormal move of a disclosed major customer, in excess of random unlinked suppliers on the same dates.",
    method: "Market model vs SPY (estimation [-250,-11], re-estimated every 21 trading days); signed by customer shock; placebo = 5 random unlinked suppliers per event; t-stats clustered by event date; one primary specification, robustness rows reported but not selected from.",
    sample: {
      links: links.length, linksWithPrices: [...byCustomer.values()].reduce((s, a) => s + a.length, 0),
      customers: byCustomer.size, suppliers: supplierUniverse.length, symbolsPriced: px.size,
      dateStart: dates[0], dateEnd: dates[N - 1], approxLinkDateShare: links.length ? links.filter((l) => l.approxDate).length / links.length : null,
    },
    primary: primaryStats,
    robustness,
    caveats: [
      "Prior-period links use fiscal period end + 75 days as an assumed disclosure date; only latest-filing links use the actual filing date.",
      "Coverage is limited to US-listed customers and suppliers with named, ticker-resolved customers in SEC XBRL.",
      "Gross of transaction costs; small-cap suppliers can be illiquid.",
      "Abnormal returns use a single-factor market model; industry co-movement is addressed only through the placebo control.",
    ],
    examples: examples.slice(0, 50),
  };
  await mppStore.put(KEY, result);
  return result;
}
