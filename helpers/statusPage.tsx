import { sql } from "kysely";
import { db } from "./db";
import { statusDirectory, slugify, type Dependency } from "./statusDirectory";
import { letterOf, type DirectoryLetter } from "./statusLetters";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";

/**
 * Server-side data for the public "Is X down?" pages (/status/:slug), small enough to render on the server for search engines.
 * A slug is either a provider (aws, cloudflare, …: every service depending on it), the exact slug of one monitored service
 * (stripe-api, deutsche-bahn, …), or a brand prefix (github → every GitHub endpoint).
 */
/** `since`: start of the current failing streak (first failed probe after the last good one), null when the service answers. */
export type StatusRow = RadarServiceRow & { via: Dependency[]; slug: string; since: string | null };
export type StatusPageData = {
  slug: string;
  kind: "provider" | "service" | "brand" | "unknown";
  name: string;
  blurb: string | null;
  category: string | null;
  regions: boolean;
  checkedAt: string | null;
  rows: StatusRow[];
  /** rows behind the page in total (provider pages ship only the failing rows plus the first ones, see ROW_CAP) */
  rowsTotal: number;
  /** headline numbers over ALL rows, so a trimmed provider page still shows the true totals */
  summary: { up: number; uptimeAvg: number | null; latencyMedian: number | null };
  /** per cloud region (provider pages with regions): services, canary state, services with errors */
  regionStats: Array<{ region: string; n: number; canary: string | null; bad: number }>;
  /** service ids for the alert form and the stack-alerts trial link */
  alertIds: string[];
  incidents: Array<{ id: string; provider: string; status: string; startedAt: string; affected: number }>;
  /** providers this page's services run on (hosting / CDN / DNS), each with a link when we have a provider page */
  infrastructure: Array<{ layer: Dependency; name: string; slug: string | null; services: number }>;
  /**
   * Services that share infrastructure with this page's services, by how likely one outage hits both:
   * region = same cloud provider AND same region; edge = same DNS provider or CDN; provider = same cloud provider,
   * but the region of at least one side is unknown (a provider-wide outage is rare). Different known regions are left out.
   */
  sharedWith: Array<{ slug: string; name: string; via: string; strength: "region" | "edge" | "provider" }>;
  sharedTotals: { region: number; edge: number; provider: number };
  related: Array<{ slug: string; name: string }>;
  /** most recent finished outage episode (>= 2 failed sweeps in a row) of this page's services, and how many in 30 days */
  lastIssue: { name: string; startedAt: string; recoveredAt: string } | null;
  issues30d: number;
  /** whether search engines should index this page per language (thin long-tail pages stay reachable but noindex) */
  indexable: { en: boolean; de: boolean };
};

const parse = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v);
/** Provider pages list hundreds of dependents (AWS: 800+). The server-rendered page carries every failing row plus the
 *  first ROW_CAP overall; the full list loads on demand (?full=1). Keeps /status/aws at ~100 KB instead of ~900 KB. */
const ROW_CAP = 100;

/**
 * SEO focus (2026-10-23): on a young domain Google discounts thousands of near-identical generated pages, so only the
 * pages with real demand and history go into the sitemap and the index: providers, curated brands, the curated
 * catalogue (hand-picked services) and the top 300 of the Tranco extended list. German pages only for DACH/European
 * and financial services. Every other page stays live and linked, with noindex,follow.
 */
const TOP_RANK = 300;
const DE_CATEGORIES = new Set(["DACH", "Europe", "Banks & payments", "Payments & fintech"]);
let topIdsCache: { at: number; ids: Set<string> } | null = null;
async function topRankedExtraIds(): Promise<Set<string>> {
  if (topIdsCache && Date.now() - topIdsCache.at < 3_600_000) return topIdsCache.ids;
  const rows = await db.selectFrom("radarCatalogExtra").select(["id"]).where("rank", "<=", TOP_RANK).execute();
  topIdsCache = { at: Date.now(), ids: new Set(rows.map((r) => r.id)) };
  return topIdsCache.ids;
}
const featuredService = (id: string, top: Set<string>) => !id.startsWith("web-") || top.has(id);
/** Pages that already earned a visit from a search engine stay indexed in that language, whatever the rules above say. */
let earnedCache: { at: number; en: Set<string>; de: Set<string> } | null = null;
async function searchEarnedSlugs(): Promise<{ en: Set<string>; de: Set<string> }> {
  if (earnedCache && Date.now() - earnedCache.at < 3_600_000) return earnedCache;
  const rows = await db.selectFrom("visitorDays").select(["firstPath"]).distinct()
    .where("isBot", "=", false).where("referrerHost", "~", "(google|bing|duckduckgo|ecosia|yahoo|qwant)\\.").execute();
  const en = new Set<string>(), de = new Set<string>();
  for (const r of rows) {
    const m = /^\/(de\/)?status\/([^/?#]+)/.exec(r.firstPath ?? "");
    if (m) (m[1] ? de : en).add(slugify(decodeURIComponent(m[2])));
  }
  earnedCache = { at: Date.now(), en, de };
  return earnedCache;
}

async function loadServices(): Promise<RadarServiceRow[]> {
  const services = await db.selectFrom("radarServices")
    .leftJoin("serviceGeo", "serviceGeo.serviceId", "radarServices.id")
    .select(["radarServices.id", "radarServices.name", "radarServices.category", "radarServices.hostingProvider", "radarServices.hostingRegion", "radarServices.hostingCountry",
      "radarServices.cdn", "radarServices.dnsProvider", "radarServices.emailProvider", "radarServices.analyzedHost",
      "serviceGeo.city as hostingCity", "serviceGeo.country as geoCountry", "serviceGeo.lat as hostingLat", "serviceGeo.lon as hostingLon"])
    .where("radarServices.active", "=", true).orderBy("radarServices.name").execute();
  return services.map((s) => ({ ...s, state: "unknown" as const, httpStatus: null, latencyMs: null, error: null, uptime24h: null, samples24h: 0 }));
}

/**
 * Live state for a subset of services: last two sweeps decide up / degraded / down (same rule as the radar).
 * The two newest sweeps come straight from radar_checks (radar_runs is only written by the hourly research job,
 * so reading it made "right now" pages up to an hour old).
 */
export async function withLiveState(rows: RadarServiceRow[]): Promise<{ rows: RadarServiceRow[]; checkedAt: string | null }> {
  const runs = (await sql<{ runId: string; at: Date }>`
    SELECT run_id AS "runId", max(checked_at) AS at FROM radar_checks
    WHERE checked_at > now() - interval '30 minutes' GROUP BY run_id ORDER BY run_id DESC LIMIT 2`.execute(db)).rows;
  if (!runs.length || !rows.length) return { rows, checkedAt: runs[0] ? new Date(runs[0].at).toISOString() : null };
  const ids = rows.map((r) => r.id);
  const checks = await db.selectFrom("radarChecks").select(["serviceId", "runId", "ok", "httpStatus", "latencyMs", "error"])
    .where("runId", "in", runs.map((r) => r.runId)).where("serviceId", "in", ids).execute();
  const uptime = await sql<{ sid: string; okn: string; n: string }>`
    select service_id as sid, sum(n_ok) as okn, sum(n) as n from radar_service_hourly
    where hour > now() - interval '24 hours' and service_id in (${sql.join(ids)}) group by service_id`.execute(db);
  const up = new Map(uptime.rows.map((u) => [u.sid, { share: Number(u.okn) / Math.max(1, Number(u.n)), n: Number(u.n) }]));
  const latest = new Map(checks.filter((c) => c.runId === runs[0].runId).map((c) => [c.serviceId, c]));
  const previous = new Map(checks.filter((c) => c.runId === runs[1]?.runId).map((c) => [c.serviceId, c]));
  return {
    checkedAt: new Date(runs[0].at).toISOString(),
    rows: rows.map((s) => {
      const c = latest.get(s.id), p = previous.get(s.id);
      const state = !c ? "unknown" : c.ok ? "up" : p && !p.ok ? "down" : "degraded";
      return { ...s, state, httpStatus: c?.httpStatus ?? null, latencyMs: c?.latencyMs ?? null, error: c?.error ?? null,
        uptime24h: up.get(s.id)?.share ?? null, samples24h: up.get(s.id)?.n ?? 0 };
    }),
  };
}

const layersOf = (s: RadarServiceRow): Array<{ layer: Dependency; name: string }> => [
  ...(s.hostingProvider ? [{ layer: "hosting" as const, name: s.hostingProvider }] : []),
  ...(s.cdn ? [{ layer: "cdn" as const, name: s.cdn }] : []),
  ...(s.dnsProvider && !/^Other \(/.test(s.dnsProvider) ? [{ layer: "dns" as const, name: s.dnsProvider }] : []),
];
/** For "same providers" matching, a smaller DNS operator counts too ("Other (arz.at)" = name servers run by arz.at). */
const sharedLayersOf = (s: RadarServiceRow): Array<{ layer: Dependency; name: string }> => [
  ...layersOf(s),
  ...(s.dnsProvider && /^Other \(/.test(s.dnsProvider) ? [{ layer: "dns" as const, name: s.dnsProvider }] : []),
];
const providerSlugFor = (layer: Dependency, name: string) =>
  statusDirectory.providers.find((p) => (layer === "hosting" ? p.hosting : layer === "cdn" ? p.cdn : p.dns)?.test(name))?.slug ?? null;

export async function getStatusPageData(rawSlug: string, opts: { full?: boolean } = {}): Promise<StatusPageData> {
  const slug = slugify(decodeURIComponent(rawSlug || ""));
  const all = (await loadServices()).filter((s) => s.category !== "Cloud region canary" || statusDirectory.provider(slug)?.regions);
  const def = statusDirectory.provider(slug);
  let kind: StatusPageData["kind"];
  let picked: Array<{ s: RadarServiceRow; via: Dependency[] }>;
  let name: string;
  if (def) {
    kind = "provider"; name = def.name;
    picked = statusDirectory.dependents(def, all).map((d) => ({ s: d.service, via: d.via }));
  } else {
    const exact = all.filter((s) => s.category !== "Cloud region canary" && slugify(s.name) === slug);
    const brand = statusDirectory.servicesFor(slug, all);
    kind = exact.length ? "service" : brand.length ? "brand" : "unknown";
    picked = (exact.length ? exact : brand).map((s) => ({ s, via: [] }));
    name = exact[0]?.name ?? statusDirectory.brandName(slug) ?? brand[0]?.name.split(" ")[0] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const live = await withLiveState(picked.map((p) => p.s));
  const viaBy = new Map(picked.map((p) => [p.s.id, p.via]));

  // since when is it failing? first failed probe after the last successful one (last 24 h), only for failing services
  const failing = live.rows.filter((r) => r.state === "down" || r.state === "degraded").map((r) => r.id).slice(0, 50);
  const sinceBy = new Map<string, string>();
  if (failing.length) {
    const rs = await sql<{ sid: string; since: Date }>`
      SELECT c.service_id AS sid, min(c.checked_at) AS since FROM radar_checks c
      WHERE c.service_id IN (${sql.join(failing)}) AND c.checked_at > now() - interval '24 hours' AND NOT c.ok
        AND c.checked_at > coalesce((SELECT max(o.checked_at) FROM radar_checks o
          WHERE o.service_id = c.service_id AND o.ok AND o.checked_at > now() - interval '24 hours'), now() - interval '24 hours')
      GROUP BY c.service_id`.execute(db);
    for (const r of rs.rows) sinceBy.set(r.sid, new Date(r.since).toISOString());
  }
  const rows: StatusRow[] = live.rows.map((r) => ({ ...r, via: viaBy.get(r.id) ?? [], slug: slugify(r.name), since: sinceBy.get(r.id) ?? null }));
  const ids = new Set(rows.map((r) => r.id));

  // outage history: finished episodes in the last 30 days (provider pages: too many services to be meaningful)
  let lastIssue: StatusPageData["lastIssue"] = null, issues30d = 0;
  if (kind !== "provider" && ids.size) {
    const ep = await db.selectFrom("radarEpisodes").select(["serviceId", "startedAt", "recoveredAt"])
      .where("serviceId", "in", [...ids]).where("startedAt", ">", new Date(Date.now() - 30 * 86_400_000))
      .where("recoveredAt", "is not", null).orderBy("startedAt", "desc").execute();
    issues30d = ep.length;
    const e = ep[0];
    if (e?.recoveredAt) lastIssue = { name: rows.find((r) => r.id === e.serviceId)?.name ?? name, startedAt: new Date(e.startedAt).toISOString(), recoveredAt: new Date(e.recoveredAt).toISOString() };
  }

  const incidentsRaw = await db.selectFrom("radarIncidents").select(["id", "provider", "status", "startedAt", "affected"])
    .where(({ or, eb }) => or([eb("status", "=", "open"), eb("startedAt", ">", new Date(Date.now() - 7 * 86_400_000))]))
    .orderBy("startedAt", "desc").limit(30).execute();
  const incidents = incidentsRaw.map((i) => ({ ...i, affected: (parse(i.affected) ?? []) as Array<{ id: string }> }))
    .filter((i) => def
      ? [def.hosting, def.cdn, def.dns].some((rx) => rx && rx.test(i.provider.replace(/ (us|eu|ap|sa|ca|me|af|europe|asia)-[a-z0-9-]+$/, "")))
      : i.affected.some((a) => ids.has(a.id)))
    .map((i) => ({ id: i.id, provider: i.provider, status: i.status, startedAt: new Date(i.startedAt).toISOString(), affected: i.affected.length }));

  // infrastructure behind this page's services, and who else shares it (what fails together)
  const infraMap = new Map<string, { layer: Dependency; name: string; slug: string | null; services: number }>();
  if (kind !== "provider") for (const r of rows) for (const l of layersOf(r)) {
    const k = `${l.layer}|${l.name}`;
    const cur = infraMap.get(k) ?? { ...l, slug: providerSlugFor(l.layer, l.name), services: 0 };
    cur.services++; infraMap.set(k, cur);
  }
  const infrastructure = [...infraMap.values()];
  const sharedWith: StatusPageData["sharedWith"] = [];
  const sharedTotals = { region: 0, edge: 0, provider: 0 };
  if (kind !== "provider" && rows.length) {
    const mine = new Set(rows.flatMap((r) => sharedLayersOf(r).map((l) => `${l.layer}|${l.name}`)));
    const label: Record<Dependency, string> = { hosting: "hosting", cdn: "CDN", dns: "DNS" };
    const rank = { region: 0, edge: 1, provider: 2 } as const;
    const categories = new Set(rows.map((r) => r.category));
    const all3: Array<StatusPageData["sharedWith"][number] & { sameCat: boolean }> = [];
    for (const s of all) {
      if (ids.has(s.id) || s.category === "Cloud region canary") continue;
      const shared = sharedLayersOf(s).filter((l) => mine.has(`${l.layer}|${l.name}`));
      if (!shared.length) continue;
      const sameRegion = shared.find((l) => l.layer === "hosting" && s.hostingRegion && s.hostingRegion !== "global"
        && rows.some((r) => r.hostingRegion === s.hostingRegion && r.hostingProvider === s.hostingProvider));
      const edge = shared.find((l) => l.layer === "dns") ?? shared.find((l) => l.layer === "cdn");
      // same cloud, but both regions known and different: a regional outage does not hit both, so it is not listed
      const hostingOnly = shared.find((l) => l.layer === "hosting"
        && !rows.some((r) => r.hostingProvider === s.hostingProvider && r.hostingRegion && s.hostingRegion && r.hostingRegion !== s.hostingRegion && r.hostingRegion !== "global" && s.hostingRegion !== "global"));
      const pick: [StatusPageData["sharedWith"][number]["strength"], (typeof shared)[number]] | null =
        sameRegion ? ["region", sameRegion] : edge ? ["edge", edge] : hostingOnly ? ["provider", hostingOnly] : null;
      if (!pick) continue;
      const [strength, l] = pick;
      sharedTotals[strength]++;
      all3.push({ slug: slugify(s.name), name: s.name, strength, sameCat: categories.has(s.category),
        // DNS operators are not named on public pages (owner decision 2026-11-01): only that the DNS provider is shared
        via: l.layer === "dns" ? "same DNS provider" : `${label[l.layer]} · ${l.name.replace(/^Other \((.+)\)$/, "$1")}${strength === "region" && s.hostingRegion ? ` ${s.hostingRegion}` : ""}` });
    }
    // strongest link first; inside a group, services of the same kind (e.g. other banks) before the rest
    all3.sort((a, b) => rank[a.strength] - rank[b.strength] || Number(b.sameCat) - Number(a.sameCat) || a.name.localeCompare(b.name));
    const perGroup = { region: 0, edge: 0, provider: 0 };
    for (const x of all3) {
      if (perGroup[x.strength] >= (x.strength === "provider" ? 12 : 18)) continue;
      perGroup[x.strength]++;
      sharedWith.push({ slug: x.slug, name: x.name, via: x.via, strength: x.strength });
    }
  }
  const category = kind === "provider" ? null : rows[0]?.category ?? null;
  const related = all.filter((s) => s.category === category && !ids.has(s.id)).slice(0, 24).map((s) => ({ slug: slugify(s.name), name: s.name }));

  // totals over every row, then trim provider pages (failing rows first, same order as the page table)
  const visible = kind === "provider" ? rows : rows.filter((r) => r.category !== "Cloud region canary");
  const lat = visible.map((r) => r.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const summary = {
    up: visible.filter((r) => r.state === "up").length,
    uptimeAvg: visible.length ? visible.reduce((s, r) => s + (r.uptime24h ?? 0), 0) / visible.length : null,
    latencyMedian: lat.length ? lat[Math.floor(lat.length / 2)] : null,
  };
  const regionStats = def?.regions
    ? [...new Set(visible.map((r) => r.hostingRegion).filter((x): x is string => !!x))].sort().map((region) => {
      const list = visible.filter((r) => r.hostingRegion === region);
      return { region, n: list.length, canary: list.find((r) => r.category === "Cloud region canary")?.state ?? null, bad: list.filter((r) => r.state !== "up").length };
    })
    : [];
  const alertIds = visible.filter((r) => r.category !== "Cloud region canary").slice(0, 25).map((r) => r.id);
  const ordered = [...visible].sort((a, b) => (a.state === "up" ? 1 : 0) - (b.state === "up" ? 1 : 0) || a.name.localeCompare(b.name));
  const cap = Math.max(ROW_CAP, ordered.filter((r) => r.state !== "up").length);
  const shown = kind === "provider" && !opts.full ? ordered.slice(0, cap) : ordered;
  const top = await topRankedExtraIds();
  const earned = await searchEarnedSlugs();
  const curatedPage = kind === "provider" || BRANDS.includes(slug);
  const en = curatedPage || earned.en.has(slug) || (kind !== "unknown" && picked.some((p) => featuredService(p.s.id, top)));
  const indexable = { en, de: curatedPage || earned.de.has(slug) || (en && picked.some((p) => DE_CATEGORIES.has(p.s.category))) };

  // Public pages show live state and the main provider (hosting, cloud region, CDN). DNS and email operators, the
  // origin's city/coordinates and the network country stay internal (owner decision 2026-11-01: no full mapping in public).
  const publicRows = shown.map((r) => ({ ...r, dnsProvider: null, emailProvider: null, hostingCountry: null,
    hostingCity: null, geoCountry: null, hostingLat: null, hostingLon: null }));
  return {
    slug, kind, name, blurb: def?.blurb ?? null, category, regions: !!def?.regions, checkedAt: live.checkedAt,
    rows: publicRows, rowsTotal: visible.length, summary, regionStats, alertIds, incidents,
    infrastructure: infrastructure.filter((i) => i.layer !== "dns"), sharedWith, sharedTotals, related, lastIssue, issues30d, indexable,
  };
}

const BRANDS = ["stripe", "github", "openai", "anthropic", "slack", "discord", "zoom", "paypal", "shopify", "twilio", "netflix", "spotify", "notion",
  "coinbase", "binance", "chatgpt", "claude", "google", "microsoft", "apple", "amazon", "salesforce", "atlassian", "adobe", "firebase", "okta", "klarna", "yahoo"];

export type StatusIndexEntry = { slug: string; name: string; letter: DirectoryLetter };

/** Every public status page with its display name: providers, curated brand pages, one page per monitored service. */
export async function statusIndex(): Promise<StatusIndexEntry[]> {
  const rows = await db.selectFrom("radarServices").select(["name", "category"]).where("active", "=", true).execute();
  const out = new Map<string, string>(statusDirectory.providers.map((p) => [p.slug, p.name]));
  for (const b of BRANDS) if (!out.has(b)) out.set(b, statusDirectory.brandName(b) ?? b.charAt(0).toUpperCase() + b.slice(1));
  for (const r of rows) if (r.category !== "Cloud region canary") { const s = slugify(r.name); if (s.length >= 2 && !out.has(s)) out.set(s, r.name); }
  return [...out].map(([slug, name]) => ({ slug, name, letter: letterOf(name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Every public status URL: providers + one page per monitored service (+ curated brand pages). */
export async function statusSlugs(): Promise<string[]> {
  return (await statusIndex()).map((e) => e.slug);
}

/** The status pages that go into the sitemap (see TOP_RANK / DE_CATEGORIES above). */
export async function featuredStatusSlugs(): Promise<{ en: string[]; de: string[] }> {
  const rows = await db.selectFrom("radarServices").select(["id", "name", "category"]).where("active", "=", true).execute();
  const top = await topRankedExtraIds();
  const en = new Set<string>([...statusDirectory.providers.map((p) => p.slug), ...BRANDS]);
  const de = new Set<string>(en);
  const earned = await searchEarnedSlugs();
  for (const s of earned.en) en.add(s);
  for (const s of earned.de) de.add(s);
  for (const r of rows) {
    if (r.category === "Cloud region canary" || !featuredService(r.id, top)) continue;
    const s = slugify(r.name);
    if (s.length < 2) continue;
    en.add(s);
    if (DE_CATEGORIES.has(r.category)) de.add(s);
  }
  return { en: [...en].sort(), de: [...de].sort() };
}
