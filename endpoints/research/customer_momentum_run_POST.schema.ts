import { z } from "zod";

export const schema = z.object({});
export type OutputType = { started: boolean; reason?: string };

export const postResearchCustomerMomentumRun = async (): Promise<OutputType> => {
  const r = await fetch("/_api/research/customer_momentum_run", { method: "POST", body: "{}" });
  if (!r.ok) throw new Error("Could not start backtest");
  return r.json();
};
