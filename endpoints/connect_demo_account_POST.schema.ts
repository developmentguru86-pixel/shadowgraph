import { z } from "zod";

export const schema = z.object({
  userId: z.string().min(2).max(100).regex(/^[A-Za-z0-9._-]+$/),
  displayName: z.string().min(2).max(120),
  contactEmail: z.string().email().max(254),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = {
  userId: string;
  accountId: string;
  displayName: string;
  contactEmail: string;
  created: boolean;
};

export const postConnectDemoAccount = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Connected account creation failed.");
  return payload;
};
