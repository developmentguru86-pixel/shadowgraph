import { mppStore } from "./mppStore";

/**
 * Historical outage event study (pre-registered before looking at results, 2026-10-09).
 *
 * H1 (tradable): after a major infrastructure outage becomes known, the provider's listed parent shows a NEGATIVE
 * abnormal return that is still capturable after the outage-day close: a short entered at the day-0 close and held
 * 5 sessions earns a positive return net of costs (15 bps per side + 500 bps/yr borrow).
 * Also reported (not tradable for us): the day-0 reaction.
 *
 * Day 0 = event date if the outage started before the 16:00 New York close on a trading day; otherwise the next
 * trading day. Abnormal returns: market model vs SPY, estimated on trading days [-250, -21]. Inference: cross-
 * sectional mean, t-statistic with events on the same day averaged first, share of negative outcomes.
 * Events: well-documented public outages with start times from the providers' own post-incident reports.
 * Nothing is tuned after seeing results; changes require a new version key.
 */
export const OUTAGE_EVENTS: Array<{ id: string; at: string; symbol: string; provider: string; what: string; kind: "hosting" | "edge" | "software" }> = [
  { id: "aws-2011-04-21", at: "2011-04-21T07:47:00Z", symbol: "AMZN", provider: "AWS", what: "EC2/EBS us-east-1 degradation", kind: "hosting" },
  { id: "aws-2012-10-22", at: "2012-10-22T17:00:00Z", symbol: "AMZN", provider: "AWS", what: "EBS us-east-1 outage", kind: "hosting" },
  { id: "aws-2017-02-28", at: "2017-02-28T17:37:00Z", symbol: "AMZN", provider: "AWS", what: "S3 us-east-1 outage", kind: "hosting" },
  { id: "aws-2020-11-25", at: "2020-11-25T13:15:00Z", symbol: "AMZN", provider: "AWS", what: "Kinesis us-east-1 outage", kind: "hosting" },
  { id: "aws-2021-12-07", at: "2021-12-07T15:30:00Z", symbol: "AMZN", provider: "AWS", what: "us-east-1 network outage", kind: "hosting" },
  { id: "aws-2021-12-15", at: "2021-12-15T15:14:00Z", symbol: "AMZN", provider: "AWS", what: "us-west-1/us-west-2 outage", kind: "hosting" },
  { id: "aws-2021-12-22", at: "2021-12-22T12:01:00Z", symbol: "AMZN", provider: "AWS", what: "us-east-1 power loss (AZ USE1-AZ4)", kind: "hosting" },
  { id: "aws-2023-06-13", at: "2023-06-13T18:49:00Z", symbol: "AMZN", provider: "AWS", what: "Lambda us-east-1 outage", kind: "hosting" },
  { id: "aws-2025-10-20", at: "2025-10-20T06:49:00Z", symbol: "AMZN", provider: "AWS", what: "DynamoDB DNS failure, us-east-1", kind: "hosting" },
  { id: "net-2020-07-17", at: "2020-07-17T21:12:00Z", symbol: "NET", provider: "Cloudflare", what: "Backbone configuration error", kind: "edge" },
  { id: "net-2022-06-21", at: "2022-06-21T06:27:00Z", symbol: "NET", provider: "Cloudflare", what: "19 data centers offline (network change)", kind: "edge" },
  { id: "net-2023-11-02", at: "2023-11-02T11:44:00Z", symbol: "NET", provider: "Cloudflare", what: "Control plane / analytics outage (data center power)", kind: "edge" },
  { id: "net-2025-06-12", at: "2025-06-12T17:52:00Z", symbol: "NET", provider: "Cloudflare", what: "Workers KV outage (third-party storage)", kind: "edge" },
  { id: "net-2025-11-18", at: "2025-11-18T11:20:00Z", symbol: "NET", provider: "Cloudflare", what: "Global outage (bot-management feature file)", kind: "edge" },
  { id: "net-2025-12-05", at: "2025-12-05T08:47:00Z", symbol: "NET", provider: "Cloudflare", what: "Global outage (configuration change)", kind: "edge" },
  { id: "msft-2020-09-28", at: "2020-09-28T21:25:00Z", symbol: "MSFT", provider: "Microsoft Azure", what: "Azure AD authentication outage", kind: "hosting" },
  { id: "msft-2021-04-01", at: "2021-04-01T21:21:00Z", symbol: "MSFT", provider: "Microsoft Azure", what: "Azure DNS outage", kind: "hosting" },
  { id: "msft-2023-01-25", at: "2023-01-25T07:05:00Z", symbol: "MSFT", provider: "Microsoft Azure", what: "WAN routing change, Azure and Microsoft 365", kind: "hosting" },
  { id: "msft-2024-07-30", at: "2024-07-30T11:45:00Z", symbol: "MSFT", provider: "Microsoft Azure", what: "DDoS-triggered Front Door / CDN outage", kind: "hosting" },
  { id: "msft-2025-10-29", at: "2025-10-29T15:45:00Z", symbol: "MSFT", provider: "Microsoft Azure", what: "Azure Front Door configuration outage", kind: "hosting" },
  { id: "googl-2019-06-02", at: "2019-06-02T19:00:00Z", symbol: "GOOGL", provider: "Google Cloud", what: "Network congestion, us-east regions", kind: "hosting" },
  { id: "googl-2020-12-14", at: "2020-12-14T11:47:00Z", symbol: "GOOGL", provider: "Google Cloud", what: "Authentication system outage", kind: "hosting" },
  { id: "googl-2025-06-12", at: "2025-06-12T17:51:00Z", symbol: "GOOGL", provider: "Google Cloud", what: "Service Control / IAM outage", kind: "hosting" },
  { id: "akam-2021-07-22", at: "2021-07-22T15:46:00Z", symbol: "AKAM", provider: "Akamai", what: "Edge DNS outage", kind: "edge" },
  { id: "fsly-2021-06-08", at: "2021-06-08T09:47:00Z", symbol: "FSLY", provider: "Fastly", what: "Global CDN outage (customer configuration bug)", kind: "edge" },
  { id: "crwd-2024-07-19", at: "2024-07-19T04:09:00Z", symbol: "CRWD", provider: "CrowdStrike", what: "Falcon sensor update crashed Windows hosts", kind: "software" },
];

const KEY = "research:outage-event-study:v1";
const UA = { "user-agent": "Mozilla/5.0 ShadowGraph-Research/1.0" };
const COST_BPS_SIDE = 15, BORROW_BPS_YEAR = 500, HOLD = 5;

type Series = { dates: string[]; close: number[]; open: number[] }; // adjusted

async function history(symbol: string): Promise<Series | null> {
  try {
    const p1 = Math.floor(Date.parse("2010-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const q = res?.indicators?.quote?.[0] ?? {};
    const adj: Array<number | null> = res?.indicators?.adjclose?.[0]?.adjclose ?? q.close ?? [];
    const s: Series = { dates: [], close: [], open: [] };
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i], o = q.open?.[i], a = adj[i];
      if (!(c > 0 && o > 0 && typeof a === "number" && a > 0)) continue;
      s.dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
      s.close.push(a); s.open.push(o * (a / c)); // open adjusted with the same factor as the close
    }
    return s.dates.length > 300 ? s : null;
  } catch { return null; }
}

function nyClock(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) % 24 * 60 + Number(g("minute")) };
}

function stats(values: Array<{ date: string; v: number }>) {
  const byDate = new Map<string, number[]>();
  for (const x of values) if (Number.isFinite(x.v)) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.v]);
  const m = [...byDate.values()].map((a) => a.reduce((s, y) => s + y, 0) / a.length);
  const n = m.length;
  if (n < 3) return { events: values.length, clusters: n, meanPct: null as number | null, t: null as number | null, negativeShare: null as number | null };
  const mean = m.reduce((s, y) => s + y, 0) / n;
  const sd = Math.sqrt(m.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1));
  return { events: values.length, clusters: n, meanPct: mean * 100, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : null, negativeShare: values.filter((x) => x.v < 0).length / values.length };
}

async function compute() {
  const symbols = [...new Set(["SPY", ...OUTAGE_EVENTS.map((e) => e.symbol)])];
  const data = new Map<string, Series>();
  for (const s of symbols) { const h = await history(s); if (h) data.set(s, h); }
  const spy = data.get("SPY");
  if (!spy) throw new Error("Benchmark prices unavailable");
  const spyIdx = new Map(spy.dates.map((d, i) => [d, i]));

  const rows = OUTAGE_EVENTS.map((e) => {
    const px = data.get(e.symbol);
    if (!px) return { ...e, status: "no_prices" as const };
    const { date, minutes } = nyClock(e.at);
    let d0 = px.dates.findIndex((d) => d >= date);
    if (d0 < 0) return { ...e, status: "no_prices" as const };
    if (px.dates[d0] === date && minutes >= 16 * 60) d0 += 1; // after the close: next session is day 0
    if (d0 < 251 || d0 + HOLD >= px.dates.length) return { ...e, status: "insufficient_window" as const, day0: px.dates[d0] ?? null };
    const ret = (i: number) => px.close[i] / px.close[i - 1] - 1;
    const mret = (i: number) => { const j = spyIdx.get(px.dates[i]), k = spyIdx.get(px.dates[i - 1]); return j !== undefined && k !== undefined ? spy.close[j] / spy.close[k] - 1 : NaN; };
    const xs: number[] = [], ys: number[] = [];
    for (let i = d0 - 250; i <= d0 - 21; i++) { const m = mret(i), r = ret(i); if (Number.isFinite(m) && Number.isFinite(r)) { xs.push(m); ys.push(r); } }
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const beta = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const alpha = my - beta * mx;
    const ar = (i: number) => ret(i) - (alpha + beta * mret(i));
    const car = (a: number, b: number) => { let s = 0; for (let i = d0 + a; i <= d0 + b; i++) s += ar(i); return s; };
    const shortGross = -(px.close[d0 + HOLD] / px.close[d0] - 1);                       // short at day-0 close, cover after 5 sessions
    const shortNet = shortGross - (2 * COST_BPS_SIDE) / 10_000 - (BORROW_BPS_YEAR / 10_000) * (7 / 365);
    return { ...e, status: "ok" as const, day0: px.dates[d0], beta, ar0: ar(d0), car01: car(0, 1), car15: car(1, HOLD), shortNet, shortExcess: shortNet + (spy.close[spyIdx.get(px.dates[d0 + HOLD])!] / spy.close[spyIdx.get(px.dates[d0])!] - 1) };
  });

  const ok = rows.filter((r): r is Extract<(typeof rows)[number], { status: "ok" }> => r.status === "ok");
  const block = (list: typeof ok) => ({
    reactionDay0: stats(list.map((r) => ({ date: r.day0, v: r.ar0 }))),
    car0to1: stats(list.map((r) => ({ date: r.day0, v: r.car01 }))),
    tradableDrift1to5: stats(list.map((r) => ({ date: r.day0, v: r.car15 }))),
    shortNetOfCosts: stats(list.map((r) => ({ date: r.day0, v: r.shortNet }))),
  });
  const all = block(ok), infraOnly = block(ok.filter((r) => r.kind !== "software"));
  const d = infraOnly.tradableDrift1to5, s = infraOnly.shortNetOfCosts;
  const supported = d.meanPct !== null && d.t !== null && d.meanPct < 0 && d.t <= -2 && (s.meanPct ?? 0) > 0;
  return {
    version: "v1", computedAt: new Date().toISOString(),
    hypothesis: "Short the provider's listed parent at the outage-day close, hold 5 sessions: positive return net of costs (15 bps/side, 500 bps/yr borrow).",
    method: { benchmark: "SPY market model, estimation days [-250,-21]", day0: "event day if before the 16:00 New York close, else next session", holdSessions: HOLD, costBpsPerSide: COST_BPS_SIDE, borrowBpsPerYear: BORROW_BPS_YEAR, inference: "mean, t-stat with same-day events averaged, share negative" },
    results: { infrastructureOnly: infraOnly, includingCrowdStrike: all },
    conclusion: supported
      ? "Supported on this sample: negative post-event drift with t <= -2 and a positive net short return. Small sample; treat as a candidate for prospective paper testing, not as a live strategy."
      : "Not supported: on this sample there is no significant negative drift after the outage day that a short could capture net of costs. Do not trade outage events on this basis.",
    signalSupported: supported,
    events: rows.map((r) => ({ id: r.id, symbol: r.symbol, provider: r.provider, what: r.what, at: r.at, status: r.status,
      day0: "day0" in r ? r.day0 : null, ar0Pct: "ar0" in r ? r.ar0 * 100 : null, car15Pct: "car15" in r ? r.car15 * 100 : null, shortNetPct: "shortNet" in r ? r.shortNet * 100 : null })),
    limitations: [
      "26 events over 15 years: a small sample; one large event can dominate the mean.",
      "Daily closes cannot show intraday reactions; a faster signal would need intraday data.",
      "Parent companies are diversified (Amazon, Microsoft, Alphabet): an outage is a small part of their value.",
      "Event selection is limited to widely reported outages, which may already be the most visible ones.",
    ],
  };
}

export const outageEventStudy = {
  async get(force = false) {
    const cached = (await mppStore.get(KEY)) as { computedAt: string } | null;
    if (cached && !force && Date.now() - Date.parse(cached.computedAt) < 24 * 3600_000) return cached as Awaited<ReturnType<typeof compute>>;
    const r = await compute();
    await mppStore.put(KEY, r);
    return r;
  },
};
