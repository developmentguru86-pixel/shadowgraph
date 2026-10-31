import { z } from "zod";

export const schema = z.object({});
export type OutputType = Record<string, unknown>;

export const postUpstreamRun = async (): Promise<OutputType> => {
  const r = await fetch("/_api/upstream/run", { method: "POST", body: "{}" });
  return r.json();
};
