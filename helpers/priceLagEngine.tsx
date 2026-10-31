import { sql } from "kysely";
import { db } from "./db";
import { leadLagEngine, type LeadLagRun, type LeadLagSignal } from "./leadLagEngine";
import { mppStore } from "./mppStore";

const LEAD_LAG_CACHE_KEY = "cache:lead-lag:v5";
const LEAD_LAG_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

type SeriesPoint = { date: string; close: number };

type UniverseItem = {
  id: string;
  name: string;
  symbol: string;
};

export type PriceLagRelationship = LeadLagSignal;

export type PriceLagOutput = {
  generatedAt: string;
  method: string;
  sample: LeadLagRun["sample"];
  testsPerformed: number;
  trainSurvivors: number;
  signals: LeadLagSignal[];
  topLeadLag: LeadLagSignal | null;
  message: string;
  audit: {
    thresholdP: number;
    tests: number;
    hits: number;
    hitRatePct: number;
    expectedByChance: number;
  };
};

const universe: UniverseItem[] = [
  { id: "DXY", name: "US Dollar Index", symbol: "DX-Y.NYB" },
  { id: "US10Y", name: "US 10Y Yield", symbol: "^TNX" },
  { id: "BRENT", name: "Brent Oil", symbol: "BZ=F" },
  { id: "GOLD", name: "Gold", symbol: "GC=F" },
  { id: "NASDAQ", name: "Nasdaq", symbol: "^IXIC" },
  { id: "SPY", name: "S&P 500 ETF", symbol: "SPY" },
  { id: "QQQ", name: "Nasdaq 100 ETF", symbol: "QQQ" },
  { id: "SOXX", name: "Semiconductor ETF", symbol: "SOXX" },
  { id: "HYG", name: "High Yield Credit ETF", symbol: "HYG" },
  { id: "TLT", name: "20Y Treasury ETF", symbol: "TLT" },
  { id: "VGK", name: "Europe ETF", symbol: "VGK" },
  { id: "EWJ", name: "Japan ETF", symbol: "EWJ" },
  { id: "EEM", name: "Emerging Markets ETF", symbol: "EEM" },
  { id: "FXI", name: "China Large-Cap ETF", symbol: "FXI" },
  { id: "SILVER", name: "Silver", symbol: "SI=F" },
  { id: "COPPER", name: "Copper", symbol: "HG=F" },
  { id: "BTC", name: "Bitcoin", symbol: "BTC-USD" },
  { id: "ETH", name: "Ethereum", symbol: "ETH-USD" },
  { id: "SOL", name: "Solana", symbol: "SOL-USD" },
  { id: "TCELL", name: "Turkcell", symbol: "TCELL.IS" },
  { id: "TTKOM", name: "Türk Telekom", symbol: "TTKOM.IS" },
  { id: "ASTOR", name: "Astor Enerji", symbol: "ASTOR.IS" },
  { id: "THYAO", name: "Türk Hava Yolları", symbol: "THYAO.IS" },
  { id: "NVDA", name: "NVIDIA", symbol: "NVDA" },
  { id: "MSFT", name: "Microsoft", symbol: "MSFT" },
  { id: "AMZN", name: "Amazon", symbol: "AMZN" },
  { id: "GEV", name: "GE Vernova", symbol: "GEV" },
  { id: "XOM", name: "Exxon Mobil", symbol: "XOM" },
  { id: "JPM", name: "JPMorgan Chase", symbol: "JPM" },
  { id: "CSCO", name: "Cisco", symbol: "CSCO" },
  { id: "UPS", name: "UPS", symbol: "UPS" },
];

async function fetchSeries(item: UniverseItem): Promise<{ item: UniverseItem; points: SeriesPoint[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=2y&interval=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph-LeadLag/3.0" },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) throw new Error(`${item.symbol} ${response.status}`);

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const points: SeriesPoint[] = [];

  for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
    const close = closes[i];
    if (typeof timestamps[i] === "number" && typeof close === "number" && close > 0) {
      points.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close,
      });
    }
  }

  return { item, points };
}

async function loadSeries() {
  const settled: PromiseSettledResult<Awaited<ReturnType<typeof fetchSeries>>>[] = [];

  for (let index = 0; index < universe.length; index += 10) {
    const batch = await Promise.allSettled(universe.slice(index, index + 10).map(fetchSeries));
    settled.push(...batch);
    if (index + 10 < universe.length) await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const series: Record<string, { dates: string[]; closes: number[] }> = {};
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    series[result.value.item.id] = {
      dates: result.value.points.map((point) => point.date),
      closes: result.value.points.map((point) => point.close),
    };
  }
  return series;
}

async function persist(run: LeadLagRun) {
  const runId = crypto.randomUUID();

  await sql`
    INSERT INTO lead_lag_runs
      (run_id, generated_at, method, sample, tests_performed, train_survivors, market_ticker)
    VALUES
      (${runId}, now(), ${run.method}, ${run.sample as any}::jsonb, ${run.testsPerformed}, ${run.trainSurvivors}, ${run.sample.marketTicker})
  `.execute(db);

  for (const signal of run.signals) {
    await sql`
      INSERT INTO lead_lag_signals
        (run_id, leader, follower, lag_days, direction, train_corr, train_q, test_corr, test_p, zero_lag_corr, stability, windows)
      VALUES
        (
          ${runId},
          ${signal.leader},
          ${signal.follower},
          ${signal.lagDays},
          ${signal.direction},
          ${signal.trainCorr},
          ${signal.trainQ},
          ${signal.testCorr},
          ${signal.testP},
          ${signal.zeroLagCorr},
          ${signal.stability},
          ${signal.windows as any}::jsonb
        )
    `.execute(db);
  }
}

export async function detectPriceLags(): Promise<PriceLagOutput> {
  const cached = await mppStore.get(LEAD_LAG_CACHE_KEY).catch(() => null) as PriceLagOutput | null;
  const cachedAt = cached?.generatedAt ? Date.parse(cached.generatedAt) : NaN;
  if (
    cached &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < LEAD_LAG_CACHE_TTL_MS &&
    Array.isArray(cached.signals)
  ) {
    return cached;
  }

  const series = await loadSeries();
  const run = leadLagEngine.runLeadLag(series, { marketTicker: series.SPY ? "SPY" : undefined });
  const audit = leadLagEngine.naiveFalsePositiveCount(series, { thresholdP: 0.004, maxLagDays: 5 });

  await persist(run).catch(() => undefined);

  const output: PriceLagOutput = {
    generatedAt: new Date().toISOString(),
    method: run.method,
    sample: run.sample,
    testsPerformed: run.testsPerformed,
    trainSurvivors: run.trainSurvivors,
    signals: run.signals,
    topLeadLag: run.signals[0] ?? null,
    message: run.signals.length
      ? `${run.signals.length} relationship(s) survived FDR and out-of-sample validation.`
      : "No relationship survived FDR and out-of-sample validation",
    audit,
  };
  await mppStore.put(LEAD_LAG_CACHE_KEY, output).catch(() => undefined);
  return output;
}
