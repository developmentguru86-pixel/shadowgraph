import superjson from "superjson";

export type MarketQuote = {
  symbol: string;
  name: string;
  theme: string;
  price: number | null;
  currency: string;
  change1dPct: number | null;
  change5dPct: number | null;
  volumeRatio: number | null;
  marketTime: number | null;
};

export type OutputType = {
  fetchedAt: string;
  quotes: MarketQuote[];
};

export const getMarkets = async (): Promise<OutputType> => {
  const result = await fetch("/_api/markets");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};