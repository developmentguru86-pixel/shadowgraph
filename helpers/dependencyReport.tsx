import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { dependencyDataset } from "./dependencyDataset";

/**
 * "Who runs the internet?" — a dated, citable snapshot computed once per UTC day from the live radar and the
 * SEC dependency dataset. Everything is derived from stored observations; nothing is estimated or extrapolated.
 */
type Share = { name: string; services: number; share: number };

const FAMILY: Array<[RegExp, string]> = [
  [/Amazon|AWS|CloudFront|Route 53/i, "AWS"], [/Google/i, "Google"], [/Microsoft|Azure/i, "Microsoft"],
  [/Cloudflare/i, "Cloudflare"], [/Akamai/i, "Akamai"], [/Fastly/i, "Fastly"], [/Oracle|Dyn/i, "Oracle"],
  [/Hetzner/i, "Hetzner"], [/OVH/i, "OVHcloud"], [/Imperva/i, "Imperva"], [/Vercel/i, "Vercel"], [/Netlify/i, "Netlify"],
];
const family = (s: string | null) => (s ? FAMILY.find(([rx]) => rx.test(s))?.[1] ?? null : null);

function shares(values: Array<string | null>, total: number, limit = 6): Share[] {
  const m = new Map<string, number>();
  for (const v of values) if (v && !/^Other \(/.test(v)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([name, n]) => ({ name, services: n, share: n / Math.max(total, 1) }))
    .sort((a, b) => b.services - a.services).slice(0, limit);
}

const KEY = "report:who-runs-the-internet:latest";

async function build(day: string) {
  const services = await db.selectFrom("radarServices")
    .select(["id", "name", "category", "hostingProvider", "hostingRegion", "hostingCountry", "cdn", "dnsProvider", "emailProvider"])
    .where("active", "=", true).where("mappedAt", "is not", null).where("category", "!=", "Cloud region canary").execute();
  const n = services.length;

  // blast radius: services that depend on a provider family through hosting, CDN or DNS
  const families = new Map<string, { any: Set<string>; hosting: number; cdn: number; dns: number }>();
  for (const s of services) {
    for (const [layer, v] of [["hosting", s.hostingProvider], ["cdn", s.cdn], ["dns", s.dnsProvider]] as const) {
      const f = family(v);
      if (!f) continue;
      if (!families.has(f)) families.set(f, { any: new Set(), hosting: 0, cdn: 0, dns: 0 });
      const e = families.get(f)!;
      if (!e.any.has(`${s.id}|${layer}`)) { e[layer]++; e.any.add(`${s.id}|${layer}`); }
    }
  }
  const blastRadius = [...families.entries()].map(([name, e]) => {
    const ids = new Set([...e.any].map((x) => x.split("|")[0]));
    return { name, services: ids.size, share: ids.size / n, viaHosting: e.hosting, viaCdn: e.cdn, viaDns: e.dns };
  }).sort((a, b) => b.services - a.services).slice(0, 8);

  // single-vendor stacks: hosting, DNS and (if any) CDN all in the same provider family
  const singleVendor = services.filter((s) => {
    const h = family(s.hostingProvider), d = family(s.dnsProvider), c = s.cdn ? family(s.cdn) : h;
    return h && d && h === d && c === h;
  });
  const behindCdn = services.filter((s) => s.cdn).length;

  const regional = services.filter((s) => s.hostingRegion && s.hostingRegion !== "global");
  const regionCounts = shares(regional.map((s) => `${family(s.hostingProvider) ?? s.hostingProvider} ${s.hostingRegion}`), regional.length, 8);

  const categories = [...new Set(services.map((s) => s.category))].map((c) => {
    const list = services.filter((s) => s.category === c);
    const top = shares(list.map((s) => family(s.hostingProvider) ?? family(s.cdn)), list.length, 1)[0] ?? null;
    return { category: c, services: list.length, topDependency: top?.name ?? null, topShare: top?.share ?? 0 };
  }).filter((c) => c.services >= 8).sort((a, b) => b.topShare - a.topShare);

  // reliability over the last 7 days
  const rel = (await sql<{ checks: number; ok: number; sweeps: number }>`
    SELECT count(*)::int AS checks, count(*) FILTER (WHERE ok)::int AS ok, count(DISTINCT run_id)::int AS sweeps
    FROM radar_checks WHERE checked_at > now() - interval '7 days'`.execute(db)).rows[0];
  const incidents = await db.selectFrom("radarIncidents").select(["layer", "provider", "startedAt", "resolvedAt"])
    .where("startedAt", ">", new Date(Date.now() - 30 * 86_400_000)).orderBy("startedAt", "desc").execute();

  // SEC dependency dataset
  const rows = await dependencyDataset.rows();
  const majority = rows.filter((r) => r.revenueShare >= 0.5).sort((a, b) => b.revenueShare - a.revenueShare);
  const byCustomer = new Map<string, { name: string; suppliers: number }>();
  for (const r of rows) {
    const k = r.customerTicker ?? r.customer;
    byCustomer.set(k, { name: r.customer, suppliers: (byCustomer.get(k)?.suppliers ?? 0) + 1 });
  }
  const hubs = [...byCustomer.entries()].map(([ticker, v]) => ({ ticker, ...v })).sort((a, b) => b.suppliers - a.suppliers).slice(0, 8);

  const report = {
    asOf: day,
    generatedAt: new Date().toISOString(),
    title: "Who runs the internet? Hidden dependencies behind critical services",
    coverage: { servicesMapped: n, behindCdn, sweeps7d: rel.sweeps, probes7d: rel.checks },
    blastRadius,
    hosting: shares(services.map((s) => s.hostingProvider), n),
    cdn: shares(services.map((s) => s.cdn), n),
    dns: shares(services.map((s) => s.dnsProvider), n),
    email: shares(services.map((s) => s.emailProvider), n),
    regions: regionCounts,
    singleVendor: { services: singleVendor.length, share: singleVendor.length / Math.max(n, 1),
      byFamily: shares(singleVendor.map((s) => family(s.hostingProvider)), singleVendor.length, 4),
      examples: singleVendor.slice(0, 12).map((s) => s.name) },
    categories,
    reliability: { uptime7d: rel.checks ? rel.ok / rel.checks : null, incidents30d: incidents.length,
      incidents: incidents.slice(0, 10) },
    sec: { relationships: rows.length, suppliers: new Set(rows.map((r) => r.supplierCik)).size,
      majorityDependent: majority.length,
      topMajority: majority.slice(0, 8).map((r) => ({ supplier: r.supplier, supplierTicker: r.supplierTicker, customer: r.customer, share: r.revenueShare, sourceUrl: r.sourceUrl })),
      hubs },
    method: [
      "Services: public endpoints of APIs, SaaS platforms and websites on the ShadowGraph radar (cloud region canaries excluded).",
      "Infrastructure: DNS resolution of the probed host, network owner via ASN (Team Cymru), AWS and Google Cloud published IP ranges, CNAME patterns; NS records for DNS provider, MX for email.",
      "Blast radius: a service counts for a provider when it depends on that provider for hosting, CDN/edge or DNS. Services behind a CDN have a hidden origin and are counted only through the layers we can see.",
      "Reliability: HTTP probes every 5 minutes from one node in AWS us-east-1 (N. Virginia); HTTP status below 500 counts as reachable.",
      "SEC data: inline XBRL ConcentrationRiskPercentage1 in the latest annual filing of each filer; names from XBRL members or the same filing's text.",
    ],
  };
  return report;
}

export async function dependencyReport(force = false): Promise<Awaited<ReturnType<typeof build>>> {
  const day = new Date().toISOString().slice(0, 10);
  const cached = (await mppStore.get(KEY)) as Awaited<ReturnType<typeof build>> | null;
  if (cached && cached.asOf === day && !force) return cached;
  const report = await build(day);
  await mppStore.put(KEY, report);
  return report;
}
