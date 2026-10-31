export type StorefrontAccount = {
  userId: string;
  accountId: string;
  displayName: string;
  contactEmail: string;
  readyToReceivePayments: boolean;
  onboardingComplete: boolean;
  transferCapabilityStatus: string;
  requirementsStatus: string | null;
  statusError?: string;
};

export type StorefrontProduct = {
  productId: string;
  name: string;
  description: string | null;
  priceId: string | null;
  unitAmount: number | null;
  currency: string | null;
  connectedAccountId: string | null;
  ownerUserId: string | null;
};

export type OutputType = {
  accounts: StorefrontAccount[];
  products: StorefrontProduct[];
};

export const getConnectDemoStorefront = async (): Promise<OutputType> => {
  const result = await fetch("/_api/connect_demo/storefront");
  const payload = await result.json();
  if (!result.ok) throw new Error(payload?.error ?? "Storefront could not be loaded.");
  return payload;
};
