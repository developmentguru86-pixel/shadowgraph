import type { AgentGlobeData } from "../../helpers/agentGlobe";

export type OutputType = AgentGlobeData;

export const getAgentGlobe = async (): Promise<OutputType> => {
  const r = await fetch("/_api/agents/globe");
  if (!r.ok) throw new Error("Agent layer unavailable");
  return r.json();
};
