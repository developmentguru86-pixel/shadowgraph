export type ChangeLine = { slug: string; customerSlug: string; customer: string; text: string; kind: "new" | "dropped" | "up" | "down" | "steady" | "first" };
export type ChangeFiling = { accession: string; filerSlug: string; filerName: string; form: string; filedAt: string; period: string; url: string; lines: ChangeLine[] };
export type OutputType = { filings: ChangeFiling[] };

export const getCompanyChanges = async (): Promise<OutputType> => {
  const r = await fetch(`/_api/company/changes`);
  if (!r.ok) throw new Error("unavailable");
  return r.json();
};
