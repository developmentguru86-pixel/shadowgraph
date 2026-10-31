import tls from "node:tls";
import { Resolver } from "node:dns/promises";
import { randomUUID } from "crypto";
import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { scanHost } from "./vendorScan";

/**
 * Private custom monitors for alert subscribers (max 10 per subscription). Kept apart from the public radar:
 * never shown on public pages, never part of incident detection or reports.
 * Safety: public http(s) hostnames only; every resolved A record must be public (blocks SSRF / DNS rebinding to
 * private ranges) — checked on add and on every weekly re-map; redirects are not followed.
 */
const MAX_PER_SUB = 10;
const UA = { "user-agent": "ShadowGraph-Monitor/1.0 (+https://shadowalpha.online/alerts)" };
/**
 * reachable: any HTTP answer counts as up (report endpoints, where "/" of an API may legitimately answer 502).
 * dns:<ns1>,<ns2>: the host name must resolve at one of these authoritative name servers (report DNS checks).
 */
export type Expect = "any_lt_500" | "success" | "reachable" | `dns:${string}`;

const PRIVATE = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];

async function resolveA(host: string): Promise<string[]> {
  for (const base of ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(6000) });
      const j = (await r.json()) as { Answer?: Array<{ type: number; data: string }> };
      return (j.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
    } catch { /* next resolver */ }
  }
  return [];
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("Enter a full URL, e.g. https://api.yourcompany.com/health"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https URLs can be monitored");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new Error("Only ports 80, 443, 8080 and 8443 are allowed");
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$)/.test(h)) throw new Error("Use a public hostname, not an IP address or internal name");
  const ips = await resolveA(h);
  if (!ips.length) throw new Error(`${h} does not resolve to a public IPv4 address`);
  if (ips.some((ip) => PRIVATE.some((rx) => rx.test(ip)))) throw new Error(`${h} resolves to a private address and cannot be monitored`);
  return u;
}

/** Asks the authoritative name servers directly (not a cache): up when at least one of them answers with an address. */
async function probeDns(url: string, expect: string) {
  const host = new URL(url).hostname;
  const servers = expect.slice(4).split(",").map((s) => s.trim().replace(/\.$/, "")).filter(Boolean).slice(0, 4);
  const t0 = Date.now();
  const ips = (await Promise.all(servers.map((s) => resolveA(s)))).flat().filter((ip) => !PRIVATE.some((rx) => rx.test(ip))).slice(0, 6);
  if (!ips.length) return { ok: false, status: null, latency: null, error: `DNS: name servers ${servers.join(", ")} not resolvable` };
  let last = "no answer";
  for (const ip of ips) {
    const r = new Resolver({ timeout: 3000, tries: 1 });
    r.setServers([ip]);
    try {
      const a = await r.resolve4(host);
      if (a.length) return { ok: true, status: null, latency: Date.now() - t0, error: null };
    } catch (e) { last = (e as { code?: string }).code ?? (e instanceof Error ? e.message : "error"); }
  }
  return { ok: false, status: null, latency: null, error: `DNS: no answer for ${host} from ${servers.join(", ")} (${last})`.slice(0, 200) };
}

async function probe(url: string, expect: string) {
  if (expect.startsWith("dns:")) return probeDns(url, expect);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: UA, signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel().catch(() => undefined);
    const ok = expect === "success" ? r.status >= 200 && r.status < 400 : expect === "reachable" ? r.status > 0 : r.status > 0 && r.status < 500;
    return { ok, status: r.status, latency: Date.now() - t0, error: ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "timeout after 10 s" : e.message) : String(e);
    return { ok: false, status: null, latency: null, error: msg.slice(0, 200) };
  }
}

export function certOf(host: string, port = 443): Promise<{ notAfter: Date; issuer: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      if (!c?.valid_to) return reject(new Error("no certificate"));
      resolve({ notAfter: new Date(c.valid_to), issuer: c.issuer ? String(c.issuer.O || c.issuer.CN || "") || null : null });
    });
    socket.on("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("error", reject);
  });
}

async function mapInfra(id: string, url: string, previous?: Record<string, string | null>) {
  const u = await assertPublicUrl(url); // re-checked on every re-map: blocks later DNS rebinding to private ranges
  const f = await scanHost(u.hostname);
  const next = { hostingProvider: f.hosting?.provider ?? null, hostingRegion: f.hosting?.region ?? null, cdn: f.cdn, dnsProvider: f.dns, emailProvider: f.email };
  if (previous) {
    const fields: Array<[keyof typeof next, string]> = [["hostingProvider", "hosting_provider"], ["hostingRegion", "hosting_region"], ["cdn", "cdn"], ["dnsProvider", "dns_provider"], ["emailProvider", "email_provider"]];
    const changes = fields.filter(([k]) => previous[k] && next[k] && previous[k] !== next[k]).map(([k, field]) => ({ serviceId: id, field, oldValue: previous[k] as string, newValue: next[k] as string }));
    if (changes.length) await db.insertInto("radarChanges").values(changes).execute();
  }
  await db.updateTable("customMonitors").set({ ...next, hostingCountry: f.hosting?.country ?? null, analyzedHost: f.analyzedHost, mappedAt: sql`now()` }).where("id", "=", id).execute();
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export const customMonitors = {
  max: MAX_PER_SUB,

  async add(subscriptionId: string, input: { name: string; url: string; expect: Expect }, limit = MAX_PER_SUB) {
    const count = await db.selectFrom("customMonitors").select(({ fn }) => fn.countAll<number>().as("n")).where("subscriptionId", "=", subscriptionId).where("active", "=", true).executeTakeFirst();
    if (Number(count?.n ?? 0) >= limit) throw new Error(`Your plan monitors up to ${limit} own endpoints`);
    const u = await assertPublicUrl(input.url);
    const id = `cm_${randomUUID()}`;
    const name = input.name.trim().slice(0, 80) || u.hostname;
    await db.insertInto("customMonitors").values({ id, subscriptionId, name, url: u.toString(), expect: input.expect }).execute();
    // instant feedback: first probe, infrastructure map and certificate right away
    const p = await probe(u.toString(), input.expect);
    await db.insertInto("customChecks").values({ monitorId: id, ok: p.ok, httpStatus: p.status, latencyMs: p.latency, error: p.error }).execute();
    await db.updateTable("customMonitors").set({ lastOk: p.ok, lastStatus: p.status, lastLatencyMs: p.latency, lastError: p.error, lastCheckedAt: sql`now()`, consecutiveFailures: p.ok ? 0 : 1 }).where("id", "=", id).execute();
    await mapInfra(id, u.toString()).catch(() => undefined);
    if (u.protocol === "https:") {
      try { const c = await certOf(u.hostname, u.port ? Number(u.port) : 443); await db.updateTable("customMonitors").set({ certNotAfter: c.notAfter, certIssuer: c.issuer, certCheckedAt: sql`now()` }).where("id", "=", id).execute(); } catch { /* reported as unknown */ }
    }
    return id;
  },

  async remove(subscriptionId: string, monitorId: string) {
    await db.updateTable("customMonitors").set({ active: false }).where("id", "=", monitorId).where("subscriptionId", "=", subscriptionId).execute();
  },

  async list(subscriptionId: string) {
    const rows = await db.selectFrom("customMonitors").selectAll().where("subscriptionId", "=", subscriptionId).where("active", "=", true).orderBy("createdAt").execute();
    if (!rows.length) return [];
    const stats = (await sql<{ id: string; uptime: number; p50: number | null; n: number }>`
      SELECT monitor_id AS id, avg(CASE WHEN ok THEN 1.0 ELSE 0.0 END)::float AS uptime,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::float AS p50, count(*)::int AS n
      FROM custom_checks WHERE monitor_id IN (${sql.join(rows.map((r) => r.id))}) AND checked_at > now() - interval '24 hours' GROUP BY monitor_id`.execute(db)).rows;
    const by = new Map(stats.map((s) => [s.id, s]));
    return rows.map((r) => ({
      id: r.id, name: r.name, url: r.url, expect: r.expect, ok: r.lastOk, status: r.lastStatus, latencyMs: r.lastLatencyMs, error: r.lastError,
      checkedAt: r.lastCheckedAt, downSince: r.downSince, uptime24h: by.get(r.id)?.uptime ?? null, p50Ms: by.get(r.id)?.p50 ?? null, samples24h: by.get(r.id)?.n ?? 0,
      hostingProvider: r.hostingProvider, hostingRegion: r.hostingRegion, cdn: r.cdn, dnsProvider: r.dnsProvider,
      certNotAfter: r.certNotAfter, certIssuer: r.certIssuer, domain: r.domain, domainExpiresAt: r.domainExpiresAt,
    }));
  },

  /** Every radar sweep: probe all active monitors of active subscriptions, update state, re-map stale infra. */
  async probeAll() {
    const monitors = await db.selectFrom("customMonitors as m").innerJoin("alertSubscriptions as s", "s.id", "m.subscriptionId")
      .selectAll("m").where("m.active", "=", true).where("s.status", "=", "active").execute();
    if (!monitors.length) return { probed: 0 };
    await pool(monitors, 20, async (m) => {
      const p = await probe(m.url, m.expect);
      const failures = p.ok ? 0 : m.consecutiveFailures + 1;
      if (p.ok && m.downSince) await mppStore.put(`cm:recovered:${m.id}`, { downSince: new Date(m.downSince).toISOString(), at: new Date().toISOString() });
      await db.insertInto("customChecks").values({ monitorId: m.id, ok: p.ok, httpStatus: p.status, latencyMs: p.latency, error: p.error }).execute();
      await db.updateTable("customMonitors").set({
        lastOk: p.ok, lastStatus: p.status, lastLatencyMs: p.latency, lastError: p.error, lastCheckedAt: sql`now()`, consecutiveFailures: failures,
        downSince: p.ok ? null : failures >= 2 ? (m.downSince ?? sql`now()`) : m.downSince,
      }).where("id", "=", m.id).execute();
    });
    const stale = monitors.filter((m) => !m.mappedAt || Date.now() - new Date(m.mappedAt).getTime() > 7 * 86_400_000).slice(0, 25);
    await pool(stale, 5, async (m) => {
      try { await mapInfra(m.id, m.url, m.mappedAt ? { hostingProvider: m.hostingProvider, hostingRegion: m.hostingRegion, cdn: m.cdn, dnsProvider: m.dnsProvider, emailProvider: m.emailProvider } : undefined); }
      catch (e) { // host now resolves privately or vanished: stop monitoring it rather than probe an internal target
        if (e instanceof Error && /private address/.test(e.message)) await db.updateTable("customMonitors").set({ active: false, lastError: e.message }).where("id", "=", m.id).execute();
      }
    });
    if (new Date().getUTCMinutes() < 5) await db.deleteFrom("customChecks").where("checkedAt", "<", new Date(Date.now() - 100 * 86_400_000) /* kept for monthly SLA evidence on status boards */).execute();
    return { probed: monitors.length };
  },

  /** Daily: certificates of https monitors (domain expiry runs with the radar expiry job). */
  async refreshCertificates() {
    const due = await db.selectFrom("customMonitors").select(["id", "url"]).where("active", "=", true)
      .where(({ or, eb }) => or([eb("certCheckedAt", "is", null), eb("certCheckedAt", "<", new Date(Date.now() - 20 * 3600_000))])).execute();
    await pool(due.filter((m) => m.url.startsWith("https:")), 10, async (m) => {
      const u = new URL(m.url);
      try { const c = await certOf(u.hostname, u.port ? Number(u.port) : 443); await db.updateTable("customMonitors").set({ certNotAfter: c.notAfter, certIssuer: c.issuer, certCheckedAt: sql`now()` }).where("id", "=", m.id).execute(); }
      catch { await db.updateTable("customMonitors").set({ certCheckedAt: sql`now()` }).where("id", "=", m.id).execute(); }
    });
    return { checked: due.length };
  },
};
