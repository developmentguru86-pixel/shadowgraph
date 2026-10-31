import { mppStore } from "../helpers/mppStore";

type Snapshot = { generatedAt?: string; fetchedAt?: string };

function snapshotState(value: unknown) {
  const snapshot = value && typeof value === "object" ? value as Snapshot : null;
  const generatedAt = snapshot?.generatedAt ?? snapshot?.fetchedAt ?? null;
  const parsed = generatedAt ? Date.parse(generatedAt) : NaN;
  return {
    available: Boolean(snapshot),
    generatedAt,
    ageSeconds: Number.isFinite(parsed) ? Math.max(0, Math.round((Date.now() - parsed) / 1000)) : null,
  };
}

export async function handle() {
  const [graph, leadLag, markets, official] = await Promise.all([
    // must match the cache keys the engines actually write (relationshipGraphEngine, priceLagEngine, globalMarkets, globalSources)
    mppStore.get("cache:relationship-graph:v5").catch(() => null),
    mppStore.get("cache:lead-lag:v5").catch(() => null),
    mppStore.get("cache:global-markets:v2").catch(() => null),
    mppStore.get("cache:global-official:v3").catch(() => null),
  ]);

  const snapshots = {
    graph: snapshotState(graph),
    leadLag: snapshotState(leadLag),
    globalMarkets: snapshotState(markets),
    globalOfficial: snapshotState(official),
  };
  const available = Object.values(snapshots).filter((item) => item.available).length;

  return new Response(JSON.stringify({
    status: available >= 3 ? "ok" : "degraded",
    service: "ShadowGraph Market Intelligence",
    version: "2.3.3",
    checkedAt: new Date().toISOString(),
    discovery: {
      mcp: "https://shadowalpha.online/_api/mcp",
      a2a: "https://shadowalpha.online/_api/a2a",
      openapi: "https://shadowalpha.online/openapi.json",
    },
    snapshots,
  }), {
    status: available >= 2 ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
