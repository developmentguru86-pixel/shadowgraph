export type OutputType = {
  service: string;
  positioning: string;
  coverage: string[];
  live: Record<string, unknown>;
  recommendedPaidNextStep: {
    rest: string;
    mode: string;
    mcpTool: string;
    priceUsd: number;
  };
};

export const getAgentPreview = async (): Promise<OutputType> => {
  const result = await fetch("/_api/agent_preview");
  if (!result.ok) throw new Error("Agent preview unavailable");
  return result.json();
};