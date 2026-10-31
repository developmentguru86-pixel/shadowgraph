import type { GlobalDisclosure, GlobalProcurement } from "../helpers/globalSources";

export type OutputType = {
  fetchedAt: string;
  disclosures: GlobalDisclosure[];
  procurement: GlobalProcurement[];
  sources: { sec: string; ted: string };
};

export const getGlobalOfficial = async (): Promise<OutputType> => {
  const result = await fetch("/_api/global_official");
  if (!result.ok) throw new Error("Global official sources unavailable");
  return result.json();
};