import superjson from "superjson";
import type { MarketQuote, OutputType } from "./markets_GET.schema";
import { PUBLISH_MARKET_QUOTES, WITHHELD } from "../helpers/licensing";

const watchlist = [
  { symbol: "TCELL.IS", name: "Turkcell", theme: "Telecom & Data" },
  { symbol: "TTKOM.IS", name: "Türk Telekom", theme: "Telecom & Fiber" },
  { symbol: "KAREL.IS", name: "Karel", theme: "Telecom Equipment" },
  { symbol: "ASTOR.IS", name: "Astor Enerji", theme: "Grid & Transformers" },
  { symbol: "EUPWR.IS", name: "Europower", theme: "Grid Equipment" },
  { symbol: "KONTR.IS", name: "Kontrolmatik", theme: "Energy Tech" },
  { symbol: "MIATK.IS", name: "Mia Teknoloji", theme: "Digital Infrastructure" },
  { symbol: "LOGO.IS", name: "Logo Yazılım", theme: "Enterprise Software" },
  { symbol: "AKBNK.IS", name: "Akbank", theme: "Banking" },
  { symbol: "GARAN.IS", name: "Garanti BBVA", theme: "Banking" },
  { symbol: "THYAO.IS", name: "Türk Hava Yolları", theme: "Logistics & Travel" },
  { symbol: "TAVHL.IS", name: "TAV Havalimanları", theme: "Transport Infrastructure" },
];

const pct = (a: number | null, b: number | null) =>
  a && b ? ((a / b) - 1) * 100 : null;

async function quote(item: typeof watchlist[number]): Promise<MarketQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${item.symbol}?range=10d&interval=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph/2.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${item.symbol} ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes: Array<number | null> = result?.indicators?.quote?.[0]?.volume ?? [];
  const validCloses = closes.filter((value): value is number => typeof value === "number");
  const validVolumes = volumes.filter((value): value is number => typeof value === "number" && value > 0);
  const last = typeof meta.regularMarketPrice === "number"
    ? meta.regularMarketPrice
    : validCloses.at(-1) ?? null;
  const previous = validCloses.length >= 2 ? validCloses.at(-2)! : null;
  const first5 = validCloses.length >= 5 ? validCloses.at(-5)! : validCloses[0] ?? null;
  const lastVolume = validVolumes.at(-1) ?? null;
  const historyVolumes = validVolumes.slice(0, -1);
  const avgVolume = historyVolumes.length
    ? historyVolumes.reduce((sum, value) => sum + value, 0) / historyVolumes.length
    : null;

  return {
    symbol: item.symbol.replace(".IS", ""),
    name: item.name,
    theme: item.theme,
    price: last,
    currency: String(meta.currency ?? "TRY"),
    change1dPct: pct(last, previous),
    change5dPct: pct(last, first5),
    volumeRatio: lastVolume && avgVolume ? lastVolume / avgVolume : null,
    marketTime: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : null,
  };
}

export async function handle() {
  if (!PUBLISH_MARKET_QUOTES) {
    return new Response(superjson.stringify({ fetchedAt: new Date().toISOString(), quotes: [], notice: WITHHELD.quotes }), { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  const settled = await Promise.allSettled(watchlist.map(quote));
  const quotes = settled
    .filter((item): item is PromiseFulfilledResult<MarketQuote> => item.status === "fulfilled")
    .map((item) => item.value);
  if (!quotes.length) {
    return new Response(superjson.stringify({ error: "Market data unavailable" }), { status: 502 });
  }
  const output: OutputType = { fetchedAt: new Date().toISOString(), quotes };
  return new Response(superjson.stringify(output), {
    headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=240" },
  });
}