import { z } from "zod";

export const schema = z.object({
  userId: z.string().min(2).max(100).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  priceInCents: z.number().int().min(50).max(100_000_000),
  currency: z.string().length(3).regex(/^[A-Za-z]{3}$/).default("usd"),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = {
  productId: string;
  priceId: string | null;
  connectedAccountId: string;
};

export const postConnectDemoProduct = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/product", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Product creation failed.");
  return payload;
};
