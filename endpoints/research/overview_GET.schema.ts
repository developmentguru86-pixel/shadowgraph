import type { ResearchOverview } from "../../helpers/researchJob";

export type OutputType = ResearchOverview;

export const getResearchOverview = async (): Promise<OutputType> => {
  const r = await fetch("/_api/research/overview");
  if (!r.ok) throw new Error("Research unavailable");
  return r.json();
};
