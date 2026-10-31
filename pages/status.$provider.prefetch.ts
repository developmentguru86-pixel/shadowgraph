import type { PagePrefetchFn } from "@runtime/prefetch";
import { getStatusPageData } from "../helpers/statusPage";

// Server-render the status page with live data so search engines see the verdict, endpoints and dependencies.
export const prefetch: PagePrefetchFn = async ({ qc, url }) => {
  const raw = new URL(url, "https://x").pathname.split("/status/")[1]?.split("/")[0] ?? "";
  const slug = decodeURIComponent(raw).toLowerCase();
  const data = await getStatusPageData(slug);
  qc.setQueryData(["status-page", slug], data);
  return { maxAge: 300, ...(data.kind === "unknown" ? { statusCode: 404 } : {}) };
};
