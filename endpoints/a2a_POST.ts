import { schema } from "./a2a_POST.schema";
import {
  authorizeMachineIntelligence,
  type MachineMode,
} from "../helpers/paidMachineIntelligence";
import { fetchGlobalOfficialSignals } from "../helpers/globalSources";
import { detectPriceLags } from "../helpers/priceLagEngine";
import { buildRelationshipGraph } from "../helpers/relationshipGraphEngine";
import { recordAgentFunnelEvent, INTERNAL_HEADER } from "../helpers/agentFunnel";

function rpc(id: string | number | null, result: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "A2A-Version": "1.0",
      ...(headers ?? {}),
    },
  });
}

function rpcError(id: string | number | null, code: number, message: string) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "A2A-Version": "1.0",
    },
  });
}

function textFromParams(params: Record<string, unknown>) {
  const message = params.message as Record<string, unknown> | undefined;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      return typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function requestedMode(text: string): MachineMode {
  const normalized = text.toLowerCase();
  if (/(deep research|full research|comprehensive research|research pack|deep dive)/.test(normalized)) {
    return "deep_research";
  }
  if (/(global brief|intelligence brief|executive brief|full brief)/.test(normalized)) {
    return "global_brief";
  }
  if (/(procurement|supplier|commercial|opportun|second.?order|pricing.?lag|tender|ted)/.test(normalized)) {
    return "opportunity";
  }
  if (/(alpha|market signal|direction|trade|long|short|risk signal)/.test(normalized)) {
    return "alpha";
  }
  return "hidden_chain";
}

async function freePreview() {
  const [officialResult, lagResult, graphResult] = await Promise.allSettled([
    fetchGlobalOfficialSignals(),
    detectPriceLags(),
    buildRelationshipGraph(),
  ]);
  const official = officialResult.status === "fulfilled" ? officialResult.value : null;
  const lag = lagResult.status === "fulfilled" ? lagResult.value : null;
  const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
  return {
    service: "ShadowGraph Machine Intelligence",
    coverage: ["US/SEC EDGAR", "EU/TED", "Global markets", "Global infrastructure", "Global news", "Türkiye regional pack"],
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
    } : null,
    next: {
      paidSkill: "global_snapshot",
      priceUsd: 0.50,
      payment: "HTTP 402 / MPP / Stripe",
    },
  };
}

export async function handle(request: Request) {
  let input: ReturnType<typeof schema.parse>;
  try {
    input = schema.parse(JSON.parse(await request.clone().text()));
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const id = input.id ?? null;
  if (input.method !== "SendMessage") {
    await recordAgentFunnelEvent({ eventType: "discovery", channel: "a2a", mode: String(input.method).slice(0, 60), userAgent: request.headers.get("user-agent"), request });
    return rpcError(id, -32601, `Unsupported A2A method: ${input.method}`);
  }

  const params = (input.params ?? {}) as Record<string, unknown>;
  const text = textFromParams(params);
  const normalized = text.toLowerCase();

  if (/(what moved|market recap|market today|markets today|top movers)/.test(normalized)) {
    await recordAgentFunnelEvent({
      eventType: "preview",
      channel: "a2a",
      mode: "free:market_recap",
      userAgent: request.headers.get("user-agent"),
      request,
    });
    const origin = new URL(request.url).origin;
    const freeResponse = await fetch(`${origin}/_api/free_query`, {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_HEADER]: "a2a" },
      body: JSON.stringify({ type: "market_recap", limit: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await freeResponse.json();
    return rpc(id, {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_AGENT",
        parts: [{ text: JSON.stringify(payload) }],
        metadata: { freeTool: "market_recap" },
      },
    });
  }

  const filingMatch = text.match(/([A-Z]{1,5}).*(?:filing|filings|sec|8-k|10-q|10-k)/i)
    ?? text.match(/(?:filing|filings|sec|8-k|10-q|10-k).*([A-Z]{1,5})/i);
  if (filingMatch) {
    await recordAgentFunnelEvent({
      eventType: "preview",
      channel: "a2a",
      mode: "free:company_filings",
      userAgent: request.headers.get("user-agent"),
      request,
    });
    const origin = new URL(request.url).origin;
    const freeResponse = await fetch(`${origin}/_api/free_query`, {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_HEADER]: "a2a" },
      body: JSON.stringify({ type: "company_filings", symbol: filingMatch[1].toUpperCase(), limit: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await freeResponse.json();
    return rpc(id, {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_AGENT",
        parts: [{ text: JSON.stringify(payload) }],
        metadata: { freeTool: "company_filings" },
      },
    });
  }

  if (/(eu tender|eu procurement|ted tender|open tender|procurement notice)/.test(normalized)) {
    await recordAgentFunnelEvent({
      eventType: "preview",
      channel: "a2a",
      mode: "free:eu_tenders",
      userAgent: request.headers.get("user-agent"),
      request,
    });
    const origin = new URL(request.url).origin;
    const freeResponse = await fetch(`${origin}/_api/free_query`, {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_HEADER]: "a2a" },
      body: JSON.stringify({ type: "eu_tenders", keyword: text.slice(0, 100), limit: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await freeResponse.json();
    return rpc(id, {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_AGENT",
        parts: [{ text: JSON.stringify(payload) }],
        metadata: { freeTool: "eu_tenders" },
      },
    });
  }

  // Discovery/preview questions are deliberately free. This gives another
  // agent enough live evidence to decide whether a paid call is worthwhile.
  if (!text || /(preview|what can you do|capabilit|service info|free sample|coverage)/.test(normalized)) {
    await recordAgentFunnelEvent({
      eventType: "preview",
      channel: "a2a",
      userAgent: request.headers.get("user-agent"),
      request,
    });
    const preview = await freePreview();
    return rpc(id, {
      message: {
        messageId: crypto.randomUUID(),
        role: "ROLE_AGENT",
        parts: [{ text: JSON.stringify(preview) }],
        metadata: { freePreview: true },
      },
    });
  }

  const mode = requestedMode(text);
  const paid = await authorizeMachineIntelligence(request, mode, "/_api/a2a");
  if (paid.kind === "challenge") return paid.response;

  return rpc(id, {
    message: {
      messageId: crypto.randomUUID(),
      role: "ROLE_AGENT",
      parts: [{ text: JSON.stringify(paid.intelligence) }],
      metadata: {
        shadowgraphMode: mode,
        priceUsd: paid.priceUsd,
        requestId: paid.requestId,
      },
    },
  }, {
    "Payment-Receipt": paid.receiptHeader,
    "X-ShadowGraph-Request-Id": paid.requestId,
  });
}