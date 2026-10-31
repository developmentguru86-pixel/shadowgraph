import type { PagePrefetchFn } from "@runtime/prefetch";
import { companyDependencies } from "../helpers/companyDependencies";
import { concentrationWatch } from "../helpers/concentrationWatch";

// Server-render the full A–Z and the latest changes so crawlers find every company page.
export const prefetch: PagePrefetchFn = async ({ qc }) => {
  const [index, changes] = await Promise.all([companyDependencies.index(), concentrationWatch.recentChanges(90).catch(() => [])]);
  qc.setQueryData(["company-index"], { companies: index });
  qc.setQueryData(["company-changes"], { filings: JSON.parse(JSON.stringify(changes)) });
  return { maxAge: 3600 };
};
