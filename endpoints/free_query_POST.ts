import { schema } from "./free_query_POST.schema";
import { fetchGlobalOfficialSignals } from "../helpers/globalSources";
import { fetchGlobalNews } from "../helpers/globalNews";
import { recordAgentFunnelEvent } from "../helpers/agentFunnel";
import { PUBLISH_NEWS_HEADLINES } from "../helpers/licensing";

type GlobalMarketQuote = {
  symbol: string;
  name: string;
  region: string;
  theme: string;
  price: number | null;
  currency: string;
  change1dPct: number | null;
  change5dPct: number | null;
  volumeRatio: number | null;
};

async function fetchMarketQuotes(request: Request) {
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/_api/global_markets`, {
    headers: { "user-agent": "ShadowGraph-FreeQuery/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Global market layer unavailable");
  const payload = await response.json();
  return (payload?.quotes ?? []) as GlobalMarketQuote[];
}

function normalize(value: string) {
  return value.toLocaleLowerCase("en-US");
}

export async function handle(request: Request) {
  try {
    const input = schema.parse(await request.json());
    await recordAgentFunnelEvent({
      eventType: "preview",
      channel: "rest",
      mode: `free:${input.type}`,
      userAgent: request.headers.get("user-agent"),
      request,
    });

    if (input.type === "market_recap") {
      const [quotes, news] = await Promise.all([
        fetchMarketQuotes(request),
        PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([]),
      ]);
      const movers = [...quotes]
        .filter((quote) => typeof quote.change1dPct === "number")
        .sort((a, b) => Math.abs(b.change1dPct ?? 0) - Math.abs(a.change1dPct ?? 0))
        .slice(0, input.limit);
      return Response.json({
        type: input.type,
        generatedAt: new Date().toISOString(),
        movers,
        relevantNews: news.slice(0, input.limit),
        nextPaidStep: {
          mode: "global_brief",
          priceUsd: 2.50,
          reason: "Use the paid brief for graph relationships, measured lead/lag, procurement and official evidence in one response.",
        },
      });
    }

    const official = await fetchGlobalOfficialSignals();

    if (input.type === "company_filings") {
      if (!input.symbol) {
        return new Response(JSON.stringify({ error: "symbol is required for company_filings" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const symbol = input.symbol.toUpperCase();
      const filings = official.disclosures
        .filter((item) => item.symbol.toUpperCase() === symbol)
        .slice(0, input.limit);
      return Response.json({
        type: input.type,
        symbol,
        filings,
        source: "SEC EDGAR",
        nextPaidStep: {
          mode: "deep_research",
          priceUsd: 5.00,
          reason: "Use Deep Research to connect filings to procurement, graph relationships, news and market evidence.",
        },
      });
    }

    const keyword = normalize(input.keyword ?? "");
    const country = (input.country ?? "").toUpperCase();
    const tenders = official.procurement
      .filter((item) => {
        const keywordOk = !keyword || normalize(`${item.title} ${item.buyer} ${item.theme} ${item.cpv.join(" ")}`).includes(keyword);
        const countryOk = !country || item.buyerCountry.toUpperCase() === country;
        return keywordOk && countryOk;
      })
      .slice(0, input.limit);
    return Response.json({
      type: input.type,
      query: { keyword: input.keyword ?? null, country: input.country ?? null },
      tenders,
      source: "EU TED",
      nextPaidStep: {
        mode: "opportunity",
        priceUsd: 1.00,
        reason: "Use the paid opportunity tool for supplier matching and second-order commercial inference.",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Free query failed",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
}