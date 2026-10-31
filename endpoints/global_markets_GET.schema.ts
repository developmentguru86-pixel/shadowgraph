export type GlobalMarketQuote = {
  symbol: string;
  name: string;
  region: string;
  theme: string;
  price: number | null;
  currency: string;
  change1dPct: number | null;
  change5dPct: number | null;
  volumeRatio: number | null;
  marketTime: number | null;
};

export type OutputType = { fetchedAt: string; quotes: GlobalMarketQuote[] };

export const getGlobalMarkets = async (): Promise<OutputType> => {
  const result = await fetch("/_api/global_markets");
  if (!result.ok) throw new Error("Global market data unavailable");
  return result.json();
};