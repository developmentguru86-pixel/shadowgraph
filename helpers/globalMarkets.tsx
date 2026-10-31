import type { GlobalMarketQuote } from "../endpoints/global_markets_GET.schema";
import { mppStore } from "./mppStore";

const CACHE_KEY = "cache:global-markets:v2";
const CACHE_TTL_MS = 120_000;

const watchlist = [
  { symbol: "SPY", name: "S&P 500 benchmark", region: "US", theme: "Benchmark" },
  { symbol: "NET", name: "Cloudflare", region: "US", theme: "Internet Infrastructure" },
  { symbol: "NVDA", name: "NVIDIA", region: "US", theme: "AI & Semiconductors" },
  { symbol: "MSFT", name: "Microsoft", region: "US", theme: "Cloud & AI" },
  { symbol: "AMZN", name: "Amazon", region: "US", theme: "Cloud & Logistics" },
  { symbol: "GOOGL", name: "Alphabet", region: "US", theme: "AI & Cloud" },
  { symbol: "META", name: "Meta Platforms", region: "US", theme: "AI Infrastructure" },
  { symbol: "AAPL", name: "Apple", region: "US", theme: "Consumer Technology" },
  { symbol: "AVGO", name: "Broadcom", region: "US", theme: "AI & Networking" },
  { symbol: "AMD", name: "AMD", region: "US", theme: "Semiconductors" },
  { symbol: "ORCL", name: "Oracle", region: "US", theme: "Cloud & Enterprise" },
  { symbol: "JPM", name: "JPMorgan Chase", region: "US", theme: "Banking" },
  { symbol: "GS", name: "Goldman Sachs", region: "US", theme: "Banking" },
  { symbol: "XOM", name: "Exxon Mobil", region: "US", theme: "Energy" },
  { symbol: "CVX", name: "Chevron", region: "US", theme: "Energy" },
  { symbol: "GEV", name: "GE Vernova", region: "US", theme: "Grid & Power" },
  { symbol: "ETN", name: "Eaton", region: "US", theme: "Grid & Electrification" },
  { symbol: "CSCO", name: "Cisco", region: "US", theme: "Networking" },
  { symbol: "UPS", name: "UPS", region: "US", theme: "Logistics" },
  { symbol: "FDX", name: "FedEx", region: "US", theme: "Logistics" },
  { symbol: "ASML", name: "ASML", region: "EU", theme: "Semiconductors" },
  { symbol: "SAP", name: "SAP", region: "EU", theme: "Enterprise Software" },
  { symbol: "SHEL", name: "Shell ADR", region: "EU", theme: "Energy" },
  { symbol: "TTE", name: "TotalEnergies ADR", region: "EU", theme: "Energy" },
  { symbol: "NVO", name: "Novo Nordisk ADR", region: "EU", theme: "Healthcare" },
  { symbol: "TSM", name: "TSMC ADR", region: "Asia", theme: "Semiconductors" },
  { symbol: "BABA", name: "Alibaba ADR", region: "Asia", theme: "Cloud & Commerce" },
  { symbol: "TM", name: "Toyota ADR", region: "Asia", theme: "Industrial & Mobility" },
  { symbol: "SONY", name: "Sony ADR", region: "Asia", theme: "Technology & Media" },
  { symbol: "INFY", name: "Infosys ADR", region: "Asia", theme: "Enterprise Technology" },
  { symbol: "MELI", name: "MercadoLibre", region: "LatAm", theme: "Commerce & Fintech" },
] as const;

const pct = (a: number | null, b: number | null) =>
  a !== null && b !== null && b !== 0 ? ((a / b) - 1) * 100 : null;

async function quote(item: typeof watchlist[number]): Promise<GlobalMarketQuote> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=10d&interval=1d`,
    {
      headers: { "user-agent": "Mozilla/5.0 ShadowGraph-Global/2.0" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`${item.symbol} ${response.status}`);

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes: Array<number | null> = result?.indicators?.quote?.[0]?.volume ?? [];
  const validCloses = closes.filter((value): value is number => typeof value === "number");
  const validVolumes = volumes.filter((value): value is number => typeof value === "number" && value > 0);
  const current = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : validCloses.at(-1) ?? null;
  const previous = validCloses.length >= 2 ? validCloses.at(-2)! : null;
  const first5 = validCloses.length >= 5 ? validCloses.at(-5)! : validCloses[0] ?? null;
  const lastVolume = validVolumes.at(-1) ?? null;
  const historical = validVolumes.slice(0, -1);
  const avg = historical.length ? historical.reduce((sum, value) => sum + value, 0) / historical.length : null;

  return {
    symbol: item.symbol,
    name: item.name,
    region: item.region,
    theme: item.theme,
    price: current,
    currency: String(meta.currency ?? "USD"),
    change1dPct: pct(current, previous),
    change5dPct: pct(current, first5),
    volumeRatio: lastVolume && avg ? lastVolume / avg : null,
    marketTime: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : null,
  };
}

export async function globalMarkets() {
  const cached = await mppStore.get(CACHE_KEY).catch(() => null) as {
    fetchedAt?: string;
    quotes?: GlobalMarketQuote[];
  } | null;
  const cachedAt = cached?.fetchedAt ? Date.parse(cached.fetchedAt) : NaN;
  if (
    cached &&
    Array.isArray(cached.quotes) &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return {
      fetchedAt: cached.fetchedAt!,
      quotes: cached.quotes,
    };
  }

  const settled: PromiseSettledResult<GlobalMarketQuote>[] = [];
  for (let index = 0; index < watchlist.length; index += 8) {
    const batch = await Promise.allSettled(watchlist.slice(index, index + 8).map(quote));
    settled.push(...batch);
    if (index + 8 < watchlist.length) await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const quotes = settled
    .filter((item): item is PromiseFulfilledResult<GlobalMarketQuote> => item.status === "fulfilled")
    .map((item) => item.value);

  if (!quotes.length) throw new Error("Global market data unavailable");

  const output = {
    fetchedAt: new Date().toISOString(),
    quotes,
  };
  await mppStore.put(CACHE_KEY, output).catch(() => undefined);
  return output;
}
