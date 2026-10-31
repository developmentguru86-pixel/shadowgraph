import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useQuery } from "@tanstack/react-query";
import { PUBLISH_MARKET_QUOTES } from "../helpers/licensing";
import {
  Activity,
  Bot,
  Building2,
  CircleDollarSign,
  Database,
  ExternalLink,
  Globe2,
  Layers3,
  Network,
  RefreshCw,
  RadioTower,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "../components/Button";
import { DependencyMap } from "../components/DependencyMap";
import { IntelligenceSignals } from "../components/IntelligenceSignals";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { Badge } from "../components/Badge";
import { getNews, type NewsEvent } from "../endpoints/news_GET.schema";
import { getInfra, type InfraNode } from "../endpoints/infra_GET.schema";
import { getMarkets, type MarketQuote } from "../endpoints/markets_GET.schema";
import { getKap, type KapSignal } from "../endpoints/kap_GET.schema";
import { getTenders, type TenderSignal } from "../endpoints/tenders_GET.schema";
import { getMacro, type HiddenChain, type MacroNode } from "../endpoints/macro_GET.schema";
import { getAlpha, type AlphaSetup } from "../endpoints/alpha_GET.schema";
import { getGraph, type GraphEdge } from "../endpoints/graph_GET.schema";
import { getPriceLag, type PriceLagRelationship } from "../endpoints/price_lag_GET.schema";
import { getLeads, type CommercialLead } from "../endpoints/leads_GET.schema";
import { getGlobalOfficial } from "../endpoints/global_official_GET.schema";
import { getGlobalMarkets, type GlobalMarketQuote } from "../endpoints/global_markets_GET.schema";
import { getHomepageBootstrap } from "../endpoints/homepage_bootstrap_GET.schema";
import { paperTrading, type PaperTrade as LedgerTrade } from "../helpers/paperTrading";
import styles from "./terminal.module.css";
import { AppMenu } from "../components/AppMenu";
import { getEventExecution } from "../endpoints/event_execution_GET.schema";
import { EventResearch } from "../components/EventResearch";

type Theme = {
  id: string;
  name: string;
  keywords: string[];
  symbols: string[];
  angle: string;
  validation: string;
};

type Opportunity = {
  event: NewsEvent;
  theme: Theme;
  score: number;
  relevance: number;
  freshness: number;
  marketConfirmation: number;
  officialConfirmation: number;
  quotes: MarketQuote[];
  kapSignals: KapSignal[];
  tenderSignals: TenderSignal[];
};

type PaperTrade = LedgerTrade;

const themes: Theme[] = [
  {
    id: "telecom",
    name: "Telekom & Fiber",
    keywords: ["telecom", "telekom", "fiber", "fibre", "5g", "network", "broadband", "internet", "data center", "datacenter"],
    symbols: ["TCELL", "TTKOM", "KAREL"],
    angle: "Fiber, şebeke kapasitesi, edge/data-center ve telekom ekipmanı talebi.",
    validation: "Operatör/KAP açıklaması + yatırım/kontrat teyidi + sektörde hacim artışı.",
  },
  {
    id: "grid",
    name: "Enerji & Şebeke",
    keywords: ["energy", "enerji", "electric", "electricity", "grid", "power", "transformer", "renewable", "solar", "battery"],
    symbols: ["ASTOR", "EUPWR", "KONTR"],
    angle: "Trafo, elektrik ekipmanı, şebeke modernizasyonu ve enerji teknoloji harcaması.",
    validation: "İhale/kapasite yatırımı + şirket açıklaması + aynı temadaki en az iki hissede teyit.",
  },
  {
    id: "digital",
    name: "Dijital Altyapı & Cyber",
    keywords: ["cyber", "hack", "breach", "cloud", "software", "digital", "ai", "data", "security", "payment"],
    symbols: ["MIATK", "LOGO", "TCELL"],
    angle: "Siber güvenlik, kurumsal yazılım, veri altyapısı ve dijital dönüşüm bütçeleri.",
    validation: "Resmî olay/kontrat teyidi + bütçe/harcama sinyali + artan işlem hacmi.",
  },
  {
    id: "banking",
    name: "Bankacılık & Fintech",
    keywords: ["bank", "banking", "fintech", "payment", "payments", "credit", "loan", "fund", "finance", "financial"],
    symbols: ["AKBNK", "GARAN"],
    angle: "Ödeme altyapısı, kredi büyümesi, dijital bankacılık ve finansal regülasyon etkisi.",
    validation: "TCMB/BDDK/KAP teyidi + sektör çapında fiyat/hacim reaksiyonu.",
  },
  {
    id: "logistics",
    name: "Lojistik & Ulaşım",
    keywords: ["logistics", "corridor", "transport", "airport", "airline", "cargo", "port", "shipping", "rail", "route"],
    symbols: ["THYAO", "TAVHL"],
    angle: "Yolcu/kargo akışı, havalimanı kapasitesi ve bölgesel koridor hareketliliği.",
    validation: "Trafik/kapasite/rota teyidi + şirket açıklaması + fiyat/hacim teyidi.",
  },
];

const normalize = (value: string) => value.toLocaleLowerCase("tr-TR");

function ageHours(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 999;
  return Math.max(0, (Date.now() - time) / 3_600_000);
}

function scoreMarket(quotes: MarketQuote[]) {
  let score = 0;
  for (const quote of quotes) {
    const c1 = quote.change1dPct ?? 0;
    const c5 = quote.change5dPct ?? 0;
    const vr = quote.volumeRatio ?? 0;
    if (Math.abs(c1) >= 1.5) score = Math.max(score, 8);
    if (Math.abs(c1) >= 3) score = Math.max(score, 12);
    if (Math.abs(c5) >= 3) score += 5;
    if (Math.abs(c5) >= 6) score += 5;
    if (vr >= 1.3) score += 6;
    if (vr >= 1.8) score += 6;
  }
  return Math.min(30, score);
}

function makeOpportunities(
  events: NewsEvent[],
  quotes: MarketQuote[],
  kapSignals: KapSignal[],
  tenderSignals: TenderSignal[],
): Opportunity[] {
  const marketBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const opportunities: Opportunity[] = [];

  for (const event of events) {
    const text = normalize(event.title);
    for (const theme of themes) {
      const hits = theme.keywords.filter((keyword) => text.includes(keyword));
      if (!hits.length) continue;
      const relevance = Math.min(50, 18 + hits.length * 9);
      const hours = ageHours(event.publishedAt);
      const freshness = hours <= 12 ? 20 : hours <= 36 ? 15 : hours <= 72 ? 10 : 5;
      const relatedQuotes = theme.symbols
        .map((symbol) => marketBySymbol.get(symbol))
        .filter((quote): quote is MarketQuote => Boolean(quote));
      const marketConfirmation = scoreMarket(relatedQuotes);
      const relatedKap = kapSignals.filter((signal) => theme.symbols.includes(signal.symbol));
      const relatedTenders = tenderSignals.filter((signal) => {
        const name = normalize(signal.theme);
        if (theme.id === "telecom") return name.includes("telekom") || name.includes("data center");
        if (theme.id === "grid") return name.includes("energy");
        if (theme.id === "digital") return name.includes("data center");
        if (theme.id === "logistics") return name.includes("logistics");
        return false;
      }).slice(0, 4);
      const kapBoost = relatedKap.some((signal) => signal.category === "contract" || signal.category === "capex")
        ? 18
        : relatedKap.length ? 10 : 0;
      const tenderBoost = relatedTenders.length ? Math.min(10, 4 + relatedTenders.length * 2) : 0;
      const officialConfirmation = Math.min(25, kapBoost + tenderBoost);
      opportunities.push({
        event,
        theme,
        relevance,
        freshness,
        marketConfirmation,
        officialConfirmation,
        score: Math.min(100, relevance + freshness + marketConfirmation + officialConfirmation),
        quotes: relatedQuotes,
        kapSignals: relatedKap.slice(0, 4),
        tenderSignals: relatedTenders,
      });
    }
  }

  return opportunities
    .sort((a, b) => b.score - a.score)
    .filter((item, index, array) =>
      array.findIndex((candidate) => candidate.event.id === item.event.id && candidate.theme.id === item.theme.id) === index,
    )
    .slice(0, 30);
}

function trendLabel(quote: MarketQuote) {
  const c1 = quote.change1dPct ?? 0;
  const c5 = quote.change5dPct ?? 0;
  if (c1 > 0 && c5 > 0) return "pozitif momentum";
  if (c1 < 0 && c5 < 0) return "negatif baskı";
  return "karışık";
}

function formatPct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}


export default function ShadowGraphPage() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [infra, setInfra] = useState<{ facilities: InfraNode[]; exchanges: InfraNode[] }>({ facilities: [], exchanges: [] });
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [kapSignals, setKapSignals] = useState<KapSignal[]>([]);
  const [tenderSignals, setTenderSignals] = useState<TenderSignal[]>([]);
  const [macroNodes, setMacroNodes] = useState<MacroNode[]>([]);
  const [hiddenChains, setHiddenChains] = useState<HiddenChain[]>([]);
  const [alphaSetup, setAlphaSetup] = useState<AlphaSetup | null>(null);
  const [alphaPrices, setAlphaPrices] = useState<Record<string, number>>({});
  const [alphaFetchedAt, setAlphaFetchedAt] = useState<string | null>(null);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [graphStats, setGraphStats] = useState({ nodes: 0, edges: 0, officialEdges: 0, inferredEdges: 0 });
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [priceLags, setPriceLags] = useState<PriceLagRelationship[]>([]);
  const [lagValidation, setLagValidation] = useState<{
    method: string;
    testsPerformed: number;
    trainSurvivors: number;
    sample: {
      marketTicker: string | null;
      minCloseDays: number;
      maxCloseDays: number;
      trainEnd: string | null;
      testStart: string | null;
    };
  } | null>(null);
  const [commercialLeads, setCommercialLeads] = useState<CommercialLead[]>([]);
  const [globalOfficial, setGlobalOfficial] = useState({ disclosures: 0, procurement: 0, sec: "loading", ted: "loading" });
  const [globalQuotes, setGlobalQuotes] = useState<GlobalMarketQuote[]>([]);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [status, setStatus] = useState({
    news: "loading",
    infra: "loading",
    markets: "loading",
    kap: "loading",
    tenders: "loading",
    macro: "loading",
    alpha: "loading",
    graph: "loading",
    lag: "loading",
    leads: "loading",
    globalOfficial: "loading",
    globalMarkets: "loading",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const executionQuery = useQuery({ queryKey: ["event-execution-v1"], queryFn: getEventExecution, staleTime: 60000, refetchInterval: 300000, refetchOnWindowFocus: false });
  const execution = executionQuery.data;
  const bootstrapQuery = useQuery({
    queryKey: ["homepage-bootstrap"],
    queryFn: getHomepageBootstrap,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const load = async (background = false) => {
    if (background) setRefreshing(true);

    type StatusKey = keyof typeof status;
    const run = async <T,>(
      key: StatusKey,
      promise: Promise<T>,
      onSuccess: (value: T) => void,
      onError?: () => void,
    ) => {
      try {
        const value = await promise;
        onSuccess(value);
        setStatus((prev) => ({ ...prev, [key]: "ok" }));
      } catch {
        onError?.();
        setStatus((prev) => ({ ...prev, [key]: "error" }));
      }
    };

    // Start every source concurrently, but update the UI as each individual
    // source resolves. The old implementation waited for the slowest of 13
    // requests before painting any live value, which made the product look empty.
    const tasks = [
      run("globalOfficial", getGlobalOfficial(), (value) => {
        setGlobalOfficial({
          disclosures: value.disclosures.length,
          procurement: value.procurement.length,
          sec: value.sources.sec,
          ted: value.sources.ted,
        });
      }),
      run("graph", getGraph(), (value) => {
        setGraphStats(value.stats);
        setGraphEdges(value.edges);
      }),
      run("lag", getPriceLag(), (value) => {
        setPriceLags(value.signals);
        setLagValidation({
          method: value.method,
          testsPerformed: value.testsPerformed,
          trainSurvivors: value.trainSurvivors,
          sample: value.sample,
        });
      }),
      run("globalMarkets", getGlobalMarkets(), (value) => setGlobalQuotes(value.quotes)),
      run("leads", getLeads(), (value) => setCommercialLeads(value.leads)),
      run("news", getNews(), (value) => setEvents(value.events)),
      run("infra", getInfra(), (value) => {
        setInfra({ facilities: value.facilities, exchanges: value.exchanges });
      }),
      run("markets", getMarkets(), (value) => setQuotes(value.quotes)),
      run("kap", getKap(), (value) => setKapSignals(value.signals)),
      run("tenders", getTenders(), (value) => setTenderSignals(value.tenders)),
      run("macro", getMacro(), (value) => {
        setMacroNodes(value.nodes);
        setHiddenChains(value.chains);
      }),
      run("alpha", getAlpha(), (value) => {
        setAlphaSetup(value.setup);
        setAlphaPrices(value.prices ?? { [value.setup.instrument]: value.setup.currentPrice });
        setAlphaFetchedAt(value.fetchedAt);
      }, () => setAlphaFetchedAt(null)),
    ];

    await Promise.allSettled(tasks);
    setLastUpdated(new Date());
    setRefreshing(false);
  };

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("shadowgraph-paper-ledger-v1");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setPaperTrades(parsed);
      }
    } catch {
      setPaperTrades([]);
    }
    setLedgerLoaded(true);
  }, []);

  useEffect(() => {
    if (!ledgerLoaded || !alphaSetup || !alphaFetchedAt) return;
    setPaperTrades((current) => paperTrading.reconcile(current, alphaSetup, alphaPrices, alphaFetchedAt));
  }, [ledgerLoaded, alphaSetup, alphaPrices, alphaFetchedAt]);

  useEffect(() => {
    if (!ledgerLoaded) return;
    try {
      window.localStorage.setItem("shadowgraph-paper-ledger-v1", JSON.stringify(paperTrades));
    } catch {
      // Keep the in-session paper ledger when storage is unavailable.
    }
  }, [paperTrades, ledgerLoaded]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 300_000);
    return () => window.clearInterval(timer);
  }, []);

  const opportunities = useMemo(
    () => makeOpportunities(events, quotes, kapSignals, tenderSignals),
    [events, quotes, kapSignals, tenderSignals],
  );

  useEffect(() => {
    if (!selected && opportunities[0]) setSelected(opportunities[0]);
  }, [opportunities, selected]);

  const nodes = useMemo(
    () => [...infra.exchanges.slice(0, 8), ...infra.facilities.slice(0, 16)],
    [infra],
  );

  const bestOpportunity = opportunities[0] ?? null;
  const bestChain = hiddenChains[0] ?? null;
  const bestTender = tenderSignals[0] ?? null;
  const topKap = kapSignals[0] ?? null;

  const stats = useMemo(() => paperTrading.stats(paperTrades), [paperTrades]);
  const currentPaperTrade = paperTrades.find((trade) => trade.signalId === alphaSetup?.signalId);
  const displayState = currentPaperTrade?.state ?? alphaSetup?.state ?? "WAIT";
  const alphaAgeMinutes = alphaFetchedAt ? Math.round((Date.now() - Date.parse(alphaFetchedAt)) / 60_000) : null;
  const bootstrap = bootstrapQuery.data;
  const visibleGlobalOfficial =
    status.globalOfficial !== "ok" && bootstrap ? bootstrap.globalOfficial : globalOfficial;
  const visibleGlobalQuotes =
    status.globalMarkets !== "ok" && bootstrap ? bootstrap.globalMarkets.quotes : globalQuotes;
  const visibleGraphStats =
    status.graph !== "ok" && bootstrap ? bootstrap.graph.stats : graphStats;
  const visibleGraphEdges =
    status.graph !== "ok" && bootstrap ? bootstrap.graph.edges : graphEdges;
  const visiblePriceLags =
    status.lag !== "ok" && bootstrap?.leadLag ? bootstrap.leadLag.signals : priceLags;
  const visibleLagValidation =
    status.lag !== "ok" && bootstrap?.leadLag
      ? {
          method: bootstrap.leadLag.method,
          testsPerformed: bootstrap.leadLag.testsPerformed,
          trainSurvivors: bootstrap.leadLag.trainSurvivors,
          sample: {
            marketTicker: bootstrap.leadLag.sample.marketTicker ?? null,
            minCloseDays: bootstrap.leadLag.sample.minCloseDays ?? 0,
            maxCloseDays: bootstrap.leadLag.sample.maxCloseDays ?? 0,
            trainEnd: bootstrap.leadLag.sample.trainEnd ?? null,
            testStart: bootstrap.leadLag.sample.testStart ?? null,
          },
        }
      : lagValidation;
  const lagReady = status.lag === "ok" || Boolean(bootstrap?.leadLag);
  const graphReady = status.graph === "ok" || Boolean(bootstrap);
  const marketsReady = status.globalMarkets === "ok" || Boolean(bootstrap);
  const officialReady = status.globalOfficial === "ok" || Boolean(bootstrap);
  const visibleUpdatedAt = lastUpdated ?? (bootstrap?.generatedAt ? new Date(bootstrap.generatedAt) : null);
  return (
    <>
    <SiteHeader active="terminal" />
    <main className={styles.shell}>
      <Helmet>
        <title>Intelligence: dependency shifts, research verdicts and public contracts · ShadowGraph</title>
        <meta name="description" content="Global evidence-ranked relationship intelligence, price-lag validation and commercial opportunity data for autonomous agents." />
        <link rel="canonical" href="https://shadowalpha.online/terminal" />
        <meta property="og:title" content="ShadowGraph · Impact: what dependencies and outages cost" />
        <meta property="og:description" content="Step four of ShadowGraph: customer concentration from SEC filings, market reactions to outages and open EU tenders, with every test result published." />
        <meta name="twitter:card" content="summary" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ShadowGraph Market Intelligence",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          url: "https://shadowalpha.online",
          description: "Global evidence-ranked relationship intelligence infrastructure for autonomous agents with MCP, A2A and pay-per-call MPP.",
          offers: {
            "@type": "AggregateOffer",
            lowPrice: "0.50",
            highPrice: "5.00",
            priceCurrency: "USD",
          },
        })}</script>
      </Helmet>

      <IntelligenceSignals />

      <div className={styles.labHeading}>
        <span className={styles.sectionEyebrow}>RESEARCH WORKSPACE</span>
        <h2>Explore the underlying graph, markets and event research</h2>
        <p>The tools behind the signals above: relationship hypotheses from live headlines, global market context, the evidence graph and event research. Everything below is exploratory unless marked as verified.</p>
      </div>

      <DependencyMap />

      <section className={styles.metricsBar}>
        <article className={styles.metric}>
          <span className={styles.metricIcon}><Building2 size={17} /></span>
          <div><small>US OFFICIAL FILINGS</small><strong>{!officialReady ? "—" : visibleGlobalOfficial.disclosures}</strong><span>{status.globalOfficial === "error" && !bootstrap ? "source unavailable" : "SEC EDGAR"}</span></div>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricIcon}><Network size={17} /></span>
          <div><small>EU PROCUREMENT</small><strong>{!officialReady ? "—" : visibleGlobalOfficial.procurement}</strong><span>{status.globalOfficial === "error" && !bootstrap ? "source unavailable" : "TED active notices"}</span></div>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricIcon}><Database size={17} /></span>
          <div><small>RELATIONSHIP GRAPH</small><strong>{!graphReady ? "—" : visibleGraphStats.nodes}</strong><span>{graphReady ? `${visibleGraphStats.edges} active edges` : "loading evidence graph"}</span></div>
        </article>
        <article className={styles.metric}>
          <span className={styles.metricIcon}><Activity size={17} /></span>
          <div><small>GLOBAL MARKETS</small><strong>{!PUBLISH_MARKET_QUOTES || !marketsReady ? "—" : visibleGlobalQuotes.length}</strong><span>{!PUBLISH_MARKET_QUOTES ? "prices withheld until a licensed feed is connected" : status.globalMarkets === "error" && !bootstrap ? "market feed unavailable" : "US · EU · Asia · LatAm"}</span></div>
        </article>
      </section>

      <section className={styles.section} id="markets">
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.sectionEyebrow}>GLOBAL MARKET LAYER</span>
            <h2>Cross-region market confirmation</h2>
            <p>Live company-level confirmation across US, European and Asian technology, energy, banking and logistics exposure.</p>
          </div>
          <span className={styles.updatedAt}>{visibleUpdatedAt ? `Updated ${visibleUpdatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Loading"}</span>
        </div>
        <div className={styles.marketGridPro}>
          {!marketsReady && Array.from({ length: 4 }).map((_, index) => (
            <article className={styles.marketCardPro} key={`market-loading-${index}`}>
              <div className={styles.emptyState}>Loading global market confirmation…</div>
            </article>
          ))}
          {visibleGlobalQuotes.slice(0, 12).map((quote) => (
            <article className={styles.marketCardPro} key={quote.symbol}>
              <div className={styles.marketTop}>
                <div>
                  <strong>{quote.symbol}</strong>
                  <small>{quote.region} · {quote.theme}</small>
                </div>
                <span className={(quote.change1dPct ?? 0) >= 0 ? styles.positivePill : styles.negativePill}>
                  {(quote.change1dPct ?? 0) >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
                  {formatPct(quote.change1dPct)}
                </span>
              </div>
              <div className={styles.marketPrice}>{quote.price?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"} <small>{quote.currency}</small></div>
              <div className={styles.marketMeta}>
                <span>{quote.name}</span>
                <span>5D {formatPct(quote.change5dPct)}</span>
                <span>Vol {quote.volumeRatio ? `${quote.volumeRatio.toFixed(1)}×` : "—"}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.intelligenceGrid} id="intelligence">
        <article className={styles.dataCard}>
          <div className={styles.cardHeader}>
            <div>
              <span>RELATIONSHIP GRAPH</span>
              <h3>Highest-confidence relationships</h3>
            </div>
            <Badge variant="outline">{!graphReady ? "loading" : `${visibleGraphStats.officialEdges} evidenced`}</Badge>
          </div>
          <div className={styles.rowList}>
            {!graphReady && <div className={styles.emptyState}>Loading evidence-backed graph…</div>}
            {status.graph === "error" && !bootstrap && <div className={styles.emptyState}>Relationship graph is temporarily unavailable.</div>}
            {visibleGraphEdges.slice(0, 6).map((edge, index) => (
              <div className={styles.graphRow} key={edge.id}>
                <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{edge.source} <i>→</i> {edge.target}</strong>
                  <small>{edge.relation.replaceAll("_", " ")}</small>
                  <span className={styles.edgeMeta}>
                    <Badge variant={edge.inferred ? "outline" : "success"}>{edge.inferred ? "hypothesis / classification" : "source record"}</Badge>
                    {edge.evidence[0]?.url && (
                      <a href={edge.evidence[0].url} target="_blank" rel="noreferrer">
                        source <ExternalLink size={11}/>
                      </a>
                    )}
                  </span>
                </div>
                <b title="Uncalibrated ranking score, not probability">{Math.round(edge.confidence * 100)}/100</b>
              </div>
            ))}
          </div>
        </article>

      </section>

      <EventResearch data={execution} loading={executionQuery.isLoading} error={executionQuery.isError} refreshing={executionQuery.isFetching} onRefresh={() => { void executionQuery.refetch(); }} />

      <section className={styles.agentSection} id="agents">
        <div className={styles.agentIntro}>
          <span className={styles.sectionEyebrow}>FOR AUTONOMOUS AGENTS</span>
          <h2>One endpoint away from paid intelligence.</h2>
          <p>
            Agents can discover ShadowGraph through MCP and A2A, inspect a free live preview, then purchase only the
            intelligence they need through HTTP 402 / MPP.
          </p>
          <div className={styles.agentButtons}>
            <Button asChild><a href="/_api/agent_preview" target="_blank" rel="noreferrer">Free preview <ExternalLink size={14}/></a></Button>
            <Button asChild variant="outline"><a href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI</a></Button>
            <Button asChild variant="outline"><a href="/docs">API docs</a></Button>
          </div>
        </div>
        <div className={styles.agentCommerce}>
          <div className={styles.commerceTop}>
            <div><Bot size={18}/><span>MACHINE COMMERCE</span></div>
            <span className={styles.liveStatus}><i /> PAYMENT READY</span>
          </div>
          <div className={styles.commerceStats}>
            <div><small>FREE TOOLS</small><strong>4</strong></div>
            <div><small>PAID TIERS</small><strong>5</strong></div>
            <div><small>PRICE RANGE</small><strong>$0.50–$5</strong></div>
          </div>
          <code className={styles.apiRoute}>POST /_api/machine/intelligence</code>
          <small className={styles.commerceNote}>MPP-compatible buyers receive a Stripe payment challenge and retry the identical request after settlement.</small>
        </div>
      </section>

      <section className={styles.regionalSection}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.sectionEyebrow}>REGIONAL PACK · TÜRKİYE</span>
            <h2>Local evidence layer</h2>
            <p>KAP disclosures, local procurement and BIST confirmation remain available as a regional data pack — not the primary global product.</p>
          </div>
          <Badge variant="outline">Optional regional layer</Badge>
        </div>
        <div className={styles.regionalGrid}>
          <article className={styles.regionalCard}>
            <span>KAP OFFICIAL DISCLOSURES</span>
            <strong>{kapSignals.length}</strong>
            <div>
              {kapSignals.slice(0, 3).map(signal => (
                <a href={signal.url} target="_blank" rel="noreferrer" key={signal.id}>
                  <b>{signal.symbol}</b><small>{signal.title}</small>
                </a>
              ))}
            </div>
          </article>
          <article className={styles.regionalCard}>
            <span>PUBLIC PROCUREMENT</span>
            <strong>{tenderSignals.length}</strong>
            <div>
              {tenderSignals.slice(0, 3).map(signal => (
                <a href={signal.url} target="_blank" rel="noreferrer" key={signal.id}>
                  <b>{signal.theme}</b><small>{signal.title}</small>
                </a>
              ))}
            </div>
          </article>
          <article className={styles.regionalCard}>
            <span>BIST CONFIRMATION</span>
            <strong>{quotes.length}</strong>
            <div className={styles.regionalMarketList}>
              {quotes.slice(0, 5).map(quote => (
                <div key={quote.symbol}>
                  <b>{quote.symbol}</b>
                  <small>{quote.price?.toFixed(2) ?? "—"}</small>
                  <span className={(quote.change1dPct ?? 0) >= 0 ? styles.up : styles.down}>{formatPct(quote.change1dPct)}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

    </main>
    <SiteFooter />
    </>
  );
}
