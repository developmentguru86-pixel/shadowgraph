export type DatasetRow = {
  customer: string; customerTicker: string | null; supplier: string; supplierTicker: string; supplierCik: string;
  revenueShare: number; fiscalPeriodEnd: string; form: string; filedAt: string;
  attribution: "official" | "inferred"; sourceUrl: string; evidence: string;
};
export type OutputType = {
  stats: { relationships: number; official: number; suppliers: number; customers: number; latestFiling: string };
  price: string;
  sampleSize: number;
  rows: DatasetRow[];
};

export const getDatasetSample = async (): Promise<OutputType> => {
  const r = await fetch("/_api/dataset/sample");
  if (!r.ok) throw new Error("Sample unavailable");
  return r.json();
};