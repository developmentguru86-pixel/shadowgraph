import tls from "node:tls";
import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { registrableDomain } from "./vendorScan";
import { customMonitors } from "./customMonitors";

/**
 * Predictable failure dates for every monitored service:
 *  - TLS certificate notAfter (direct TLS handshake to the probed host, SNI set, chain not validated so expired certs are still read)
 *  - domain registration expiry via RDAP (rdap.org bootstrap; ccTLDs without RDAP are recorded as unavailable, not guessed)
 * Certificates are re-read daily; domains weekly (RDAP servers rate-limit).
 */
function certOf(host: string): Promise<{ notAfter: Date; issuer: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      if (!c || !c.valid_to) return reject(new Error("no certificate"));
      const issuer = (c.issuer && (c.issuer.O || c.issuer.CN)) ? String(c.issuer.O || c.issuer.CN) : null;
      resolve({ notAfter: new Date(c.valid_to), issuer });
    });
    socket.on("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("error", (e) => reject(e));
  });
}

/** IANA RDAP bootstrap: TLD -> authoritative RDAP base URL (cached 7 days). TLDs without RDAP (e.g. .de, .at) are reported, never guessed. */
async function rdapBase(tld: string): Promise<string | null> {
  const key = "cache:iana-rdap-bootstrap:v1";
  let boot = (await mppStore.get(key)) as { at: number; map: Record<string, string> } | null;
  if (!boot || Date.now() - boot.at > 7 * 86_400_000) {
    const r = await fetch("https://data.iana.org/rdap/dns.json", { headers: { "user-agent": "ShadowGraph-OutageRadar/1.0" }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as { services: Array<[string[], string[]]> };
    const map: Record<string, string> = {};
    for (const [tlds, urls] of j.services) for (const t of tlds) map[t.toLowerCase()] = urls.find((u) => u.startsWith("https")) ?? urls[0];
    boot = { at: Date.now(), map };
    await mppStore.put(key, boot);
  }
  return boot.map[tld.toLowerCase()] ?? null;
}

export async function rdapOf(domain: string): Promise<{ expiresAt: Date | null; registrar: string | null }> {
  const base = await rdapBase(domain.split(".").pop()!);
  if (!base) throw new Error("registry offers no RDAP for this TLD");
  const r = await fetch(`${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`, {
    headers: { accept: "application/rdap+json", "user-agent": "ShadowGraph-OutageRadar/1.0 (+https://shadowalpha.online/radar)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (r.status === 404) throw new Error("domain not found in RDAP");
  if (!r.ok) throw new Error(`RDAP ${r.status}`);
  const j = (await r.json()) as { events?: Array<{ eventAction: string; eventDate: string }>; entities?: Array<{ roles?: string[]; vcardArray?: unknown[] }> };
  const exp = j.events?.find((e) => e.eventAction === "expiration")?.eventDate;
  const reg = j.entities?.find((e) => e.roles?.includes("registrar"));
  let registrar: string | null = null;
  const vcard = reg?.vcardArray?.[1] as Array<[string, unknown, string, string]> | undefined;
  if (Array.isArray(vcard)) registrar = (vcard.find((v) => v[0] === "fn")?.[3] as string | undefined) ?? null;
  return { expiresAt: exp ? new Date(exp) : null, registrar };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function radarExpiryJob() {
  const claimed = await mppStore.update<boolean>("job:radar-expiry:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 30 * 60_000) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!claimed) return { ran: false, reason: "ran less than 30 minutes ago" };

  const services = await db.selectFrom("radarServices").select(["id", "probeUrl"]).where("active", "=", true).execute();
  const known = new Map((await db.selectFrom("radarExpiry").selectAll().execute()).map((r) => [r.serviceId, r]));
  const now = Date.now();

  // certificates: daily
  const certDue = services.filter((s) => { const k = known.get(s.id); return !k?.certCheckedAt || now - new Date(k.certCheckedAt).getTime() > 20 * 3600_000; });
  let certOk = 0, certErr = 0;
  await pool(certDue, 25, async (s) => {
    const host = new URL(s.probeUrl).host;
    let notAfter: Date | null = null, issuer: string | null = null, error: string | null = null;
    try { ({ notAfter, issuer } = await certOf(host)); certOk++; } catch (e) { error = (e instanceof Error ? e.message : String(e)).slice(0, 200); certErr++; }
    await db.insertInto("radarExpiry").values({ serviceId: s.id, host, certNotAfter: notAfter, certIssuer: issuer, certCheckedAt: sql`now()`, certError: error })
      .onConflict((oc) => oc.column("serviceId").doUpdateSet({ host, certNotAfter: notAfter, certIssuer: issuer, certCheckedAt: sql`now()`, certError: error })).execute();
  });

  // domains: weekly, one RDAP lookup per registrable domain, capped per run
  const byDomain = new Map<string, string[]>();
  for (const s of services) {
    const d = registrableDomain(new URL(s.probeUrl).host);
    const k = known.get(s.id);
    if (k?.domainCheckedAt && now - new Date(k.domainCheckedAt).getTime() < 6 * 86_400_000) continue;
    byDomain.set(d, [...(byDomain.get(d) ?? []), s.id]);
  }
  let domOk = 0, domErr = 0;
  const DOMAIN_CAP = 800;
  await pool([...byDomain.entries()].slice(0, DOMAIN_CAP), 6, async ([domain, ids]) => {
    let expiresAt: Date | null = null, registrar: string | null = null, error: string | null = null;
    try { ({ expiresAt, registrar } = await rdapOf(domain)); domOk++; } catch (e) { error = (e instanceof Error ? e.message : String(e)).slice(0, 200); domErr++; }
    for (const id of ids) {
      const host = new URL(services.find((s) => s.id === id)!.probeUrl).host;
      await db.insertInto("radarExpiry").values({ serviceId: id, host, domain, domainExpiresAt: expiresAt, domainRegistrar: registrar, domainCheckedAt: sql`now()`, domainError: error })
        .onConflict((oc) => oc.column("serviceId").doUpdateSet({ domain, domainExpiresAt: expiresAt, domainRegistrar: registrar, domainCheckedAt: sql`now()`, domainError: error })).execute();
    }
    await new Promise((r) => setTimeout(r, 250));
  });
  await mppStore.delete("cache:radar-outlook:v1");

  // private custom monitors: certificates daily, domains weekly (same RDAP source)
  const cm = await customMonitors.refreshCertificates();
  const cmDue = (await db.selectFrom("customMonitors").select(["id", "url", "domainCheckedAt"]).where("active", "=", true).execute())
    .filter((m) => !m.domainCheckedAt || now - new Date(m.domainCheckedAt).getTime() > 6 * 86_400_000);
  await pool(cmDue, 4, async (m) => {
    const domain = registrableDomain(new URL(m.url).hostname);
    let expiresAt: Date | null = null;
    try { ({ expiresAt } = await rdapOf(domain)); } catch { /* registry without RDAP: stays unknown */ }
    await db.updateTable("customMonitors").set({ domain, domainExpiresAt: expiresAt, domainCheckedAt: sql`now()` }).where("id", "=", m.id).execute();
  });

  // vendor-list scans are kept 30 days (privacy notice), then deleted; scans with a paid assessment report 12 months
  await db.deleteFrom("vendorScans").where(({ or, and, eb }) => or([
    and([eb("createdAt", "<", new Date(now - 30 * 86_400_000)), eb("reportPaidAt", "is", null)]),
    eb("createdAt", "<", new Date(now - 365 * 86_400_000)),
  ])).execute().catch(() => undefined);

  return { ran: true, certsChecked: certDue.length, certOk, certErr, domainsChecked: Math.min(byDomain.size, DOMAIN_CAP), domOk, domErr, domainsRemaining: Math.max(0, byDomain.size - DOMAIN_CAP), customCerts: cm.checked, customDomains: cmDue.length };
}
