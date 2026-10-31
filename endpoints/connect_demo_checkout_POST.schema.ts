import { z } from "zod";

export const schema = z.object({
  productId: z.string().min(3).max(200),
  quantity: z.number().int().min(1).max(20).default(1),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = {
  url: string;
  sessionId: string;
  applicationFeeAmount: number;
  destinationAccountId: string;
};

export const postConnectDemoCheckout = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Checkout Session creation failed.");
  return payload;
};
