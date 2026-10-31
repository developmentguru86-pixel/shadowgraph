/**
 * Vendor (ICT third-party) list: parsing the uploaded list, the per-vendor result row, the portfolio summary and the
 * CSV export. Pure functions only (unit-tested); the scanning itself lives in vendorBulkScan.
 */

export const MAX_VENDORS = 300;

/**
 * host: the exact endpoint to analyse (a host name or a public IPv4 address). Set when the list names a host column, an IP,
 * or a sub-domain such as meine.bank99.at; without it the scanner prefers the vendor's api./app./login. hosts.
 */
export type VendorInput = { name: string; domain: string; fn: string | null; critical: boolean; host?: string | null };

export type VendorRow = VendorInput & {
  status: "ok" | "no_dns" | "error";
  host: string | null;
  hosting: string | null;
  hostingCategory: string | null;
  region: string | null;
  country: string | null;
  confidence: string | null;
  cdn: string | null;
  originHidden: boolean;
  dns: string | null;
  email: string | null;
  certIssuer: string | null;
  certNotAfter: string | null;
  certNote: string | null;
  registrar: string | null;
  domainExpiresAt: string | null;
  domainNote: string | null;
  evidence: { ips: string[]; cnames: string[]; ns: string[]; mx: string[]; asn: string | null };
  scannedAt: string;
};

const DOMAIN_RX = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function cleanDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0].replace(/\.$/, "");
  return DOMAIN_RX.test(d) ? d : null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const PRIVATE_IP = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];
export const isIpv4 = (s: string) => IPV4.test(s);
/** Exact host from a cell: host name (www. kept) or a public IPv4 address. Private and reserved addresses are refused. */
export function cleanHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:\s]/)[0].replace(/\.$/, "");
  if (IPV4.test(h)) return PRIVATE_IP.some((rx) => rx.test(h)) ? null : h;
  return DOMAIN_RX.test(h) ? h : null;
}
const TWO_LEVEL = /\.(co|com|org|net|ac|gv|or)\.(uk|at|au|jp|nz|za|br|tr|in)$/;
const isSubdomain = (d: string) => d.split(".").length > (TWO_LEVEL.test(d) ? 3 : 2);

const TRUE = /^(1|y|yes|ja|j|true|x|critical|kritisch|wichtig|important|high|hoch)$/i;

/**
 * Accepts CSV/TSV/semicolon text or one domain per line. Recognised header names (any order):
 * name|vendor|anbieter|dienstleister, domain|website|url, function|funktion|service|leistung, critical|kritisch.
 * Without a header, a cell that looks like a domain/URL is the domain, the first other cell the name,
 * the next the function, and a yes/ja/x cell marks it critical.
 */
export function parseVendorList(text: string): { vendors: VendorInput[]; rejected: string[]; truncated: number } {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { vendors: [], rejected: [], truncated: 0 };
  const sep = [";", "\t", ","].map((s) => [s, lines.slice(0, 5).reduce((n, l) => n + l.split(s).length - 1, 0)] as const).sort((a, b) => b[1] - a[1])[0];
  const split = (l: string) => (sep[1] > 0 ? splitCsv(l, sep[0]) : [l]).map((c) => c.trim().replace(/^"|"$/g, "").trim());
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const col = (rx: RegExp) => first.findIndex((c) => rx.test(c));
  const hdr = { name: col(/^(name|vendor|anbieter|dienstleister|provider|lieferant|company|firma)/), domain: col(/^(domain|website|url|web|homepage)/), fn: col(/^(function|funktion|service|leistung|zweck|purpose|category|kategorie)/), crit: col(/^(critical|kritisch|criticality|kritikalit|important|wichtig)/), host: col(/^(host|hostname|endpoint|endpunkt|server|ip|fqdn)/) };
  const hasHeader = hdr.domain >= 0 || hdr.host >= 0 || (hdr.name >= 0 && first.every((c) => !cleanDomain(c)));
  const rows = hasHeader ? lines.slice(1) : lines;

  const seen = new Set<string>();
  const vendors: VendorInput[] = [];
  const rejected: string[] = [];
  let truncated = 0;
  for (const line of rows) {
    const cells = split(line);
    let domain: string | null = null, host: string | null = null, name = "", fn: string | null = null, critical = false;
    if (hasHeader && (hdr.domain >= 0 || hdr.host >= 0)) {
      domain = hdr.domain >= 0 ? cleanDomain(cells[hdr.domain] ?? "") : null;
      host = hdr.host >= 0 ? cleanHost(cells[hdr.host] ?? "") : null;
      if (!domain && !host && hdr.domain >= 0) host = cleanHost(cells[hdr.domain] ?? ""); // an IP in the domain column
      name = hdr.name >= 0 ? cells[hdr.name] ?? "" : "";
      fn = hdr.fn >= 0 ? cells[hdr.fn] || null : null;
      critical = hdr.crit >= 0 ? TRUE.test(cells[hdr.crit] ?? "") : false;
    } else {
      const ii = cells.findIndex((c) => IPV4.test(c.trim()));
      if (ii >= 0) host = cleanHost(cells[ii]);
      const di = cells.findIndex((c, i) => i !== ii && cleanDomain(c) && /[.]/.test(c));
      domain = di >= 0 ? cleanDomain(cells[di]) : null;
      const rest = cells.filter((_, i) => i !== di && i !== ii);
      const flagIdx = rest.findIndex((c) => TRUE.test(c));
      if (flagIdx >= 0) { critical = true; rest.splice(flagIdx, 1); }
      name = rest[0] ?? "";
      fn = rest[1] || null;
    }
    // a named sub-domain (meine.bank99.at) is the endpoint itself, not a company domain to search for api./app. hosts
    if (!host && domain && isSubdomain(domain)) host = domain;
    if (!domain && host) domain = host;
    if (!domain) { rejected.push(line.slice(0, 120)); continue; }
    const key = host ?? domain;
    if (seen.has(key)) continue;
    if (vendors.length >= MAX_VENDORS) { truncated++; continue; }
    seen.add(key);
    vendors.push({ name: (name || host || domain).slice(0, 120), domain, fn: fn ? fn.slice(0, 120) : null, critical, ...(host ? { host } : {}) });
  }
  return { vendors, rejected: rejected.slice(0, 50), truncated };
}

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export type Layer = "hosting" | "cloud region" | "cdn" | "dns" | "email" | "certificate authority";
export type PortfolioSummary = {
  vendors: number;
  scanned: number;
  unresolved: number;
  critical: number;
  hiddenOrigins: number;
  distinctHosting: number;
  layers: Array<{ layer: Layer; providers: Array<{ provider: string; vendors: number; critical: number; share: number; names: string[] }> }>;
  scenarios: Array<{ provider: string; layer: Layer; vendors: number; critical: number; share: number; names: string[] }>;
  certsExpiring: Array<{ name: string; domain: string; days: number; date: string }>;
  domainsExpiring: Array<{ name: string; domain: string; days: number; date: string }>;
};

const OTHER = /^Other \(/;
/**
 * Email belongs to an organisation's mail setup, not to an endpoint: several rows of one organisation (api., banking., www.,
 * or two of its domains with the same mail exchangers) are one mail dependency. DNS is deliberately NOT merged: three critical
 * services in one zone on one DNS operator do fail together.
 */
const ZONE_LAYERS = new Set<Layer>(["email"]);
export const mailSetupOf = (r: Pick<VendorRow, "domain" | "evidence">) =>
  r.evidence?.mx?.length ? [...r.evidence.mx].map((m) => m.toLowerCase()).sort().join(",") : r.domain.toLowerCase().split(".").slice(-2).join(".");
/**
 * The company behind a row. "Internex - Website" and "Internex - Kundenbereich" are two services of one vendor (name convention
 * "Company - Service"); without that convention, rows on the same registrable domain are one vendor (two "AWS" lines on aws.amazon.com).
 */
export const companyOf = (name: string, domain?: string | null) =>
  name.includes(" - ") || !domain ? name.split(" - ")[0].trim().toLowerCase() : domain.toLowerCase().split(".").slice(-2).join(".");
/** Concentration counts companies (email: mail setups), never rows: ten rows of three companies are three dependencies. */
const unitOf = (layer: Layer, r: VendorRow) => (ZONE_LAYERS.has(layer) ? mailSetupOf(r) : companyOf(r.name, r.domain));
export function summarizePortfolio(rows: VendorRow[], now = new Date()): PortfolioSummary {
  const ok = rows.filter((r) => r.status === "ok");
  const n = Math.max(ok.length, 1);
  const layerOf: Array<[Layer, (r: VendorRow) => string | null]> = [
    ["hosting", (r) => r.hosting],
    ["cloud region", (r) => (r.hosting && r.region && r.region !== "global" ? `${r.hosting} ${r.region}` : null)],
    ["cdn", (r) => r.cdn],
    ["dns", (r) => r.dns],
    ["email", (r) => r.email],
    ["certificate authority", (r) => r.certIssuer],
  ];
  const layers = layerOf.map(([layer, get]) => {
    const m = new Map<string, VendorRow[]>();
    for (const r of ok) { const p = get(r); if (p) m.set(p, [...(m.get(p) ?? []), r]); }
    const providers = [...m.entries()]
      .map(([provider, rs]) => {
        const count = (xs: VendorRow[]) => new Set(xs.map((r) => unitOf(layer, r))).size;
        const zones = new Set(ok.map((r) => unitOf(layer, r))).size || n;
        return { provider, vendors: count(rs), critical: count(rs.filter((r) => r.critical)), share: count(rs) / Math.max(zones, 1), names: rs.map((r) => r.name).sort((a, b) => a.localeCompare(b)) };
      })
      .sort((a, b) => b.vendors - a.vendors || b.critical - a.critical);
    return { layer, providers };
  });
  const scenarios = layers
    .filter((l) => l.layer !== "certificate authority")
    .flatMap((l) => l.providers.filter((p) => p.vendors >= 2 && !OTHER.test(p.provider)).map((p) => ({ ...p, layer: l.layer })))
    .sort((a, b) => b.critical - a.critical || b.vendors - a.vendors)
    .slice(0, 8);
  const days = (iso: string | null) => (iso ? Math.floor((new Date(iso).getTime() - now.getTime()) / 86_400_000) : null);
  const soon = (get: (r: VendorRow) => string | null, limit: number) => ok
    .map((r) => ({ name: r.name, domain: r.domain, date: get(r), days: days(get(r)) }))
    .filter((x): x is { name: string; domain: string; date: string; days: number } => x.days != null && x.date != null && x.days <= limit)
    .sort((a, b) => a.days - b.days);
  return {
    vendors: rows.length,
    scanned: ok.length,
    unresolved: rows.length - ok.length,
    critical: rows.filter((r) => r.critical).length,
    hiddenOrigins: ok.filter((r) => r.originHidden && !r.hosting).length,
    distinctHosting: new Set(ok.map((r) => r.hosting).filter(Boolean)).size,
    layers,
    scenarios,
    certsExpiring: soon((r) => r.certNotAfter, 30),
    domainsExpiring: soon((r) => r.domainExpiresAt, 60),
  };
}

const CSV_COLS: Array<[string, (r: VendorRow) => string | number | boolean | null]> = [
  ["vendor_name", (r) => r.name], ["vendor_domain", (r) => r.domain], ["function", (r) => r.fn], ["critical", (r) => (r.critical ? "yes" : "no")],
  ["scan_status", (r) => r.status], ["analysed_host", (r) => r.host],
  ["hosting_provider", (r) => r.hosting], ["hosting_type", (r) => r.hostingCategory], ["cloud_region", (r) => r.region], ["network_owner_country", (r) => r.country],
  ["hosting_confidence", (r) => r.confidence], ["cdn_edge", (r) => r.cdn], ["origin_hidden_behind_cdn", (r) => (r.originHidden ? "yes" : "no")],
  ["dns_provider", (r) => r.dns], ["email_provider", (r) => r.email], ["certificate_authority", (r) => r.certIssuer], ["certificate_expires", (r) => r.certNotAfter?.slice(0, 10) ?? null],
  ["domain_registrar", (r) => r.registrar], ["domain_expires", (r) => r.domainExpiresAt?.slice(0, 10) ?? null], ["domain_note", (r) => r.domainNote],
  ["evidence_ips", (r) => r.evidence.ips.join(" ")], ["evidence_asn", (r) => r.evidence.asn], ["evidence_nameservers", (r) => r.evidence.ns.join(" ")],
  ["evidence_mx", (r) => r.evidence.mx.join(" ")], ["evidence_cnames", (r) => r.evidence.cnames.join(" ")], ["scanned_at", (r) => r.scannedAt],
];
const cell = (v: string | number | boolean | null) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formula injection when opened in Excel
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function vendorCsv(rows: VendorRow[]): string {
  return "﻿" + [CSV_COLS.map(([h]) => h).join(","), ...rows.map((r) => CSV_COLS.map(([, g]) => cell(g(r))).join(","))].join("\r\n") + "\r\n";
}
