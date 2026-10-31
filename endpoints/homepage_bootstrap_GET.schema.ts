import type { GlobalMarketQuote } from "./global_markets_GET.schema";
import type { GraphEdge } from "./graph_GET.schema";
import type { PriceLagRelationship } from "./price_lag_GET.schema";

export type OutputType = {
  generatedAt: string;
  globalOfficial: {
    disclosures: number;
    procurement: number;
    sec: string;
    ted: string;
  };
  globalMarkets: {
    fetchedAt: string | null;
    quotes: GlobalMarketQuote[];
  };
  graph: {
    stats: {
      nodes: number;
      edges: number;
      officialEdges: number;
      inferredEdges: number;
    };
    edges: GraphEdge[];
  };
  leadLag: {
    method: string;
    sample: {
      marketTicker?: string | null;
      minCloseDays?: number;
      maxCloseDays?: number;
      trainEnd?: string | null;
      testStart?: string | null;
    };
    testsPerformed: number;
    trainSurvivors: number;
    signals: PriceLagRelationship[];
  } | null;
};

export const getHomepageBootstrap = async (): Promise<OutputType> => {
  const result = await fetch("/_api/homepage_bootstrap");
  if (!result.ok) throw new Error("Homepage bootstrap unavailable");
  return result.json();
};
