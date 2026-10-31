import type { PagePrefetchFn } from "@runtime/prefetch";
import { statusBoards } from "../helpers/statusBoards";
import { templateBySlug, DEFAULT_SLA } from "../helpers/boardTemplates";

// Server-render example boards: they double as public "is it down?" pages for their tool suites.
export const prefetch: PagePrefetchFn = async ({ qc, url }) => {
  const slug = decodeURIComponent(new URL(url, "https://x").pathname.split("/boards/")[1]?.split("/")[0] ?? "");
  const t = templateBySlug(slug);
  if (!t) return { statusCode: 404 };
  const b = await statusBoards.preview({ serviceIds: t.serviceIds, title: t.title, accent: t.accent, theme: t.theme, slaTarget: t.sla ?? DEFAULT_SLA }).catch(() => null);
  if (b) qc.setQueryData(["board-template", slug], JSON.parse(JSON.stringify(b)));
  return { maxAge: 60 };
};