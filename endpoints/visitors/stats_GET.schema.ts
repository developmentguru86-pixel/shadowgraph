import type { VisitorSummary } from "../../helpers/visitorStats";

export type OutputType = VisitorSummary | { error: string };

export const getVisitorStats = async (key: string): Promise<OutputType> => {
  const r = await fetch(`/_api/visitors/stats?key=${encodeURIComponent(key)}`, { cache: "no-store" });
  return r.json();
};
