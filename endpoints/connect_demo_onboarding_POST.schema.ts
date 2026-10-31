import { z } from "zod";

export const schema = z.object({
  userId: z.string().min(2).max(100).regex(/^[A-Za-z0-9._-]+$/),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { url: string; accountId: string };

export const postConnectDemoOnboarding = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Onboarding link creation failed.");
  return payload;
};
