import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { loadReader } from "./geoRefreshJob";
import { cidr, firstRemoteUrl, isIPv4, KNOWN_EDGE, placeHost, type GeoHit, type Net } from "./agentSignals";

/**
 * Weekly refresh of the public agent directory (table agent_directory) shown on the radar globe's "Agents" layer.
 * Sources: the official MCP Registry (registry.modelcontextprotocol.io, latest versions with a remote endpoint) and
 * the A2A Registry (a2aregistry.org). Each endpoint host is resolved (DNS over HTTPS) and placed:
 *   1. anycast edge networks (Cloudflare, CloudFront, Fastly, Vercel, platform sub-domains) → "edge", not placed,
 *   2. AWS / Google Cloud region from the providers' official IP ranges → "region",
 *   3. otherwise IP geolocation (DB-IP Lite, CC BY 4.0) → "city".
 * Entries that disappear from both registries are removed after 30 days.
 */

const H = 60 * 60_000;
const LAST = "agent-dir:last";
const UA = "ShadowGraph-AgentDirectory/1.0 (+https://shadowalpha.online/radar)";

type Entry = { id: string; source: string; protocol: "mcp" | "a2a"; name: string; title: string | null; url: string; host: string };

async function getJson<T>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return (await r.json()) as T;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

async function mcpRegistry(): Promise<{ entries: Entry[]; complete: boolean }> {
  type Page = { servers: Array<{ server: { name: string; title?: string; remotes?: Array<{ url?: string }> } }>; metadata?: { nextCursor?: string } };
  const out: Entry[] = [];
  let cursor: string | undefined, pages = 0, complete = true;
  do {
    const j = await getJson<Page>(`https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!j) { complete = false; break; }
    for (const { server: s } of j.servers ?? []) {
      const r = firstRemoteUrl((s.remotes ?? []).map((x) => x.url));
      if (r) out.push({ id: `mcp:${s.name}`.slice(0, 300), source: "MCP Registry", protocol: "mcp", name: s.name.slice(0, 200), title: s.title?.slice(0, 200) ?? null, ...r });
    }
    cursor = j.metadata?.nextCursor;
    pages++;
  } while (cursor && pages < 600);
  if (cursor) complete = false;
  return { entries: out, complete };
}

async function a2aRegistry(): Promise<{ entries: Entry[]; complete: boolean }> {
  type Page = { agents: Array<{ name: string; url?: string; wellKnownURI?: string; author?: string; provider?: { organization?: string } }>; total?: number };
  const out: Entry[] = [];
  let offset = 0, total = Infinity, complete = true;
  while (offset < total && offset < 20_000) {
    const j = await getJson<Page>(`https://a2aregistry.org/api/agents?limit=100&offset=${offset}`);
    if (!j) { complete = false; break; }
    total = j.total ?? 0;
    if (!j.agents?.length) break;
    for (const a of j.agents) {
      const r = firstRemoteUrl([a.url, a.wellKnownURI]);
      if (r) out.push({ id: `a2a:${a.wellKnownURI ?? a.url}`.slice(0, 300), source: "A2A Registry", protocol: "a2a", name: (a.name ?? r.host).slice(0, 200), title: (a.provider?.organization ?? a.author ?? null)?.slice(0, 200) ?? null, ...r });
    }
    offset += j.agents.length;
  }
  return { entries: out, complete };
}

async function edgeAndRegionNets(): Promise<Net[]> {
  const nets: Net[] = [];
  const push = (n: Net | null) => { if (n) nets.push(n); };
  try {
    const r = await fetch("https://www.cloudflare.com/ips-v4", { signal: AbortSignal.timeout(10_000) });
    if (r.ok) for (const l of (await r.text()).split("\n")) if (l.trim()) push(cidr(l, "Cloudflare", "edge"));
  } catch { /* skip */ }
  const fastly = await getJson<{ addresses?: string[] }>("https://api.fastly.com/public-ip-list", 2);
  for (const a of fastly?.addresses ?? []) push(cidr(a, "Fastly", "edge"));
  for (const [c, label] of KNOWN_EDGE) push(cidr(c, label, "edge"));
  const aws = await getJson<{ prefixes: Array<{ ip_prefix: string; region: string; service: string }> }>("https://ip-ranges.amazonaws.com/ip-ranges.json", 2);
  for (const p of aws?.prefixes ?? []) {
    if (p.service === "CLOUDFRONT" || p.service === "GLOBALACCELERATOR") push(cidr(p.ip_prefix, "Amazon CloudFront", "edge"));
    else if (p.service === "EC2") push(cidr(p.ip_prefix, `AWS|${p.region}`, "region"));
  }
  const gcp = await getJson<{ prefixes: Array<{ ipv4Prefix?: string; scope: string }> }>("https://www.gstatic.com/ipranges/cloud.json", 2);
  for (const p of gcp?.prefixes ?? []) {
    if (!p.ipv4Prefix) continue;
    // "global" = Google's anycast load balancers: no single location
    push(p.scope === "global" ? cidr(p.ipv4Prefix, "Google Cloud load balancer", "edge") : cidr(p.ipv4Prefix, `Google Cloud|${p.scope}`, "region"));
  }
  // every other Google address (front ends, load balancers, unpublished cloud ranges) geolocates to a registration
  // address such as Kansas City or Mountain View, not to a server: treated as not placeable
  const goog = await getJson<{ prefixes: Array<{ ipv4Prefix?: string }> }>("https://www.gstatic.com/ipranges/goog.json", 2);
  for (const p of goog?.prefixes ?? []) if (p.ipv4Prefix) push(cidr(p.ipv4Prefix, "Google network", "edge"));
  // most specific first; for equal prefixes an explicit cloud region wins over the generic Google aggregate
  return nets.sort((a, b) => b.mask - a.mask || (a.kind === b.kind ? 0 : a.kind === "region" ? -1 : 1));
}

async function resolveA(host: string): Promise<string | null> {
  if (isIPv4(host)) return host;
  for (const base of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
      return j.Answer?.find((a) => a.type === 1)?.data ?? null;
    } catch { /* next resolver */ }
  }
  return null;
}

export async function agentDirectoryJob() {
  const gotLock = await mppStore.update<boolean>("agent-dir:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 6 * H) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };

  const started = Date.now();
  const [mcp, a2a, nets, geo] = await Promise.all([mcpRegistry(), a2aRegistry(), edgeAndRegionNets(), loadReader()]);
  const entries = [...new Map([...mcp.entries, ...a2a.entries].map((e) => [e.id, e])).values()];

  // resolve each distinct host once
  const hosts = [...new Set(entries.map((e) => e.host))];
  const ipOf = new Map<string, string | null>();
  for (let i = 0; i < hosts.length; i += 40) {
    await Promise.all(hosts.slice(i, i + 40).map(async (h) => { ipOf.set(h, await resolveA(h).catch(() => null)); }));
  }
  const lookup = (ip: string) => geo.reader.get(ip) as unknown as GeoHit;
  const placeOf = new Map(hosts.map((h) => [h, placeHost(h, ipOf.get(h) ?? null, nets, lookup)]));

  const now = new Date();
  const counts: Record<string, number> = {};
  for (let i = 0; i < entries.length; i += 400) {
    const rows = entries.slice(i, i + 400).map((e) => {
      const p = placeOf.get(e.host)!;
      counts[p.placement] = (counts[p.placement] ?? 0) + 1;
      return { ...e, ip: ipOf.get(e.host) ?? null, ...p, lastSeen: now, checkedAt: now };
    });
    await db.insertInto("agentDirectory").values(rows).onConflict((oc) => oc.column("id").doUpdateSet({
      source: sql`excluded.source`, protocol: sql`excluded.protocol`, name: sql`excluded.name`, title: sql`excluded.title`,
      url: sql`excluded.url`, host: sql`excluded.host`, ip: sql`excluded.ip`, placement: sql`excluded.placement`,
      network: sql`excluded.network`, region: sql`excluded.region`, city: sql`excluded.city`, country: sql`excluded.country`,
      lat: sql`excluded.lat`, lon: sql`excluded.lon`, lastSeen: sql`excluded.last_seen`, checkedAt: sql`excluded.checked_at`,
    })).execute();
  }
  // only prune when both registries were read completely, so a registry outage never wipes the map
  const removed = mcp.complete && a2a.complete
    ? Number((await db.deleteFrom("agentDirectory").where("lastSeen", "<", new Date(Date.now() - 30 * 24 * H)).executeTakeFirst()).numDeletedRows ?? 0)
    : 0;

  const summary = {
    at: now.toISOString(), seconds: Math.round((Date.now() - started) / 1000), geoSource: geo.source,
    mcp: mcp.entries.length, a2a: a2a.entries.length, mcpComplete: mcp.complete, a2aComplete: a2a.complete,
    hosts: hosts.length, placement: counts, removed,
  };
  await mppStore.put(LAST, summary);
  return { ran: true, ...summary };
}

export async function lastAgentDirectoryRun() {
  return (await mppStore.get(LAST)) as null | { at: string; mcp: number; a2a: number; mcpComplete: boolean; a2aComplete: boolean; hosts: number; placement: Record<string, number>; geoSource: string };
}
