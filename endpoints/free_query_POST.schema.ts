import { z } from "zod";

export const schema = z.object({
  type: z.enum(["market_recap", "company_filings", "eu_tenders"]),
  symbol: z.string().trim().max(20).optional(),
  keyword: z.string().trim().max(120).optional(),
  country: z.string().trim().max(8).optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = unknown;

export const postFreeQuery = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/free_query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Free query failed.");
  return payload;
};