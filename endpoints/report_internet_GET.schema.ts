import type { dependencyReport } from "../helpers/dependencyReport";

export type OutputType = Awaited<ReturnType<typeof dependencyReport>>;

export const getReportInternet = async (): Promise<OutputType> => {
  const r = await fetch("/_api/report/internet");
  if (!r.ok) throw new Error("Report unavailable");
  return r.json();
};