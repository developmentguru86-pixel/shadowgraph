import superjson from "superjson";
import { sql } from "kysely";
import { db } from "./db";
import type { KapSignal } from "../endpoints/kap_GET.schema";
import type { TenderSignal } from "../endpoints/tenders_GET.schema";
import { fetchGlobalOfficialSignals } from "./globalSources";
import { mppStore } from "./mppStore";

const LEAD_CACHE_KEY = "cache:commercial-leads:v2";
const LEAD_CACHE_TTL_MS = 5 * 60 * 1000;

export type CommercialLead = {
  leadId: string;
  sourceType: "tender" | "kap" | "ted";
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  publishedAt: string;
  targetSymbol: string | null;
  targetName: string;
  theme: string;
  score: number;
  confidence: number;
  rationale: string;
  nextAction: string;
  evidence: Array<{ type: string; detail: string; url?: string }>;
};

const BASE = "https://shadowalpha.online";

const suppliers = [
  { symbol: "TCELL", name: "Turkcell", themes: ["telecom", "digital"], capabilities: ["fiber", "cloud", "data center", "connectivity"], fit: 0.88 },
  { symbol: "TTKOM", name: "Türk Telekom", themes: ["telecom", "digital"], capabilities: ["fiber", "fixed network", "cloud", "connectivity"], fit: 0.9 },
  { symbol: "KAREL", name: "Karel Elektronik", themes: ["telecom", "digital"], capabilities: ["communications systems", "network equipment"], fit: 0.86 },
  { symbol: "MIATK", name: "Mia Teknoloji", themes: ["digital"], capabilities: ["software", "cybersecurity", "digital infrastructure"], fit: 0.84 },
  { symbol: "LOGO", name: "Logo Yazılım", themes: ["digital"], capabilities: ["enterprise software", "digital transformation"], fit: 0.78 },
  { symbol: "ASTOR", name: "Astor Enerji", themes: ["grid"], capabilities: ["transformers", "grid equipment"], fit: 0.93 },
  { symbol: "EUPWR", name: "Europower Enerji", themes: ["grid"], capabilities: ["switchgear", "grid equipment", "electrical systems"], fit: 0.9 },
  { symbol: "KONTR", name: "Kontrolmatik", themes: ["grid", "digital"], capabilities: ["energy automation", "industrial systems", "digital infrastructure"], fit: 0.87 },
  { symbol: "THYAO", name: "Türk Hava Yolları", themes: ["logistics"], capabilities: ["air cargo", "transport"], fit: 0.72 },
  { symbol: "TAVHL", name: "TAV Havalimanları", themes: ["logistics"], capabilities: ["airport infrastructure", "transport operations"], fit: 0.76 },
] as const;

const globalSuppliers = [
  { symbol: "NVDA", name: "NVIDIA", themes: ["digital"], capabilities: ["AI accelerators", "data-center compute"], fit: 0.92 },
  { symbol: "MSFT", name: "Microsoft", themes: ["digital"], capabilities: ["cloud", "AI platform", "enterprise software"], fit: 0.91 },
  { symbol: "AMZN", name: "Amazon", themes: ["digital", "logistics"], capabilities: ["AWS cloud", "data centers", "logistics"], fit: 0.88 },
  { symbol: "CSCO", name: "Cisco", themes: ["telecom", "digital"], capabilities: ["networking", "cybersecurity", "data-center infrastructure"], fit: 0.93 },
  { symbol: "GEV", name: "GE Vernova", themes: ["grid"], capabilities: ["grid equipment", "power generation", "electrification"], fit: 0.94 },
  { symbol: "XOM", name: "Exxon Mobil", themes: ["grid"], capabilities: ["energy", "industrial infrastructure"], fit: 0.72 },
  { symbol: "UPS", name: "UPS", themes: ["logistics"], capabilities: ["parcel logistics", "freight"], fit: 0.89 },
  { symbol: "FDX", name: "FedEx", themes: ["logistics"], capabilities: ["air cargo", "parcel logistics"], fit: 0.87 },
  { symbol: "JPM", name: "JPMorgan Chase", themes: ["banking"], capabilities: ["banking", "payments"], fit: 0.82 },
] as const;

function globalTheme(value: string) {
  if (value === "ai-digital") return "digital";
  if (value === "energy-grid") return "grid";
  if (value === "finance") return "banking";
  if (["telecom", "digital", "grid", "banking", "logistics"].includes(value)) return value;
  return null;
}

async function publicData<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": "ShadowGraph-Lead/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return superjson.parse<T>(await response.text());
}

function parsePublishedAt(value: string) {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const tr = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!tr) return NaN;
  return Date.UTC(Number(tr[3]), Number(tr[2]) - 1, Number(tr[1]), Number(tr[4]), Number(tr[5]), Number(tr[6] ?? 0));
}

function freshness(value: string) {
  const ts = parsePublishedAt(value);
  if (!Number.isFinite(ts)) return 0.45;
  const hours = Math.max(0, (Date.now() - ts) / 3_600_000);
  if (hours <= 24) return 1;
  if (hours <= 72) return 0.88;
  if (hours <= 168) return 0.72;
  if (hours <= 336) return 0.55;
  return 0.35;
}

function inferTheme(textValue: string) {
  const text = textValue.toLocaleLowerCase("tr-TR");
  if (/(telekom|fiber|haberleşme|5g|network|internet|genişbant)/.test(text)) return "telecom";
  if (/(veri merkezi|data center|yazılım|siber|bulut|dijital|sunucu|lisans|bilgi işlem|ai)/.test(text)) return "digital";
  if (/(enerji|elektrik|trafo|şebeke|güneş|ges|batarya|otomasyon)/.test(text)) return "grid";
  if (/(lojistik|taşıma|kargo|liman|havaalanı|demiryolu|ulaşım)/.test(text)) return "logistics";
  return null;
}

function tenderTheme(tender: TenderSignal) {
  return inferTheme(`${tender.theme} ${tender.title}`);
}

function makeId(sourceType: string, sourceId: string, symbol: string) {
  return `${sourceType}:${sourceId}:${symbol}`;
}

function score(base: number, supplierFit: number, freshnessScore: number, officialQuality: number) {
  return Math.round(Math.min(100,
    base * 0.48 +
    supplierFit * 100 * 0.22 +
    freshnessScore * 100 * 0.18 +
    officialQuality * 100 * 0.12
  ) * 10) / 10;
}

async function persist(leads: CommercialLead[]) {
  if (!leads.length) return;
  const values = leads.slice(0, 80).map((lead) => sql`(
    ${lead.leadId},
    ${lead.sourceType},
    ${lead.sourceId},
    ${lead.targetSymbol},
    ${lead.targetName},
    ${lead.theme},
    ${lead.score},
    'candidate',
    ${lead.rationale},
    ${lead.nextAction},
    ${lead.sourceUrl},
    ${lead.evidence as any}::jsonb,
    now(),
    now()
  )`);
  await sql`
    INSERT INTO lead_signals
      (lead_id, source_type, source_id, target_symbol, target_name, theme, score, status, rationale, next_action, source_url, evidence, first_seen, last_seen)
    VALUES ${sql.join(values)}
    ON CONFLICT (lead_id) DO UPDATE SET
      score = EXCLUDED.score,
      rationale = EXCLUDED.rationale,
      next_action = EXCLUDED.next_action,
      evidence = EXCLUDED.evidence,
      last_seen = now()
  `.execute(db);
}

export async function buildCommercialLeads() {
  const cached = await mppStore.get(LEAD_CACHE_KEY).catch(() => null) as {
    generatedAt?: string;
    methodology?: string;
    disclaimer?: string;
    leads?: CommercialLead[];
  } | null;
  const cachedAt = cached?.generatedAt ? Date.parse(cached.generatedAt) : NaN;
  if (
    cached &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt < LEAD_CACHE_TTL_MS &&
    Array.isArray(cached.leads)
  ) {
    return {
      generatedAt: cached.generatedAt!,
      methodology: cached.methodology ?? "Evidence-ranked commercial opportunity matching.",
      disclaimer: cached.disclaimer ?? "Candidate opportunity only.",
      leads: cached.leads,
    };
  }
  const [kapResult, tenderResult, globalResult] = await Promise.allSettled([
    publicData<{ signals: KapSignal[] }>("/_api/kap"),
    publicData<{ tenders: TenderSignal[] }>("/_api/tenders"),
    fetchGlobalOfficialSignals(),
  ]);
  const kap = kapResult.status === "fulfilled" ? kapResult.value.signals : [];
  const tenders = tenderResult.status === "fulfilled" ? tenderResult.value.tenders : [];
  const globalSignals = globalResult.status === "fulfilled"
    ? globalResult.value
    : { disclosures: [], procurement: [] };
  const leads: CommercialLead[] = [];

  for (const tender of tenders.slice(0, 50)) {
    const theme = tenderTheme(tender);
    if (!theme) continue;
    const candidates = suppliers
      .filter((supplier) => supplier.themes.includes(theme as never))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 4);
    for (const supplier of candidates) {
      const fresh = freshness(tender.publishedAt);
      const leadScore = score(tender.score, supplier.fit, fresh, 0.78);
      leads.push({
        leadId: makeId("tender", tender.id, supplier.symbol),
        sourceType: "tender",
        sourceId: tender.id,
        sourceTitle: tender.title,
        sourceUrl: tender.url,
        publishedAt: tender.publishedAt,
        targetSymbol: supplier.symbol,
        targetName: supplier.name,
        theme,
        score: leadScore,
        confidence: Math.round(Math.min(95, 45 + supplier.fit * 28 + fresh * 12 + tender.score * 0.1)),
        rationale: `Public procurement signal matches ${supplier.name}'s mapped capabilities (${supplier.capabilities.join(", ")}). This is a candidate supplier opportunity, not evidence that the company is bidding or will win.`,
        nextAction: `Verify the notice in EKAP, identify buyer/lot/technical specifications, then compare them with ${supplier.name}'s current product/service scope before outreach or investment conclusions.`,
        evidence: [
          { type: "public-procurement", detail: `${tender.theme} · source score ${tender.score}`, url: tender.url },
          { type: "capability-match", detail: supplier.capabilities.join(", ") },
        ],
      });
    }
  }

  for (const signal of kap.slice(0, 60)) {
    if (signal.category !== "capex" && signal.category !== "contract") continue;
    const theme = inferTheme(signal.title);
    if (!theme) continue;
    const candidates = suppliers
      .filter((supplier) => supplier.symbol !== signal.symbol && supplier.themes.includes(theme as never))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 3);
    for (const supplier of candidates) {
      const fresh = freshness(signal.publishedAt);
      const leadScore = score(signal.score, supplier.fit, fresh, 1);
      leads.push({
        leadId: makeId("kap", signal.id, supplier.symbol),
        sourceType: "kap",
        sourceId: signal.id,
        sourceTitle: signal.title,
        sourceUrl: signal.url,
        publishedAt: signal.publishedAt,
        targetSymbol: supplier.symbol,
        targetName: supplier.name,
        theme,
        score: leadScore,
        confidence: Math.round(Math.min(96, 52 + supplier.fit * 25 + fresh * 10 + signal.score * 0.1)),
        rationale: `Official KAP ${signal.category} disclosure from ${signal.company} indicates activity in the ${theme} chain. ${supplier.name} is mapped as a possible downstream capability match; no contractual relationship is asserted.`,
        nextAction: `Read the full KAP disclosure, identify scope/vendor requirements and timing, then validate whether ${supplier.name}'s disclosed business lines actually match the requirement.`,
        evidence: [
          { type: "KAP-official", detail: `${signal.symbol} · ${signal.category} · source score ${signal.score}`, url: signal.url },
          { type: "capability-match", detail: supplier.capabilities.join(", ") },
        ],
      });
    }
  }

  for (const notice of globalSignals.procurement.slice(0, 100)) {
    const theme = globalTheme(notice.theme);
    if (!theme) continue;
    const candidates = globalSuppliers
      .filter((supplier) => supplier.themes.includes(theme as never))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, 5);
    for (const supplier of candidates) {
      const fresh = freshness(notice.publishedAt);
      const leadScore = score(notice.score, supplier.fit, fresh, 1);
      leads.push({
        leadId: makeId("ted", notice.id, supplier.symbol),
        sourceType: "ted",
        sourceId: notice.id,
        sourceTitle: notice.title,
        sourceUrl: notice.url,
        publishedAt: notice.publishedAt,
        targetSymbol: supplier.symbol,
        targetName: supplier.name,
        theme,
        score: leadScore,
        confidence: Math.round(Math.min(97, 55 + supplier.fit * 24 + fresh * 10 + notice.score * 0.08)),
        rationale: `Official EU TED procurement from ${notice.buyer || "a contracting authority"} (${notice.buyerCountry || "EU"}) matches ${supplier.name}'s mapped capabilities (${supplier.capabilities.join(", ")}). Candidate only; no bidding or award claim.`,
        nextAction: `Open the TED notice, inspect CPV/lot/specification/deadline, then verify whether ${supplier.name}'s current commercial offering and geographic eligibility match before outreach or investment conclusions.`,
        evidence: [
          { type: "TED-official", detail: `${notice.buyerCountry || "EU"} · CPV ${notice.cpv.slice(0, 4).join(", ")} · source score ${notice.score}`, url: notice.url },
          { type: "capability-match", detail: supplier.capabilities.join(", ") },
        ],
      });
    }
  }

  const deduped = [...new Map(leads.map((lead) => [lead.leadId, lead])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);

  await persist(deduped).catch(() => undefined);

  const output = {
    generatedAt: new Date().toISOString(),
    methodology: "Official KAP + public-procurement signals are matched to a curated supplier capability map; scores combine source strength, capability fit, freshness and source quality.",
    disclaimer: "These are candidate commercial opportunities. They do not prove bidding activity, contracts, customer intent or future revenue.",
    leads: deduped,
  };
  await mppStore.put(LEAD_CACHE_KEY, output).catch(() => undefined);
  return output;
}
