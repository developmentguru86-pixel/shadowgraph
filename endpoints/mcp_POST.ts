import { schema } from "./mcp_POST.schema";
import {
  authorizeMachineIntelligenceMcp,
  machinePrices,
  MCP_RECEIPT_KEY,
  type MachineMode,
} from "../helpers/paidMachineIntelligence";
import { fetchGlobalOfficialSignals } from "../helpers/globalSources";
import { detectPriceLags } from "../helpers/priceLagEngine";
import { buildRelationshipGraph } from "../helpers/relationshipGraphEngine";
import { recordAgentFunnelEvent } from "../helpers/agentFunnel";
import { fetchGlobalNews } from "../helpers/globalNews";
import { PUBLISH_NEWS_HEADLINES } from "../helpers/licensing";
import { MCP_MODERN, MCP_LEGACY, MCP_NEGOTIABLE, MCP_SERVER_INFO, MCP_TOOLS } from "../helpers/mcpCatalog";

const MODERN = MCP_MODERN;
const LEGACY = MCP_LEGACY;
const serverInfo = MCP_SERVER_INFO;
const tools = MCP_TOOLS;

function modeForTool(name: string): MachineMode | null {
  if (name === "shadowgraph_hidden_chain" || name === "shadowgraph_global_snapshot") return "hidden_chain";
  if (name === "shadowgraph_alpha" || name === "shadowgraph_market_signal") return "alpha";
  if (name === "shadowgraph_opportunity" || name === "shadowgraph_procurement_opportunity") return "opportunity";
  if (name === "shadowgraph_global_brief") return "global_brief";
  if (name === "shadowgraph_deep_research") return "deep_research";
  return null;
}

function jsonRpc(id: string | number | null, result: unknown, modern: boolean, headers?: HeadersInit) {
  const body = {
    jsonrpc: "2.0",
    id,
    result: modern && result && typeof result === "object"
      ? {
          ...(result as Record<string, unknown>),
          _meta: {
            ...((result as Record<string, unknown>)._meta as Record<string, unknown> | undefined),
            "io.modelcontextprotocol/serverInfo": serverInfo,
          },
        }
      : result,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  });
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown, status = 200) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validateModernHeaders(request: Request, method: string, name?: string) {
  const protocol = request.headers.get("mcp-protocol-version");
  if (protocol !== MODERN) return "MCP-Protocol-Version must be 2026-07-28";
  const headerMethod = request.headers.get("mcp-method");
  if (headerMethod !== method) return "Mcp-Method header does not match JSON-RPC method";
  if (method === "tools/call") {
    const headerName = request.headers.get("mcp-name");
    if (!name || headerName !== name) return "Mcp-Name header does not match tool name";
  }
  return null;
}

export async function handle(request: Request) {
  let input: ReturnType<typeof schema.parse>;
  try {
    input = schema.parse(JSON.parse(await request.clone().text()));
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = input.id ?? null;
  const protocolHeader = request.headers.get("mcp-protocol-version");
  const modern = protocolHeader === MODERN || input.method === "server/discover";

  if (modern) {
    const toolName = input.method === "tools/call" && input.params
      ? String((input.params as Record<string, unknown>).name ?? "")
      : undefined;
    const headerError = validateModernHeaders(request, input.method, toolName);
    if (headerError) return rpcError(id, -32020, "HeaderMismatch", { detail: headerError }, 400);
  }

  if (input.method === "initialize" || input.method === "tools/list" || input.method === "server/discover") {
    // handshake / tool listing: logged as a signal for the globe's agent layer (not part of the sales funnel)
    await recordAgentFunnelEvent({ eventType: "discovery", channel: "mcp", mode: input.method, userAgent: request.headers.get("user-agent"), request });
  }

  if (input.method === "server/discover") {
    return jsonRpc(id, {
      supportedVersions: [MODERN, LEGACY],
      capabilities: { tools: { listChanged: false } },
      instructions: "Use tools/list to discover ShadowGraph tools. Paid tools use the Machine Payments Protocol MCP binding: an unpaid tools/call returns JSON-RPC error -32042 with error.data.challenges (method stripe, intent charge); retry the identical tools/call with params._meta[\"org.paymentauth/credential\"] = {challenge, payload: {spt}}; the receipt is returned in result._meta[\"org.paymentauth/receipt\"].",
      ttlMs: 3_600_000,
      cacheScope: "public",
    }, true);
  }

  // Notifications carry no id and get no JSON-RPC response: Streamable HTTP says 202 Accepted with an empty body.
  if (input.method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  if (input.method === "initialize") {
    const requested = String(((input.params ?? {}) as Record<string, unknown>).protocolVersion ?? "");
    return jsonRpc(id, {
      protocolVersion: MCP_NEGOTIABLE.includes(requested) ? requested : LEGACY,
      capabilities: { tools: { listChanged: false } },
      serverInfo,
      instructions: "ShadowGraph exposes pay-per-call market intelligence tools. Paid calls use MPP over MCP: an unpaid tools/call returns JSON-RPC error -32042 with error.data.challenges; retry with params._meta[\"org.paymentauth/credential\"]; the receipt is in result._meta[\"org.paymentauth/receipt\"].",
    }, false);
  }

  if (input.method === "tools/list") {
    return jsonRpc(id, modern
      ? { tools, ttlMs: 3_600_000, cacheScope: "public" }
      : { tools }, modern);
  }

  if (input.method === "tools/call") {
    const params = (input.params ?? {}) as Record<string, unknown>;
    const name = String(params.name ?? "");
    if (["shadowgraph_market_recap", "shadowgraph_company_filings", "shadowgraph_eu_tenders"].includes(name)) {
      await recordAgentFunnelEvent({
        eventType: "preview",
        channel: "mcp",
        mode: `free:${name}`,
        userAgent: request.headers.get("user-agent"),
        request,
      });
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5) || 5));
      const official = name === "shadowgraph_market_recap" ? null : await fetchGlobalOfficialSignals();
      let result: unknown;

      if (name === "shadowgraph_company_filings") {
        const symbol = String(args.symbol ?? "").toUpperCase();
        if (!symbol) return rpcError(id, -32602, "symbol is required");
        result = {
          symbol,
          source: "SEC EDGAR",
          filings: official!.disclosures.filter((item) => item.symbol.toUpperCase() === symbol).slice(0, limit),
          nextPaidStep: { tool: "shadowgraph_deep_research", priceUsd: 5.00 },
        };
      } else if (name === "shadowgraph_eu_tenders") {
        const keyword = String(args.keyword ?? "").toLowerCase();
        const country = String(args.country ?? "").toUpperCase();
        result = {
          source: "EU TED",
          tenders: official!.procurement.filter((item) => {
            const keywordOk = !keyword || `${item.title} ${item.buyer} ${item.theme} ${item.cpv.join(" ")}`.toLowerCase().includes(keyword);
            const countryOk = !country || item.buyerCountry.toUpperCase() === country;
            return keywordOk && countryOk;
          }).slice(0, limit),
          nextPaidStep: { tool: "shadowgraph_procurement_opportunity", priceUsd: 1.00 },
        };
      } else {
        const origin = new URL(request.url).origin;
        const [marketResponse, news] = await Promise.all([
          fetch(`${origin}/_api/global_markets`, { signal: AbortSignal.timeout(12_000) }),
          PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([]),
        ]);
        const marketPayload = marketResponse.ok ? await marketResponse.json() : { quotes: [] };
        const movers = [...(marketPayload.quotes ?? [])]
          .filter((quote: any) => typeof quote.change1dPct === "number")
          .sort((a: any, b: any) => Math.abs(b.change1dPct) - Math.abs(a.change1dPct))
          .slice(0, limit);
        result = {
          movers,
          relevantNews: news.slice(0, limit),
          nextPaidStep: { tool: "shadowgraph_global_brief", priceUsd: 2.50 },
        };
      }
      return jsonRpc(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      }, modern);
    }
    if (name === "shadowgraph_free_preview") {
      await recordAgentFunnelEvent({
        eventType: "preview",
        channel: "mcp",
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
      const preview = {
        service: "ShadowGraph Machine Intelligence",
        positioning: "Global evidence-ranked relationship, market-lag and commercial-opportunity intelligence for autonomous agents.",
        coverage: ["US / SEC EDGAR", "EU / TED", "Global markets", "Global internet infrastructure", "Global thematic news", "Türkiye regional pack"],
        live: {
          recentOfficialDisclosures: official?.disclosures.length ?? null,
          activeEuProcurementSignals: official?.procurement.length ?? null,
          graphNodes: graph?.stats.nodes ?? null,
          graphEdges: graph?.stats.edges ?? null,
          leadLag: lag ? {
            method: lag.method,
            sample: lag.sample,
            testsPerformed: lag.testsPerformed,
            trainSurvivors: lag.trainSurvivors,
            signalCount: lag.signals.length,
            topLeadLag: lag.topLeadLag,
            message: lag.message,
          } : null,
        },
        recommendedPaidNextStep: {
          tool: "shadowgraph_global_snapshot",
          priceUsd: 0.50,
          reason: "Lowest-friction paid call for a full cross-region hidden-relationship snapshot.",
        },
        paidTools: {
          shadowgraph_global_snapshot: 0.50,
          shadowgraph_market_signal: 0.75,
          shadowgraph_procurement_opportunity: 1.00,
          shadowgraph_global_brief: 2.50,
          shadowgraph_deep_research: 5.00,
        },
        payment: "HTTP 402 / MPP / Stripe",
      };
      return jsonRpc(id, {
        content: [{ type: "text", text: JSON.stringify(preview) }],
        structuredContent: preview,
      }, modern);
    }

    if (name === "shadowgraph_service_info") {
      return jsonRpc(id, {
        content: [{
          type: "text",
          text: "ShadowGraph is a pay-per-call global evidence-ranked relationship intelligence service. Paid tools settle through MPP / Stripe.",
        }],
        structuredContent: {
          service: "ShadowGraph Machine Intelligence",
          restEndpoint: "https://shadowalpha.online/_api/machine/intelligence",
          mcpEndpoint: "https://shadowalpha.online/_api/mcp",
          openapi: "https://shadowalpha.online/openapi.json",
          docs: "https://shadowalpha.online/docs",
          pricesUsd: machinePrices,
          payment: "MPP / Stripe — MCP: JSON-RPC -32042 + _meta org.paymentauth/credential; REST: HTTP 402 + Authorization: Payment",
          coverage: ["US/SEC EDGAR", "EU/TED", "Global markets", "Global PeeringDB infrastructure", "Global thematic news", "Türkiye/KAP regional pack"],
          recommendedFirstPaidTool: "shadowgraph_global_snapshot",
          freeDataEndpoints: [
            "https://shadowalpha.online/_api/global_official",
            "https://shadowalpha.online/_api/global_news",
            "https://shadowalpha.online/_api/global_markets",
            "https://shadowalpha.online/_api/global_infra",
            "https://shadowalpha.online/_api/graph",
            "https://shadowalpha.online/_api/price_lag",
            "https://shadowalpha.online/_api/leads"
          ],
        },
      }, modern);
    }

    const mode = modeForTool(name);
    if (!mode) return rpcError(id, -32602, `Unknown tool: ${name}`);

    // MPP over MCP: payment required = JSON-RPC error -32042 (not an HTTP 402 page, which MCP clients surface as a transport error)
    const paid = await authorizeMachineIntelligenceMcp(request, mode, "/_api/mcp", params._meta);
    if (paid.kind === "error") return rpcError(id, paid.code, paid.message, paid.data);

    return jsonRpc(id, {
      content: [{
        type: "text",
        text: JSON.stringify(paid.intelligence),
      }],
      structuredContent: paid.intelligence,
      _meta: { [MCP_RECEIPT_KEY]: paid.receipt },
    }, modern, {
      "Payment-Receipt": paid.receiptHeader,
      "X-ShadowGraph-Request-Id": paid.requestId,
      "X-ShadowGraph-Price-Usd": String(paid.priceUsd),
    });
  }

  return rpcError(id, -32601, `Method not found: ${input.method}`);
}