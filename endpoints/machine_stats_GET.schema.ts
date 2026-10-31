export type OutputType = {
  paidCalls: number;
  revenueUsd: number;
  lastPaidCallAt: string | null;
  byMode: Array<{ mode: string; calls: number; revenueUsd: number }>;
};

export const getMachineStats = async (): Promise<OutputType> => {
  const result = await fetch("/_api/machine_stats");
  if (!result.ok) throw new Error(`Machine stats ${result.status}`);
  return result.json();
};