export type GlobalInfraNode = {
  id: string;
  type: "facility" | "exchange";
  name: string;
  city: string;
  country: string;
  region: string;
  website?: string | null;
};

export type OutputType = {
  fetchedAt: string;
  facilities: GlobalInfraNode[];
  exchanges: GlobalInfraNode[];
  countries: string[];
};

export const getGlobalInfra = async (): Promise<OutputType> => {
  const result = await fetch("/_api/global_infra");
  if (!result.ok) throw new Error("Global infrastructure data unavailable");
  return result.json();
};