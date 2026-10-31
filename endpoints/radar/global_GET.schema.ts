import type { GlobalView } from "../../helpers/globalProbeJob";

export type OutputType = GlobalView;

export const getRadarGlobal = async (): Promise<OutputType> => {
  const r = await fetch("/_api/radar/global");
  if (!r.ok) throw new Error("Worldwide checks unavailable");
  return r.json();
};
