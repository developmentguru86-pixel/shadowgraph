import { randomUUID } from "crypto";
import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { RADAR_CATALOG, RADAR_CATALOG_VERSION } from "./radarCatalog";
import { scanHost } from "./vendorScan";
import { detectIncidents, detectDegradation, EARLY_WARNING_RULE, type IncidentDecision, type WarningDecision } from "./radarDetect";
import { registrableDomain } from "./vendorScan";
import { stackAlerts } from "./stackAlerts";
import { freeAlerts } from "./freeAlerts";
import { customMonitors } from "./customMonitors";
import { dispatchIncidentAlerts } from "./doraIncident";
import { eventExecution } from "./eventExecution";

/**
 * Internet Outage Radar — one run every 5 minutes:
 *  1. sync catalog -> radar_services     2. map infrastructure of unmapped services (max 40 / run)
 *  3. probe every active service          4. detect provider / region / CDN / DNS incidents
 *
 * False-alarm guards:
 *  - a service is DOWN only after two consecutive failed probes (one failure = "degraded")
 *  - if > 50% of all probes fail in a run, our own vantage point is suspect: no incidents are opened
 *  - an incident needs several independent services of the same group down; a failing region canary
 *    (cloud-native regional endpoint) lowers the bar because it is ground truth for that region
 */
const UA = { "user-agent": "ShadowGraph-OutageRadar/1.0 (+https://shadowalpha.online/radar)" };
const LOCK = "radar:lock";
const LAST_RUN = "radar:lastRun";

type Probe = { serviceId: string; ok: boolean; httpStatus: number | null; latencyMs: number | null; error: string | null };

async function probe(id: string, url: string): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: UA, signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel().catch(() => undefined);
    return { serviceId: id, ok: r.status > 0 && r.status < 500, httpStatus: r.status, latencyMs: Date.now() - t0, error: null };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : String(e);
    return { serviceId: id, ok: false, httpStatus: null, latencyMs: null, error: msg.slice(0, 200) };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/**
 * Catalog = curated list in code (RADAR_CATALOG) + extended list in radar_catalog_extra (most-visited sites worldwide and
 * in Europe from the Tranco research ranking, SaaS & fintech vendors). The extended list only adds services; a curated
 * code change re-maps everything once.
 */
/** Adult (18+) sites are not part of the catalogue; a future top-sites import that contains them is skipped here. */
const ADULT_HOST = /(porn|xxx|xvid|xvv1d|xhamster|youjizz|hentai|pussy|escort|nsfw|bokep|yadong|erome|tnaflix|onlyfans|chaturbate|stripchat|spankbang|eporner|redtube|youporn|xnxx)/i;

async function syncCatalog() {
  const extras = (await db.selectFrom("radarCatalogExtra").select(["id", "name", "category", "url"]).execute())
    .filter((x) => !ADULT_HOST.test(x.url));
  const version = `${RADAR_CATALOG_VERSION}+x${extras.length}`;
  const stored = (await mppStore.get("radar:catalogVersion")) as string | null;
  if (stored === version) return;
  const codeChanged = !stored || stored.split("+x")[0] !== RADAR_CATALOG_VERSION;
  const entries = [
    ...RADAR_CATALOG.map((e) => ({ id: e.id, name: e.name, category: e.category, url: e.url, provider: e.provider ?? null, region: e.region ?? null })),
    ...extras.filter((x) => !RADAR_CATALOG.some((e) => e.id === x.id)).map((x) => ({ ...x, provider: null, region: null })),
  ];
  for (let i = 0; i < entries.length; i += 300) {
    const chunk = entries.slice(i, i + 300).map((e) => ({
      id: e.id, name: e.name, category: e.category, probeUrl: e.url, domain: new URL(e.url).host,
      hostingProvider: e.provider, hostingRegion: e.region, active: true,
    }));
    await db.insertInto("radarServices").values(chunk).onConflict((oc) => oc.column("id").doUpdateSet({
      name: sql`excluded.name`, category: sql`excluded.category`, probeUrl: sql`excluded.probe_url`, domain: sql`excluded.domain`,
    })).execute();
  }
  const ids = entries.map((e) => e.id);
  await db.updateTable("radarServices").set({ active: false }).where("id", "not in", ids).execute();
  // curated catalog or mapping rules changed: curated entries get another chance, every service is re-mapped once
  if (codeChanged) {
    await db.updateTable("radarServices").set({ active: true }).where("id", "in", RADAR_CATALOG.map((e) => e.id)).execute();
    await db.updateTable("radarServices").set({ mappedAt: null }).execute();
  }
  await mppStore.put("radar:catalogVersion", version);
}

async function mapInfrastructure(limit = 400) {
  const todo = await db.selectFrom("radarServices").selectAll()
    .where("active", "=", true)
    .where(({ or, eb }) => or([eb("mappedAt", "is", null), eb("mappedAt", "<", new Date(Date.now() - 7 * 86_400_000))]))
    .limit(limit).execute();
  await pool(todo, 8, async (s) => {
    try {
      const f = await scanHost(new URL(s.probeUrl).host);
      const canary = RADAR_CATALOG.find((e) => e.id === s.id && e.region);
      const next = {
        hostingProvider: canary?.provider ?? f.hosting?.provider ?? null,
        hostingRegion: canary?.region ?? f.hosting?.region ?? null,
        cdn: f.cdn, dnsProvider: f.dns, emailProvider: f.email,
      };
      // infrastructure change detection: only real changes between two successful mappings (both values known)
      if (!canary && s.mappedAt) {
        const fields: Array<[keyof typeof next, string]> = [["hostingProvider", "hosting_provider"], ["hostingRegion", "hosting_region"], ["cdn", "cdn"], ["dnsProvider", "dns_provider"], ["emailProvider", "email_provider"]];
        const changes = fields.filter(([k]) => s[k] && next[k] && s[k] !== next[k])
          .map(([k, field]) => ({ serviceId: s.id, field, oldValue: s[k] as string, newValue: next[k] as string }));
        if (changes.length) await db.insertInto("radarChanges").values(changes).execute();
      }
      await db.updateTable("radarServices").set({
        ...next, hostingCountry: f.hosting?.country ?? null, analyzedHost: f.analyzedHost, mappedAt: sql`now()`,
      }).where("id", "=", s.id).execute();
    } catch { /* retried next run */ }
  });
}

/** Each service's own normal: median latency of successful probes over the last 24h (cached for an hour). */
async function baselines(): Promise<Map<string, { ms: number; n: number }>> {
  const key = "radar:baseline:v1";
  const cached = (await mppStore.get(key)) as { at: number; rows: Array<[string, number, number]> } | null;
  if (cached && Date.now() - cached.at < 3600_000) return new Map(cached.rows.map(([id, ms, n]) => [id, { ms, n }]));
  const rows = (await sql<{ id: string; ms: number; n: number }>`
    SELECT service_id AS id, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::float AS ms, count(*)::int AS n
    FROM radar_checks WHERE ok AND latency_ms IS NOT NULL AND checked_at > now() - interval '24 hours' GROUP BY service_id`.execute(db)).rows;
  await mppStore.put(key, { at: Date.now(), rows: rows.map((r) => [r.id, r.ms, r.n]) });
  return new Map(rows.map((r) => [r.id, { ms: r.ms, n: r.n }]));
}

/** Open/refresh early warnings; close those that stopped firing for two sweeps. */
async function persistWarnings(decisions: WarningDecision[]) {
  const open = await db.selectFrom("radarWarnings").selectAll().where("closedAt", "is", null).execute();
  const matched = new Set<string>();
  for (const d of decisions) {
    const evidence = { rule: EARLY_WARNING_RULE, groupSize: d.groupSize, degraded: d.degraded } as never;
    const existing = open.find((o) => o.layer === d.layer && o.provider === d.provider);
    if (existing) {
      matched.add(existing.id);
      await db.updateTable("radarWarnings").set({ lastSeenAt: sql`now()`, evidence }).where("id", "=", existing.id).execute();
    } else {
      await db.insertInto("radarWarnings").values({ id: randomUUID(), layer: d.layer, provider: d.provider, evidence }).execute();
    }
  }
  for (const o of open) if (!matched.has(o.id) && Date.now() - new Date(o.lastSeenAt).getTime() > 9 * 60_000) {
    await db.updateTable("radarWarnings").set({ closedAt: sql`now()` }).where("id", "=", o.id).execute();
  }
}

/** Score every warning against what actually happened, so the hit rate and lead time can be published. */
async function evaluateWarnings() {
  const pending = await db.selectFrom("radarWarnings").selectAll().where("outcome", "is", null)
    .where("openedAt", ">", new Date(Date.now() - 8 * 86_400_000)).execute();
  if (!pending.length) return;
  const incidents = await db.selectFrom("radarIncidents").select(["layer", "provider", "startedAt"])
    .where("startedAt", ">", new Date(Date.now() - 9 * 86_400_000)).execute();
  const related = (w: { layer: string; provider: string }, i: { layer: string; provider: string }) =>
    (i.layer === w.layer && i.provider === w.provider)
    || (w.layer === "region" && i.layer === "hosting" && w.provider.startsWith(`${i.provider} `))
    || (w.layer === "hosting" && i.layer === "region" && i.provider.startsWith(`${w.provider} `));
  for (const w of pending) {
    const opened = new Date(w.openedAt).getTime();
    const until = (w.closedAt ? new Date(w.closedAt).getTime() : Date.now()) + 30 * 60_000;
    const hit = incidents.find((i) => related(w, i) && new Date(i.startedAt).getTime() >= opened - 10 * 60_000 && new Date(i.startedAt).getTime() <= until);
    if (hit) {
      await db.updateTable("radarWarnings").set({ outcome: "incident", leadMinutes: Math.round((new Date(hit.startedAt).getTime() - opened) / 60_000) }).where("id", "=", w.id).execute();
    } else if (w.closedAt && Date.now() - new Date(w.closedAt).getTime() > 30 * 60_000) {
      await db.updateTable("radarWarnings").set({ outcome: "no_incident" }).where("id", "=", w.id).execute();
    }
  }
}

/** Persist the pure detector's decisions: update matching open incidents, open new ones, resolve the rest. */
async function persistIncidents(decisions: IncidentDecision[], now: Map<string, Probe>) {
  // jsonb columns: bind the raw JS value; postgres-js serialises jsonb params itself
  // (pre-stringifying, with or without ::jsonb, stores a jsonb *string* scalar that later crashes .map()).
  const j = <T,>(v: T) => v as never;
  const open = await db.selectFrom("radarIncidents").selectAll().where("status", "=", "open").execute();
  const matched = new Set<string>();
  for (const d of decisions) {
    const affected = d.affected;
    const atRisk = d.atRisk;
    const share = d.share;
    const evidence = {
      groupSize: d.groupSize, failing: d.affected.length, canaryDown: d.canaryDown,
      probes: d.affected.map((m) => ({ id: m.id, status: now.get(m.id)?.httpStatus ?? null, error: now.get(m.id)?.error ?? null })),
    };
    const existing = open.find((o) => o.layer === d.layer && o.provider === d.provider);
    if (existing) {
      matched.add(existing.id);
      await db.updateTable("radarIncidents").set({
        lastSeenAt: sql`now()`, affected: j(affected), atRisk: j(atRisk), evidence: j(evidence),
        peakFailureShare: Math.max(existing.peakFailureShare, share),
      }).where("id", "=", existing.id).execute();
    } else {
      await db.insertInto("radarIncidents").values({
        id: randomUUID(), layer: d.layer, provider: d.provider, affected: j(affected), atRisk: j(atRisk),
        evidence: j(evidence), peakFailureShare: share,
      }).execute();
    }
  }
  // resolve open incidents whose group no longer meets the bar
  for (const o of open) if (!matched.has(o.id)) {
    await db.updateTable("radarIncidents").set({ status: "resolved", resolvedAt: sql`now()` }).where("id", "=", o.id).execute();
  }
}

export async function radarJob() {
  const gotLock = await mppStore.update<boolean>(LOCK, (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 4 * 60_000) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false, reason: "another run is in progress or ran < 4 min ago" };

  await syncCatalog();
  await mapInfrastructure();

  const services = await db.selectFrom("radarServices")
    .select(["id", "name", "probeUrl", "hostingProvider", "hostingRegion", "cdn", "dnsProvider"])
    .where("active", "=", true).execute();
  const runId = new Date().toISOString();
  // Two passes so the latency baselines stay clean: 100 parallel TLS handshakes in one process inflate the measured
  // latency ~4x (event-loop contention). Curated services keep the old concurrency of 40; the extended top-sites
  // list (radar_catalog_extra, ids "web-*") runs afterwards with its own pool.
  const curated = services.filter((s) => !s.id.startsWith("web-"));
  const extended = services.filter((s) => s.id.startsWith("web-"));
  const probes = [
    ...await pool(curated, 40, (s) => probe(s.id, s.probeUrl)),
    ...await pool(extended, 50, (s) => probe(s.id, s.probeUrl)),
  ];
  for (let i = 0; i < probes.length; i += 2000) {
    await db.insertInto("radarChecks").values(probes.slice(i, i + 2000).map((p) => ({ ...p, runId }))).execute();
  }
  // remember the first successful probe of every service (cheap "ever reached" flag instead of scanning radar_checks)
  const okIds = probes.filter((p) => p.ok).map((p) => p.serviceId);
  if (okIds.length) await db.updateTable("radarServices").set({ firstOkAt: sql`now()` }).where("firstOkAt", "is", null).where("id", "in", okIds).execute();
  // Prune targets our node has NEVER reached (wrong host, bot wall): after 3 checks they leave monitoring,
  // so they cannot pollute incident detection as permanent false "down" entries.
  await sql`UPDATE radar_services SET active = false WHERE active AND first_ok_at IS NULL AND id IN (
    SELECT service_id FROM radar_checks WHERE checked_at > now() - interval '2 hours' GROUP BY service_id HAVING count(*) >= 3 AND NOT bool_or(ok))`.execute(db);

  const last = (await mppStore.get(LAST_RUN)) as { runId?: string } | null;
  const prev = new Map<string, boolean>();
  if (last?.runId) {
    for (const r of await db.selectFrom("radarChecks").select(["serviceId", "ok"]).where("runId", "=", last.runId).execute()) prev.set(r.serviceId, r.ok);
  }
  const now = new Map(probes.map((p) => [p.serviceId, p]));
  // services our node has reached at least once (only these can count as DOWN)
  const everReached = new Set((await db.selectFrom("radarServices").select("id").where("firstOkAt", "is not", null).execute()).map((r) => r.id));
  const result = detectIncidents(
    services.map((s) => ({ ...s, canary: /^(aws-s3-|aws-ddb-|gcp-run-)/.test(s.id) })),
    probes, prev, everReached,
  );
  const { vantageSuspect, down } = result;
  // with a suspect vantage point we neither open nor resolve anything: keep the last known incident state
  if (!vantageSuspect) await persistIncidents(result.incidents, now);

  // early warning (gray failures) + scoring of past warnings
  let warnings = 0;
  try {
    const base = await baselines();
    const incidentGroups = new Set(result.incidents.map((i) => `${i.layer}|${i.provider}`));
    const orgOf = new Map(services.map((s) => [s.id, registrableDomain(new URL(s.probeUrl).hostname)]));
    const toDegrade = (sample: Map<string, Probe>) => services.map((s) => {
      const p = sample.get(s.id), b = base.get(s.id);
      return { ...s, org: orgOf.get(s.id), latencyMs: p?.latencyMs ?? null, ok: p?.ok ?? true, baselineMs: b?.ms ?? null, baselineN: b?.n ?? 0 };
    });
    const first = detectDegradation(toDegrade(now), incidentGroups);
    const usable = !vantageSuspect && !first.vantageSuspect;
    let confirmed: WarningDecision[] = [];
    if (usable && first.warnings.length) {
      // confirmation re-probe: a transient delay at our own measurement origin does not survive a second sample
      const suspects = new Set(first.warnings.flatMap((w) => w.degraded.map((d) => d.id)));
      const second = new Map(now);
      for (const p of await pool(services.filter((s) => suspects.has(s.id)), 20, (s) => probe(s.id, s.probeUrl))) second.set(p.serviceId, p);
      confirmed = detectDegradation(toDegrade(second), incidentGroups).warnings;
    }
    // persistence: a new warning opens only if the same group was also a confirmed candidate in the previous sweep
    const prev = (await mppStore.get("radar:ewCandidates")) as { at: number; keys: string[] } | null;
    const prevKeys = new Set(prev && Date.now() - prev.at < 12 * 60_000 ? prev.keys : []);
    await mppStore.put("radar:ewCandidates", { at: Date.now(), keys: confirmed.map((w) => `${w.layer}|${w.provider}`) });
    if (usable) {
      const openKeys = new Set((await db.selectFrom("radarWarnings").select(["layer", "provider"]).where("closedAt", "is", null).execute()).map((o) => `${o.layer}|${o.provider}`));
      const persistent = confirmed.filter((w) => prevKeys.has(`${w.layer}|${w.provider}`) || openKeys.has(`${w.layer}|${w.provider}`));
      await persistWarnings(persistent);
      warnings = persistent.length;
    }
    await evaluateWarnings();
  } catch (e) {
    console.error("radar early warning failed", e instanceof Error ? e.message : e);
  }

  const summary = {
    runId, at: runId, total: probes.length, up: probes.filter((p) => p.ok).length,
    degraded: probes.filter((p) => !p.ok && !down.has(p.serviceId)).length, down: down.size, vantageSuspect, warnings,
    medianLatencyMs: (() => { const l = probes.map((p) => p.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)] : null; })(),
  };
  await mppStore.put(LAST_RUN, summary);
  try { await eventExecution.run(vantageSuspect); } catch (e) { console.error("Event execution research failed", e instanceof Error ? e.message : e); }
  // subscribers' private endpoints, then paid stack alerts (isolated: errors here never break the radar)
  try { await customMonitors.probeAll(); } catch (e) { console.error("custom monitors failed", e instanceof Error ? e.message : e); }
  try { await dispatchIncidentAlerts(); } catch (e) { console.error("dora incident alerts failed", e instanceof Error ? e.message : e); }
  let alertsSent = 0;
  try { alertsSent = (await stackAlerts.dispatch()).sent; } catch (e) { console.error("stack alerts dispatch failed", e instanceof Error ? e.message : e); }
  try { alertsSent += (await freeAlerts.dispatch()).sent; } catch (e) { console.error("free alerts dispatch failed", e instanceof Error ? e.message : e); }
  if (new Date().getUTCMinutes() < 5) {
    // 2 days of raw probes (hourly aggregates in radar_service_hourly keep the long history)
    await db.deleteFrom("radarChecks").where("checkedAt", "<", new Date(Date.now() - 2 * 86_400_000)).execute();
    // rate-limit counters hold hashed client IDs: the privacy notice promises they live at most about an hour
    await db.deleteFrom("mppStore").where("key", "like", "ratelimit:%").where("updatedAt", "<", new Date(Date.now() - 2 * 3600_000)).execute();
  }
  return { ran: true, ...summary, alertsSent };
}
