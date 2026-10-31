/**
 * Single source of truth for the MCP server's identity and tool catalog. Used by the MCP endpoint (tools/list)
 * and rendered on /docs, so the documentation can never drift from what agents actually receive.
 */
export const MCP_ENDPOINT = "https://shadowalpha.online/_api/mcp";
export const MCP_REGISTRY_NAME = "online.shadowalpha/shadowgraph";
export const MCP_MODERN = "2026-07-28";
export const MCP_LEGACY = "2025-11-25";
/** Protocol versions a client may request in initialize; the server echoes a supported one back. */
export const MCP_NEGOTIABLE = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_SERVER_INFO = {
  name: "shadowgraph-machine-intelligence",
  title: "ShadowGraph Market Intelligence",
  version: "2.3.3",
  description: "Pay-per-call global evidence-ranked relationship intelligence for AI agents.",
  websiteUrl: "https://shadowalpha.online",
};

const PAY = " Payment: MPP (Stripe) — JSON-RPC error -32042 carries the challenge; retry with params._meta[\"org.paymentauth/credential\"].";
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const NONE = { type: "object", properties: {}, additionalProperties: false };

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, { type: string; description?: string; minimum?: number; maximum?: number }>; required?: string[]; additionalProperties: false };
  outputSchema: { type: "object" };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "shadowgraph_market_recap",
    title: "Global Market Recap",
    description: "Free. Answer the concrete question: what moved in global markets today? Returns the largest current company moves plus recent global thematic news.",
    inputSchema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 10 } }, additionalProperties: false },
    outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_company_filings",
    title: "Latest Official Company Filings",
    description: "Free. Return recent official SEC EDGAR filings for a supported company symbol.",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Ticker symbol, for example NVDA or MSFT" }, limit: { type: "number", minimum: 1, maximum: 10 } }, required: ["symbol"], additionalProperties: false },
    outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_eu_tenders",
    title: "Open EU Procurement Search",
    description: "Free. Search current EU TED procurement notices by keyword and/or buyer country.",
    inputSchema: { type: "object", properties: { keyword: { type: "string" }, country: { type: "string", description: "Two-letter buyer country code, for example DE or FR" }, limit: { type: "number", minimum: 1, maximum: 10 } }, additionalProperties: false },
    outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_free_preview",
    title: "ShadowGraph Global Preview",
    description: "Free. Return a compact live preview of ShadowGraph's global coverage, relationship graph and top measured price-lag signal, plus the paid tools to call next.",
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_global_snapshot",
    title: "ShadowGraph Global Market Snapshot",
    description: `Paid ($0.50/call). Fast global intelligence snapshot across official filings, procurement, infrastructure, markets and evidence-ranked relationships.${PAY}`,
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_market_signal",
    title: "ShadowGraph Global Market Signal",
    description: `Paid ($0.75/call). Global directional market intelligence with measured lead/lag evidence and explicit invalidation logic.${PAY}`,
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_procurement_opportunity",
    title: "ShadowGraph Global Procurement Opportunity",
    description: `Paid ($1.00/call). Find evidence-backed supplier and second-order commercial opportunities using SEC EDGAR, EU TED, KAP, infrastructure and price-lag evidence.${PAY}`,
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_global_brief",
    title: "ShadowGraph Global Intelligence Brief",
    description: "Paid ($2.50/call). Higher-density global intelligence brief combining official disclosures, EU procurement, global news, relationship graph, measured lead/lag and commercial opportunities.",
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_deep_research",
    title: "ShadowGraph Deep Research",
    description: "Paid ($5.00/call). Full machine-readable research pack with expanded official evidence, global news, graph relationships, measured price lags and commercial opportunity analysis.",
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: RO,
  },
  {
    name: "shadowgraph_service_info",
    title: "ShadowGraph Service Info",
    description: "Free. Return service capabilities, paid-tool prices and discovery URLs.",
    inputSchema: NONE as McpTool["inputSchema"], outputSchema: { type: "object" }, annotations: { ...RO, openWorldHint: false },
  },
];

/** Price in USD parsed from the tool description ("Paid ($0.50/call)"), or null for free tools. */
export function mcpToolPrice(t: Pick<McpTool, "description">): number | null {
  const m = /^Paid \(\$(\d+(?:\.\d+)?)/.exec(t.description);
  return m ? Number(m[1]) : null;
}
/** Description without the "Free." / "Paid (...)." prefix and the payment boilerplate, for human docs. */
export function mcpToolSummary(t: Pick<McpTool, "description">): string {
  return t.description.replace(/^(Free\.|Paid \([^)]*\)\.)\s*/, "").replace(/\s*Payment: MPP.*$/, "");
}
