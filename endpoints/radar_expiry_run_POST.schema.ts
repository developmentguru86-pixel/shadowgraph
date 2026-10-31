import { z } from "zod";

export const schema = z.object({});
export type OutputType = Record<string, unknown>;

export const postRadarExpiryRun = async (): Promise<OutputType> => {
  const r = await fetch("/_api/radar/expiry_run", { method: "POST", body: "{}" });
  return r.json();
};