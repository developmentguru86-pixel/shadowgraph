import superjson from "superjson";

export type TenderSignal = {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  theme: string;
  score: number;
};

export type OutputType = {
  fetchedAt: string;
  tenders: TenderSignal[];
  source: string;
  verificationUrl: string;
};

export const getTenders = async (): Promise<OutputType> => {
  const result = await fetch("/_api/tenders");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};