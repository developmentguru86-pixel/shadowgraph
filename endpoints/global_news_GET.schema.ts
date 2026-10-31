import type { GlobalNewsSignal } from "../helpers/globalNews";

export type OutputType = {
  fetchedAt: string;
  events: GlobalNewsSignal[];
  source: string;
};

export const getGlobalNews = async (): Promise<OutputType> => {
  const result = await fetch("/_api/global_news");
  if (!result.ok) throw new Error("Global news unavailable");
  return result.json();
};