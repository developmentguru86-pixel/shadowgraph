import { z } from "zod";

export const schema = z.object({});

export type OutputType = {
  ran: boolean;
  reason?: string;
  last?: unknown;
  summary?: {
    startedAt: string; finishedAt: string; filers: number; filingsParsed: number; facts: number;
    named: number; textAttributed: number; anonymous: number; errors: Array<{ ticker: string; error: string }>;
  };
};

export const postDependenciesRefresh = async (): Promise<OutputType> => {
  const result = await fetch("/_api/dependencies_refresh", { method: "POST", body: "{}" });
  if (!result.ok) throw new Error("Dependency refresh failed");
  return result.json();
};
