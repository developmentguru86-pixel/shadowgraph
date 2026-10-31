import { createHash } from "crypto";
import { globalSearch, asDomain } from "../helpers/globalSearch";
import { mppStore } from "../helpers/mppStore";
import { clientIp } from "../helpers/visitorStats";

const DOMAIN_SCANS_PER_HOUR = 30;

async function allowDomainScan(request: Request) {
  const client = createHash("sha256").update(clientIp(request) || "unknown").digest("hex").slice(0, 16);
  const key = `ratelimit:search-scan:${client}:${new Date().toISOString().slice(0, 13)}`;
  return mppStore.update<boolean>(key, (cur) => {
    const n = Number((cur as { n?: number } | null)?.n ?? 0);
    if (n >= DOMAIN_SCANS_PER_HOUR) return { op: "noop", result: false };
    return { op: "set", value: { n: n + 1 }, result: true };
  });
}

export async function handle(request: Request) {
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const quick = u.searchParams.get("quick") === "1";
  if (q.length < 2) return Response.json({ error: "Type at least 2 characters." }, { status: 400 });
  try {
    const allow = !quick && asDomain(q) ? await allowDomainScan(request) : true;
    const result = await globalSearch(q, { quick, allowDomainScan: allow });
    return Response.json(result, { headers: { "Cache-Control": quick ? "public, s-maxage=60" : "public, s-maxage=120", "X-Robots-Tag": "noindex", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Search failed" }, { status: 500 });
  }
}
