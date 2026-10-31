import { mppStore } from "./mppStore";
import { loadBaseEvents, fetchCloses, mulberry32, mean, quantile, winsorise, type PriceSeries } from "./concentrationSignal";

/**
 * cc-v2 · Customer-concentration LEVEL test. Registered 2026-10-18, before the first run; the design below is fixed.
 *
 * Origin: in cc-v1.1 a secondary row showed the most concentrated third of companies trailing the least concentrated by
 * 8.4 points over the following year (p 0.003). That row used log returns, which are mechanically lower for volatile
 * stocks, and concentrated companies tend to be volatile. This test asks whether anything is left once that is removed.
 *
 * Events: the cc-v1.1 events (one per annual 10-K / 20-F, US tickers) with a known current-year concentration C1.
 *   Required: price >= $1 (unadjusted) on day +1; at least 120 daily returns in the year before the filing
 *   (trading days -250..-2) to measure volatility; a price on day +250.
 * Returns: SIMPLE buy-and-hold, day +1 close to day +250 close, minus the same for SPY (BHAR). Winsorised 1% / 99%.
 * Volatility matching: within each filing year, events are split into five quintiles of pre-filing daily volatility.
 *   Inside every year x volatility cell, the top third by C1 is "high" and the bottom third "low" (ties broken by a
 *   fixed hash of the accession number). Cells with fewer than 6 events are skipped. So high and low are compared only
 *   against companies of similar volatility filing in the same year.
 * PRIMARY: spread = mean BHAR(high) - mean BHAR(low).
 *   p-value: labels shuffled within filing month x volatility quintile (5,000 permutations, two-sided).
 *   95% CI: bootstrap over filing months (2,000 draws).
 * CONFIRMATION (calendar time, avoids overlapping-window problems of long-horizon BHAR): each trading day, an equal-weight
 *   portfolio long all "high" and short all "low" stocks within their days +2..+250 (at least 10 stocks per side);
 *   monthly long-short returns regressed on SPY and IWM-minus-SPY; Newey-West (3 lags) t-statistics.
 * Verdict "supported" only if ALL hold: primary p < 0.01; same sign before and from 2021-01-01; |spread| >= 3 points
 *   (shorting small caps costs borrow fees on top of trading costs); calendar-time alpha has the same sign with |t| >= 2.
 * SECONDARY (reported, never used to pick a result): no volatility matching (simple returns); no matching with log
 *   returns (replicates cc-v1.1); matching on dollar trading volume instead of volatility; primary against IWM;
 *   spread inside each volatility quintile; spread by filing year.
 */

export const LEVEL_KEY = "research:concentration-level:v1";
export const LEVEL_VERSION = "cc-v2";
const H = 250;

type Ev = {
  accession: string; ticker: string; filed: string; c1: number; d0: number;
  vol: number; dollarVol: number | null; bhar: number | null; bharIwm: number | null; logAr: number | null; tie: number;
};
type Item = { perm: string; cluster: string; a: boolean; v: number };
export type LevelStat = { nA: number; nB: number; meanA: number | null; meanB: number | null; spread: number | null; ciLo: number | null; ciHi: number | null; p: number | null };

function hash(s: string) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }

/** Spread with permutation inside `perm` groups and bootstrap over `cluster` groups. */
function spread(items: Item[], seed = 11, perms = 5000, boots = 2000): LevelStat {
  const A = items.filter((x) => x.a).map((x) => x.v), B = items.filter((x) => !x.a).map((x) => x.v);
  if (A.length < 30 || B.length < 30) return { nA: A.length, nB: B.length, meanA: A.length ? mean(A) : null, meanB: B.length ? mean(B) : null, spread: null, ciLo: null, ciHi: null, p: null };
  const obs = mean(A) - mean(B);
  const rnd = mulberry32(seed);
  const pg = new Map<string, Item[]>(); for (const x of items) pg.set(x.perm, [...(pg.get(x.perm) ?? []), x]);
  const groups = [...pg.values()].map((g) => ({ nA: g.filter((x) => x.a).length, vals: g.map((x) => x.v) }));
  let extreme = 0;
  for (let k = 0; k < perms; k++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (const g of groups) {
      const v = g.vals.slice();
      for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = v[i]; v[i] = v[j]; v[j] = t; }
      for (let i = 0; i < v.length; i++) { if (i < g.nA) { sa += v[i]; na++; } else { sb += v[i]; nb++; } }
    }
    if (Math.abs(sa / na - sb / nb) >= Math.abs(obs) - 1e-12) extreme++;
  }
  const cg = new Map<string, Item[]>(); for (const x of items) cg.set(x.cluster, [...(cg.get(x.cluster) ?? []), x]);
  const clusters = [...cg.values()];
  const bs: number[] = [];
  for (let k = 0; k < boots; k++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (let m = 0; m < clusters.length; m++) for (const x of clusters[Math.floor(rnd() * clusters.length)]) { if (x.a) { sa += x.v; na++; } else { sb += x.v; nb++; } }
    if (na && nb) bs.push(sa / na - sb / nb);
  }
  bs.sort((a, b) => a - b);
  return { nA: A.length, nB: B.length, meanA: mean(A), meanB: mean(B), spread: obs, ciLo: quantile(bs, 0.025), ciHi: quantile(bs, 0.975), p: (extreme + 1) / (perms + 1) };
}

/** high / low labels: thirds of C1 inside year x quintile-of-`key` cells. */
function label(evs: Ev[], key: (e: Ev) => number | null): Map<string, { high: boolean; q: number }> {
  const out = new Map<string, { high: boolean; q: number }>();
  const byYear = new Map<string, Ev[]>();
  for (const e of evs) if (key(e) !== null) byYear.set(e.filed.slice(0, 4), [...(byYear.get(e.filed.slice(0, 4)) ?? []), e]);
  for (const list of byYear.values()) {
    const s = [...list].sort((a, b) => key(a)! - key(b)!);
    for (let q = 0; q < 5; q++) {
      const cell = s.slice(Math.floor((q * s.length) / 5), Math.floor(((q + 1) * s.length) / 5));
      if (cell.length < 6) continue;
      const byC = [...cell].sort((a, b) => a.c1 - b.c1 || a.tie - b.tie);
      const t = Math.floor(byC.length / 3);
      for (const e of byC.slice(0, t)) out.set(e.accession, { high: false, q });
      for (const e of byC.slice(-t)) out.set(e.accession, { high: true, q });
    }
  }
  return out;
}

// ---------- small linear algebra for the calendar-time regression ----------
function inv(m: number[][]): number[][] {
  const n = m.length, a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c]; if (Math.abs(d) < 1e-14) throw new Error("singular");
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map((r) => r.slice(n));
}
/** OLS with Newey-West standard errors. */
function olsNW(y: number[], X: number[][], lags = 3) {
  const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, t) => s + r[i] * y[t], 0));
  const XtXi = inv(XtX);
  const b = XtXi.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const e = y.map((v, t) => v - X[t].reduce((s, x, j) => s + x * b[j], 0));
  const S = Array.from({ length: k }, () => Array(k).fill(0));
  for (let l = 0; l <= lags; l++) {
    const w = l === 0 ? 1 : 1 - l / (lags + 1);
    for (let t = l; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = w * X[t][i] * e[t] * X[t - l][j] * e[t - l];
      S[i][j] += v; if (l > 0) S[j][i] += v;
    }
  }
  // V = XtXi * S * XtXi
  const V: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const tmp = XtXi.map((r) => S[0].map((_, j) => r.reduce((s, v, m) => s + v * S[m][j], 0)));
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) V[i][j] = tmp[i].reduce((s, v, m) => s + v * XtXi[m][j], 0);
  return { b, se: b.map((_, i) => Math.sqrt(Math.max(0, V[i][i] * (n / Math.max(1, n - k))))), n };
}

export async function concentrationLevel() {
  const startedAt = new Date().toISOString();
  const base = (await loadBaseEvents()).filter((e) => e.c1 !== null);
  const period1 = Math.floor(Date.parse("2012-12-01") / 1000);
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
  const idx = (d: string) => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; } return lo; };
  const closeAt = (m: Map<string, number>, i: number) => { if (i < 0 || i >= N) return null; for (let k = i; k >= Math.max(0, i - 5); k--) { const v = m.get(dates[k]); if (v) return v; } return null; };
  const exact = (m: Map<string, number>, i: number) => (i >= 0 && i < N ? m.get(dates[i]) ?? null : null);

  // ---------- events with volatility, liquidity and returns ----------
  const evs: Ev[] = [];
  let noPrice = 0, penny = 0, shortHistory = 0, incomplete = 0;
  for (const e of base) {
    const m = px.get(e.ticker);
    const d0 = idx(e.filed);
    if (!m || d0 + 1 >= N || !closeAt(m, d0 + 1)) { noPrice++; continue; }
    const raw1 = m.raw ? closeAt(m.raw, d0 + 1) : null;
    if (raw1 !== null && raw1 < 1) { penny++; continue; }
    const rets: number[] = [];
    for (let t = Math.max(1, d0 - 250); t <= d0 - 2; t++) { const a = exact(m, t - 1), b = exact(m, t); if (a && b) rets.push(b / a - 1); }
    if (rets.length < 120) { shortHistory++; continue; }
    const mu = mean(rets), vol = Math.sqrt(rets.reduce((s, r) => s + (r - mu) ** 2, 0) / (rets.length - 1));
    const dv: number[] = [];
    for (let t = Math.max(0, d0 - 60); t <= d0 - 2; t++) { const c = m.raw ? exact(m.raw, t) : null, v = m.volume?.get(dates[t]); if (c && v !== undefined) dv.push(c * v); }
    const p0 = closeAt(m, d0 + 1), p1 = closeAt(m, d0 + H), s0 = closeAt(spy, d0 + 1), s1 = closeAt(spy, d0 + H), i0 = closeAt(iwm, d0 + 1), i1 = closeAt(iwm, d0 + H);
    if (!p0 || !p1 || !s0 || !s1 || !i0 || !i1) { incomplete++; continue; }
    evs.push({ accession: e.accession, ticker: e.ticker, filed: e.filed, c1: e.c1!, d0, vol, dollarVol: dv.length >= 30 ? mean(dv) : null,
      bhar: p1 / p0 - s1 / s0, bharIwm: p1 / p0 - i1 / i0, logAr: Math.log(p1 / p0) - Math.log(s1 / s0), tie: hash(e.accession) });
  }
  for (const k of ["bhar", "bharIwm", "logAr"] as const) { const w = winsorise(evs.map((e) => e[k])); evs.forEach((e, i) => { e[k] = w[i]; }); }

  const month = (e: Ev) => e.filed.slice(0, 7);
  const items = (lab: Map<string, { high: boolean; q: number }>, val: (e: Ev) => number | null, filter: (e: Ev) => boolean = () => true): Item[] =>
    evs.filter((e) => lab.has(e.accession) && val(e) !== null && filter(e))
      .map((e) => ({ perm: `${month(e)}|${lab.get(e.accession)!.q}`, cluster: month(e), a: lab.get(e.accession)!.high, v: val(e)! }));

  const volLab = label(evs, (e) => e.vol);
  const noneLab = label(evs, () => 0); // one cell per year = no matching
  const dvLab = label(evs, (e) => e.dollarVol);

  const primary = spread(items(volLab, (e) => e.bhar));
  const firstHalf = spread(items(volLab, (e) => e.bhar, (e) => e.filed < "2021-01-01"));
  const secondHalf = spread(items(volLab, (e) => e.bhar, (e) => e.filed >= "2021-01-01"));
  const sameSign = firstHalf.spread !== null && secondHalf.spread !== null && Math.sign(firstHalf.spread) === Math.sign(secondHalf.spread);
  const ann = (d: number) => d * Math.sqrt(252);
  const volOf = (high: boolean) => mean(evs.filter((e) => volLab.get(e.accession)?.high === high).map((e) => ann(e.vol)));
  const matching = { volHigh: volOf(true), volLow: volOf(false),
    volHighUnmatched: mean(evs.filter((e) => noneLab.get(e.accession)?.high === true).map((e) => ann(e.vol))),
    volLowUnmatched: mean(evs.filter((e) => noneLab.get(e.accession)?.high === false).map((e) => ann(e.vol))),
    c1High: mean(evs.filter((e) => volLab.get(e.accession)?.high === true).map((e) => e.c1)),
    c1Low: mean(evs.filter((e) => volLab.get(e.accession)?.high === false).map((e) => e.c1)) };

  const secondary = {
    unmatchedSimple: spread(items(noneLab, (e) => e.bhar)),
    unmatchedLog: spread(items(noneLab, (e) => e.logAr)),
    dollarVolumeMatched: spread(items(dvLab, (e) => e.bhar)),
    primaryVsIwm: spread(items(volLab, (e) => e.bharIwm)),
  };
  const byQuintile = [0, 1, 2, 3, 4].map((q) => ({ quintile: q + 1,
    volatility: mean(evs.filter((e) => volLab.get(e.accession)?.q === q).map((e) => ann(e.vol))),
    ...spread(items(volLab, (e) => e.bhar, (e) => volLab.get(e.accession)?.q === q), 13, 1000, 500) }));
  const byYear = [...new Set(evs.map((e) => e.filed.slice(0, 4)))].sort().map((y) => {
    const it = items(volLab, (e) => e.bhar, (e) => e.filed.startsWith(y));
    const a = it.filter((x) => x.a).map((x) => x.v), b = it.filter((x) => !x.a).map((x) => x.v);
    return { year: y, high: a.length, low: b.length, spread: a.length >= 5 && b.length >= 5 ? mean(a) - mean(b) : null };
  });

  // ---------- calendar-time long-short portfolio ----------
  const legs: Array<Map<string, boolean>> = Array.from({ length: N }, () => new Map());
  for (const e of [...evs].sort((a, b) => a.d0 - b.d0)) {
    const l = volLab.get(e.accession); if (!l) continue;
    for (let t = e.d0 + 2; t <= Math.min(N - 1, e.d0 + H); t++) legs[t].set(e.ticker, l.high);
  }
  type M = { L: number; S: number; spy: number; iwm: number; days: number; nL: number; nS: number };
  const months = new Map<string, M>();
  for (let t = 1; t < N; t++) {
    let sL = 0, nL = 0, sS = 0, nS = 0;
    for (const [tk, high] of legs[t]) {
      const m = px.get(tk)!; const a = exact(m, t - 1), b = exact(m, t); if (!a || !b) continue;
      const r = Math.max(-0.9, Math.min(3, b / a - 1));
      if (high) { sL += r; nL++; } else { sS += r; nS++; }
    }
    if (nL < 10 || nS < 10) continue;
    const a = exact(spy, t - 1), b = exact(spy, t), c = exact(iwm, t - 1), d = exact(iwm, t);
    if (!a || !b || !c || !d) continue;
    const k = dates[t].slice(0, 7);
    const cur = months.get(k) ?? { L: 1, S: 1, spy: 1, iwm: 1, days: 0, nL: 0, nS: 0 };
    cur.L *= 1 + sL / nL; cur.S *= 1 + sS / nS; cur.spy *= b / a; cur.iwm *= d / c; cur.days++; cur.nL += nL; cur.nS += nS;
    months.set(k, cur);
  }
  const ms = [...months.entries()].filter(([, m]) => m.days >= 15).sort((a, b) => a[0].localeCompare(b[0]));
  const ls = ms.map(([, m]) => (m.L - 1) - (m.S - 1));
  let calendar: { months: number; from: string | null; to: string | null; meanMonthly: number | null; tMean: number | null; alphaMonthly: number | null; tAlpha: number | null;
    betaSpy: number | null; betaSize: number | null; avgLong: number | null; avgShort: number | null; series: Array<{ month: string; ls: number }> } =
    { months: ms.length, from: null, to: null, meanMonthly: null, tMean: null, alphaMonthly: null, tAlpha: null, betaSpy: null, betaSize: null, avgLong: null, avgShort: null, series: [] };
  if (ms.length >= 24) {
    const m0 = olsNW(ls, ls.map(() => [1]));
    const f = olsNW(ls, ms.map(([, m]) => [1, m.spy - 1, (m.iwm - 1) - (m.spy - 1)]));
    calendar = { months: ms.length, from: ms[0][0], to: ms[ms.length - 1][0], meanMonthly: m0.b[0], tMean: m0.b[0] / m0.se[0], alphaMonthly: f.b[0], tAlpha: f.b[0] / f.se[0],
      betaSpy: f.b[1], betaSize: f.b[2], avgLong: mean(ms.map(([, m]) => m.nL / m.days)), avgShort: mean(ms.map(([, m]) => m.nS / m.days)),
      series: ms.map(([k], i) => ({ month: k, ls: ls[i] })) };
  }

  const supported = primary.p !== null && primary.p < 0.01 && sameSign && Math.abs(primary.spread ?? 0) >= 0.03
    && calendar.tAlpha !== null && calendar.alphaMonthly !== null && Math.sign(calendar.alphaMonthly) === Math.sign(primary.spread ?? 0) && Math.abs(calendar.tAlpha) >= 2;

  const result = {
    version: LEVEL_VERSION, generatedAt: new Date().toISOString(), startedAt, registeredAt: "2026-10-18",
    question: "Do companies that depend most on their largest customers underperform similar-volatility companies that depend least, over the year after the annual report?",
    verdict: supported ? "supported" : "not_supported",
    rule: "Supported only if p < 0.01 (labels shuffled within filing month and volatility quintile), the same sign before and from 2021, |spread| >= 3 points, and a calendar-time alpha of the same sign with |t| >= 2.",
    sample: { events: evs.length, labelled: volLab.size, noPrice, penny, shortHistory, incomplete,
      firstFiled: evs[0]?.filed ?? null, lastFiled: evs[evs.length - 1]?.filed ?? null },
    matching,
    primary: { window: [2, H], returns: "simple buy-and-hold minus SPY", ...primary, firstHalf, secondHalf, sameSign },
    calendar, secondary, byQuintile, byYear,
    caveats: [
      "Survivorship: companies delisted or acquired since are missing. If highly concentrated companies fail more often, the missing failures make the high group look better than it was.",
      "The short side is small, often illiquid stocks; borrow fees can be several percent a year and some names cannot be borrowed at all.",
      "Volatility and dollar volume are controlled; industry is not. Single-customer biotech and defence contractors cluster in the high group.",
      "Market cap is not in our data; dollar trading volume stands in for size.",
    ],
  };
  await mppStore.put(LEVEL_KEY, result);
  return result;
}
