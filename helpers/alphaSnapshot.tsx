import type { AlphaSetup, OutputType } from "../endpoints/alpha_GET.schema";

type Bar = { high: number; low: number; close: number };

async function chart(symbol: string, range: string, interval: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph/4.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${symbol} ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} no chart data`);
  return result;
}

function dailyChange(result: any) {
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter((v): v is number => typeof v === "number");
  const current = typeof result?.meta?.regularMarketPrice === "number"
    ? result.meta.regularMarketPrice
    : valid.at(-1) ?? null;
  const previous = valid.length >= 2 ? valid.at(-2)! : null;
  return { current, change: current !== null && previous ? ((current / previous) - 1) * 100 : 0 };
}

function bars15(result: any): Bar[] {
  const quote = result?.indicators?.quote?.[0] ?? {};
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const closes: Array<number | null> = quote.close ?? [];
  const output: Bar[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (typeof highs[i] === "number" && typeof lows[i] === "number" && typeof closes[i] === "number") {
      output.push({ high: highs[i]!, low: lows[i]!, close: closes[i]! });
    }
  }
  return output;
}

function atr(bars: Bar[], period = 14) {
  const subset = bars.slice(-(period + 1));
  if (subset.length < 4) return null;
  const ranges: number[] = [];
  for (let i = 1; i < subset.length; i += 1) {
    const prevClose = subset[i - 1].close;
    ranges.push(Math.max(
      subset[i].high - subset[i].low,
      Math.abs(subset[i].high - prevClose),
      Math.abs(subset[i].low - prevClose),
    ));
  }
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

const round = (value: number, price: number) => {
  if (price >= 10000) return Math.round(value);
  if (price >= 1000) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
};

function makeSignalId(instrument: string, direction: string) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `SG-${day}-${instrument.replace("-USD", "")}-${direction}`;
}

export async function alphaSnapshot(): Promise<OutputType> {
    const fetched = await Promise.allSettled([
      chart("BTC-USD", "1d", "15m"),
      chart("ETH-USD", "1d", "15m"),
      chart("SOL-USD", "1d", "15m"),
      chart("BTC-USD", "5d", "1d"),
      chart("ETH-USD", "5d", "1d"),
      chart("SOL-USD", "5d", "1d"),
      chart("DX-Y.NYB", "5d", "1d"),
      chart("^TNX", "5d", "1d"),
      chart("BZ=F", "5d", "1d"),
      chart("^IXIC", "5d", "1d"),
    ]);

    const [btc15, eth15, sol15, btcD, ethD, solD, dxyD, tnxD, brentD, nasdaqD] = fetched.map(r => r.status === "fulfilled" ? r.value : {});
    const complete = fetched.every(r => r.status === "fulfilled");
    const quoteTimes: Record<string,string> = {};
    const macro = {
      btc: dailyChange(btcD),
      eth: dailyChange(ethD),
      sol: dailyChange(solD),
      dxy: dailyChange(dxyD),
      tnx: dailyChange(tnxD),
      brent: dailyChange(brentD),
      nasdaq: dailyChange(nasdaqD),
    };
    const priceSnapshots: Record<string, number> = {};
    for (const [symbol, result] of [
      ["BTC", btc15],
      ["ETH", eth15],
      ["SOL", sol15],
    ] as const) {
      const bars = bars15(result);
      const latest = bars.at(-1)?.close;
      const price = typeof result?.meta?.regularMarketPrice === "number"
        ? result.meta.regularMarketPrice
        : latest;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        const t = result?.meta?.regularMarketTime;
        if (typeof t === "number" && t * 1000 <= Date.now() + 60000 && Date.now() - t * 1000 <= 30 * 60000) {
          priceSnapshots[symbol] = price;
          quoteTimes[symbol] = new Date(t * 1000).toISOString();
        }
      }
    }

    const riskOffEvidence = [
      macro.dxy.change > 0.15,
      macro.tnx.change > 0.1,
      macro.brent.change > 0.25,
      macro.btc.change < -0.8,
      macro.eth.change < -1,
      macro.nasdaq.change < 0,
    ].filter(Boolean).length;
    const riskOnEvidence = [
      macro.dxy.change < -0.15,
      macro.tnx.change < -0.1,
      macro.btc.change > 0.8,
      macro.eth.change > 1,
      macro.nasdaq.change > 0.3,
    ].filter(Boolean).length;

    const direction: AlphaSetup["direction"] =
      !complete ? "WAIT" : riskOffEvidence >= 4 ? "SHORT" : riskOnEvidence >= 4 ? "LONG" : "WAIT";
    const evidenceCount = direction === "SHORT" ? riskOffEvidence : direction === "LONG" ? riskOnEvidence : Math.max(riskOffEvidence, riskOnEvidence);

    const candidates = [
      { instrument: "BTC-USD", daily: macro.btc, bars: bars15(btc15) },
      { instrument: "ETH-USD", daily: macro.eth, bars: bars15(eth15) },
      { instrument: "SOL-USD", daily: macro.sol, bars: bars15(sol15) },
    ].filter((item) => item.daily.current !== null && item.bars.length >= 8 && priceSnapshots[item.instrument.replace("-USD","")] !== undefined);

    candidates.sort((a, b) => Math.abs(b.daily.change) - Math.abs(a.daily.change));
    const chosen = candidates[0];
    if (!chosen) throw new Error("No liquid crypto candidate");

    const currentPrice = priceSnapshots[chosen.instrument.replace("-USD", "")] ?? chosen.daily.current!;
    const volatility = atr(chosen.bars);
    const recent = chosen.bars.slice(-8);
    const recentLow = Math.min(...recent.map((bar) => bar.low));
    const recentHigh = Math.max(...recent.map((bar) => bar.high));

    let trigger: number | null = null;
    let stop: number | null = null;
    let target1: number | null = null;
    let target2: number | null = null;
    let rewardRisk: number | null = null;
    let state: AlphaSetup["state"] = "WAIT";

    if (direction !== "WAIT" && volatility && volatility > 0) {
      if (direction === "SHORT") {
        trigger = round(recentLow - volatility * 0.08, currentPrice);
        stop = round(trigger + volatility * 1.2, currentPrice);
        target1 = round(trigger - volatility * 1.6, currentPrice);
        target2 = round(trigger - volatility * 2.7, currentPrice);
        rewardRisk = (trigger - target2) / (stop - trigger);
        state = currentPrice <= trigger
          ? "ACTIVE"
          : currentPrice - trigger <= volatility * 0.75 ? "ARMED" : "WAIT";
      } else {
        trigger = round(recentHigh + volatility * 0.08, currentPrice);
        stop = round(trigger - volatility * 1.2, currentPrice);
        target1 = round(trigger + volatility * 1.6, currentPrice);
        target2 = round(trigger + volatility * 2.7, currentPrice);
        rewardRisk = (target2 - trigger) / (trigger - stop);
        state = currentPrice >= trigger
          ? "ACTIVE"
          : trigger - currentPrice <= volatility * 0.75 ? "ARMED" : "WAIT";
      }
    }

    const confidence = direction === "WAIT"
      ? Math.min(69, 42 + evidenceCount * 5)
      : Math.min(96, 58 + evidenceCount * 7 + (Math.abs(chosen.daily.change) > 2 ? 5 : 0));

    const hiddenChain = direction === "SHORT"
      ? [
          "DXY / yields firm",
          "Financial conditions tighten",
          "Broad risk appetite weakens",
          "BTC absorbs liquidity pressure",
          `${chosen.instrument.replace("-USD", "")} expresses higher beta`,
        ]
      : direction === "LONG"
        ? [
            "DXY / yields soften",
            "Financial conditions ease",
            "Risk appetite improves",
            "BTC confirms liquidity return",
            `${chosen.instrument.replace("-USD", "")} expresses higher beta`,
          ]
        : ["Cross-market signals disagree", "No directional alpha is armed"];

    const setup: AlphaSetup = {
      signalId: makeSignalId(chosen.instrument, direction),
      generatedAt: new Date().toISOString(),
      instrument: chosen.instrument.replace("-USD", ""),
      direction,
      state,
      confidence,
      evidenceCount,
      currentPrice: round(currentPrice, currentPrice),
      trigger,
      stop,
      target1,
      target2,
      rewardRisk: rewardRisk ? Math.round(rewardRisk * 100) / 100 : null,
      atr15m: volatility ? round(volatility, currentPrice) : null,
      hiddenChain,
      thesis: direction === "WAIT"
        ? "Cross-market evidence is not aligned strongly enough to justify a directional setup."
        : `${evidenceCount} potentially correlated cross-market indicators align with ${direction.toLowerCase()} pressure; the highest-beta liquid candidate is ${chosen.instrument.replace("-USD", "")}.`,
      invalidation: direction === "WAIT" || stop === null
        ? "Wait for at least four indicators to align."
        : `Setup is invalid if price trades through the stop zone around ${stop}.`,
    };

    return { fetchedAt: new Date().toISOString(), setup: {...setup, scoreKind: "rule_score", successProbability: null, quoteObservedAt: quoteTimes[setup.instrument] ?? null}, prices: priceSnapshots, quoteTimes };
}