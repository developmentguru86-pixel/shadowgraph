import superjson from "superjson";

export type KapSignal = {
  id: string;
  symbol: string;
  company: string;
  title: string;
  publishedAt: string;
  url: string;
  category: "contract" | "capex" | "financing" | "corporate" | "other";
  score: number;
};

export type OutputType = {
  fetchedAt: string;
  signals: KapSignal[];
  source: string;
};

export const getKap = async (): Promise<OutputType> => {
  const result = await fetch("/_api/kap");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};