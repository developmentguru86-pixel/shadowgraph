export async function handle() {
  return new Response(JSON.stringify({
    name: "ShadowGraph Machine Intelligence",
    transport: "streamable-http",
    protocolVersions: ["2026-07-28", "2025-11-25"],
    endpoint: "https://shadowalpha.online/_api/mcp",
    tools: [
      "shadowgraph_hidden_chain",
      "shadowgraph_alpha",
      "shadowgraph_opportunity",
      "shadowgraph_service_info"
    ],
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}