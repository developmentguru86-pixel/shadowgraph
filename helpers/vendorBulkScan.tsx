import { randomBytes, createHash } from "crypto";
import { sql } from "kysely";
import { queueTask } from "@runtime/queueTask";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { vendorScan, registrableDomain, scanHost } from "./vendorScan";
import { certOf } from "./customMonitors";
import { rdapOf } from "./radarExpiryJob";
import { slugify } from "./statusDirectory";
import { MAX_VENDORS, summarizePortfolio, type VendorInput, type VendorRow, type PortfolioSummary } from "./vendorList";

/**
 * Bulk ICT third-party scan (up to 300 vendor domains) for DORA / NIS2 registers. Runs as a background task:
 * per vendor the public infrastructure (hosting, cloud region, CDN, DNS, email — vendorScan), the TLS certificate
 * (issuer, expiry) and the domain registration (registrar, expiry via RDAP). Results are stored per scan id
 * (unguessable, shared by link) and deleted after 30 days.
 */

const RETENTION_DAYS = 30;
const PER_CLIENT_PER_HOUR = 4;
const GLOBAL_PER_HOUR = 40;

async function allow(key: string, limit: number) {
  return mppStore.update<boolean>(key, (cur) => {
    const n = Number((cur as { n?: number } | null)?.n ?? 0);
    if (n >= limit) return { op: "noop", result: false };
    return { op: "set", value: { n: n + 1 }, result: true };
  });
}

export async function startVendorScan(input: { vendors: VendorInput[]; company?: string | null; email?: string | null; clientIp: string }) {
  const vendors = input.vendors.slice(0, MAX_VENDORS);
  if (!vendors.length) throw new Error("Add at least one vendor domain.");
  const hour = new Date().toISOString().slice(0, 13);
  const client = createHash("sha256").update(input.clientIp || "unknown").digest("hex").slice(0, 16);
  if (!(await allow(`ratelimit:vendorbulk:${client}:${hour}`, PER_CLIENT_PER_HOUR)) || !(await allow(`ratelimit:vendorbulk:all:${hour}`, GLOBAL_PER_HOUR))) {
    throw new Error("Scan limit reached for this hour. Please try again later.");
  }
  const id = randomBytes(16).toString("base64url");
  await db.insertInto("vendorScans").values({
    id, total: vendors.length, input: JSON.stringify(vendors), company: input.company?.slice(0, 120) || null,
    email: input.email?.slice(0, 200) || null, clientHash: client,
  }).execute();
  await queueTask("vendorBulkScan", { id });
  return { id };
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/** "DigiCert, Inc." and "DigiCert Inc" are the same certificate authority. */
const normalizeIssuer = (s: string | null) => (s ? s.replace(/[,.]?\s+(inc|llc|ltd|limited|gmbh|s\.?a|corp|corporation)\.?$/i, "").replace(/,$/, "").trim() || s : null);

async function scanOne(v: VendorInput, rdapCache: Map<string, Promise<{ expiresAt: Date | null; registrar: string | null } | Error>>): Promise<VendorRow> {
  const base: VendorRow = {
    ...v, status: "error", host: null, hosting: null, hostingCategory: null, region: null, country: null, confidence: null, cdn: null, originHidden: false,
    dns: null, email: null, certIssuer: null, certNotAfter: null, certNote: null, registrar: null, domainExpiresAt: null, domainNote: null,
    evidence: { ips: [], cnames: [], ns: [], mx: [], asn: null }, scannedAt: new Date().toISOString(),
  };
  try {
    const f = v.host ? await scanHost(v.host) : (await vendorScan([v.domain])).findings[0];
    Object.assign(base, {
      status: f.status, host: f.analyzedHost, hosting: f.hosting?.provider ?? null, hostingCategory: f.hosting?.category ?? null,
      region: f.hosting?.region ?? null, country: f.hosting?.country ?? null, confidence: f.hosting?.confidence ?? null,
      cdn: f.cdn, originHidden: f.originHidden, dns: f.dns, email: f.email,
      evidence: { ips: f.evidence.ips, cnames: f.evidence.cnames, ns: f.evidence.ns, mx: f.evidence.mx, asn: f.evidence.asnName },
    });
  } catch (e) {
    base.certNote = null;
    base.domainNote = e instanceof Error ? e.message.slice(0, 120) : "scan failed";
    return base;
  }
  const [cert, reg] = await Promise.all([
    base.host ? certOf(base.host).then((c) => c, (e: unknown) => (e instanceof Error ? e : new Error("no certificate"))) : Promise.resolve(new Error("no reachable host")),
    (() => {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v.domain)) return Promise.resolve(new Error("IP address: no domain registration"));
      const d = registrableDomain(v.domain);
      if (!rdapCache.has(d)) rdapCache.set(d, rdapOf(d).then((r) => r, (e: unknown) => (e instanceof Error ? e : new Error("RDAP failed"))));
      return rdapCache.get(d)!;
    })(),
  ]);
  if (cert instanceof Error) base.certNote = /ssl|tls|handshake|alert/i.test(cert.message) ? "TLS handshake refused" : /timeout/i.test(cert.message) ? "no answer on port 443" : cert.message.slice(0, 60);
  else { base.certIssuer = normalizeIssuer(cert.issuer); base.certNotAfter = cert.notAfter.toISOString(); }
  if (reg instanceof Error) base.domainNote = /no RDAP/.test(reg.message) ? "registry publishes no expiry date (no RDAP)" : reg.message.slice(0, 80);
  else { base.registrar = reg.registrar; base.domainExpiresAt = reg.expiresAt ? reg.expiresAt.toISOString() : null; }
  return base;
}

/** Background task (queueTask "vendorBulkScan"). */
export async function vendorBulkScan(payload: { id: string }) {
  const scan = await db.selectFrom("vendorScans").selectAll().where("id", "=", payload.id).executeTakeFirst();
  if (!scan || scan.status === "done") return;
  const vendors = (typeof scan.input === "string" ? JSON.parse(scan.input) : scan.input) as VendorInput[];
  await db.updateTable("vendorScans").set({ status: "running", updatedAt: new Date() }).where("id", "=", scan.id).execute();
  const results: Array<VendorRow | undefined> = new Array(vendors.length);
  const rdapCache = new Map<string, Promise<{ expiresAt: Date | null; registrar: string | null } | Error>>();
  let done = 0, lastFlush = 0;
  const flush = async (status?: string) => {
    lastFlush = Date.now();
    await db.updateTable("vendorScans")
      .set({ done, results: JSON.stringify(results.filter(Boolean)), updatedAt: new Date(), ...(status ? { status } : {}) })
      .where("id", "=", scan.id).execute();
  };
  try {
    await pool(vendors, 10, async (v, i) => {
      results[i] = await scanOne(v, rdapCache);
      done++;
      if (Date.now() - lastFlush > 2500) await flush();
    });
    await flush("done");
  } catch (e) {
    await db.updateTable("vendorScans").set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "failed", updatedAt: new Date() }).where("id", "=", scan.id).execute();
  }
}

export type VendorScanView = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  total: number;
  done: number;
  createdAt: string;
  company: string | null;
  rows: Array<VendorRow & { radar: { slug: string; name: string; uptime24h: number | null } | null }>;
  summary: PortfolioSummary | null;
  providerIncidents: Array<{ provider: string; incidents90d: number; severe90d: number; lastTitle: string | null; lastAt: string | null }>;
  expiresAt: string;
};

export async function getVendorScan(id: string): Promise<VendorScanView | null> {
  const s = await db.selectFrom("vendorScans").selectAll().where("id", "=", id).executeTakeFirst();
  if (!s) return null;
  const created = new Date(s.createdAt);
  // scans with a paid assessment report are kept 12 months (see radarExpiryJob)
  const expiresAt = new Date(created.getTime() + (s.reportPaidAt ? 365 : RETENTION_DAYS) * 86_400_000).toISOString();
  // a background run lives at most 15 minutes
  const stale = (s.status === "running" || s.status === "queued") && Date.now() - new Date(s.updatedAt).getTime() > 16 * 60_000;
  const rows = ((typeof s.results === "string" ? JSON.parse(s.results) : s.results) ?? []) as VendorRow[];

  // vendors we also monitor on the public radar: link their live status page
  const domains = [...new Set(rows.map((r) => registrableDomain(r.domain)))];
  const radar = domains.length ? await db.selectFrom("radarServices").select(["id", "name", "domain"]).where("active", "=", true).where("domain", "in", domains).execute() : [];
  const up = radar.length ? await sql<{ sid: string; okn: string; n: string }>`
    select service_id as sid, sum(n_ok) as okn, sum(n) as n from radar_service_hourly
    where hour > now() - interval '24 hours' and service_id in (${sql.join(radar.map((r) => r.id))}) group by service_id`.execute(db) : { rows: [] };
  const upMap = new Map(up.rows.map((u) => [u.sid, Number(u.n) ? Number(u.okn) / Number(u.n) : null]));
  const radarByDomain = new Map<string, { slug: string; name: string; uptime24h: number | null }>();
  for (const r of radar) if (!radarByDomain.has(r.domain)) radarByDomain.set(r.domain, { slug: slugify(r.name), name: r.name, uptime24h: upMap.get(r.id) ?? null });

  // public incident history of the big providers the portfolio depends on (from their status feeds)
  const provs = [...new Set(rows.flatMap((r) => [r.hosting, r.cdn, r.dns]).filter((p): p is string => !!p))];
  const inc = provs.length ? await sql<{ provider: string; n: number; sev: number; title: string | null; lastat: Date | null }>`
    select provider, count(*)::int as n, count(*) filter (where severe)::int as sev,
           (array_agg(title order by started_at desc))[1] as title, max(started_at) as lastat
    from provider_incidents where started_at > now() - interval '90 days' and provider in (${sql.join(provs)})
    group by provider order by 2 desc`.execute(db) : { rows: [] };

  return {
    id: s.id,
    status: stale ? "failed" : (s.status as VendorScanView["status"]),
    total: s.total,
    done: s.done,
    createdAt: created.toISOString(),
    company: s.company,
    rows: rows.map((r) => ({ ...r, radar: radarByDomain.get(registrableDomain(r.domain)) ?? null })),
    summary: rows.length ? summarizePortfolio(rows) : null,
    providerIncidents: inc.rows.map((r) => ({ provider: r.provider, incidents90d: r.n, severe90d: r.sev, lastTitle: r.title, lastAt: r.lastat ? new Date(r.lastat).toISOString() : null })),
    expiresAt,
  };
}
