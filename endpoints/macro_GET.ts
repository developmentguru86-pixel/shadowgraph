import superjson from "superjson";
import type { HiddenChain, MacroNode, OutputType } from "./macro_GET.schema";
import { PUBLISH_MARKET_QUOTES, WITHHELD } from "../helpers/licensing";

const instruments = [
  { id: "brent", name: "Brent Oil", symbol: "BZ=F", unit: "USD", role: "energy / inflation impulse" },
  { id: "wti", name: "WTI Oil", symbol: "CL=F", unit: "USD", role: "energy / inflation impulse" },
  { id: "us10y", name: "US 10Y", symbol: "^TNX", unit: "%", role: "discount rate / liquidity" },
  { id: "dxy", name: "US Dollar", symbol: "DX-Y.NYB", unit: "DXY", role: "global liquidity pressure" },
  { id: "gold", name: "Gold", symbol: "GC=F", unit: "USD", role: "real-yield / safe haven" },
  { id: "btc", name: "Bitcoin", symbol: "BTC-USD", unit: "USD", role: "high-beta liquidity proxy" },
  { id: "eth", name: "Ethereum", symbol: "ETH-USD", unit: "USD", role: "crypto beta / institutional flow" },
  { id: "nasdaq", name: "Nasdaq", symbol: "^IXIC", unit: "pts", role: "growth / duration risk" },
];

const pct = (current: number | null, previous: number | null) =>
  current !== null && previous ? ((current / previous) - 1) * 100 : null;

async function node(item: typeof instruments[number]): Promise<MacroNode> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph/3.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`${item.symbol} ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter((value): value is number => typeof value === "number");
  const current = typeof result?.meta?.regularMarketPrice === "number"
    ? result.meta.regularMarketPrice
    : valid.at(-1) ?? null;
  const previous = valid.length >= 2 ? valid.at(-2)! : null;
  return {
    id: item.id,
    name: item.name,
    symbol: item.symbol,
    value: current,
    unit: item.unit,
    changePct: pct(current, previous),
    role: item.role,
  };
}

const byId = (nodes: MacroNode[], id: string) => nodes.find((item) => item.id === id);
const change = (nodes: MacroNode[], id: string) => byId(nodes, id)?.changePct ?? 0;

function buildChains(nodes: MacroNode[]): HiddenChain[] {
  const chains: HiddenChain[] = [];
  const oil = Math.max(change(nodes, "brent"), change(nodes, "wti"));
  const yieldMove = change(nodes, "us10y");
  const dollar = change(nodes, "dxy");
  const btc = change(nodes, "btc");
  const eth = change(nodes, "eth");
  const nasdaq = change(nodes, "nasdaq");
  const gold = change(nodes, "gold");

  const riskOffEvidence =
    (oil > 0.5 ? 1 : 0) +
    (yieldMove > 0.2 ? 1 : 0) +
    (dollar > 0.15 ? 1 : 0) +
    (btc < -0.8 ? 1 : 0) +
    (eth < -1 ? 1 : 0);

  if (riskOffEvidence >= 3) {
    chains.push({
      id: "oil-rates-liquidity",
      title: "Oil shock → rates → dollar → crypto liquidity",
      confidence: Math.min(96, 62 + riskOffEvidence * 7),
      direction: "risk-off",
      steps: [
        "Oil / supply risk rises",
        "Near-term inflation pressure rises",
        "Bond yields stay elevated",
        "Dollar liquidity tightens",
        "Leveraged risk assets de-rate",
        "BTC / ETH absorb forced selling",
      ],
      logic: "Energy and geopolitical stress can migrate into inflation expectations and discount rates before it appears as a crypto-specific headline.",
      watch: "Chain weakens if yields and DXY roll over together while BTC reclaims the latest resistance zone.",
    });
  }

  if (eth < btc - 0.8) {
    chains.push({
      id: "eth-beta",
      title: "BTC stress → ETH beta amplification",
      confidence: 78,
      direction: "risk-off",
      steps: [
        "BTC loses liquidity / support",
        "Portfolio risk budgets shrink",
        "Higher-beta crypto is cut faster",
        "ETH underperforms BTC",
      ],
      logic: "When macro pressure is broad rather than coin-specific, beta usually transmits the shock unevenly; ETH can become the cleaner expression of crypto risk-off.",
      watch: "Relative pressure weakens if ETH/BTC stabilizes while BTC remains soft.",
    });
  }

  if (yieldMove > 0.2 && gold < 0) {
    chains.push({
      id: "real-yield-gold",
      title: "Higher yields → real-rate pressure → gold digestion",
      confidence: 72,
      direction: "mixed",
      steps: [
        "Treasury yields rise",
        "Opportunity cost of non-yielding assets rises",
        "Gold momentum cools despite geopolitical demand",
      ],
      logic: "Safe-haven demand can coexist with weaker gold when the real-yield channel dominates the geopolitical channel.",
      watch: "A simultaneous fall in yields with persistent geopolitical stress would flip this balance back toward gold.",
    });
  }

  if (nasdaq > -0.5 && btc < -1.5) {
    chains.push({
      id: "crypto-specific-leverage",
      title: "Equities resilient → crypto weak → leverage flush",
      confidence: 74,
      direction: "mixed",
      steps: [
        "Broad growth equities hold relatively better",
        "Crypto sells off disproportionately",
        "Derivatives / positioning becomes the transmission mechanism",
      ],
      logic: "This divergence suggests part of the move is positioning and forced deleveraging rather than a universal collapse in risk appetite.",
      watch: "If BTC stabilizes after liquidations while Nasdaq stays firm, mean reversion probability rises.",
    });
  }

  if (!chains.length) {
    chains.push({
      id: "no-dominant-chain",
      title: "No dominant hidden balance",
      confidence: 45,
      direction: "mixed",
      steps: ["Macro signals are not aligned", "Wait for cross-market confirmation"],
      logic: "The system does not force a narrative when the major transmission channels disagree.",
      watch: "Look for oil, yields, dollar and risk assets to align before taking a directional view.",
    });
  }

  return chains.sort((a, b) => b.confidence - a.confidence);
}

export async function handle() {
  if (!PUBLISH_MARKET_QUOTES) {
    return new Response(superjson.stringify({ fetchedAt: new Date().toISOString(), nodes: [], chains: [], notice: WITHHELD.quotes }), { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  const settled = await Promise.allSettled(instruments.map(node));
  const nodes = settled
    .filter((item): item is PromiseFulfilledResult<MacroNode> => item.status === "fulfilled")
    .map((item) => item.value);

  if (nodes.length < 5) {
    return new Response(superjson.stringify({ error: "Macro cross-asset data unavailable" }), { status: 502 });
  }

  const output: OutputType = {
    fetchedAt: new Date().toISOString(),
    nodes,
    chains: buildChains(nodes),
  };
  return new Response(superjson.stringify(output), {
    headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=240" },
  });
}