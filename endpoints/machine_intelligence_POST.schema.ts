import { z } from "zod";

export const schema = z.object({
  mode: z.enum(["hidden_chain", "alpha", "opportunity", "global_brief", "deep_research"]).default("hidden_chain"),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  requestId: string;
  priceUsd: number;
  intelligence: unknown;
};

export const postMachineIntelligence = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validated = schema.parse(body);
  const result = await fetch("/_api/machine/intelligence", {
    method: "POST",
    body: JSON.stringify(validated),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!result.ok) throw new Error(`Machine API ${result.status}`);
  return result.json();
};