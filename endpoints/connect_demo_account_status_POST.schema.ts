import { z } from "zod";

export const schema = z.object({
  userId: z.string().min(2).max(100).regex(/^[A-Za-z0-9._-]+$/),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = {
  userId: string;
  accountId: string;
  displayName: string;
  contactEmail: string;
  readyToReceivePayments: boolean;
  onboardingComplete: boolean;
  transferCapabilityStatus: string;
  requirementsStatus: string | null;
};

export const postConnectDemoAccountStatus = async (body: InputType): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/account_status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schema.parse(body)),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Connected account status failed.");
  return payload;
};
