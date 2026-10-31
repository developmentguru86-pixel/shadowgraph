export type { PriceLagRelationship } from "../helpers/priceLagEngine";
import type { PriceLagRelationship } from "../helpers/priceLagEngine";

export type OutputType = {
  generatedAt: string;
  method: string;
  sample: {
    tickerCount: number;
    tickers: string[];
    marketTicker: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    trainEnd: string | null;
    testStart: string | null;
    minCloseDays: number;
    maxCloseDays: number;
    discoveryFraction: number;
    testFraction: number;
  };
  testsPerformed: number;
  trainSurvivors: number;
  signals: PriceLagRelationship[];
  topLeadLag: PriceLagRelationship | null;
  message: string;
  audit: {
    thresholdP: number;
    tests: number;
    hits: number;
    hitRatePct: number;
    expectedByChance: number;
  };
};

export const getPriceLag = async (): Promise<OutputType> => {
  const result = await fetch("/_api/price_lag");
  if (!result.ok) throw new Error("Price-lag engine unavailable");
  return result.json();
};
