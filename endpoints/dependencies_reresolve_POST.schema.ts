import { z } from "zod";

export const schema = z.object({});
export type OutputType = { ran: boolean; reason?: string; checked?: number; changed?: number; distinct?: Array<{ name: string; from: string | null; to: string | null }> };

export const postDependenciesReresolve = async (): Promise<OutputType> => {
  const r = await fetch("/_api/dependencies_reresolve", { method: "POST", body: "{}" });
  if (!r.ok) throw new Error("Re-resolve failed");
  return r.json();
};
