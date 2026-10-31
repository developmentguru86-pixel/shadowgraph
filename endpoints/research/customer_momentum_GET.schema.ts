export type OutputType = Record<string, unknown>;

export const getResearchCustomerMomentum = async (): Promise<OutputType> => {
  const r = await fetch("/_api/research/customer_momentum");
  if (!r.ok) throw new Error("Backtest result unavailable");
  return r.json();
};
