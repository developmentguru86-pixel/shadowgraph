import { sql } from "kysely";
import { db } from "./db";
import { slugify, statusDirectory } from "./statusDirectory";
import { withLiveState } from "./statusPage";
import { worldMap } from "./worldMap";
import { vendorScan, type VendorFinding } from "./vendorScan";
import { companyDependencies, type CompanyIndexEntry } from "./companyDependencies";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";

/**
 * One search box for the whole site: a company, a service, a provider (hosting / CDN / DNS / email), a cloud region
 * or a domain. Returns every data set that mentions it, structured, with links to the detail pages.
 */

export type SearchService = { id: string; slug: string; name: string; category: string; domain: string; state: string; uptime24h: number | null; hosting: string | null; region: string | null; cdn: string | null; dns: string | null; email: string | null };
export type SearchProvider = {
  name: string; layers: Array<"hosting" | "cdn" | "dns" | "email">; services: number; sample: string[];
  slug: string | null; incidents90d: number; lastIncident: { title: string; at: string } | null;
};
export type SearchResult = {
  q: string;
  services: SearchService[]; servicesTotal: number;
  providers: SearchProvider[];
  regions: Array<{ region: string; label: string; services: number; sample: string[] }>;
  incidents: Array<{ source: "provider status" | "service status page"; who: string; title: string; at: string; resolved: boolean; link: string | null; severe: boolean }>;
  companies: Array<{ filer: string; ticker: string; customer: string; customerSlug: string; share: number; periodEnd: string; docUrl: string }>;
  companiesTotal: number;
  /** company dependency pages (/company/<slug>) matching the query by name or ticker */
  companyPages: CompanyIndexEntry[];
  agents: { total: number; sample: Array<{ name: string; protocol: string; host: string; where: string | null }> };
  domain: (VendorFinding & { scannedAt: string }) | null;
  domainNote: string | null;
};

const DOMAIN_RX = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const asDomain = (q: string) => {
  const d = q.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0];
  return DOMAIN_RX.test(d) ? d : null;
};
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** Postgres regex that only matches the term at the start of a word: "ubs" finds "UBS Group", not "Subsidiaries" or "Hubs". */
const reEsc = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
const wordStart = (q: string) => `\\m${reEsc(q)}`;
/** Whole-word match, used for domain searches: "ete.ch" must find "ETE" but never "Baseten", "Meteo" or "card complete". */
const wholeWord = (q: string) => `\\m${reEsc(q)}\\M`;

export async function globalSearch(rawQ: string, opts: { quick?: boolean; allowDomainScan?: boolean } = {}): Promise<SearchResult> {
  const q = rawQ.trim().slice(0, 80);
  const lim = opts.quick ? 5 : 12;
  const pat = like(q);
  const domain = asDomain(q);
  const term = domain ? domain.split(".").slice(0, -1).join(".") : q; // "stripe.com" also finds "Stripe"
  const wpat = wordStart(term);
  // a domain query names one organisation: match its domain exactly (or a sub-domain of it) and its name only as a whole word
  const wq = domain ? wholeWord(term) : wpat;
  const subDomain = domain ? `%.${domain.replace(/[\\%_]/g, (c) => `\\${c}`)}` : "";
  const svcWhere = domain
    ? sql<boolean>`(lower(domain) = ${domain} or domain ilike ${subDomain} or name ~* ${wq})`
    : sql<boolean>`(name ~* ${wpat} or domain ~* ${wpat})`;

  const [svcRows, svcCount, provRows, regionRows, provInc, pageInc, facts, factCount, agentRows, agentCount, companyPages] = await Promise.all([
    db.selectFrom("radarServices").select(["id", "name", "category", "domain", "hostingProvider", "hostingRegion", "hostingCountry", "cdn", "dnsProvider", "emailProvider", "analyzedHost"])
      .where("active", "=", true).where("category", "<>", "Cloud region canary")
      .where(svcWhere)
      .orderBy(sql`case when lower(name) = lower(${term}) then 0 when name ilike ${`${term.replace(/[\\%_]/g, "")}%`} then 1 else 2 end`).orderBy("name").limit(lim).execute(),
    db.selectFrom("radarServices").select(sql<number>`count(*)::int`.as("n")).where("active", "=", true).where("category", "<>", "Cloud region canary")
      .where(svcWhere).executeTakeFirst(),
    sql<{ provider: string; layer: string; n: number; sample: string[] }>`
      select provider, layer, count(*)::int as n, (array_agg(name order by name))[1:6] as sample from (
        select hosting_provider as provider, 'hosting' as layer, name from radar_services where active and hosting_provider ~* ${wq}
        union all select cdn, 'cdn', name from radar_services where active and cdn ~* ${wq}
        union all select dns_provider, 'dns', name from radar_services where active and dns_provider ~* ${wq}
        union all select email_provider, 'email', name from radar_services where active and email_provider ~* ${wq}
      ) x where provider is not null group by provider, layer order by n desc limit 40`.execute(db),
    sql<{ region: string; n: number; sample: string[] }>`
      select hosting_region as region, count(*)::int as n, (array_agg(name order by name))[1:6] as sample
      from radar_services where active and hosting_region is not null and hosting_region <> 'global'
      group by hosting_region`.execute(db),
    sql<{ provider: string; title: string; ts: Date; resolved: boolean; link: string | null; severe: boolean }>`
      select provider, title, started_at as ts, resolved_at is not null as resolved, link, severe from provider_incidents
      where started_at > now() - interval '90 days' and (provider ~* ${wq} or ${domain ? sql`false` : sql`title ~* ${wpat}`}) order by started_at desc limit ${opts.quick ? 3 : 8}`.execute(db),
    sql<{ org: string; name: string; ts: Date | null; resolved: boolean; link: string | null; impact: string }>`
      select org, name, coalesce(started_at, created_at) as ts, resolved_at is not null as resolved, shortlink as link, impact from status_incidents
      where coalesce(started_at, created_at) > now() - interval '90 days' and ${domain
        ? sql`(lower(org) = ${domain} or lower(page_host) = ${domain} or page_host ilike ${subDomain})`
        : sql`(org ~* ${wpat} or page_host ~* ${wpat})`}
      order by coalesce(started_at, created_at) desc limit ${opts.quick ? 3 : 8}`.execute(db),
    sql<{ filer: string; ticker: string; customer: string; cslug: string; share: number; periodend: Date; docurl: string }>`
      select * from (
        -- named customers only (no sales channels, anonymised or intra-group entries); spelling variants merged via customer_display
        select distinct on (filer_ticker, customer_display) filer_name as filer, filer_ticker as ticker, customer_display as customer,
          coalesce(lower(customer_ticker), trim(both '-' from regexp_replace(lower(replace(customer_display, '&', ' and ')), '[^a-z0-9]+', '-', 'g'))) as cslug,
          share, period_end as periodend, doc_url as docurl
        from customer_concentration_facts where entry_kind = 'customer' and benchmark = 'revenue'
          and (filer_name ~* ${wq} or customer_display ~* ${wq} or customer_name ~* ${wq} or filer_ticker = ${term.toUpperCase()} or customer_ticker = ${term.toUpperCase()})
        order by filer_ticker, customer_display, period_end desc, share desc
      ) latest order by periodend desc, share desc limit ${opts.quick ? 3 : 10}`.execute(db),
    sql<{ n: number }>`select count(distinct (filer_ticker, customer_display))::int as n from customer_concentration_facts
      where entry_kind = 'customer' and benchmark = 'revenue'
        and (filer_name ~* ${wq} or customer_display ~* ${wq} or customer_name ~* ${wq} or filer_ticker = ${term.toUpperCase()} or customer_ticker = ${term.toUpperCase()})`.execute(db),
    sql<{ name: string; protocol: string; host: string; loc: string | null }>`
      select coalesce(title, name) as name, protocol, host, case when placement in ('city','region') then coalesce(city, region) else network end as loc
      from agent_directory where name ~* ${wq} or title ~* ${wq} or ${domain ? sql`(lower(host) = ${domain} or host ilike ${subDomain})` : sql`host ~* ${wpat}`} order by protocol desc, name limit ${opts.quick ? 3 : 6}`.execute(db),
    sql<{ n: number }>`select count(*)::int as n from agent_directory where name ~* ${wq} or title ~* ${wq} or ${domain ? sql`(lower(host) = ${domain} or host ilike ${subDomain})` : sql`host ~* ${wpat}`}`.execute(db),
    companyDependencies.search(term, opts.quick ? 4 : 8)
      .then((rows) => (domain ? rows.filter((c) => new RegExp(`\\b${reEsc(term)}\\b`, "i").test(c.name)) : rows))
      .catch(() => [] as CompanyIndexEntry[]),
  ]);

  // services with live state
  const base: RadarServiceRow[] = svcRows.map((s) => ({ ...s, state: "unknown" as const, httpStatus: null, latencyMs: null, error: null, uptime24h: null, samples24h: 0 }) as unknown as RadarServiceRow);
  const live = (await withLiveState(base)).rows;
  const services: SearchService[] = live.map((s) => ({
    id: s.id, slug: slugify(s.name), name: s.name, category: s.category, domain: (svcRows.find((r) => r.id === s.id)?.domain) ?? "",
    state: s.state, uptime24h: s.uptime24h, hosting: s.hostingProvider, region: s.hostingRegion, cdn: s.cdn, dns: s.dnsProvider, email: s.emailProvider,
  }));

  // providers: merge layers per provider name, link provider status pages, add 90-day incident counts
  const byName = new Map<string, SearchProvider>();
  for (const r of provRows.rows) {
    if (/^Other \(/.test(r.provider)) continue;
    const p = byName.get(r.provider) ?? { name: r.provider, layers: [], services: 0, sample: [], slug: null, incidents90d: 0, lastIncident: null };
    p.layers.push(r.layer as SearchProvider["layers"][number]);
    p.services = Math.max(p.services, r.n);
    p.sample = [...new Set([...p.sample, ...(r.sample ?? [])])].slice(0, 6);
    const def = statusDirectory.providers.find((d) => (d.hosting?.test(r.provider) || d.cdn?.test(r.provider) || d.dns?.test(r.provider)));
    if (def) p.slug = def.slug;
    byName.set(r.provider, p);
  }
  const providers = [...byName.values()].sort((a, b) => b.services - a.services).slice(0, opts.quick ? 4 : 10);
  if (providers.length) {
    const inc = await sql<{ provider: string; n: number; title: string; ts: Date }>`
      select provider, count(*)::int as n, (array_agg(title order by started_at desc))[1] as title, max(started_at) as ts
      from provider_incidents where started_at > now() - interval '90 days' and provider in (${sql.join(providers.map((p) => p.name))}) group by provider`.execute(db);
    for (const r of inc.rows) { const p = byName.get(r.provider); if (p) { p.incidents90d = r.n; p.lastIncident = { title: r.title, at: new Date(r.ts).toISOString() }; } }
  }

  // regions: by code (eu-central-1) or place name (Frankfurt)
  const ql = q.toLowerCase();
  const regions = q.length >= 3 ? regionRows.rows
    .map((r) => ({ region: r.region, label: worldMap.regions[r.region]?.[2] ?? r.region, services: r.n, sample: r.sample ?? [] }))
    .filter((r) => r.region.toLowerCase().includes(ql) || r.label.toLowerCase().includes(ql))
    .sort((a, b) => b.services - a.services).slice(0, 6) : [];

  const incidents: SearchResult["incidents"] = [
    ...provInc.rows.map((r) => ({ source: "provider status" as const, who: r.provider, title: r.title, at: new Date(r.ts).toISOString(), resolved: r.resolved, link: r.link, severe: r.severe })),
    ...pageInc.rows.filter((r) => r.ts).map((r) => ({ source: "service status page" as const, who: r.org, title: r.name, at: new Date(r.ts!).toISOString(), resolved: r.resolved, link: r.link, severe: r.impact === "major" || r.impact === "critical" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.quick ? 3 : 10);

  // live infrastructure lookup for a domain nobody has scanned yet
  let found: SearchResult["domain"] = null, domainNote: string | null = null;
  if (domain && !opts.quick) {
    if (opts.allowDomainScan === false) domainNote = "Live lookup limit reached for this hour.";
    else {
      try { const r = await vendorScan([domain]); const f = r.findings[0]; if (f.status === "ok") found = { ...f, scannedAt: r.scannedAt }; else domainNote = `${domain} does not resolve.`; }
      catch { domainNote = "Live lookup failed."; }
    }
  }

  return {
    q, services, servicesTotal: svcCount?.n ?? services.length, providers, regions, incidents,
    companies: facts.rows.map((r) => ({ filer: r.filer, ticker: r.ticker, customer: r.customer, customerSlug: r.cslug, share: r.share, periodEnd: new Date(r.periodend).toISOString().slice(0, 10), docUrl: r.docurl })),
    companiesTotal: factCount.rows[0]?.n ?? 0,
    companyPages,
    agents: { total: agentCount.rows[0]?.n ?? 0, sample: agentRows.rows.map((a) => ({ name: a.name, protocol: a.protocol, host: a.host, where: a.loc })) },
    domain: found, domainNote,
  };
}
