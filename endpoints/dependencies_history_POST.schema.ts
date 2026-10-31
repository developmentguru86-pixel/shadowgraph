import { z } from "zod";

export const schema = z.object({});
export type OutputType = { started: boolean; reason?: string; state?: unknown };

export const postDependenciesHistory = async (): Promise<OutputType> => {
  const r = await fetch("/_api/dependencies_history", { method: "POST", body: "{}" });
  if (!r.ok) throw new Error("History backfill start failed");
  return r.json();
};