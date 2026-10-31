import { sql } from "kysely";
import { db } from "./db";
import { fetchGlobalOfficialSignals } from "./globalSources";
import { globalMarkets } from "./globalMarkets";
import { PUBLISH_MARKET_QUOTES } from "./licensing";
import { mppStore } from "./mppStore";

// External sources (SEC, TED, market quotes) made a cold /terminal render take ~5 s. Keep the last result per server
// instance for 5 minutes (in memory: the payload holds third-party JSON whose keys must not be rewritten by mppStore).
let memo: { at: number; value: Awaited<ReturnType<typeof buildHomepageBootstrap>> } | null = null;
let inflight: Promise<Awaited<ReturnType<typeof buildHomepageBootstrap>>> | null = null;
export async function homepageBootstrap() {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.value;
  inflight ??= buildHomepageBootstrap().then((value) => { memo = { at: Date.now(), value }; return value; }).finally(() => { inflight = null; });
  return inflight;
}

async function buildHomepageBootstrap() {
  const [officialResult, marketsResult, graphCacheResult, graphStatsResult, graphEdgesResult, lagRunResult] = await Promise.allSettled([
    fetchGlobalOfficialSignals(),
    globalMarkets(),
    mppStore.get("cache:relationship-graph:v5"),
    sql<{
      nodes: number;
      edges: number;
      officialEdges: number;
      inferredEdges: number;
    }>`
      SELECT
        (SELECT count(*)::int FROM relationship_nodes) AS "nodes",
        (SELECT count(*)::int FROM relationship_edges) AS "edges",
        (SELECT count(*)::int FROM relationship_edges WHERE inferred = false) AS "officialEdges",
        (SELECT count(*)::int FROM relationship_edges WHERE inferred = true) AS "inferredEdges"
    `.execute(db),
    sql<{
      id: string;
      source: string;
      target: string;
      relation: string;
      confidence: number;
      inferred: boolean;
      evidence: unknown;
    }>`
      SELECT
        edge_id AS "id",
        source_id AS "source",
        target_id AS "target",
        relation,
        confidence,
        inferred,
        evidence
      FROM relationship_edges
      ORDER BY confidence DESC, last_seen DESC
      LIMIT 8
    `.execute(db),
    sql<{
      runId: string;
      method: string;
      sample: unknown;
      testsPerformed: number;
      trainSurvivors: number;
    }>`
      SELECT
        run_id AS "runId",
        method,
        sample,
        tests_performed AS "testsPerformed",
        train_survivors AS "trainSurvivors"
      FROM lead_lag_runs
      ORDER BY generated_at DESC
      LIMIT 1
    `.execute(db),
  ]);

  const official = officialResult.status === "fulfilled" ? officialResult.value : null;
  const markets = marketsResult.status === "fulfilled" ? marketsResult.value : null;
  const graphCache = graphCacheResult.status === "fulfilled" && graphCacheResult.value && typeof graphCacheResult.value === "object"
    ? graphCacheResult.value as any
    : null;
  const fallbackGraphStats = graphStatsResult.status === "fulfilled"
    ? graphStatsResult.value.rows[0] ?? { nodes: 0, edges: 0, officialEdges: 0, inferredEdges: 0 }
    : { nodes: 0, edges: 0, officialEdges: 0, inferredEdges: 0 };
  const fallbackGraphEdges = graphEdgesResult.status === "fulfilled"
    ? graphEdgesResult.value.rows.map((row) => ({
        ...row,
        evidence: Array.isArray(row.evidence)
          ? row.evidence
          : typeof row.evidence === "string"
            ? (() => {
                try {
                  const parsed = JSON.parse(row.evidence);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [],
      }))
    : [];
  const graphStats = graphCache?.stats ?? fallbackGraphStats;
  const graphEdges = Array.isArray(graphCache?.edges) ? graphCache.edges.slice(0, 8) : fallbackGraphEdges;

  const latestRun = lagRunResult.status === "fulfilled" ? lagRunResult.value.rows[0] : undefined;
  let leadLag: {
    method: string;
    sample: any;
    testsPerformed: number;
    trainSurvivors: number;
    signals: Array<{
      leader: string;
      follower: string;
      lagDays: number;
      direction: "same" | "inverse";
      trainCorr: number;
      trainQ: number;
      testCorr: number;
      testP: number;
      zeroLagCorr: number;
      stability: number;
      windows: unknown;
    }>;
  } | null = null;

  if (latestRun) {
    const signalsResult = await sql<{
      leader: string;
      follower: string;
      lagDays: number;
      direction: "same" | "inverse";
      trainCorr: number;
      trainQ: number;
      testCorr: number;
      testP: number;
      zeroLagCorr: number;
      stability: number;
      windows: unknown;
    }>`
      SELECT
        leader,
        follower,
        lag_days AS "lagDays",
        direction,
        train_corr AS "trainCorr",
        train_q AS "trainQ",
        test_corr AS "testCorr",
        test_p AS "testP",
        zero_lag_corr AS "zeroLagCorr",
        stability,
        windows
      FROM lead_lag_signals
      WHERE run_id = ${latestRun.runId}
      ORDER BY abs(test_corr) * stability DESC
      LIMIT 10
    `.execute(db).catch(() => ({ rows: [] }));

    leadLag = {
      method: latestRun.method,
      sample: latestRun.sample,
      testsPerformed: latestRun.testsPerformed,
      trainSurvivors: latestRun.trainSurvivors,
      signals: signalsResult.rows,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    globalOfficial: {
      disclosures: official?.disclosures.length ?? 0,
      procurement: official?.procurement.length ?? 0,
      sec: official?.sources.sec ?? "unavailable",
      ted: official?.sources.ted ?? "unavailable",
    },
    globalMarkets: {
      fetchedAt: markets?.fetchedAt ?? null,
      quotes: PUBLISH_MARKET_QUOTES ? markets?.quotes ?? [] : [],
    },
    graph: {
      stats: graphStats,
      edges: graphEdges,
    },
    leadLag,
  };
}
