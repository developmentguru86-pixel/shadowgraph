import type { PagePrefetchFn } from "@runtime/prefetch";
import { dependencyReport } from "../helpers/dependencyReport";

// Server-render the report with its numbers (title, description and findings), not "—" placeholders.
export const prefetch: PagePrefetchFn = async ({ qc }) => {
  try {
    // same JSON shape the browser gets from /_api/report/internet
    qc.setQueryData(["report-internet"], JSON.parse(JSON.stringify(await dependencyReport())));
  } catch (e) {
    console.error("report prefetch failed", e instanceof Error ? e.message : e);
  }
  return { maxAge: 1800 };
};