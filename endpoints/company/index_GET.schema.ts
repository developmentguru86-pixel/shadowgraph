import type { CompanyIndexEntry } from "../../helpers/companyDependencies";

export type OutputType = { companies: CompanyIndexEntry[] };

export const getCompanyIndex = async (): Promise<OutputType> => {
  const r = await fetch(`/_api/company/index`);
  if (!r.ok) throw new Error("unavailable");
  return r.json();
};
