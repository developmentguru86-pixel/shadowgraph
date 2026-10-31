import { mppStore } from "./mppStore";

/**
 * Fourth-party dependency scan for a vendor list (DORA / NIS2 third-party concentration risk).
 * For each vendor domain, from public internet infrastructure only (no vendor access needed):
 *   hosting  - IP -> network owner (ASN via Team Cymru over DNS-over-HTTPS), AWS/GCP region from published ranges
 *   cdn      - CDN/edge in front of the site (origin hosting is then hidden — reported, never guessed)
 *   dns      - authoritative DNS provider (NS records)
 *   email    - mail provider (MX records)
 * Every finding carries the raw evidence (IPs, ASN, NS, MX, CNAME) and a confidence level.
 */

type Provider = { provider: string; category: "cloud" | "cdn" | "hosting" | "self/other" };
const ASN: Record<string, Provider> = {
  "16509": { provider: "Amazon Web Services", category: "cloud" }, "14618": { provider: "Amazon Web Services", category: "cloud" },
  "8987": { provider: "Amazon Web Services", category: "cloud" },
  "15169": { provider: "Google Cloud", category: "cloud" }, "396982": { provider: "Google Cloud", category: "cloud" }, "19527": { provider: "Google Cloud", category: "cloud" },
  "8075": { provider: "Microsoft Azure", category: "cloud" }, "8068": { provider: "Microsoft Azure", category: "cloud" },
  "31898": { provider: "Oracle Cloud", category: "cloud" }, "36351": { provider: "IBM Cloud", category: "cloud" },
  "45102": { provider: "Alibaba Cloud", category: "cloud" },
  "13335": { provider: "Cloudflare", category: "cdn" }, "209242": { provider: "Cloudflare", category: "cdn" },
  "20940": { provider: "Akamai", category: "cdn" }, "16625": { provider: "Akamai", category: "cdn" }, "33905": { provider: "Akamai", category: "cdn" },
  "21342": { provider: "Akamai", category: "cdn" }, "63949": { provider: "Akamai (Linode)", category: "cloud" },
  "54113": { provider: "Fastly", category: "cdn" }, "60068": { provider: "CDN77", category: "cdn" }, "15133": { provider: "Edgio", category: "cdn" },
  "24940": { provider: "Hetzner", category: "hosting" }, "16276": { provider: "OVHcloud", category: "hosting" },
  "14061": { provider: "DigitalOcean", category: "hosting" }, "20473": { provider: "Vultr", category: "hosting" },
  "51167": { provider: "Contabo", category: "hosting" }, "12876": { provider: "Scaleway", category: "hosting" },
  "8560": { provider: "IONOS", category: "hosting" }, "200130": { provider: "IONOS", category: "hosting" },
  "19551": { provider: "Imperva (Incapsula)", category: "cdn" }, "62041": { provider: "Imperva (Incapsula)", category: "cdn" },
  "32934": { provider: "Meta (own network)", category: "self/other" }, "714": { provider: "Apple (own network)", category: "self/other" },
  "6185": { provider: "Apple (own network)", category: "self/other" }, "2906": { provider: "Netflix (own network)", category: "self/other" },
  "36459": { provider: "GitHub (own network)", category: "self/other" }, "46489": { provider: "Twitch (own network)", category: "self/other" },
  "13414": { provider: "X (own network)", category: "self/other" }, "32590": { provider: "Valve (own network)", category: "self/other" },
  "209": { provider: "Lumen (CenturyLink)", category: "hosting" },
  "3356": { provider: "Lumen (Level 3)", category: "hosting" }, "7018": { provider: "AT&T", category: "hosting" },
  "3320": { provider: "Deutsche Telekom", category: "hosting" }, "8447": { provider: "A1 Telekom Austria", category: "hosting" },
  "9121": { provider: "Türk Telekom", category: "hosting" }, "15897": { provider: "Vodafone Türkiye", category: "hosting" },
  "16125": { provider: "Turkcell (Superonline)", category: "hosting" }, "21859": { provider: "Zenlayer", category: "cdn" },
  "199524": { provider: "G-Core Labs", category: "cdn" }, "202053": { provider: "Upcloud", category: "hosting" },
};
const CNAME_HINTS: Array<[RegExp, string, Provider["category"]]> = [
  [/cloudfront\.net$/, "Amazon Web Services (CloudFront)", "cdn"], [/elb\.amazonaws\.com$/, "Amazon Web Services", "cloud"],
  [/azurefd\.net$|azureedge\.net$/, "Microsoft Azure (Front Door)", "cdn"], [/azurewebsites\.net$|cloudapp\.azure\.com$|trafficmanager\.net$/, "Microsoft Azure", "cloud"],
  [/edgekey\.net$|akamaiedge\.net$|edgesuite\.net$/, "Akamai", "cdn"], [/fastly\.net$|fastlylb\.net$/, "Fastly", "cdn"],
  [/vercel-dns\.com$|vercel\.app$/, "Vercel", "cdn"], [/netlify\.(app|com)$/, "Netlify", "cdn"], [/herokudns\.com$|herokuapp\.com$/, "Heroku (Salesforce, on AWS)", "cloud"],
  [/ghs\.googlehosted\.com$|googleusercontent\.com$/, "Google Cloud", "cloud"], [/cdn\.cloudflare\.net$/, "Cloudflare", "cdn"],
];
const DNS_PROVIDERS: Array<[RegExp, string]> = [
  [/cloudflare\.com$/, "Cloudflare"], [/awsdns/, "AWS Route 53"], [/azure-dns\./, "Azure DNS"], [/googledomains\.com$|google\.com$|ns-cloud-/, "Google Cloud DNS"],
  [/nsone\.net$/, "NS1 (IBM)"], [/ultradns\./, "UltraDNS (Vercara)"], [/dynect\.net$/, "Oracle Dyn"], [/akam\.net$|akamai/, "Akamai Edge DNS"],
  [/domaincontrol\.com$/, "GoDaddy"], [/hetzner\.(com|de)$/, "Hetzner"], [/ovh\.net$/, "OVHcloud"], [/ui-dns\./, "IONOS"], [/dnsimple\.com$/, "DNSimple"],
  [/(^|\.)cscdns\.(net|uk|com)$/, "CSC DNS"], [/(^|\.)a1\.net$/, "A1 Telekom Austria"], [/(^|\.)arz\.at$/, "Accenture TiGital (ARZ)"],
];
const MAIL_PROVIDERS: Array<[RegExp, string]> = [
  [/google\.com$|googlemail\.com$/, "Google Workspace"], [/protection\.outlook\.com$|outlook\.com$/, "Microsoft 365"],
  [/pphosted\.com$|ppe-hosted\.com$/, "Proofpoint"], [/mimecast\.com$/, "Mimecast"], [/messagelabs\.com$/, "Broadcom (Symantec)"],
  [/barracudanetworks\.com$/, "Barracuda"], [/zoho\.(com|eu)$/, "Zoho"], [/amazonaws\.com$/, "Amazon SES"], [/hornetsecurity\.com$/, "Hornetsecurity"],
  [/(^|\.)open\.ch$/, "Open Systems"], [/(^|\.)seppmail\.(ch|cloud)$/, "SEPPmail"], [/(^|\.)iphmx\.com$/, "Cisco Secure Email"],
];

/**
 * Authoritative DNS of a zone. Name servers from two or more independent operators are reported together
 * ("Akamai Edge DNS + UltraDNS (Vercara) + own name servers"): such a zone keeps resolving when one operator fails,
 * so it must never be reported as a single point of failure on that operator.
 */
export const OWN_NS = "own name servers";
function dnsLabel(ns: string[], zone: string): string | null {
  if (!ns.length) return null;
  const own = registrableDomain(zone);
  const ops = [...new Set(ns.map((n) => DNS_PROVIDERS.find(([rx]) => rx.test(n))?.[1]
    ?? (registrableDomain(n) === own ? OWN_NS : `Other (${n.split(".").slice(-2).join(".")})`)))];
  if (ops.length === 1) return ops[0] === OWN_NS ? `Other (${own})` : ops[0];
  return ops.sort((a, b) => (a === OWN_NS ? 1 : b === OWN_NS ? -1 : a.localeCompare(b))).join(" + ");
}

type DohAnswer = { type: number; data: string };
async function doh(name: string, type: string): Promise<DohAnswer[]> {
  for (const base of ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { Answer?: Array<{ type: number; data: string }> };
      return (j.Answer ?? []).map((a) => ({ type: a.type, data: a.data.replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase() }));
    } catch { /* try next resolver */ }
  }
  return [];
}

async function asnOf(ip: string): Promise<{ asn: string; name: string; country: string } | null> {
  const key = `cache:asn:${ip}`;
  const cached = (await mppStore.get(key)) as { asn: string; name: string; country: string } | null;
  if (cached) return cached;
  const rev = ip.split(".").reverse().join(".");
  const t = (await doh(`${rev}.origin.asn.cymru.com`, "TXT"))[0]?.data ?? "";
  const asn = t.split("|")[0]?.trim().split(" ")[0];
  if (!asn) return null;
  const n = (await doh(`AS${asn}.asn.cymru.com`, "TXT"))[0]?.data ?? "";
  const out = { asn, name: n.split("|").pop()?.trim() ?? "", country: (t.split("|")[2] ?? "").trim().toUpperCase() };
  await mppStore.put(key, out);
  return out;
}

// ---- AWS / GCP region ranges (in-memory, refreshed every 12h) ----
let ranges: { at: number; nets: Array<{ base: number; mask: number; label: string }> } | null = null;
const ipInt = (ip: string) => ip.split(".").reduce((a, o) => (a * 256 + Number(o)) >>> 0, 0);
async function regionOf(ip: string): Promise<string | null> {
  if (!ranges || Date.now() - ranges.at > 12 * 3600_000) {
    const nets: Array<{ base: number; mask: number; label: string }> = [];
    const add = (cidr: string, label: string) => {
      const [b, l] = cidr.split("/"); const len = Number(l);
      const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
      nets.push({ base: (ipInt(b) & mask) >>> 0, mask, label });
    };
    try {
      const aws = (await (await fetch("https://ip-ranges.amazonaws.com/ip-ranges.json", { signal: AbortSignal.timeout(10_000) })).json()) as { prefixes: Array<{ ip_prefix: string; region: string; service: string }> };
      for (const p of aws.prefixes) if (p.service === "EC2" || p.service === "CLOUDFRONT" || p.service === "AMAZON") add(p.ip_prefix, p.region === "GLOBAL" ? "global edge" : p.region);
    } catch { /* region stays unknown */ }
    try {
      const gcp = (await (await fetch("https://www.gstatic.com/ipranges/cloud.json", { signal: AbortSignal.timeout(10_000) })).json()) as { prefixes: Array<{ ipv4Prefix?: string; scope: string }> };
      for (const p of gcp.prefixes) if (p.ipv4Prefix) add(p.ipv4Prefix, p.scope);
    } catch { /* region stays unknown */ }
    nets.sort((a, b) => b.mask - a.mask); // most specific first
    ranges = { at: Date.now(), nets };
  }
  const x = ipInt(ip);
  return ranges.nets.find((n) => ((x & n.mask) >>> 0) === n.base)?.label ?? null;
}

export type VendorFinding = {
  domain: string;
  status: "ok" | "no_dns";
  /** the host whose infrastructure was analysed (api./app./... preferred over the marketing site) */
  analyzedHost: string | null;
  hosting: { provider: string; category: string; region: string | null; country: string | null; asn: string | null; confidence: "high" | "medium" | "low" } | null;
  cdn: string | null;
  originHidden: boolean;
  dns: string | null;
  email: string | null;
  evidence: { ips: string[]; cnames: string[]; ns: string[]; mx: string[]; asnName: string | null };
};

export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

async function scanDomain(domain: string, explicitHosts?: string[]): Promise<VendorFinding> {
  const cacheKey = `cache:vendorscan:v6:${domain}${explicitHosts ? `|${explicitHosts.join(",")}` : ""}`;
  const cached = (await mppStore.get(cacheKey)) as { at: number; f: VendorFinding } | null;
  if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.f;

  // Service hosts first: for a fintech, the vendor's API / app endpoint matters more than its marketing site.
  const SERVICE = ["api", "app", "checkout", "portal", "login"];
  const hostNames = explicitHosts ?? [...SERVICE.map((s) => `${s}.${domain}`), domain, `www.${domain}`];
  const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipOnly = IP.test(domain);
  const [hostAnswers, nsOwn, mxAns] = await Promise.all([
    Promise.all(hostNames.map((h) => (IP.test(h) ? Promise.resolve([{ type: 1, data: h }]) : doh(h, "A")))),
    ipOnly ? Promise.resolve([] as DohAnswer[]) : doh(domain, "NS"), ipOnly ? Promise.resolve([] as DohAnswer[]) : doh(domain, "MX"),
  ]);
  // a sub-domain (meine.bank99.at) has no NS records of its own: its name servers are those of the parent zone
  let nsAns = nsOwn.filter((a) => a.type === 2);
  for (let parts = domain.split("."); !ipOnly && !nsAns.length && parts.length > 2; ) {
    parts = parts.slice(1);
    nsAns = (await doh(parts.join("."), "NS")).filter((a) => a.type === 2);
  }
  const resolved = hostNames.map((h, i) => ({ host: h, ans: hostAnswers[i] })).filter((x) => x.ans.some((a) => a.type === 1));
  const primary = resolved[0] ?? null; // first service host that resolves, else apex/www
  const all = hostAnswers.flat();
  const ips = [...new Set((primary?.ans ?? []).filter((a) => a.type === 1).map((a) => a.data))].slice(0, 4);
  const cnames = [...new Set((primary?.ans ?? all).filter((a) => a.type === 5).map((a) => a.data))];
  const ns = nsAns.map((a) => a.data);
  const mx = mxAns.map((a) => a.data.split(" ").pop() ?? "").filter(Boolean);

  const finding: VendorFinding = {
    domain, status: primary ? "ok" : "no_dns", analyzedHost: primary?.host ?? null,
    hosting: null, cdn: null, originHidden: false,
    dns: dnsLabel(ns, domain),
    email: mx.length ? (MAIL_PROVIDERS.find(([rx]) => mx.some((m) => rx.test(m)))?.[1] ?? `Other (${mx[0].split(".").slice(-2).join(".")})`) : null,
    evidence: { ips, cnames, ns, mx, asnName: null },
  };

  const cnameHit = CNAME_HINTS.find(([rx]) => cnames.some((c) => rx.test(c)));
  const ip = ips[0];
  const as = ip ? await asnOf(ip) : null;
  finding.evidence.asnName = as?.name ?? null;
  const known = as ? ASN[as.asn] : undefined;
  const region = ip && known?.category === "cloud" ? await regionOf(ip) : null;

  if (known?.category === "cdn" || cnameHit?.[2] === "cdn" || region === "global edge") {
    finding.cdn = cnameHit?.[2] === "cdn" ? cnameHit[1] : region === "global edge" ? "Amazon Web Services (CloudFront)" : known!.provider;
    finding.originHidden = true;
  }
  if (known && known.category !== "cdn") {
    finding.hosting = {
      provider: known.provider, category: known.category, region: region === "global edge" ? null : region,
      country: as?.country ?? null, asn: as?.asn ?? null,
      // behind the provider's own CDN the origin is very likely, but not provably, on the same cloud
      confidence: finding.originHidden ? "medium" : "high",
    };
  } else if (cnameHit && cnameHit[2] === "cloud") {
    finding.hosting = { provider: cnameHit[1], category: "cloud", region: null, country: null, asn: as?.asn ?? null, confidence: "medium" };
  } else if (as && !finding.originHidden) {
    const raw = as.name.split(" - ").pop()?.replace(/,.*$/, "").trim() || `AS${as.asn}`;
    const pretty = raw.toLowerCase().replace(/\b(inc|ltd|llc|gmbh|ag|sa|bv|plc)\b\.?/g, "").trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || raw;
    finding.hosting = { provider: pretty, category: "self/other", region: null, country: as.country || null, asn: as.asn, confidence: "medium" };
  }
  await mppStore.put(cacheKey, { at: Date.now(), f: finding });
  return finding;
}

const TWO_LEVEL_TLDS = /\.(co|com|org|net|ac|gv|or)\.(uk|at|au|jp|nz|za|br|tr|in)$/;
export function registrableDomain(host: string) {
  const parts = host.toLowerCase().split(".");
  return parts.slice(TWO_LEVEL_TLDS.test(host) ? -3 : -2).join(".");
}

/** Infrastructure of one exact host (used by the outage radar for its probe targets). */
export async function scanHost(host: string): Promise<VendorFinding> {
  return scanDomain(/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : registrableDomain(host), [host]);
}

export type ScanSummary = {
  vendors: number;
  concentration: Array<{ layer: "hosting" | "cloud region" | "cdn" | "dns" | "email"; provider: string; vendors: string[]; share: number }>;
  scenarios: string[];
  hiddenOrigins: string[];
};

function summarize(f: VendorFinding[]): ScanSummary {
  const ok = f.filter((x) => x.status === "ok");
  const groups = new Map<string, { layer: ScanSummary["concentration"][number]["layer"]; provider: string; vendors: Set<string> }>();
  const add = (layer: ScanSummary["concentration"][number]["layer"], provider: string | null | undefined, v: string) => {
    if (!provider) return;
    const k = `${layer}|${provider}`;
    if (!groups.has(k)) groups.set(k, { layer, provider, vendors: new Set() });
    groups.get(k)!.vendors.add(v);
  };
  for (const x of ok) {
    add("hosting", x.hosting?.provider, x.domain);
    if (x.hosting?.region && x.hosting.region !== "global edge") add("cloud region", `${x.hosting.provider} ${x.hosting.region}`, x.domain);
    add("cdn", x.cdn, x.domain);
    add("dns", x.dns, x.domain);
    add("email", x.email, x.domain);
  }
  const n = Math.max(ok.length, 1);
  const concentration = [...groups.values()]
    .map((g) => ({ layer: g.layer, provider: g.provider, vendors: [...g.vendors].sort(), share: g.vendors.size / n }))
    .filter((g) => g.vendors.length >= 2 && !/^Other \(/.test(g.provider))
    .sort((a, b) => b.vendors.length - a.vendors.length);
  const label: Record<string, string> = { hosting: "hosting", "cloud region": "hosting region", cdn: "CDN / edge", dns: "DNS", email: "email" };
  const scenarios = concentration.slice(0, 5).map((c) =>
    `If ${c.provider} has an outage, ${c.vendors.length} of ${ok.length} vendors lose their ${label[c.layer]} at the same time: ${c.vendors.join(", ")}.`);
  return { vendors: f.length, concentration, scenarios, hiddenOrigins: ok.filter((x) => x.originHidden && !x.hosting).map((x) => x.domain) };
}

export async function vendorScan(domains: string[]): Promise<{ findings: VendorFinding[]; summary: ScanSummary; scannedAt: string }> {
  const findings = await Promise.all(domains.map((d) => scanDomain(d)));
  return { findings, summary: summarize(findings), scannedAt: new Date().toISOString() };
}
