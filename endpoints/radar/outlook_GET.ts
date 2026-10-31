import { sql } from "kysely";
import { db } from "../../helpers/db";
import { mppStore } from "../../helpers/mppStore";

// Predictive risk signals: early warnings with their public track record, certificate and domain expiry, infra changes.
export async function handle(_request: Request) {
  const key = "cache:radar-outlook:v2";
  const cached = (await mppStore.get(key)) as { at: number; body: unknown } | null;
  if (cached && Date.now() - cached.at < 5 * 60_000) return Response.json(cached.body, { headers: { "Cache-Control": "public, s-maxage=120", "Access-Control-Allow-Origin": "*" } });

  const certs = await db.selectFrom("radarExpiry as e").innerJoin("radarServices as s", "s.id", "e.serviceId")
    .select(["s.id", "s.name", "s.category", "e.host", "e.certNotAfter", "e.certIssuer"])
    .where("s.active", "=", true).where("e.certNotAfter", "is not", null)
    .where("e.certNotAfter", "<", new Date(Date.now() + 30 * 86_400_000)).orderBy("e.certNotAfter").limit(60).execute();
  const domainsRaw = await db.selectFrom("radarExpiry as e").innerJoin("radarServices as s", "s.id", "e.serviceId")
    .select(["s.name", "e.domain", "e.domainExpiresAt", "e.domainRegistrar"])
    .where("s.active", "=", true).where("e.domainExpiresAt", "is not", null)
    .where("e.domainExpiresAt", "<", new Date(Date.now() + 60 * 86_400_000)).orderBy("e.domainExpiresAt").limit(80).execute();
  const seen = new Set<string>();
  const domains = domainsRaw.filter((d) => d.domain && !seen.has(d.domain) && seen.add(d.domain));
  const coverage = (await sql<{ certs: number; certErrors: number; domains: number; domainErrors: number }>`
    SELECT count(*) FILTER (WHERE cert_not_after IS NOT NULL)::int AS certs, count(*) FILTER (WHERE cert_error IS NOT NULL)::int AS "certErrors",
           count(DISTINCT domain) FILTER (WHERE domain_expires_at IS NOT NULL)::int AS domains,
           count(DISTINCT domain) FILTER (WHERE domain_error IS NOT NULL)::int AS "domainErrors"
    FROM radar_expiry`.execute(db)).rows[0];

  // track record is per rule version: ew-v1 (no rule tag) was retired after 0/10 confirmations; ew-v2 starts clean
  const allWarnings = await db.selectFrom("radarWarnings").selectAll().where("openedAt", ">", new Date(Date.now() - 30 * 86_400_000)).orderBy("openedAt", "desc").limit(200).execute();
  const ruleOf = (w: { evidence: unknown }) => ((typeof w.evidence === "string" ? JSON.parse(w.evidence) : w.evidence) as { rule?: string } | null)?.rule ?? "ew-v1";
  const warnings = allWarnings.filter((w) => ruleOf(w) === "ew-v2").slice(0, 40);
  const legacy = allWarnings.filter((w) => ruleOf(w) === "ew-v1");
  const scored = warnings.filter((w) => w.outcome);
  const hits = scored.filter((w) => w.outcome === "incident");
  const leads = hits.map((w) => w.leadMinutes ?? 0).sort((a, b) => a - b);
  const changes = await db.selectFrom("radarChanges as c").innerJoin("radarServices as s", "s.id", "c.serviceId")
    .select(["c.id", "s.name", "s.category", "c.field", "c.oldValue", "c.newValue", "c.detectedAt"])
    .where("c.detectedAt", ">", new Date(Date.now() - 30 * 86_400_000)).orderBy("c.detectedAt", "desc").limit(50).execute();

  // Risk tiers: auto-renewing CAs normally renew ~30 days before expiry, so <14 days left on such a cert means renewal is
  // overdue (likely failing). Everything else inside 30 days is the normal renewal window and is only "watch".
  const AUTO = /Let's Encrypt|ZeroSSL|Google Trust Services|Amazon|Cloudflare/i;
  const tier = (days: number, issuer: string | null) => days < 0 ? "expired" : days < 7 ? "critical" : days < 14 && issuer && AUTO.test(issuer) ? "renewal_overdue" : "watch";
  const rank: Record<string, number> = { expired: 0, critical: 1, renewal_overdue: 2, watch: 3 };
  const certificates = certs.map((c) => {
    const daysLeft = Math.floor((new Date(c.certNotAfter!).getTime() - Date.now()) / 86_400_000);
    return { ...c, daysLeft, risk: tier(daysLeft, c.certIssuer) };
  }).sort((a, b) => rank[a.risk] - rank[b.risk] || a.daysLeft - b.daysLeft);

  const body = {
    generatedAt: new Date().toISOString(),
    certificates,
    domains: domains.map((d) => ({ ...d, daysLeft: Math.floor((new Date(d.domainExpiresAt!).getTime() - Date.now()) / 86_400_000) })),
    coverage,
    warnings: warnings.map((w) => ({ id: w.id, layer: w.layer, provider: w.provider, openedAt: w.openedAt, closedAt: w.closedAt, outcome: w.outcome, leadMinutes: w.leadMinutes, evidence: typeof w.evidence === "string" ? JSON.parse(w.evidence) : w.evidence })),
    trackRecord: { warnings: warnings.length, scored: scored.length, confirmed: hits.length, precision: scored.length ? hits.length / scored.length : null, medianLeadMinutes: leads.length ? leads[Math.floor(leads.length / 2)] : null },
    retiredRule: legacy.length ? { rule: "ew-v1", warnings: legacy.length, scored: legacy.filter((w) => w.outcome).length, confirmed: legacy.filter((w) => w.outcome === "incident").length,
      retiredAt: "2026-10-09", reason: "The same three hosts per region intermittently gained about 1.8 s together: a delay at our own measurement origin, not a provider problem." } : null,
    changes,
  };
  await mppStore.put(key, { at: Date.now(), body });
  return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=120", "Access-Control-Allow-Origin": "*" } });
}