import type { outageEventStudy } from "../../helpers/outageEventStudy";

export type OutputType = Awaited<ReturnType<typeof outageEventStudy.get>>;

export const getOutageImpact = async (): Promise<OutputType> => {
  const r = await fetch("/_api/research/outage_impact");
  if (!r.ok) throw new Error("Study unavailable");
  return r.json();
};