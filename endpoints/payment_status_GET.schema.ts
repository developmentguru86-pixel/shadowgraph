export type OutputType = {
  connected: boolean;
  mode: "live" | "test" | "restricted" | "invalid" | "missing";
  mppReady: boolean;
  message: string;
};

export const getPaymentStatus = async (): Promise<OutputType> => {
  const result = await fetch("/_api/payment_status");
  if (!result.ok) throw new Error(`Payment status ${result.status}`);
  return result.json();
};