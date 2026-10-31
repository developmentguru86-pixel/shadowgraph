import superjson from "superjson";
import { sql } from "kysely";
import { db } from "./db";
import type { KapSignal } from "../endpoints/kap_GET.schema";
import type { TenderSignal } from "../endpoints/tenders_GET.schema";
import type { InfraNode } from "../endpoints/infra_GET.schema";
import { fetchGlobalOfficialSignals } from "./globalSources";
import { fetchGlobalNews } from "./globalNews";
import { PUBLISH_NEWS_HEADLINES } from "./licensing";
import { mppStore } from "./mppStore";
import { dependencyGraph } from "./dependencyGraph";

const GRAPH_CACHE_KEY = "cache:relationship-graph:v5";
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000;

export type GraphNode = {
  id: string;
  kind: "company" | "theme" | "event" | "infrastructure" | "macro";
  name: string;
  metadata: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  inferred: boolean;
  /** Share of the target's exposure carried by this edge (e.g. customer revenue share). Absent = unweighted. */
  weight?: number;
  evidence: Array<{ sourceType: string; title?: string; url?: string; note?: string }>;
};

const BASE = "https://shadowalpha.online";

const themes = [
  { id: "telecom", name: "Telecom & Fiber" },
  { id: "digital", name: "Digital Infrastructure & Cyber" },
  { id: "grid", name: "Energy & Grid" },
  { id: "banking", name: "Banking & Fintech" },
  { id: "logistics", name: "Logistics & Transport" },
] as const;

const companies = [
  { symbol: "TCELL", name: "Turkcell", themes: ["telecom", "digital"], capabilities: ["mobile", "fiber", "cloud", "data center"] },
  { symbol: "TTKOM", name: "Türk Telekom", themes: ["telecom", "digital"], capabilities: ["fixed network", "fiber", "cloud"] },
  { symbol: "KAREL", name: "Karel Elektronik", themes: ["telecom", "digital"], capabilities: ["network equipment", "communications systems"] },
  { symbol: "ASTOR", name: "Astor Enerji", themes: ["grid"], capabilities: ["transformers", "grid equipment"] },
  { symbol: "EUPWR", name: "Europower Enerji", themes: ["grid"], capabilities: ["switchgear", "grid equipment"] },
  { symbol: "KONTR", name: "Kontrolmatik", themes: ["grid", "digital"], capabilities: ["energy automation", "industrial digital infrastructure"] },
  { symbol: "MIATK", name: "Mia Teknoloji", themes: ["digital"], capabilities: ["software", "cyber", "digital infrastructure"] },
  { symbol: "LOGO", name: "Logo Yazılım", themes: ["digital"], capabilities: ["enterprise software"] },
  { symbol: "AKBNK", name: "Akbank", themes: ["banking"], capabilities: ["banking", "digital payments"] },
  { symbol: "GARAN", name: "Garanti BBVA", themes: ["banking"], capabilities: ["banking", "digital payments"] },
  { symbol: "THYAO", name: "Türk Hava Yolları", themes: ["logistics"], capabilities: ["air transport", "cargo"] },
  { symbol: "TAVHL", name: "TAV Havalimanları", themes: ["logistics"], capabilities: ["airport infrastructure"] },
] as const;

const globalCompanies = [
  { symbol: "NVDA", name: "NVIDIA", region: "US", themes: ["digital"], capabilities: ["AI accelerators", "data-center compute", "semiconductors"] },
  { symbol: "MSFT", name: "Microsoft", region: "US", themes: ["digital"], capabilities: ["cloud", "AI software", "enterprise software"] },
  { symbol: "AMZN", name: "Amazon", region: "US", themes: ["digital", "logistics"], capabilities: ["cloud", "data centers", "logistics"] },
  { symbol: "GOOGL", name: "Alphabet", region: "US", themes: ["digital"], capabilities: ["cloud", "AI", "digital infrastructure"] },
  { symbol: "META", name: "Meta Platforms", region: "US", themes: ["digital"], capabilities: ["AI infrastructure", "data centers", "networking"] },
  { symbol: "JPM", name: "JPMorgan Chase", region: "US", themes: ["banking"], capabilities: ["banking", "payments"] },
  { symbol: "XOM", name: "Exxon Mobil", region: "US", themes: ["grid"], capabilities: ["energy", "industrial infrastructure"] },
  { symbol: "GEV", name: "GE Vernova", region: "US", themes: ["grid"], capabilities: ["power generation", "grid equipment", "electrification"] },
  { symbol: "CSCO", name: "Cisco", region: "US", themes: ["telecom", "digital"], capabilities: ["networking", "security", "data-center infrastructure"] },
  { symbol: "UPS", name: "UPS", region: "US", themes: ["logistics"], capabilities: ["parcel logistics", "freight"] },
  { symbol: "FDX", name: "FedEx", region: "US", themes: ["logistics"], capabilities: ["air cargo", "parcel logistics"] },
] as const;

function normalizeGlobalTheme(value: string) {
  if (value === "ai-digital") return "digital";
  if (value === "energy-grid") return "grid";
  if (value === "finance") return "banking";
  if (["telecom", "digital", "grid", "banking", "logistics"].includes(value)) return value;
  return null;
}

const macroNodes = [
  { id: "macro:dxy", name: "US Dollar Liquidity", themes: ["banking", "digital", "logistics"] },
  { id: "macro:rates", name: "Global Rates / Discount Rate", themes: ["banking", "grid", "digital"] },
  { id: "macro:energy", name: "Energy / Inflation Impulse", themes: ["grid", "logistics"] },
  { id: "macro:risk", name: "Global Risk Appetite", themes: ["banking", "digital", "logistics"] },
] as const;

async function publicData<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": "ShadowGraph-Graph/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return superjson.parse<T>(await response.text());
}

function themeForTender(value: string) {
  const text = value.toLocaleLowerCase("tr-TR");
  if (text.includes("telekom") || text.includes("fiber")) return "telecom";
  if (text.includes("data center") || text.includes("it") || text.includes("yazılım")) return "digital";
  if (text.includes("energy") || text.includes("enerji") || text.includes("grid")) return "grid";
  if (text.includes("logistics") || text.includes("lojistik")) return "logistics";
  return null;
}

function themeFromText(value: string) {
  const text = value.toLocaleLowerCase("tr-TR");
  if (/(telekom|fiber|5g|haberleşme|network|şebeke kapasitesi)/.test(text)) return "telecom";
  if (/(veri merkezi|data center|yazılım|siber|bulut|dijital|sunucu|ai)/.test(text)) return "digital";
  if (/(enerji|elektrik|trafo|şebeke|güneş|ges|batarya)/.test(text)) return "grid";
  if (/(banka|finans|ödeme|kredi|fintech)/.test(text)) return "banking";
  if (/(lojistik|kargo|liman|havaalanı|demiryolu|ulaşım)/.test(text)) return "logistics";
  return null;
}

function edgeId(source: string, relation: string, target: string) {
  return `${source}|${relation}|${target}`;
}

async function persist(nodes: GraphNode[], edges: GraphEdge[]) {
  if (nodes.length) {
    const values = nodes.map((node) => sql`(
      ${node.id},
      ${node.kind},
      ${node.name},
      ${node.metadata as any}::jsonb,
      now(),
      now()
    )`);
    await sql`
      INSERT INTO relationship_nodes (node_id, kind, name, metadata, first_seen, updated_at)
      VALUES ${sql.join(values)}
      ON CONFLICT (node_id) DO UPDATE SET
        kind = EXCLUDED.kind,
        name = EXCLUDED.name,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `.execute(db);
  }

  if (edges.length) {
    const values = edges.map((edge) => sql`(
      ${edge.id},
      ${edge.source},
      ${edge.target},
      ${edge.relation},
      ${edge.confidence},
      ${edge.inferred},
      ${edge.evidence as any}::jsonb,
      now(),
      now()
    )`);
    await sql`
      INSERT INTO relationship_edges
        (edge_id, source_id, target_id, relation, confidence, inferred, evidence, first_seen, last_seen)
      VALUES ${sql.join(values)}
      ON CONFLICT (edge_id) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        inferred = EXCLUDED.inferred,
        evidence = EXCLUDED.evidence,
        last_seen = now()
    `.execute(db);
  }
}

export async function buildRelationshipGraph() {
  const cached = await mppStore.get(GRAPH_CACHE_KEY).catch(() => null) as {
    generatedAt?: string;
    methodology?: string;
    disclaimer?: string;
    stats?: { nodes: number; edges: number; officialEdges: number; inferredEdges: number };
    nodes?: GraphNode[];
    edges?: GraphEdge[];
  } | null;
  const cachedAt = cached?.generatedAt ? Date.parse(cached.generatedAt) : NaN;
  if (
    cached &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < GRAPH_CACHE_TTL_MS &&
    cached.stats &&
    Array.isArray(cached.nodes) &&
    Array.isArray(cached.edges)
  ) {
    return {
      generatedAt: cached.generatedAt!,
      methodology: cached.methodology ?? "Evidence-backed multi-layer graph.",
      disclaimer: cached.disclaimer ?? "Inferred edges are hypotheses, not proven causality.",
      stats: cached.stats,
      nodes: cached.nodes,
      edges: cached.edges,
    };
  }
  const [kapResult, tenderResult, infraResult, globalResult, globalNewsResult] = await Promise.allSettled([
    publicData<{ signals: KapSignal[] }>("/_api/kap"),
    publicData<{ tenders: TenderSignal[] }>("/_api/tenders"),
    publicData<{ facilities: InfraNode[]; exchanges: InfraNode[] }>("/_api/infra"),
    fetchGlobalOfficialSignals(),
    fetchGlobalNews(),
  ]);

  const kap = kapResult.status === "fulfilled" ? kapResult.value.signals : [];
  const tenders = tenderResult.status === "fulfilled" ? tenderResult.value.tenders : [];
  const infra = infraResult.status === "fulfilled"
    ? [...infraResult.value.exchanges.slice(0, 12), ...infraResult.value.facilities.slice(0, 28)]
    : [];
  const globalSignals = globalResult.status === "fulfilled"
    ? globalResult.value
    : { disclosures: [], procurement: [] };
  const globalNews = globalNewsResult.status === "fulfilled" ? globalNewsResult.value : [];

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const theme of themes) {
    nodes.push({ id: `theme:${theme.id}`, kind: "theme", name: theme.name, metadata: {} });
  }

  for (const company of companies) {
    const id = `company:${company.symbol}`;
    nodes.push({
      id,
      kind: "company",
      name: company.name,
      metadata: { symbol: company.symbol, capabilities: company.capabilities },
    });
    for (const theme of company.themes) {
      edges.push({
        id: edgeId(id, "operates_in", `theme:${theme}`),
        source: id,
        target: `theme:${theme}`,
        relation: "operates_in",
        confidence: 0.96,
        inferred: true,
        evidence: [{ sourceType: "curated-profile", note: "Editorial sector mapping; verify company disclosures before treating as exposure." }],
      });
    }
  }

  for (const company of globalCompanies) {
    const id = `company:${company.symbol}`;
    nodes.push({
      id,
      kind: "company",
      name: company.name,
      metadata: { symbol: company.symbol, region: company.region, capabilities: company.capabilities },
    });
    for (const theme of company.themes) {
      edges.push({
        id: edgeId(id, "operates_in", `theme:${theme}`),
        source: id,
        target: `theme:${theme}`,
        relation: "operates_in",
        confidence: 0.96,
        inferred: true,
        evidence: [{ sourceType: "curated-profile", note: "Editorial sector mapping; verify company disclosures before treating as exposure." }],
      });
    }
  }

  for (const factor of macroNodes) {
    const id = factor.id;
    nodes.push({ id, kind: "macro", name: factor.name, metadata: {} });
    for (const theme of factor.themes) {
      edges.push({
        id: edgeId(id, "macro_exposure", `theme:${theme}`),
        source: id,
        target: `theme:${theme}`,
        relation: "macro_exposure",
        confidence: 0.72,
        inferred: true,
        evidence: [{ sourceType: "economic-model", note: "Transmission-channel hypothesis; not proof of direct causality." }],
      });
    }
  }

  for (const signal of kap.slice(0, 36)) {
    const eventId = `kap:${signal.id}`;
    const companyId = `company:${signal.symbol}`;
    nodes.push({
      id: eventId,
      kind: "event",
      name: signal.title,
      metadata: { source: "KAP", publishedAt: signal.publishedAt, category: signal.category, url: signal.url },
    });
    edges.push({
      id: edgeId(eventId, "official_disclosure_by", companyId),
      source: eventId,
      target: companyId,
      relation: "official_disclosure_by",
      confidence: 1,
      inferred: false,
      evidence: [{ sourceType: "KAP", title: signal.title, url: signal.url }],
    });

    const theme = themeFromText(signal.title);
    if (theme) {
      edges.push({
        id: edgeId(companyId, "current_signal_in", `theme:${theme}`),
        source: companyId,
        target: `theme:${theme}`,
        relation: "current_signal_in",
        confidence: Math.max(0.5, Math.min(0.95, signal.score / 100)),
        inferred: true,
        evidence: [{ sourceType: "KAP", title: signal.title, url: signal.url }],
      });
    }
  }

  for (const tender of tenders.slice(0, 30)) {
    const eventId = `tender:${tender.id}`;
    const theme = themeForTender(tender.theme) ?? themeFromText(tender.title);
    nodes.push({
      id: eventId,
      kind: "event",
      name: tender.title,
      metadata: { source: tender.source, publishedAt: tender.publishedAt, url: tender.url, classifiedTheme: tender.theme },
    });
    if (!theme) continue;
    edges.push({
      id: edgeId(eventId, "procurement_signal_in", `theme:${theme}`),
      source: eventId,
      target: `theme:${theme}`,
      relation: "procurement_signal_in",
      confidence: Math.max(0.5, Math.min(0.96, tender.score / 100)),
      inferred: true,
      evidence: [{ sourceType: "public-procurement", title: tender.title, url: tender.url }],
    });
    for (const company of companies.filter((item) => item.themes.includes(theme as never)).slice(0, 4)) {
      edges.push({
        id: edgeId(eventId, "candidate_supplier", `company:${company.symbol}`),
        source: eventId,
        target: `company:${company.symbol}`,
        relation: "candidate_supplier",
        confidence: Math.max(0.42, Math.min(0.82, tender.score / 125)),
        inferred: true,
        evidence: [{
          sourceType: "capability-match",
          title: tender.title,
          url: tender.url,
          note: `Matched to capabilities: ${company.capabilities.join(", ")}. Candidate only; no claim that the company is bidding.`,
        }],
      });
    }
  }

  for (const disclosure of globalSignals.disclosures.slice(0, 60)) {
    const eventId = disclosure.id;
    const companyId = `company:${disclosure.symbol}`;
    nodes.push({
      id: eventId,
      kind: "event",
      name: `${disclosure.company} · ${disclosure.form}`,
      metadata: {
        region: disclosure.region,
        source: disclosure.source,
        filedAt: disclosure.filedAt,
        form: disclosure.form,
        url: disclosure.url,
      },
    });
    edges.push({
      id: edgeId(eventId, "official_disclosure_by", companyId),
      source: eventId,
      target: companyId,
      relation: "official_disclosure_by",
      confidence: 1,
      inferred: false,
      evidence: [{ sourceType: "SEC EDGAR", title: disclosure.title, url: disclosure.url }],
    });
    const theme = normalizeGlobalTheme(disclosure.theme);
    if (theme) {
      edges.push({
        id: edgeId(companyId, "current_signal_in", `theme:${theme}`),
        source: companyId,
        target: `theme:${theme}`,
        relation: "current_signal_in",
        confidence: Math.max(0.55, Math.min(0.95, disclosure.score / 100)),
        inferred: true,
        evidence: [{ sourceType: "SEC EDGAR", title: disclosure.title, url: disclosure.url }],
      });
    }
  }

  for (const notice of globalSignals.procurement.slice(0, 80)) {
    const eventId = notice.id;
    const theme = normalizeGlobalTheme(notice.theme);
    nodes.push({
      id: eventId,
      kind: "event",
      name: notice.title,
      metadata: {
        region: notice.region,
        source: notice.source,
        buyer: notice.buyer,
        buyerCountry: notice.buyerCountry,
        publishedAt: notice.publishedAt,
        cpv: notice.cpv,
        url: notice.url,
      },
    });
    if (!theme) continue;
    edges.push({
      id: edgeId(eventId, "procurement_signal_in", `theme:${theme}`),
      source: eventId,
      target: `theme:${theme}`,
      relation: "procurement_signal_in",
      confidence: Math.max(0.58, Math.min(0.97, notice.score / 100)),
      inferred: true,
      evidence: [{ sourceType: "TED", title: notice.title, url: notice.url, note: "Official notice; theme classification is inferred." }],
    });
    for (const company of globalCompanies.filter((item) => item.themes.includes(theme as never)).slice(0, 5)) {
      edges.push({
        id: edgeId(eventId, "candidate_supplier", `company:${company.symbol}`),
        source: eventId,
        target: `company:${company.symbol}`,
        relation: "candidate_supplier",
        confidence: Math.max(0.45, Math.min(0.86, notice.score / 115)),
        inferred: true,
        evidence: [{
          sourceType: "TED+capability-match",
          title: notice.title,
          url: notice.url,
          note: `Buyer: ${notice.buyer || "EU contracting authority"} (${notice.buyerCountry || "EU"}). Candidate only; no claim of bidding or award.`,
        }],
      });
    }
  }

  for (const news of (PUBLISH_NEWS_HEADLINES ? globalNews : []).slice(0, 60)) {
    if (news.theme === "general") continue;
    const eventId = news.id;
    nodes.push({
      id: eventId,
      kind: "event",
      name: news.title,
      metadata: {
        region: "GLOBAL",
        source: news.source,
        publishedAt: news.publishedAt,
        url: news.url,
      },
    });
    edges.push({
      id: edgeId(eventId, "news_signal_in", `theme:${news.theme}`),
      source: eventId,
      target: `theme:${news.theme}`,
      relation: "news_signal_in",
      confidence: Math.max(0.45, Math.min(0.82, news.score / 110)),
      inferred: true,
      evidence: [{
        sourceType: "global-news",
        title: news.title,
        url: news.url,
        note: "News signal only; must be confirmed with official or market evidence before stronger inference.",
      }],
    });
  }

  for (const item of infra) {
    const id = `infra:${item.id}`;
    nodes.push({
      id,
      kind: "infrastructure",
      name: item.name,
      metadata: { type: item.type, city: item.city, website: item.website ?? null },
    });
    edges.push({
      id: edgeId(id, "supports", "theme:digital"),
      source: id,
      target: "theme:digital",
      relation: "supports",
      confidence: 0.9,
      inferred: true,
      evidence: [{ sourceType: "PeeringDB", note: `${item.type} listed in ${item.city || "Türkiye"}; sector support inferred, no specific customer dependency verified.` }],
    });
    edges.push({
      id: edgeId(id, "supports", "theme:telecom"),
      source: id,
      target: "theme:telecom",
      relation: "supports",
      confidence: 0.84,
      inferred: true,
      evidence: [{ sourceType: "PeeringDB", note: "Connectivity infrastructure exposure, not a contractual dependency claim." }],
    });
  }

  const dependency = await dependencyGraph().catch(() => ({ nodes: [] as GraphNode[], edges: [] as GraphEdge[] }));
  const existingIds = new Set(nodes.map((node) => node.id));
  for (const node of dependency.nodes) {
    if (!existingIds.has(node.id)) { nodes.push(node); existingIds.add(node.id); }
  }
  edges.push(...dependency.edges);

  const knownIds = new Set(nodes.map(node => node.id));
  for (const edge of edges) for (const id of [edge.source, edge.target]) {
    if (!knownIds.has(id)) {
      knownIds.add(id);
      nodes.push({ id, kind: id.startsWith("company:") ? "company" : "theme", name: id.split(":").slice(1).join(":"), metadata: { unresolved: true } });
    }
  }
  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const uniqueEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()]
    .sort((a, b) => b.confidence - a.confidence);

  await persist(uniqueNodes, uniqueEdges).catch(() => undefined);

  const output = {
    generatedAt: new Date().toISOString(),
    methodology: "Evidence-backed multi-layer graph: official disclosures, procurement signals, PeeringDB infrastructure, curated sector capabilities and explicitly labeled inferred transmission edges.",
    disclaimer: "Inferred edges are hypotheses/candidate exposures, not claims of ownership, contracts, bidding activity or proven causality.",
    stats: {
      nodes: uniqueNodes.length,
      edges: uniqueEdges.length,
      officialEdges: uniqueEdges.filter((edge) => !edge.inferred).length,
      inferredEdges: uniqueEdges.filter((edge) => edge.inferred).length,
    },
    nodes: uniqueNodes,
    edges: uniqueEdges,
  };
  await mppStore.put(GRAPH_CACHE_KEY, output).catch(() => undefined);
  return output;
}
