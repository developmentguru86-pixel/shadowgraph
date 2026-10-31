import type { CompanyPage } from "../../helpers/companyDependencies";

export type OutputType = CompanyPage;

export const getCompanyPage = async (slug: string): Promise<OutputType> => {
  const r = await fetch(`/_api/company/page?slug=${encodeURIComponent(slug)}`);
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error("unavailable");
  return r.json();
};
