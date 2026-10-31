import type { SpreadStat } from "../../helpers/concentrationSignal";

export type StudyResult = {
  version: string; generatedAt: string; startedAt: string; registeredAt: string; question: string;
  verdict: "supported" | "not_supported"; rule: string;
  sample: { filings: number; priced: number; pennyExcluded: number; symbols: number; symbolsPriced: number; firstFiled: string | null; lastFiled: string | null;
    counts: { rise: number; fall: number; steady: number; unknown: number } };
  primary: SpreadStat & { window: [number, number]; benchmark: string; firstHalf: SpreadStat; secondHalf: SpreadStat; sameSign: boolean };
  secondary: { filingDay: SpreadStat; month1: SpreadStat; year1: SpreadStat; primaryVsIwm: SpreadStat; levelTopVsBottom: SpreadStat };
  years: Array<{ year: string; rise: number; fall: number; meanRise: number | null; meanFall: number | null }>;
  largest: Array<{ ticker: string; filed: string; c0: number | null; c1: number | null; delta: number | null; arM3: number | null; accession: string }>;
  caveats: string[];
  changelog?: Array<{ version: string; date: string; note: string }>;
};

export const getConcentrationSignal = async (): Promise<StudyResult> => {
  const r = await fetch("/_api/research/concentration_signal");
  if (!r.ok) throw new Error("Result unavailable");
  return r.json();
};