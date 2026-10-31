export type OutputType = {
  status: "ok" | "degraded";
  service: string;
  version: string;
  checkedAt: string;
  discovery: {
    mcp: string;
    a2a: string;
    openapi: string;
  };
  snapshots: {
    graph: { available: boolean; generatedAt: string | null; ageSeconds: number | null };
    leadLag: { available: boolean; generatedAt: string | null; ageSeconds: number | null };
    globalMarkets: { available: boolean; generatedAt: string | null; ageSeconds: number | null };
    globalOfficial: { available: boolean; generatedAt: string | null; ageSeconds: number | null };
  };
};

export const getHealth = async (): Promise<OutputType> => {
  const result = await fetch("/_api/health");
  if (!result.ok) throw new Error("Health endpoint unavailable");
  return result.json();
};
