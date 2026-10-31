import type { StatusPageData } from "../../helpers/statusPage";

export type OutputType = StatusPageData;

export const getStatusPage = async (slug: string, opts: { full?: boolean } = {}): Promise<OutputType> => {
  const r = await fetch(`/_api/status/page?slug=${encodeURIComponent(slug)}${opts.full ? "&full=1" : ""}`);
  if (!r.ok) throw new Error("Status unavailable");
  return r.json();
};
