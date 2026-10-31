import { z } from "zod";

export const schema = z.object({});

export type OutputType = { started: boolean; runId?: string; reason?: string; state?: unknown };

export const postDependenciesBackfill = async (): Promise<OutputType> => {
  const result = await fetch("/_api/dependencies_backfill", { method: "POST", body: "{}" });
  if (!result.ok) throw new Error("Backfill start failed");
  return result.json();
};
