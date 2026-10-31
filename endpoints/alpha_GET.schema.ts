import superjson from "superjson";

export type AlphaSetup = {
  signalId: string;
  generatedAt: string;
  instrument: string;
  direction: "LONG" | "SHORT" | "WAIT";
  state: "WAIT" | "ARMED" | "ACTIVE" | "TARGET HIT" | "STOPPED" | "INVALIDATED";
  confidence: number;
  scoreKind?: "rule_score";
  successProbability?: number | null;
  quoteObservedAt?: string | null;
  evidenceCount: number;
  currentPrice: number;
  trigger: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  rewardRisk: number | null;
  atr15m: number | null;
  hiddenChain: string[];
  thesis: string;
  invalidation: string;
};

export type OutputType = {
  fetchedAt: string;
  setup: AlphaSetup;
  prices: Record<string, number>;
  quoteTimes?: Record<string, string>;
};

export const getAlpha = async (): Promise<OutputType> => {
  const result = await fetch("/_api/alpha");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};