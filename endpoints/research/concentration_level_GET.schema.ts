import type { LevelStat } from "../../helpers/concentrationLevel";

export type LevelResult = {
  version: string; generatedAt: string; registeredAt: string; question: string; verdict: "supported" | "not_supported"; rule: string;
  sample: { events: number; labelled: number; noPrice: number; penny: number; shortHistory: number; incomplete: number; firstFiled: string | null; lastFiled: string | null };
  matching: { volHigh: number; volLow: number; volHighUnmatched: number; volLowUnmatched: number; c1High: number; c1Low: number };
  primary: LevelStat & { window: [number, number]; returns: string; firstHalf: LevelStat; secondHalf: LevelStat; sameSign: boolean };
  calendar: { months: number; from: string | null; to: string | null; meanMonthly: number | null; tMean: number | null; alphaMonthly: number | null; tAlpha: number | null;
    betaSpy: number | null; betaSize: number | null; avgLong: number | null; avgShort: number | null; series: Array<{ month: string; ls: number }> };
  secondary: { unmatchedSimple: LevelStat; unmatchedLog: LevelStat; dollarVolumeMatched: LevelStat; primaryVsIwm: LevelStat };
  byQuintile: Array<LevelStat & { quintile: number; volatility: number }>;
  byYear: Array<{ year: string; high: number; low: number; spread: number | null }>;
  caveats: string[];
};

export const getConcentrationLevel = async (): Promise<LevelResult> => {
  const r = await fetch("/_api/research/concentration_level");
  if (!r.ok) throw new Error("Result unavailable");
  return r.json();
};