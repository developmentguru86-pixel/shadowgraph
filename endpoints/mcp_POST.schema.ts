import { z } from "zod";

export const schema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type InputType = z.infer<typeof schema>;
export type OutputType = unknown;