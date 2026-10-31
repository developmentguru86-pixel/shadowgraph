import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { registrableDomain } from "./vendorScan";
import { statusOrg } from "./statusRegistry";
import { collectStatusIncidents, collectProviderIncidents } from "./statusIngest";
import { wilson, bootstrapMedianCI } from "./researchStats";
import {
  UPSTREAM_RULE, DEFAULT_UPSTREAM_OPTS, detectUpstream, classifyEvidence, seasonality, familyOf,
  type OrgIncident, type Group, type ProviderIncident, type UpstreamEvent, type Candidate, type Evidence,
} from "./upstreamDetect";

/**
 * Upstream Signals (rule cs-v1) — every 10 minutes:
 *  1. ingest official status pages of 182 companies and the providers' own incident records
 *  2. detect live events over the last 3 days and persist them (upstream_events)
 *  3. hourly: retrospective test over 84 days (track record, sensitivity to alpha, recall vs provider records)
 */
const MIN = 60_000, H = 3_600_000, DAY = 24 * H;
const HISTORY_DAYS = 84;
const BACKTEST_CACHE = "upstream:backtest:v2";
const IMPACTS = ["minor", "major", "critical"];

type OrgInfo = { org: string; name: string; region: string | null; hosting: string | null; cdn: string | null; dns: string | null };

const mode = (xs: Array<string | null>) => {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** Companies with a status page, mapped to their infrastructure (most common value over their monitored services). */
export async function loadOrgInfra() {
  const rows = await db.selectFrom("radarServices").select(["name", "probeUrl", "category", "hostingProvider", "hostingRegion", "cdn", "dnsProvider"])
    .where("active", "=", true).execute();
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.category === "Cloud region canary") continue;
    const org = statusOrg(registrableDomain(new URL(r.probeUrl).hostname));
    if (org) (by.get(org) ?? by.set(org, []).get(org)!).push(r);
  }
  const infra = new Map<string, OrgInfo>();
  for (const [org, list] of by) {
    const hosting = mode(list.map((s) => s.hostingProvider));
    infra.set(org, {
      org, name: list.map((s) => s.name.replace(/\s+(API|Dashboard|Console|App)$/i, "")).sort((a, b) => a.length - b.length)[0],
      hosting, region: mode(list.map((s) => (s.hostingProvider && s.hostingRegion ? `${s.hostingProvider} ${s.hostingRegion}` : null))),
      cdn: mode(list.map((s) => s.cdn)), dns: mode(list.map((s) => (s.dnsProvider && !/^Other \(/.test(s.dnsProvider) ? s.dnsProvider : null))),
    });
  }
  const groups: Group[] = [];
  const add = (layer: Group["layer"], key: (o: OrgInfo) => string | null) => {
    const m = new Map<string, string[]>();
    for (const o of infra.values()) { const k = key(o); if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(o.org); }
    for (const [provider, members] of m) if (members.length >= 2) groups.push({ layer, provider, members });
  };
  add("region", (o) => o.region); add("hosting", (o) => o.hosting); add("cdn", (o) => o.cdn); add("dns", (o) => o.dns);
  return { infra, groups };
}

/** Official incidents (minor or worse) since `since`, one row per incident even when mirrored on several pages. */
async function loadIncidents(since: number, orgs: Set<string>): Promise<OrgIncident[]> {
  const rows = await db.selectFrom("statusIncidents").select(["incidentId", "org", "createdAt", "name", "impact", "shortlink", "pageHost"])
    .where("createdAt", ">=", new Date(since)).where("impact", "in", IMPACTS).orderBy("org").execute();
  const seen = new Set<string>();
  const out: OrgIncident[] = [];
  for (const r of rows) {
    if (!orgs.has(r.org) || seen.has(r.incidentId)) continue;
    seen.add(r.incidentId);
    out.push({ org: r.org, t: new Date(r.createdAt).getTime(), id: r.incidentId, title: r.name, impact: r.impact, link: r.shortlink ?? `https://${r.pageHost}/` });
  }
  return out;
}

/** Each company's incident rate per hour over the history window (pages with shorter public history use their own span). */
async function loadRates(orgs: Set<string>, t0: number, now: number) {
  const rows = (await sql<{ org: string; n: number; oldest: Date; total: number; ulid: boolean }>`
    SELECT org, count(*) FILTER (WHERE created_at >= ${new Date(t0)} AND impact IN ('minor','major','critical'))::int AS n,
      min(created_at) AS oldest, count(*)::int AS total, bool_or(incident_id ~ '^[0-9A-Z]{26}$') AS ulid
    FROM status_incidents GROUP BY org`.execute(db)).rows;
  const hoursFull = (now - t0) / H;
  const rates = new Map<string, number>();
  for (const r of rows) {
    if (!orgs.has(r.org)) continue;
    const complete = new Date(r.oldest).getTime() <= t0 || r.total < (r.ulid ? 25 : 50);
    const hours = complete ? hoursFull : Math.max(24, (now - new Date(r.oldest).getTime()) / H);
    rates.set(r.org, Math.max(r.n, 1) / hours); // floor: one incident per window, never a zero rate
  }
  for (const o of orgs) if (!rates.has(o)) rates.set(o, 1 / hoursFull);
  return rates;
}

async function loadProviderIncidents(since: number): Promise<ProviderIncident[]> {
  const rows = await db.selectFrom("providerIncidents").selectAll().where("startedAt", ">=", new Date(since)).execute();
  return rows.map((r) => ({
    source: r.source, id: r.incidentId, family: r.family, provider: r.provider, region: r.region, title: r.title,
    startedAt: new Date(r.startedAt).getTime(), declaredAt: new Date(r.declaredAt).getTime(),
    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).getTime() : null, link: r.link, severe: r.severe,
  }));
}

export type PublicEvent = {
  id: string; openedAt: string; firedAt: string; lastAt: string; p: number; tier: Evidence["tier"];
  candidates: Candidate[]; namedBy: string[]; minutesVsProvider: number | null;
  providerIncident: { title: string; source: string; declaredAt: string; link: string | null } | null;
  companies: Array<{ org: string; name: string; title: string; impact: string; at: string; link: string | null }>;
};

function toPublic(e: UpstreamEvent, ev: Evidence, infra: Map<string, OrgInfo>): PublicEvent {
  return {
    id: `cs1-${e.incidents[0].id}`, openedAt: new Date(e.openedAt).toISOString(), firedAt: new Date(e.firedAt).toISOString(),
    lastAt: new Date(e.lastAt).toISOString(), p: e.p, tier: ev.tier, candidates: e.candidates, namedBy: ev.namedBy,
    minutesVsProvider: ev.minutesVsProvider,
    providerIncident: ev.providerIncident ? { title: ev.providerIncident.title, source: ev.providerIncident.source,
      declaredAt: new Date(ev.providerIncident.declaredAt).toISOString(), link: ev.providerIncident.link } : null,
    companies: e.incidents.map((i) => ({ org: i.org, name: infra.get(i.org)?.name ?? i.org, title: i.title, impact: i.impact, at: new Date(i.t).toISOString(), link: i.link })),
  };
}

async function context(now: number) {
  const { infra, groups } = await loadOrgInfra();
  const orgs = new Set(infra.keys());
  const t0 = now - HISTORY_DAYS * DAY;
  const [history, rates, provider] = await Promise.all([loadIncidents(t0, orgs), loadRates(orgs, t0, now), loadProviderIncidents(t0 - 2 * DAY)]);
  return { infra, groups, orgs, t0, history, rates, season: seasonality(history.map((i) => i.t)), provider };
}

// ---------------------------------------------------------------- live
async function detectLive() {
  const now = Date.now();
  const c = await context(now);
  const recent = c.history.filter((i) => i.t >= now - 3 * DAY);
  const events = detectUpstream(recent, c.groups, c.rates, c.season);
  // the last 3 days are re-evaluated every run (impacts get upgraded/downgraded): drop rows the rule no longer supports
  const ids = events.map((e) => `cs1-${[...e.incidents].sort((a, b) => a.t - b.t)[0].id}`);
  let stale = db.deleteFrom("upstreamEvents").where("firedAt", ">=", new Date(now - 3 * DAY + 2 * H));
  if (ids.length) stale = stale.where("id", "not in", ids);
  await stale.execute();
  for (const e of events) {
    const ev = classifyEvidence(e, c.provider);
    const pub = toPublic(e, ev, c.infra);
    const j = <T,>(v: T) => v as never;
    await db.insertInto("upstreamEvents").values({
      id: pub.id, rule: UPSTREAM_RULE, openedAt: new Date(e.openedAt), firedAt: new Date(e.firedAt), lastAt: new Date(e.lastAt), p: e.p,
      candidates: j(pub.candidates), incidents: j(pub.companies), orgs: e.orgs.length, tier: ev.tier,
      providerIncident: pub.providerIncident ? j(pub.providerIncident) : null, minutesVsProvider: ev.minutesVsProvider,
    }).onConflict((oc) => oc.column("id").doUpdateSet({
      lastAt: new Date(e.lastAt), p: e.p, candidates: j(pub.candidates), incidents: j(pub.companies), orgs: e.orgs.length, tier: ev.tier,
      providerIncident: pub.providerIncident ? j(pub.providerIncident) : null, minutesVsProvider: ev.minutesVsProvider, updatedAt: sql`now()`,
    })).execute();
  }
  return { events: events.length, companies: c.orgs.size, groups: c.groups.length };
}

// ---------------------------------------------------------------- retrospective test
export async function computeBacktest() {
  const now = Date.now();
  const c = await context(now);
  const weeks = HISTORY_DAYS / 7;
  const run = (alpha: number) => detectUpstream(c.history, c.groups, c.rates, c.season, { ...DEFAULT_UPSTREAM_OPTS, alpha });
  const sensitivity = [1e-2, 1e-3, 1e-4].map((alpha) => {
    const evs = run(alpha);
    const tiers = evs.map((e) => classifyEvidence(e, c.provider).tier);
    const supported = tiers.filter((t) => t !== "statistical").length;
    return { alpha, events: evs.length, perWeek: evs.length / weeks, supported: wilson(supported, evs.length), confirmed: tiers.filter((t) => t === "confirmed").length };
  });
  const events = run(DEFAULT_UPSTREAM_OPTS.alpha);
  const classified = events.map((e) => ({ e, ev: classifyEvidence(e, c.provider) }));
  const tiers = { confirmed: 0, named: 0, statistical: 0 };
  for (const x of classified) tiers[x.ev.tier]++;

  // recall against the providers' own significant incidents, for providers present in the dependency map
  const fams = new Set(c.groups.map((g) => familyOf(g.provider)));
  const severe = c.provider.filter((p) => p.severe && p.startedAt >= c.t0 && fams.has(p.family));
  const orgFamilies = (o: OrgInfo) => [o.hosting, o.cdn, o.dns].filter((x): x is string => !!x).map(familyOf);
  const judged = severe.map((pi) => {
    const lo = pi.startedAt - 2 * H, hi = (pi.resolvedAt ?? pi.startedAt + 6 * H) + 2 * H;
    const dependents = [...c.infra.values()].filter((o) => orgFamilies(o).includes(pi.family)
      && (!pi.region || !o.region || !/amazon|google/i.test(o.region) || o.region.endsWith(` ${pi.region}`)));
    const declaring = new Set(c.history.filter((i) => i.t >= lo && i.t <= hi && dependents.some((d) => d.org === i.org)).map((i) => i.org));
    const hit = classified.find((x) => x.ev.providerIncident?.id === pi.id
      || (x.e.candidates.some((cand) => familyOf(cand.provider) === pi.family) && x.e.openedAt <= hi && lo <= x.e.lastAt));
    return { pi, visible: declaring.size >= 2, detected: !!hit, declaring: declaring.size };
  });
  const deltas = classified.filter((x) => x.ev.minutesVsProvider !== null).map((x) => x.ev.minutesVsProvider!);
  const result = {
    rule: UPSTREAM_RULE, computedAt: new Date(now).toISOString(), days: HISTORY_DAYS, alpha: DEFAULT_UPSTREAM_OPTS.alpha,
    windowMinutes: DEFAULT_UPSTREAM_OPTS.windowMs / MIN, companies: c.orgs.size, groups: c.groups.length, incidents: c.history.length,
    events: events.length, perWeek: events.length / weeks, tiers, supported: wilson(tiers.confirmed + tiers.named, events.length),
    recall: {
      all: wilson(judged.filter((x) => x.detected).length, judged.length),
      visible: wilson(judged.filter((x) => x.visible && x.detected).length, judged.filter((x) => x.visible).length),
      providerIncidents: judged.sort((a, b) => b.pi.startedAt - a.pi.startedAt).slice(0, 15).map((x) => ({
        provider: x.pi.provider, region: x.pi.region, title: x.pi.title, startedAt: new Date(x.pi.startedAt).toISOString(),
        link: x.pi.link, dependentsDeclaring: x.declaring, detected: x.detected,
      })),
    },
    vsProvider: { ...bootstrapMedianCI(deltas), earlier: deltas.filter((d) => d < 0).length },
    sensitivity,
    recent: classified.slice(0, 25).map((x) => toPublic(x.e, x.ev, c.infra)),
  };
  await mppStore.put(BACKTEST_CACHE, result);
  return result;
}
export type UpstreamBacktest = Awaited<ReturnType<typeof computeBacktest>>;

export async function getUpstream() {
  const [rows, bt, ingest, providerSrc] = await Promise.all([
    db.selectFrom("upstreamEvents").selectAll().where("firedAt", ">", new Date(Date.now() - 30 * DAY)).orderBy("firedAt", "desc").limit(60).execute(),
    mppStore.get(BACKTEST_CACHE) as Promise<UpstreamBacktest | null>,
    mppStore.get("research:groundTruth:last") as Promise<{ at: string; ok: number; pages: number } | null>,
    mppStore.get("upstream:providerSources:last") as Promise<{ at: string; result: Record<string, number | string> } | null>,
  ]);
  const backtest = bt && Date.now() - new Date(bt.computedAt).getTime() < 3 * H ? bt : await computeBacktest();
  const events: PublicEvent[] = rows.map((r) => ({
    id: r.id, openedAt: new Date(r.openedAt).toISOString(), firedAt: new Date(r.firedAt).toISOString(), lastAt: new Date(r.lastAt).toISOString(),
    p: r.p, tier: r.tier as Evidence["tier"], candidates: r.candidates as unknown as Candidate[], namedBy: [], minutesVsProvider: r.minutesVsProvider,
    providerIncident: r.providerIncident as PublicEvent["providerIncident"], companies: r.incidents as unknown as PublicEvent["companies"],
  }));
  const liveSince = (await sql<{ first: Date | null }>`SELECT min(first_seen_at) AS first FROM upstream_events`.execute(db)).rows[0]?.first ?? null;
  return {
    rule: UPSTREAM_RULE, generatedAt: new Date().toISOString(), lastIngest: ingest, providerSources: providerSrc,
    liveSince: liveSince ? new Date(liveSince).toISOString() : null,
    active: events.filter((e) => Date.now() - new Date(e.lastAt).getTime() < 3 * H),
    events, backtest,
  };
}
export type UpstreamOverview = Awaited<ReturnType<typeof getUpstream>>;

export async function upstreamJob() {
  const gotLock = await mppStore.update<boolean>("upstream:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 8 * MIN) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };
  const status = await collectStatusIncidents();
  const providers = await collectProviderIncidents();
  const live = await detectLive();
  const bt = (await mppStore.get(BACKTEST_CACHE)) as UpstreamBacktest | null;
  if (!bt || Date.now() - new Date(bt.computedAt).getTime() > H) await computeBacktest();
  return { ran: true, status: { ok: status.ok, rows: status.rows }, providers, live };
}
