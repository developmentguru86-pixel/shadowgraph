import type { PagePrefetchFn } from "@runtime/prefetch";
import { companyDependencies } from "../helpers/companyDependencies";

// Server-render the company page so search engines see the customers, shares and history.
export const prefetch: PagePrefetchFn = async ({ qc, url }) => {
  const raw = new URL(url, "https://x").pathname.split("/company/")[1]?.split("/")[0] ?? "";
  const slug = decodeURIComponent(raw).toLowerCase();
  const data = await companyDependencies.page(slug);
  if (!data) return { statusCode: 404 };
  qc.setQueryData(["company", slug], JSON.parse(JSON.stringify(data)));
  return { maxAge: 3600 };
};
