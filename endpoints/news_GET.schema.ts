import superjson from "superjson";

export type NewsEvent = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type OutputType = {
  fetchedAt: string;
  events: NewsEvent[];
  source: string;
};

export const getNews = async (): Promise<OutputType> => {
  const result = await fetch("/_api/news");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};