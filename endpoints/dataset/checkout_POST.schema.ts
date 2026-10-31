import { z } from "zod";

export const schema = z.object({});
export type OutputType = { url?: string; error?: string };

export const postDatasetCheckout = async (): Promise<OutputType> => {
  const r = await fetch("/_api/dataset/checkout", { method: "POST", body: "{}" });
  const j = (await r.json()) as OutputType;
  if (!r.ok || !j.url) throw new Error(j.error ?? "Checkout unavailable");
  return j;
};