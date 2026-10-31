import Stripe from "stripe";
import { sql } from "kysely";
import { db } from "./db";
import { fetchGlobalOfficialSignals } from "./globalSources";
import { fetchGlobalNews } from "./globalNews";
import { PUBLISH_MARKET_QUOTES, PUBLISH_NEWS_HEADLINES } from "./licensing";
import { buildRelationshipGraph } from "./relationshipGraphEngine";
import { buildCommercialLeads } from "./leadEngine";
import { detectPriceLags } from "./priceLagEngine";

export type ShadowBriefTier = "instant" | "deep";

export const shadowBriefPrices: Record<ShadowBriefTier, number> = {
  instant: 900,
  deep: 2900,
};

type SecMatch = {
  symbol: string;
  company: string;
  cik: number;
};

function env(name: string) {
  return (Reflect.get(process.env, name) as string | undefined)?.trim();
}

export function getShadowBriefStripeClient() {
  const key = env("STRIPE_LIVE_SECRET_KEY_V2");
  if (!key) {
    throw new Error(
      "Stripe Checkout is not configured. Set STRIPE_LIVE_SECRET_KEY_V2 on the server.",
    );
  }
  return new Stripe(key);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreText(text: string, query: string) {
  const nText = normalize(text);
  const nQuery = normalize(query);
  if (!nQuery) return 0;
  if (nText === nQuery) return 100;
  if (nText.startsWith(nQuery)) return 90;
  if (nText.includes(nQuery)) return 75;
  const tokens = nQuery.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => nText.includes(token)).length;
  return Math.round((hits / tokens.length) * 60);
}

async function resolveSecCompany(query: string): Promise<SecMatch | null> {
  const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: {
      accept: "application/json",
      "user-agent": "ShadowBrief https://shadowalpha.online",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const json = await response.json() as Record<string, any>;
  const upper = query.trim().toUpperCase();
  const candidates: Array<SecMatch & { score: number }> = [];
  for (const value of Object.values(json)) {
    const symbol = String(value?.ticker ?? "").toUpperCase();
    const company = String(value?.title ?? "");
    const symbolScore = symbol === upper ? 120 : scoreText(symbol, query);
    const nameScore = scoreText(company, query);
    const score = Math.max(symbolScore, nameScore);
    if (score >= 45) {
      candidates.push({
        symbol,
        company,
        cik: Number(value?.cik_str),
        score,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return best ? { symbol: best.symbol, company: best.company, cik: best.cik } : null;
}

async function fetchDynamicSec(query: string, limit: number) {
  const match = await resolveSecCompany(query);
  if (!match) return { match: null, filings: [] as any[] };

  const cik10 = String(match.cik).padStart(10, "0");
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik10}.json`, {
    headers: {
      accept: "application/json",
      "user-agent": "ShadowBrief https://shadowalpha.online",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { match, filings: [] as any[] };
  const json = await response.json();
  const recent = json?.filings?.recent ?? {};
  const forms: string[] = recent.form ?? [];
  const dates: string[] = recent.filingDate ?? [];
  const accessions: string[] = recent.accessionNumber ?? [];
  const docs: string[] = recent.primaryDocument ?? [];
  const descriptions: string[] = recent.primaryDocDescription ?? [];
  const filings = [];

  for (let i = 0; i < forms.length && filings.length < limit; i += 1) {
    const form = String(forms[i] ?? "");
    if (!["8-K", "10-Q", "10-K", "6-K", "20-F", "40-F"].includes(form)) continue;
    const accession = String(accessions[i] ?? "");
    const clean = accession.replace(/-/g, "");
    filings.push({
      symbol: match.symbol,
      company: match.company,
      form,
      filedAt: String(dates[i] ?? ""),
      title: String(descriptions[i] || `${match.company} ${form}`),
      url: `https://www.sec.gov/Archives/edgar/data/${match.cik}/${clean}/${String(docs[i] ?? "")}`,
    });
  }

  return { match, filings };
}

async function fetchMarketQuote(symbol: string | null) {
  if (!symbol || !PUBLISH_MARKET_QUOTES) return null;
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`,
    {
      headers: { "user-agent": "Mozilla/5.0 ShadowBrief/1.0" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) return null;
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((x: unknown): x is number => typeof x === "number");
  const current = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : closes.at(-1) ?? null;
  const prev = closes.length >= 2 ? closes.at(-2)! : null;
  const five = closes.length >= 5 ? closes.at(-5)! : closes[0] ?? null;
  const pct = (a: number | null, b: number | null) =>
    a !== null && b !== null && b !== 0 ? ((a / b) - 1) * 100 : null;
  return {
    symbol,
    price: current,
    currency: String(meta.currency ?? "USD"),
    change1dPct: pct(current, prev),
    change5dPct: pct(current, five),
    marketTime: meta.regularMarketTime ?? null,
  };
}

async function fetchQueryNews(query: string, limit: number) {
  if (!PUBLISH_NEWS_HEADLINES) return [];
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `"${query}" when:14d`);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const response = await fetch(url, {
    headers: { "user-agent": "ShadowBrief-News/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];

  const xml = await response.text();
  const decode = (value: string) =>
    value.replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  const clean = (value: string) => decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const readTag = (item: string, tag: string) => {
    const match = item.match(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match ? clean(match[1]) : "";
  };

  return (xml.match(/<item>[\s\S]*?<\/item>/g) ?? [])
    .slice(0, limit)
    .map((item) => ({
      title: readTag(item, "title"),
      url: readTag(item, "link"),
      source: readTag(item, "source") || "Google News",
      publishedAt: readTag(item, "pubDate"),
    }))
    .filter((item) => item.title && item.url);
}

function matchesQuery(value: unknown, query: string) {
  return scoreText(JSON.stringify(value ?? ""), query) >= 25;
}

function confidenceLabel(evidenceCount: number, officialCount: number) {
  if (officialCount >= 3 && evidenceCount >= 10) return "high";
  if (officialCount >= 1 && evidenceCount >= 5) return "medium";
  return "exploratory";
}

export async function buildShadowBrief(query: string, tier: ShadowBriefTier) {
  const depth = tier === "deep"
    ? { filings: 15, news: 20, tenders: 20, graph: 20, leads: 12, lags: 10 }
    : { filings: 5, news: 8, tenders: 8, graph: 8, leads: 5, lags: 5 };

  const sec = await fetchDynamicSec(query, depth.filings);
  const marketPromise = fetchMarketQuote(sec.match?.symbol ?? null);

  const [officialResult, newsResult, graphResult, leadsResult, lagResult, queryNewsResult, marketResult] =
    await Promise.allSettled([
      fetchGlobalOfficialSignals(),
      PUBLISH_NEWS_HEADLINES ? fetchGlobalNews() : Promise.resolve([]),
      buildRelationshipGraph(),
      buildCommercialLeads(),
      detectPriceLags(),
      fetchQueryNews(query, depth.news),
      marketPromise,
    ]);

  const official = officialResult.status === "fulfilled" ? officialResult.value : null;
  const globalNews = newsResult.status === "fulfilled" ? newsResult.value : [];
  const graph = graphResult.status === "fulfilled" ? graphResult.value : null;
  const leads = leadsResult.status === "fulfilled" ? leadsResult.value : null;
  const lag = lagResult.status === "fulfilled" ? lagResult.value : null;
  const queryNews = queryNewsResult.status === "fulfilled" ? queryNewsResult.value : [];
  const market = marketResult.status === "fulfilled" ? marketResult.value : null;

  const tenders = (official?.procurement ?? [])
    .filter((item) => matchesQuery(item, query))
    .slice(0, depth.tenders);

  const graphEdges = (graph?.edges ?? [])
    .filter((edge) => matchesQuery(edge, query) || (sec.match?.symbol && matchesQuery(edge, sec.match.symbol)))
    .slice(0, depth.graph);

  const commercialLeads = (leads?.leads ?? [])
    .filter((lead) => matchesQuery(lead, query) || (sec.match?.symbol && matchesQuery(lead, sec.match.symbol)))
    .slice(0, depth.leads);

  const lagSignals = (lag?.signals ?? [])
    .filter((item) => matchesQuery(item, query) || (sec.match?.symbol && matchesQuery(item, sec.match.symbol)))
    .slice(0, depth.lags);

  const fallbackNews = globalNews.filter((item) => matchesQuery(item, query)).slice(0, depth.news);
  const news = queryNews.length ? queryNews : fallbackNews;

  const officialEvidenceCount = sec.filings.length + tenders.length +
    graphEdges.filter((edge) => !edge.inferred).length;
  const totalEvidenceCount = officialEvidenceCount + news.length + graphEdges.length + commercialLeads.length + lagSignals.length;

  const secondOrder = graphEdges
    .filter((edge) => edge.inferred)
    .slice(0, tier === "deep" ? 10 : 4)
    .map((edge) => ({
      from: edge.source,
      relation: edge.relation,
      to: edge.target,
      confidence: edge.confidence,
      evidence: edge.evidence,
    }));

  const headline = sec.match
    ? `${sec.match.company} (${sec.match.symbol}) — evidence-ranked situation map`
    : `${query} — evidence-ranked situation map`;

  const summary = {
    headline,
    confidence: confidenceLabel(totalEvidenceCount, officialEvidenceCount),
    evidenceCount: totalEvidenceCount,
    officialEvidenceCount,
    keyFinding:
      lagSignals.length > 0
        ? "At least one statistically validated lead/lag relationship is connected to this query."
        : commercialLeads.length > 0
          ? "Current public procurement/commercial evidence creates at least one candidate second-order opportunity."
          : sec.filings.length > 0
            ? "Recent official company filings are the strongest directly verifiable evidence layer."
            : "Current evidence is primarily contextual; no strong query-specific official relationship was found.",
    invalidation:
      "Treat inferred links as hypotheses. Reassess if new official filings, procurement decisions, or market data contradict the current evidence map.",
  };

  return {
    product: "ShadowBrief",
    tier,
    query,
    generatedAt: new Date().toISOString(),
    resolvedEntity: sec.match,
    summary,
    market,
    officialFilings: sec.filings,
    procurement: tenders,
    news,
    relationships: graphEdges,
    secondOrderMap: secondOrder,
    commercialOpportunities: commercialLeads,
    validatedPriceLag: {
      method: lag?.method ?? null,
      validation: lag ? { sample: lag.sample, testsPerformed: lag.testsPerformed, trainSurvivors: lag.trainSurvivors, audit: lag.audit } : null,
      signals: lagSignals,
      note: lagSignals.length
        ? "Only relationships that survived FDR and out-of-sample validation are shown."
        : "No query-specific relationship survived FDR and out-of-sample validation.",
    },
    methodology: {
      evidencePolicy: "Official evidence is separated from inferred relationships. Inferred edges are labeled and never presented as contracts, ownership, or proven causality.",
      priceLagPolicy: "Price-lag relationships are published only after Benjamini-Hochberg FDR correction and walk-forward out-of-sample validation.",
    },
    disclaimer:
      "ShadowBrief is research intelligence based on public and official sources. It is not legal, investment, credit, or procurement advice and does not guarantee outcomes.",
  };
}

export async function createShadowBriefRequest(query: string, tier: ShadowBriefTier) {
  const id = crypto.randomUUID();
  const amountCents = shadowBriefPrices[tier];
  await sql`
    INSERT INTO shadowbrief_requests (id, query, tier, amount_cents, created_at)
    VALUES (${id}, ${query}, ${tier}, ${amountCents}, now())
  `.execute(db);
  return { id, query, tier, amountCents };
}

export async function attachShadowBriefCheckout(requestId: string, sessionId: string) {
  await sql`
    UPDATE shadowbrief_requests
    SET stripe_checkout_session_id = ${sessionId}
    WHERE id = ${requestId}
  `.execute(db);
}

export async function getShadowBriefRequestBySession(sessionId: string) {
  const result = await sql<{
    id: string;
    query: string;
    tier: ShadowBriefTier;
    amount_cents: number;
    paid_at: Date | null;
  }>`
    SELECT id, query, tier, amount_cents, paid_at
    FROM shadowbrief_requests
    WHERE stripe_checkout_session_id = ${sessionId}
    LIMIT 1
  `.execute(db);
  return result.rows[0] ?? null;
}

export async function markShadowBriefPaid(id: string) {
  await sql`
    UPDATE shadowbrief_requests
    SET paid_at = COALESCE(paid_at, now())
    WHERE id = ${id}
  `.execute(db);
}
