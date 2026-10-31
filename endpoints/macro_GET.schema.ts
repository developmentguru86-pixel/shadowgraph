import superjson from "superjson";

export type MacroNode = {
  id: string;
  name: string;
  symbol: string;
  value: number | null;
  unit: string;
  changePct: number | null;
  role: string;
};

export type HiddenChain = {
  id: string;
  title: string;
  confidence: number;
  direction: "risk-on" | "risk-off" | "mixed";
  steps: string[];
  logic: string;
  watch: string;
};

export type OutputType = {
  fetchedAt: string;
  nodes: MacroNode[];
  chains: HiddenChain[];
};

export const getMacro = async (): Promise<OutputType> => {
  const result = await fetch("/_api/macro");
  if (!result.ok) {
    const error = superjson.parse<{ error: string }>(await result.text());
    throw new Error(error.error);
  }
  return superjson.parse<OutputType>(await result.text());
};