import type { UpstreamOverview } from "../../helpers/upstreamJob";

export type OutputType = UpstreamOverview;

export const getUpstreamSignals = async (): Promise<OutputType> => {
  const r = await fetch("/_api/upstream/signals");
  if (!r.ok) throw new Error("Upstream signals unavailable");
  return r.json();
};
