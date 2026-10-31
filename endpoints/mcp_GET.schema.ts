export type OutputType = {
  name: string;
  transport: string;
  protocolVersions: string[];
  endpoint: string;
  tools: string[];
};

export const getMcpInfo = async (): Promise<OutputType> => {
  const result = await fetch("/_api/mcp");
  if (!result.ok) throw new Error(`MCP info ${result.status}`);
  return result.json();
};