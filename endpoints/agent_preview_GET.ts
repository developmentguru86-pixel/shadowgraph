import { fetchGlobalOfficialSignals } from "../helpers/globalSources";
import { detectPriceLags } from "../helpers/priceLagEngine";
import { buildRelationshipGraph } from "../helpers/relationshipGraphEngine";
import { recordAgentFunnelEvent } from "../helpers/agentFunnel";

export async function handle(request: Request) {
  await recordAgentFunnelEvent({
    eventType: "preview",
    channel: "preview",
    userAgent: request.headers.get("user-agent"),
    request,
  });
  const [officialResult, lagResult, graphResult] = await Promise.allSettled([
    fetchGlobalOfficialSignals(),
    detectPriceLags(),
    buildRelationshipGraph(),
  ]);
  const official = officialResult.status === "fulfilled" ? officialResult.value : null;
  const lag = lagResult.status === "fulfilled" ? lagResult.value : null;
  const graph = graphResult.status === "fulfilled" ? graphResult.value : null;

  return new Response(JSON.stringify({
    service: "ShadowGraph Machine Intelligence",
    positioning: "Global evidence-ranked relationship, market-lag and commercial-opportunity intelligence for autonomous agents.",
    coverage: [
      "US / SEC EDGAR",
      "EU / TED procurement",
      "Global company and cross-asset markets",
      "Global internet infrastructure",
      "Global thematic news",
      "Türkiye regional pack",
    ],
    live: {
      recentOfficialDisclosures: official?.disclosures.length ?? null,
      activeEuProcurementSignals: official?.procurement.length ?? null,
      graph: graph?.stats ?? null,
      leadLag: lag ? {
        method: lag.method,
        sample: lag.sample,
        testsPerformed: lag.testsPerformed,
        trainSurvivors: lag.trainSurvivors,
        signalCount: lag.signals.length,
        topLeadLag: lag.topLeadLag,
        message: lag.message,
        naiveMultipleTestingAudit: lag.audit,
      } : null,
    },
    recommendedPaidNextStep: {
      rest: "POST https://shadowalpha.online/_api/machine/intelligence",
      mode: "hidden_chain",
      mcpTool: "shadowgraph_global_snapshot",
      priceUsd: 0.50,
    },
    payment: "HTTP 402 / MPP / Stripe",
    discovery: {
      mcp: "https://shadowalpha.online/_api/mcp",
      a2a: "https://shadowalpha.online/_api/a2a",
      agentCard: "https://shadowalpha.online/.well-known/agent-card.json",
      openapi: "https://shadowalpha.online/openapi.json",
    },
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}