import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { registrableDomain } from "./vendorScan";
import { STATUS_PAGES, STATUS_REGISTRY_VERSION, statusOrg } from "./statusRegistry";
import { wilson, bootstrapMedianCI, overlaps, sharedFate, concentration, rng, eventFate, holm, type Proportion, type SharedFateLayer, type EventFateLayer } from "./researchStats";

/**
 * ShadowGraph Research — hourly job. All rules are versioned and published on /research.
 *  1. persist: sweep table (radar_runs), hourly service aggregates, DOWN episodes (radar_checks is kept only 3 days)
 *  2. ground truth: official incidents from 182 machine-readable status pages
 *  3. val-v1:  radar DOWN episodes vs official incidents (recall, precision, timeliness, with 95% intervals)
 *  4. sf-v1:   shared-fate study — do organisations on the same infrastructure fail together more than chance?
 *  5. conc-v1: concentration of the monitored internet per infrastructure layer (HHI, blast radius)
 */
export const RESEARCH_VERSIONS = { validation: "val-v1", sharedFate: "sf-v1", sharedFateRadar: "sf-radar-v1", concentration: "conc-v1", registry: STATUS_REGISTRY_VERSION };
const CACHE = "research:overview:v4";
const MIN = 60_000;

// ---------------------------------------------------------------- 1. persistence
async function persistMeasurements() {
  await sql`INSERT INTO radar_runs (run_id, at, total, n_failed, failing, vantage_suspect)
    SELECT run_id, min(checked_at), count(*), count(*) FILTER (WHERE NOT ok),
      coalesce(array_agg(service_id ORDER BY service_id) FILTER (WHERE NOT ok), '{}'),
      (count(*) FILTER (WHERE NOT ok))::float / count(*) > 0.5
    FROM radar_checks WHERE checked_at > now() - interval '6 hours' GROUP BY run_id
    ON CONFLICT (run_id) DO NOTHING`.execute(db);
  await sql`INSERT INTO radar_service_hourly (service_id, hour, n, n_ok, p50_ms, p95_ms)
    SELECT service_id, date_trunc('hour', checked_at), count(*), count(*) FILTER (WHERE ok),
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok),
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok)
    FROM radar_checks WHERE checked_at > date_trunc('hour', now()) - interval '6 hours' AND checked_at < date_trunc('hour', now())
    GROUP BY 1, 2
    ON CONFLICT (service_id, hour) DO UPDATE SET n = excluded.n, n_ok = excluded.n_ok, p50_ms = excluded.p50_ms, p95_ms = excluded.p95_ms`.execute(db);
  // DOWN episodes = runs of >= 2 consecutive failed sweeps (vantage-suspect sweeps are treated as missing)
  await sql`WITH good AS (SELECT run_id FROM radar_runs WHERE NOT vantage_suspect AND at > now() - interval '3 days'),
    c AS (SELECT k.service_id, k.checked_at, k.ok, coalesce(k.error, 'HTTP ' || k.http_status) AS reason
          FROM radar_checks k JOIN good g USING (run_id)),
    s AS (SELECT *, row_number() OVER (PARTITION BY service_id ORDER BY checked_at) AS rn,
                 row_number() OVER (PARTITION BY service_id, ok ORDER BY checked_at) AS rk FROM c),
    isl AS (SELECT service_id, min(checked_at) AS started_at, max(checked_at) AS last_failed_at, count(*)::int AS n_failed,
                   mode() WITHIN GROUP (ORDER BY reason) AS reason, max(rn) AS last_rn
            FROM s WHERE NOT ok GROUP BY service_id, rn - rk)
    INSERT INTO radar_episodes (service_id, started_at, last_failed_at, recovered_at, n_failed, reason)
    SELECT i.service_id, i.started_at, i.last_failed_at,
      (SELECT min(s2.checked_at) FROM s s2 WHERE s2.service_id = i.service_id AND s2.rn = i.last_rn + 1), i.n_failed, i.reason
    FROM isl i WHERE i.n_failed >= 2
    ON CONFLICT (service_id, started_at) DO UPDATE SET last_failed_at = excluded.last_failed_at,
      recovered_at = excluded.recovered_at, n_failed = excluded.n_failed, reason = excluded.reason`.execute(db);
}

// ---------------------------------------------------------------- 2. ground truth
// Status pages are ingested every 10 minutes by upstreamJob (helpers/statusIngest); this job only reads them.

// ---------------------------------------------------------------- shared inputs
type Svc = { id: string; name: string; org: string; category: string; hostingProvider: string | null; hostingRegion: string | null;
  cdn: string | null; dnsProvider: string | null; emailProvider: string | null; n: number; nOk: number };

async function loadServices(): Promise<Svc[]> {
  const rows = (await sql<Omit<Svc, "org"> & { probeUrl: string }>`
    SELECT s.id, s.name, s.category, s.probe_url AS "probeUrl", s.hosting_provider AS "hostingProvider", s.hosting_region AS "hostingRegion",
      s.cdn, s.dns_provider AS "dnsProvider", s.email_provider AS "emailProvider",
      coalesce(sum(h.n), 0)::int AS n, coalesce(sum(h.n_ok), 0)::int AS "nOk"
    FROM radar_services s LEFT JOIN radar_service_hourly h ON h.service_id = s.id
    WHERE s.active GROUP BY s.id`.execute(db)).rows;
  return rows.map((r) => ({ ...r, org: registrableDomain(new URL(r.probeUrl).hostname) }));
}
/** Measurable = reached at least once, and reachable in >= 50% of sweeps (bot walls / geo blocks are not outages). */
const measurable = (s: Svc) => s.nOk > 0 && s.n >= 12 && s.nOk / s.n >= 0.5;

// ---------------------------------------------------------------- 3. validation (val-v1)
const PRE = 30 * MIN, POST = 30 * MIN;

async function validation(services: Svc[]) {
  const span = (await sql<{ first: Date | null; runs: number }>`SELECT min(at) AS first, count(*)::int AS runs FROM radar_runs WHERE NOT vantage_suspect`.execute(db)).rows[0];
  if (!span?.first) return null;
  const w0 = new Date(span.first).getTime() + PRE, w1 = Date.now() - POST;
  const covered = services.filter((s) => measurable(s) && statusOrg(s.org));
  const orgOf = new Map(covered.map((s) => [s.id, statusOrg(s.org)!]));
  const orgs = [...new Set(orgOf.values())];
  if (!orgs.length) return null;

  const incRows = await db.selectFrom("statusIncidents").selectAll().where("org", "in", orgs)
    .where("createdAt", ">", new Date(w0 - 7 * 86_400_000)).execute();
  // de-duplicate incidents mirrored on several hosts of one page (e.g. Twilio / SendGrid)
  const byId = new Map<string, { id: string; name: string; impact: string; orgs: Set<string>; created: number; start: number; end: number; link: string | null; open: boolean }>();
  for (const r of incRows) {
    const created = new Date(r.createdAt).getTime();
    const cur = byId.get(r.incidentId);
    if (cur) { cur.orgs.add(r.org); continue; }
    byId.set(r.incidentId, {
      id: r.incidentId, name: r.name, impact: r.impact, orgs: new Set([r.org]), created,
      start: r.startedAt ? Math.min(created, new Date(r.startedAt).getTime()) : created,
      end: r.resolvedAt ? new Date(r.resolvedAt).getTime() : Date.now(), link: r.shortlink, open: !r.resolvedAt,
    });
  }
  const incidents = [...byId.values()];
  const epiRows = await db.selectFrom("radarEpisodes").selectAll().where("serviceId", "in", covered.map((s) => s.id))
    .where("startedAt", ">", new Date(w0 - 86_400_000)).execute();
  const episodes = epiRows.map((e) => ({
    serviceId: e.serviceId, org: orgOf.get(e.serviceId)!, start: new Date(e.startedAt).getTime(),
    end: e.recoveredAt ? new Date(e.recoveredAt).getTime() : new Date(e.lastFailedAt).getTime() + 5 * MIN,
    nFailed: e.nFailed, reason: e.reason ?? "unknown",
  }));
  const names = new Map(services.map((s) => [s.id, s.name]));

  // recall: official incidents declared inside the observation window
  const inWindow = incidents.filter((i) => i.created >= w0 && i.created <= w1);
  const judged = inWindow.map((i) => {
    const hits = episodes.filter((e) => i.orgs.has(e.org) && overlaps(e.start, e.end, i.start - PRE, i.end + POST)).sort((a, b) => a.start - b.start);
    return { i, first: hits[0] ?? null };
  });
  const impacts = ["critical", "major", "minor", "none"];
  const recallBy = Object.fromEntries(impacts.map((imp) => {
    const sub = judged.filter((x) => x.i.impact === imp);
    return [imp, wilson(sub.filter((x) => x.first).length, sub.length)];
  })) as Record<string, Proportion>;
  const sev = judged.filter((x) => x.i.impact === "critical" || x.i.impact === "major");

  // precision: radar DOWN episodes that coincide with an official incident of the same organisation
  const epiInWindow = episodes.filter((e) => e.start >= w0 && e.start <= w1);
  const confirm = (e: (typeof episodes)[number]) => incidents.some((i) => i.orgs.has(e.org) && overlaps(e.start, e.end, i.start - PRE, i.end + POST));
  const precisionAll = wilson(epiInWindow.filter(confirm).length, epiInWindow.length);
  const long = epiInWindow.filter((e) => e.nFailed >= 3);
  const precisionLong = wilson(long.filter(confirm).length, long.length);

  // timeliness: radar's first failed sweep minus the official declaration (negative = radar first)
  const deltas = judged.filter((x) => x.first).map((x) => (x.first!.start - x.i.created) / MIN);
  const reasons = new Map<string, number>();
  for (const e of epiInWindow.filter((e) => !confirm(e))) {
    const k = /timeout/i.test(e.reason) ? "timeout" : /^HTTP 5/.test(e.reason) ? "HTTP 5xx" : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e.reason) ? "DNS resolution" : /certificate|TLS|SSL/i.test(e.reason) ? "TLS" : "connection error";
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  return {
    rule: RESEARCH_VERSIONS.validation,
    window: { from: new Date(w0).toISOString(), to: new Date(w1).toISOString(), hours: Math.max(0, (w1 - w0) / 3_600_000), sweeps: span.runs },
    coverage: { services: covered.length, organisations: orgs.length, statusPages: new Set(orgs.map((o) => STATUS_PAGES[o])).size },
    officialIncidents: inWindow.length,
    recall: { severe: wilson(sev.filter((x) => x.first).length, sev.length), byImpact: recallBy },
    precision: { all: precisionAll, sustained: precisionLong },
    timeliness: { ...bootstrapMedianCI(deltas), earlier: deltas.filter((d) => d < 0).length },
    unconfirmedReasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    matches: judged.filter((x) => x.first).sort((a, b) => b.i.created - a.i.created).slice(0, 12).map((x) => ({
      incident: x.i.name, impact: x.i.impact, organisation: [...x.i.orgs][0], declaredAt: new Date(x.i.created).toISOString(),
      radarFirstFailure: new Date(x.first!.start).toISOString(), deltaMinutes: Math.round((x.first!.start - x.i.created) / MIN),
      service: names.get(x.first!.serviceId) ?? x.first!.serviceId, link: x.i.link,
    })),
    misses: judged.filter((x) => !x.first && (x.i.impact === "critical" || x.i.impact === "major")).sort((a, b) => b.i.created - a.i.created).slice(0, 12).map((x) => ({
      incident: x.i.name, impact: x.i.impact, organisation: [...x.i.orgs][0], declaredAt: new Date(x.i.created).toISOString(), link: x.i.link,
    })),
    radarOnly: epiInWindow.filter((e) => !confirm(e)).sort((a, b) => b.nFailed - a.nFailed).slice(0, 8).map((e) => ({
      service: names.get(e.serviceId) ?? e.serviceId, organisation: e.org, startedAt: new Date(e.start).toISOString(),
      minutes: Math.round((e.end - e.start) / MIN), reason: e.reason,
    })),
  };
}

// ---------------------------------------------------------------- 4. shared fate (sf-v1)
const mode = (xs: Array<string | null>) => {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

async function sharedFateStudy(services: Svc[]) {
  const runs = await db.selectFrom("radarRuns").select(["at", "failing"]).where("vantageSuspect", "=", false).orderBy("at").execute();
  const T = runs.length;
  if (T < 48) return null;
  const ok = services.filter((s) => measurable(s) && s.category !== "Cloud region canary");
  const okIds = new Set(ok.map((s) => s.id));
  const svcFail = new Map<string, number[]>();
  runs.forEach((r, t) => { for (const id of r.failing ?? []) if (okIds.has(id)) (svcFail.get(id) ?? svcFail.set(id, []).get(id)!).push(t); });

  // unit = organisation: an organisation fails in a sweep if any of its measurable services fails
  const byOrg = new Map<string, Svc[]>();
  for (const s of ok) (byOrg.get(s.org) ?? byOrg.set(s.org, []).get(s.org)!).push(s);
  const orgFail = new Map<string, number[]>();
  for (const [org, list] of byOrg) {
    const ts = new Set<number>();
    for (const s of list) for (const t of svcFail.get(s.id) ?? []) ts.add(t);
    if (ts.size) orgFail.set(org, [...ts].sort((a, b) => a - b));
  }
  const layer = (f: (s: Svc) => string | null) => new Map([...byOrg].map(([org, list]) => [org, mode(list.map(f))] as [string, string | null]).filter((x): x is [string, string] => !!x[1]));
  const groups: Record<string, Map<string, string>> = {
    "Cloud region": layer((s) => (s.hostingProvider && s.hostingRegion ? `${s.hostingProvider} ${s.hostingRegion}` : null)),
    "Hosting provider": layer((s) => s.hostingProvider),
    CDN: layer((s) => s.cdn),
    "DNS provider": layer((s) => (s.dnsProvider && !/^Other \(/.test(s.dnsProvider) ? s.dnsProvider : null)),
  };
  // negative control: organisations assigned to random groups of the same sizes as the hosting layer
  const host = [...groups["Hosting provider"]];
  const r = rng(29);
  const shuffled = host.map(([, g]) => g).sort(() => r() - 0.5);
  groups["Negative control (random groups)"] = new Map(host.map(([org], i) => [org, shuffled[i]]));
  const orgLayers = sharedFate({ T, failures: orgFail, groups }, 500, 11);
  // positive control: separate endpoints of the SAME organisation (shared code, deploys and infrastructure)
  const sameOrg = new Map(ok.map((s) => [s.id, s.org]));
  const [positive] = sharedFate({ T, failures: svcFail, groups: { "Positive control (same organisation)": sameOrg } }, 500, 13);
  const orderFirst = new Date(runs[0].at).toISOString(), orderLast = new Date(runs[T - 1].at).toISOString();
  return {
    rule: RESEARCH_VERSIONS.sharedFateRadar, sweeps: T, from: orderFirst, to: orderLast,
    organisations: byOrg.size, organisationsWithFailures: orgFail.size,
    failureSweeps: [...orgFail.values()].reduce((s, x) => s + x.length, 0),
    layers: [...orgLayers, positive] as SharedFateLayer[],
    groupCoverage: Object.fromEntries(Object.entries(groups).map(([k, m]) => [k, m.size])),
  };
}

// ---------------------------------------------------------------- 4b. shared fate in official incidents (sf-v1, primary)
const UPSTREAMS: Array<{ name: string; org: string | null; re: RegExp }> = [
  { name: "Amazon Web Services", org: null, re: /\b(aws|amazon web services|us-east-1|us-east-2|us-west-2|eu-west-1|eu-central-1|cloudfront|route ?53|dynamodb|amazon s3)\b/i },
  { name: "Cloudflare", org: "cloudflare.com", re: /\bcloudflare\b/i },
  { name: "Google Cloud", org: null, re: /\b(google cloud|gcp|gcs|cloud run|gke)\b/i },
  { name: "Microsoft Azure", org: null, re: /\b(azure|front door)\b/i },
  { name: "Fastly", org: null, re: /\bfastly\b/i },
  { name: "Akamai", org: null, re: /\bakamai\b/i },
];

async function statusFateStudy(services: Svc[]) {
  const DAYS = 84, TOL = 60 * MIN, WEEK = 7 * 86_400_000; // 12 whole weeks: rotations by whole weeks keep hour-of-week
  const t1 = Date.now(), t0 = t1 - DAYS * 86_400_000;
  const pages = (await sql<{ pageHost: string; n: number; oldest: Date; ulid: boolean }>`
    SELECT page_host AS "pageHost", count(*)::int AS n, min(created_at) AS oldest, bool_or(incident_id ~ '^[0-9A-Z]{26}$') AS ulid
    FROM status_incidents GROUP BY page_host`.execute(db)).rows;
  // a page is complete for the window if its history reaches back past t0, or the API returned fewer than its page limit
  const complete = new Set(pages.filter((p) => new Date(p.oldest).getTime() < t0 || p.n < (p.ulid ? 25 : 50)).map((p) => p.pageHost));
  const rows = await db.selectFrom("statusIncidents").select(["incidentId", "org", "pageHost", "createdAt", "impact", "name"])
    .where("createdAt", ">=", new Date(t0)).where("impact", "in", ["minor", "major", "critical"]).orderBy("org").execute();
  const seen = new Set<string>();
  const times = new Map<string, number[]>();
  const titled: Array<{ org: string; t: number; name: string }> = [];
  for (const r of rows) {
    if (!complete.has(r.pageHost) || seen.has(r.incidentId)) continue; // mirrored pages (Twilio/SendGrid) count once
    seen.add(r.incidentId);
    const t = new Date(r.createdAt).getTime();
    (times.get(r.org) ?? times.set(r.org, []).get(r.org)!).push(t);
    titled.push({ org: r.org, t, name: r.name });
  }
  // infrastructure of each organisation with a status page = most common value over its monitored services
  const byOrg = new Map<string, Svc[]>();
  for (const s of services) {
    const o = statusOrg(s.org);
    if (o && s.category !== "Cloud region canary") (byOrg.get(o) ?? byOrg.set(o, []).get(o)!).push(s);
  }
  const completeOrgs = [...new Set(Object.entries(STATUS_PAGES).filter(([, h]) => complete.has(h)).map(([o]) => o))].filter((o) => byOrg.has(o));
  for (const o of completeOrgs) if (!times.has(o)) times.set(o, []);
  for (const o of [...times.keys()]) if (!byOrg.has(o)) times.delete(o);
  const layer = (f: (s: Svc) => string | null) => new Map(completeOrgs.map((o) => [o, mode(byOrg.get(o)!.map(f))] as [string, string | null]).filter((x): x is [string, string] => !!x[1]));
  const groups: Record<string, Map<string, string>> = {
    "Cloud region": layer((s) => (s.hostingProvider && s.hostingRegion ? `${s.hostingProvider} ${s.hostingRegion}` : null)),
    "Hosting provider": layer((s) => s.hostingProvider),
    CDN: layer((s) => s.cdn),
    "DNS provider": layer((s) => (s.dnsProvider && !/^Other \(/.test(s.dnsProvider) ? s.dnsProvider : null)),
  };
  const host = [...groups["Hosting provider"]];
  const r = rng(31);
  const shuffled = host.map(([, g]) => g).sort(() => r() - 0.5);
  groups["Negative control (random groups)"] = new Map(host.map(([org], i) => [org, shuffled[i]]));
  const span: [number, number] = [t0, t1];
  const layers = eventFate(times, groups, span, TOL, 1000, 17, WEEK);
  // injection-recovery check (positive control): plant 4 shared upstream events across 10 random organisations
  // (each declares within 30 min) into a copy of the real data, and verify the test recovers them.
  const ri = rng(37);
  const planted = [...times.keys()].sort(() => ri() - 0.5).slice(0, 10);
  const injected = new Map([...times].map(([o, ts]) => [o, [...ts]]));
  for (let e = 0; e < 4; e++) {
    const at = t0 + Math.floor(ri() * (t1 - t0 - 3_600_000));
    for (const o of planted) injected.get(o)!.push(at + Math.floor(ri() * 30 * MIN));
  }
  const [positive] = eventFate(injected, { "Positive control (4 planted shared events)": new Map(planted.map((o) => [o, "planted"])) }, span, TOL, 1000, 23, WEEK);
  layers.push(positive);

  // per provider (hosting, CDN, DNS providers with >= 5 organisations), Holm-adjusted for multiple testing
  const perProvider: Array<EventFateLayer & { kind: string; pAdj?: number }> = [];
  for (const kind of ["Hosting provider", "CDN", "DNS provider"]) {
    const counts = new Map<string, number>();
    for (const g of groups[kind].values()) counts.set(g, (counts.get(g) ?? 0) + 1);
    for (const [prov, n] of counts) if (n >= 5) {
      const only = new Map([...groups[kind]].filter(([, g]) => g === prov));
      perProvider.push({ ...eventFate(times, { [prov]: only }, span, TOL, 1000, 19, WEEK)[0], kind });
    }
  }
  const adj = holm(perProvider.map((x) => x.p));
  perProvider.forEach((x, i) => { x.pAdj = adj[i]; });

  // upstream incidents named on several organisations' status pages within 6 hours
  const named: Array<{ upstream: string; from: string; organisations: string[]; titles: string[] }> = [];
  for (const u of UPSTREAMS) {
    const hits = titled.filter((x) => x.org !== u.org && u.re.test(x.name)).sort((a, b) => a.t - b.t);
    let cur: typeof hits = [];
    const flush = () => {
      const orgs = [...new Set(cur.map((c) => c.org))];
      if (orgs.length >= 2) named.push({ upstream: u.name, from: new Date(cur[0].t).toISOString(), organisations: orgs, titles: cur.slice(0, 4).map((c) => c.name) });
      cur = [];
    };
    for (const h of hits) { if (cur.length && h.t - cur[cur.length - 1].t > 6 * 3_600_000) flush(); cur.push(h); }
    flush();
  }
  return {
    rule: RESEARCH_VERSIONS.sharedFate, days: DAYS, toleranceMinutes: TOL / MIN, from: new Date(t0).toISOString(), to: new Date(t1).toISOString(),
    organisations: times.size, incidents: [...times.values()].reduce((s, x) => s + x.length, 0), completePages: complete.size,
    layers, perProvider: perProvider.sort((a, b) => (a.pAdj ?? 1) - (b.pAdj ?? 1)),
    namedUpstreamEvents: named.sort((a, b) => b.from.localeCompare(a.from)).slice(0, 20),
    namedUpstreamCount: named.length,
  };
}

// ---------------------------------------------------------------- 5. concentration (conc-v1)
function concentrationStudy(services: Svc[]) {
  const svc = services.filter((s) => s.category !== "Cloud region canary");
  const byOrg = new Map<string, Svc[]>();
  for (const s of svc) (byOrg.get(s.org) ?? byOrg.set(s.org, []).get(s.org)!).push(s);
  const orgs = [...byOrg.values()];
  const pick = (f: (s: Svc) => string | null) => orgs.map((l) => mode(l.map(f)));
  const layers = {
    "Hosting provider": concentration(pick((s) => s.hostingProvider)),
    "Cloud region": concentration(pick((s) => (s.hostingProvider && s.hostingRegion ? `${s.hostingProvider} ${s.hostingRegion}` : null))),
    CDN: concentration(pick((s) => s.cdn)),
    "DNS provider": concentration(pick((s) => (s.dnsProvider && !/^Other \(/.test(s.dnsProvider) ? s.dnsProvider : null))),
    "Email provider": concentration(pick((s) => s.emailProvider)),
  };
  // blast radius: organisations that depend on a provider in ANY layer (hosting, CDN or DNS)
  const reach = new Map<string, Set<string>>();
  for (const [org, list] of byOrg) for (const s of list) for (const p of [s.hostingProvider, s.cdn, s.dnsProvider]) {
    if (!p || /^Other \(/.test(p)) continue;
    (reach.get(p) ?? reach.set(p, new Set()).get(p)!).add(org);
  }
  const blast = [...reach].map(([provider, set]) => ({ provider, organisations: set.size, share: set.size / byOrg.size }))
    .sort((a, b) => b.organisations - a.organisations).slice(0, 12);
  return { rule: RESEARCH_VERSIONS.concentration, organisations: byOrg.size, services: svc.length, layers, blastRadius: blast,
    systemicProviders: blast.filter((b) => b.share >= 0.1).length };
}

// ---------------------------------------------------------------- orchestration
export async function computeResearch() {
  const services = await loadServices();
  const [val, sfRadar, sf] = await Promise.all([validation(services), sharedFateStudy(services), statusFateStudy(services)]);
  const result = {
    computedAt: new Date().toISOString(), versions: RESEARCH_VERSIONS,
    groundTruth: (await mppStore.get("research:groundTruth:last")) as { at: string; pages: number; ok: number; rows: number; failed: string[] } | null,
    validation: val, sharedFate: sf, sharedFateRadar: sfRadar, concentration: concentrationStudy(services),
  };
  await mppStore.put(CACHE, result);
  return result;
}
export type ResearchOverview = Awaited<ReturnType<typeof computeResearch>>;

export async function getResearch(): Promise<ResearchOverview> {
  const cached = (await mppStore.get(CACHE)) as ResearchOverview | null;
  if (cached && Date.now() - new Date(cached.computedAt).getTime() < 2 * 3_600_000) return cached;
  return computeResearch();
}

export async function researchJob() {
  const gotLock = await mppStore.update<boolean>("research:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 20 * MIN) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };
  await persistMeasurements();
  const r = await computeResearch();
  return { ran: true, groundTruth: r.groundTruth, validationIncidents: r.validation?.officialIncidents ?? null, statusIncidents: r.sharedFate.incidents, sweeps: r.sharedFateRadar?.sweeps ?? null };
}
