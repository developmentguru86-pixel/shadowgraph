import type { SearchResult } from "../helpers/globalSearch";

export type OutputType = SearchResult;

export const getSearch = async (q: string, quick = false, signal?: AbortSignal): Promise<OutputType> => {
  const r = await fetch(`/_api/search?q=${encodeURIComponent(q)}${quick ? "&quick=1" : ""}`, { signal });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Search failed");
  return j;
};
