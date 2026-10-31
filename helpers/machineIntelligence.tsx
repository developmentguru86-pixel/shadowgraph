import { buildRelationshipGraph } from "./relationshipGraphEngine";
import { detectPriceLags } from "./priceLagEngine";
import { buildCommercialLeads } from "./leadEngine";
import { fetchGlobalOfficialSignals } from "./globalSources";
import { fetchGlobalNews } from "./globalNews";
import { PUBLISH_MARKET_QUOTES, PUBLISH_NEWS_HEADLINES } from "./licensing";

export type MachineFocus = {
  symbol?: string;
  keyword?: string;
  country?: string;
};

function normalizeFocus(focus?: MachineFocus): MachineFocus | null {
  if (!focus) return null;
  const symbol = focus.symbol?.trim().toUpperCase();
  const keyword = focus.keyword?.trim();
  const country = focus.country?.trim().toUpperCase();
  if (!symbol && !keyword && !country) return null;
  return {
    ...(symbol ? { symbol } : {}),
    ...(keyword ? { keyword } : {}),
    ...(country ? { country } : {}),
  };
}

function containsFocus(value: unknown, focus: MachineFocus | null) {
  if (!focus) return true;
  const haystack = JSON.stringify(value ?? "").toLowerCase();
  const symbolOk = !focus.symbol || haystack.includes(focus.symbol.toLowerCase());
  const keywordOk = !focus.keyword || haystack.includes(focus.keyword.toLowerCase());
  const countryOk = !focus.country || haystack.includes(focus.country.toLowerCase());
  return symbolOk && keywordOk && countryOk;
}

type Point = {
  id: string;
  name: string;
  value: number | null;
  changePct: number;
  role: string;
};

const instruments = [
  { id: "brent", name: "Brent", symbol: "BZ=F", role: "energy / inflation impulse" },
  { id: "us10y", name: "US 10Y", symbol: "^TNX", role: "discount rate / liquidity" },
  { id: "dxy", name: "DXY", symbol: "DX-Y.NYB", role: "global liquidity" },
  { id: "gold", name: "Gold", symbol: "GC=F", role: "real yield / safe haven" },
  { id: "btc", name: "Bitcoin", symbol: "BTC-USD", role: "liquidity beta" },
  { id: "eth", name: "Ethereum", symbol: "ETH-USD", role: "higher crypto beta" },
  { id: "sol", name: "Solana", symbol: "SOL-USD", role: "high crypto beta" },
  { id: "nasdaq", name: "Nasdaq", symbol: "^IXIC", role: "growth risk" },
];

async function point(item: typeof instruments[number]): Promise<Point> {
  // unlicensed prices never leave the system: the point stays neutral and chains fall back to "no dominant balance"
  if (!PUBLISH_MARKET_QUOTES) return { id: item.id, name: item.name, value: null, changePct: 0, role: item.role };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph-Machine/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${item.symbol} ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter((value): value is number => typeof value === "number");
  const value = typeof result?.meta?.regularMarketPrice === "number"
    ? result.meta.regularMarketPrice
    : valid.at(-1) ?? null;
  const previous = valid.length >= 2 ? valid.at(-2)! : null;
  const changePct = value !== null && previous ? ((value / previous) - 1) * 100 : 0;
  return { id: item.id, name: item.name, value, changePct, role: item.role };
}

function byId(points: Point[], id: string) {
  return points.find((item) => item.id === id);
}

function strongestExpression(points: Point[], direction: "LONG" | "SHORT" | "WAIT") {
  const crypto = ["btc", "eth", "sol"]
    .map((id) => byId(points, id))
    .filter((item): item is Point => Boolean(item));
  if (!crypto.length) return null;
  if (direction === "SHORT") return crypto.sort((a, b) => a.changePct - b.changePct)[0];
  if (direction === "LONG") return crypto.sort((a, b) => b.changePct - a.changePct)[0];
  return crypto.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
}

export async function buildMachineIntelligence(
  mode: "hidden_chain" | "alpha" | "opportunity" | "global_brief" | "deep_research",
  requestedFocus?: MachineFocus,
) {
  const focus = normalizeFocus(requestedFocus);
  const settled = await Promise.allSettled(instruments.map(point));
  const points = settled
    .filter((item): item is PromiseFulfilledResult<Point> => item.status === "fulfilled")
    .map((item) => item.value);
  if (points.length < 6) throw new Error("Insufficient cross-market data");

  const dxy = byId(points, "dxy")?.changePct ?? 0;
  const yields = byId(points, "us10y")?.changePct ?? 0;
  const oil = byId(points, "brent")?.changePct ?? 0;
  const btc = byId(points, "btc")?.changePct ?? 0;
  const eth = byId(points, "eth")?.changePct ?? 0;
  const nasdaq = byId(points, "nasdaq")?.changePct ?? 0;

  const riskOff = [
    dxy > 0.15,
    yields > 0.1,
    oil > 0.25,
    btc < -0.8,
    eth < -1,
    nasdaq < 0,
  ].filter(Boolean).length;
  const riskOn = [
    dxy < -0.15,
    yields < -0.1,
    btc > 0.8,
    eth > 1,
    nasdaq > 0.3,
  ].filter(Boolean).length;

  const direction: "LONG" | "SHORT" | "WAIT" =
    riskOff >= 4 ? "SHORT" : riskOn >= 4 ? "LONG" : "WAIT";
  const evidenceCount = direction === "SHORT" ? riskOff : direction === "LONG" ? riskOn : Math.max(riskOff, riskOn);
  const expression = strongestExpression(points, direction);
  const confidence = direction === "WAIT"
    ? Math.min(69, 42 + evidenceCount * 5)
    : Math.min(96, 58 + evidenceCount * 7 + (Math.abs(expression?.changePct ?? 0) > 2 ? 5 : 0));

  const chain = direction === "SHORT"
    ? [
        "Energy / inflation pressure",
        "Yields and/or dollar stay firm",
        "Financial conditions tighten",
        "Broad risk appetite weakens",
        "BTC absorbs liquidity pressure",
        `${expression?.name ?? "Higher-beta asset"} becomes the strongest expression`,
      ]
    : direction === "LONG"
      ? [
          "Dollar / yield pressure eases",
          "Financial conditions loosen",
          "Growth risk stabilizes",
          "BTC confirms returning liquidity",
          `${expression?.name ?? "Higher-beta asset"} becomes the strongest expression`,
        ]
      : [
          "Cross-market inputs disagree",
          "No dominant transmission chain",
          "Wait for at least four independent confirmations",
        ];

  const divergences = [
    Math.abs(eth - btc) >= 1
      ? { relation: "ETH vs BTC beta gap", spreadPct: eth - btc, interpretation: eth < btc ? "ETH underperforms BTC" : "ETH outperforms BTC" }
      : null,
    Math.abs(btc - nasdaq) >= 1.5
      ? { relation: "Crypto vs Nasdaq gap", spreadPct: btc - nasdaq, interpretation: btc < nasdaq ? "crypto-specific pressure" : "crypto relative strength" }
      : null,
  ].filter(Boolean);

  const common = {
    generatedAt: new Date().toISOString(),
    mode,
    focus,
    direction,
    confidence,
    evidenceCount,
    strongestExpression: expression
      ? { asset: expression.name, changePct: Math.round(expression.changePct * 100) / 100 }
      : null,
    hiddenChain: chain,
    crossMarket: points.map((item) => ({
      id: item.id,
      value: item.value,
      changePct: Math.round(item.changePct * 100) / 100,
      role: item.role,
    })),
    divergences,
  };

  if (mode === "hidden_chain") {
    const [graphResult, lagResult] = await Promise.allSettled([
      buildRelationshipGraph(),
      detectPriceLags(),
    ]);
    const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
    const priceLag = lagResult.status === "fulfilled" ? lagResult.value : null;
    return {
      ...common,
      relationshipGraph: graph ? {
        stats: graph.stats,
        topEdges: graph.edges.slice(0, 12),
        disclaimer: graph.disclaimer,
      } : null,
      measuredLeadLag: priceLag ? {
        method: priceLag.method,
        sample: priceLag.sample,
        testsPerformed: priceLag.testsPerformed,
        trainSurvivors: priceLag.trainSurvivors,
        signals: priceLag.signals.slice(0, 6),
        topLeadLag: priceLag.topLeadLag,
        message: priceLag.message,
      } : null,
    };
  }

  if (mode === "alpha") {
    const lagResult = await detectPriceLags().catch(() => null);
    return {
      ...common,
      actionability: direction === "WAIT" ? "NO_TRADE" : confidence >= 85 ? "HIGH_CONVICTION_WATCH" : "WATCH",
      executionRule: direction === "WAIT"
        ? "Do not force a position. Wait for alignment."
        : "Use a separate price-structure trigger and hard invalidation; relationship alignment alone is not an entry.",
      measuredLeadLag: lagResult ? {
        method: lagResult.method,
        sample: lagResult.sample,
        testsPerformed: lagResult.testsPerformed,
        trainSurvivors: lagResult.trainSurvivors,
        signals: lagResult.signals.slice(0, 8),
        topLeadLag: lagResult.topLeadLag,
        message: lagResult.message,
      } : null,
    };
  }

  if (mode === "global_brief") {
    const [officialResult, lagResult, leadResult, graphResult, newsResult] = await Promise.allSettled([
      fetchGlobalOfficialSignals(),
      detectPriceLags(),
      buildCommercialLeads(),
      buildRelationshipGraph(),
      PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([]),
    ]);
    const official = officialResult.status === "fulfilled" ? officialResult.value : null;
    const priceLag = lagResult.status === "fulfilled" ? lagResult.value : null;
    const leads = leadResult.status === "fulfilled" ? leadResult.value : null;
    const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
    const news = newsResult.status === "fulfilled" ? newsResult.value : [];
    const disclosures = official?.disclosures.filter((item) => {
      if (!focus) return true;
      const symbolOk = !focus.symbol || item.symbol.toUpperCase() === focus.symbol;
      const keywordOk = !focus.keyword || `${item.company} ${item.title} ${item.form}`.toLowerCase().includes(focus.keyword.toLowerCase());
      return symbolOk && keywordOk;
    }) ?? [];
    const procurement = official?.procurement.filter((item) => {
      if (!focus) return true;
      const countryOk = !focus.country || item.buyerCountry.toUpperCase() === focus.country;
      const keywordOk = !focus.keyword || `${item.title} ${item.buyer} ${item.theme} ${item.cpv.join(" ")}`.toLowerCase().includes(focus.keyword.toLowerCase());
      return countryOk && keywordOk;
    }) ?? [];
    const focusedNews = news.filter((item) => containsFocus(item, focus));
    const focusedLeads = leads?.leads.filter((item) => containsFocus(item, focus)) ?? [];
    const focusedEdges = graph?.edges.filter((item) => containsFocus(item, focus)) ?? [];
    return {
      ...common,
      product: "ShadowGraph Global Intelligence Brief",
      coverage: ["US official filings", "EU procurement", "global markets", "infrastructure", "global thematic news"],
      officialSignals: official ? {
        disclosures: disclosures.slice(0, 12),
        procurement: procurement.slice(0, 18),
      } : null,
      topNews: focusedNews.slice(0, 12),
      measuredLeadLag: priceLag ? {
        method: priceLag.method,
        sample: priceLag.sample,
        testsPerformed: priceLag.testsPerformed,
        trainSurvivors: priceLag.trainSurvivors,
        signals: priceLag.signals.slice(0, 12),
        topLeadLag: priceLag.topLeadLag,
        message: priceLag.message,
      } : null,
      topCommercialOpportunities: focusedLeads.slice(0, 15),
      relationshipGraph: graph ? {
        stats: graph.stats,
        topEdges: focusedEdges.slice(0, 20),
      } : null,
      focusMatchCounts: focus ? {
        disclosures: disclosures.length,
        procurement: procurement.length,
        news: focusedNews.length,
        commercialLeads: focusedLeads.length,
        graphEdges: focusedEdges.length,
      } : null,
      executiveSummary: {
        regime: direction,
        confidence,
        strongestExpression: common.strongestExpression,
        evidenceCount,
      },
      disclaimer: "This is machine intelligence built from public/official evidence and statistical relationships. It is not proof of causation, a contract, or guaranteed investment return.",
    };
  }

  if (mode === "deep_research") {
    const [officialResult, lagResult, leadResult, graphResult, newsResult] = await Promise.allSettled([
      fetchGlobalOfficialSignals(),
      detectPriceLags(),
      buildCommercialLeads(),
      buildRelationshipGraph(),
      PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([]),
    ]);
    const official = officialResult.status === "fulfilled" ? officialResult.value : null;
    const priceLag = lagResult.status === "fulfilled" ? lagResult.value : null;
    const leads = leadResult.status === "fulfilled" ? leadResult.value : null;
    const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
    const news = newsResult.status === "fulfilled" ? newsResult.value : [];
    const disclosures = official?.disclosures.filter((item) => {
      if (!focus) return true;
      const symbolOk = !focus.symbol || item.symbol.toUpperCase() === focus.symbol;
      const keywordOk = !focus.keyword || `${item.company} ${item.title} ${item.form}`.toLowerCase().includes(focus.keyword.toLowerCase());
      return symbolOk && keywordOk;
    }) ?? [];
    const procurement = official?.procurement.filter((item) => {
      if (!focus) return true;
      const countryOk = !focus.country || item.buyerCountry.toUpperCase() === focus.country;
      const keywordOk = !focus.keyword || `${item.title} ${item.buyer} ${item.theme} ${item.cpv.join(" ")}`.toLowerCase().includes(focus.keyword.toLowerCase());
      return countryOk && keywordOk;
    }) ?? [];
    const focusedNews = news.filter((item) => containsFocus(item, focus));
    const focusedLeads = leads?.leads.filter((item) => containsFocus(item, focus)) ?? [];
    const focusedEdges = graph?.edges.filter((item) => containsFocus(item, focus)) ?? [];
    const focusedLagSignals = priceLag?.signals.filter((item) =>
      !focus?.symbol || item.leader === focus.symbol || item.follower === focus.symbol
    ) ?? [];
    return {
      ...common,
      product: "ShadowGraph Deep Research",
      objective: "Provide a high-density machine-readable research pack combining official evidence, cross-market state, graph relationships, measured lags and commercial opportunities.",
      sourceCoverage: {
        officialDisclosures: disclosures.length,
        procurementSignals: procurement.length,
        newsSignals: focusedNews.length,
        graphNodes: graph?.stats.nodes ?? 0,
        graphEdges: focusedEdges.length,
        measuredLeadLagRelationships: focusedLagSignals.length,
        commercialLeads: focusedLeads.length,
      },
      officialEvidence: official ? {
        disclosures: disclosures.slice(0, 30),
        procurement: procurement.slice(0, 45),
      } : null,
      newsEvidence: focusedNews.slice(0, 30),
      relationshipGraph: graph ? {
        stats: graph.stats,
        edges: focusedEdges.slice(0, 45),
        disclaimer: graph.disclaimer,
      } : null,
      priceLagResearch: priceLag ? {
        method: priceLag.method,
        sample: priceLag.sample,
        testsPerformed: priceLag.testsPerformed,
        trainSurvivors: priceLag.trainSurvivors,
        signals: focusedLagSignals.slice(0, 25),
        topLeadLag: focusedLagSignals[0] ?? null,
        message: priceLag.message,
      } : null,
      commercialOpportunityResearch: leads ? {
        methodology: leads.methodology,
        disclaimer: leads.disclaimer,
        leads: focusedLeads.slice(0, 35),
      } : null,
      researchChecklist: [
        "Separate direct official evidence from inferred graph edges.",
        "Validate the strongest lag relationships against current price action before downstream use.",
        "Inspect procurement eligibility, geography and deadline before treating a candidate supplier match as actionable.",
        "Treat directional market output as a state estimate rather than a guaranteed trade signal.",
      ],
      disclaimer: "Deep Research is an evidence-ranked research pack for downstream agents. It does not establish legal/contractual relationships or guarantee market outcomes.",
    };
  }

  const [lagResult, leadResult, graphResult] = await Promise.allSettled([
    detectPriceLags(),
    buildCommercialLeads(),
    buildRelationshipGraph(),
  ]);
  const priceLag = lagResult.status === "fulfilled" ? lagResult.value : null;
  const leads = leadResult.status === "fulfilled" ? leadResult.value : null;
  const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
  const focusedLeads = leads?.leads.filter((item) => containsFocus(item, focus)) ?? [];
  const focusedEdges = graph?.edges.filter((item) => containsFocus(item, focus)) ?? [];
  const focusedLagSignals = priceLag?.signals.filter((item) =>
    !focus?.symbol || item.leader === focus.symbol || item.follower === focus.symbol
  ) ?? [];

  return {
    ...common,
    opportunity: direction === "WAIT"
      ? "No dominant pricing lag detected."
      : `Search for assets and suppliers economically exposed to the ${direction === "SHORT" ? "tightening" : "easing"} chain that have not yet matched the move in the strongest expression.`,
    priceLagDetector: priceLag ? {
      method: priceLag.method,
      sample: priceLag.sample,
      testsPerformed: priceLag.testsPerformed,
      trainSurvivors: priceLag.trainSurvivors,
      signals: focusedLagSignals.slice(0, 12),
      topLeadLag: focusedLagSignals[0] ?? null,
      message: priceLag.message,
    } : null,
    commercialLeadEngine: leads ? {
      methodology: leads.methodology,
      leads: focusedLeads.slice(0, 12),
      disclaimer: leads.disclaimer,
    } : null,
    relationshipGraph: graph ? {
      stats: graph.stats,
      topEdges: focusedEdges.slice(0, 12),
      disclaimer: graph.disclaimer,
    } : null,
    nextChecks: [
      "official corporate disclosures",
      "sector-relative volume confirmation",
      "supplier / infrastructure exposure",
      "price lag versus first-order asset",
    ],
  };
}