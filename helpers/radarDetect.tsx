/**
 * Pure incident-detection logic of the Internet Outage Radar (no I/O, fully unit-tested).
 *
 * Rules
 *  - DOWN = failed in the current AND the previous sweep (one failure = degraded, never an incident).
 *  - ELIGIBILITY: only services our node has reached successfully at least once can count as DOWN.
 *    New targets behind bot walls (Akamai Bot Manager etc.) time out from the first probe; counting them
 *    produced a false "Akamai outage" on 2026-10-08. They are pruned instead.
 *  - VANTAGE GUARD: if more than 50% of all probes fail in a sweep, our own measurement node is suspect:
 *    no incidents at all.
 *  - A group = services sharing a hosting region, hosting provider, CDN or DNS provider.
 *  - An incident fires when, in a group of n >= 3 services, the number of DOWN services reaches
 *      n <= 30 : max(3, ceil(25% of n))
 *      n  > 30 : max(6, ceil(10% of n))
 *    or, for a cloud region, its regional canary is DOWN and at least 2 services of that region are DOWN.
 *  - Provider-wide groups are suppressed when a single region of that provider explains the failures
 *    (the region incident is the more precise blast radius).
 */
export type DetectService = {
  id: string; name: string;
  hostingProvider: string | null; hostingRegion: string | null; cdn: string | null; dnsProvider: string | null;
  canary?: boolean;
};
export type DetectProbe = { serviceId: string; ok: boolean };
export type IncidentDecision = {
  layer: "region" | "hosting" | "cdn" | "dns"; provider: string; groupSize: number;
  affected: Array<{ id: string; name: string }>; atRisk: Array<{ id: string; name: string }>; share: number; canaryDown: boolean;
};

export function incidentThreshold(n: number) {
  return n <= 30 ? Math.max(3, Math.ceil(0.25 * n)) : Math.max(6, Math.ceil(0.1 * n));
}

function groupsOf(s: DetectService) {
  const g: Array<{ layer: IncidentDecision["layer"]; provider: string }> = [];
  if (s.hostingProvider && s.hostingRegion) g.push({ layer: "region", provider: `${s.hostingProvider} ${s.hostingRegion}` });
  if (s.hostingProvider) g.push({ layer: "hosting", provider: s.hostingProvider });
  if (s.cdn) g.push({ layer: "cdn", provider: s.cdn });
  if (s.dnsProvider && !/^Other \(/.test(s.dnsProvider)) g.push({ layer: "dns", provider: s.dnsProvider });
  return g;
}

export function detectIncidents(
  services: DetectService[], current: DetectProbe[], previousOk: Map<string, boolean>, everReached?: Set<string>,
) {
  const now = new Map(current.map((p) => [p.serviceId, p.ok]));
  const failShare = current.filter((p) => !p.ok).length / Math.max(current.length, 1);
  if (failShare > 0.5) return { vantageSuspect: true, down: new Set<string>(), incidents: [] as IncidentDecision[] };

  const eligible = (id: string) => !everReached || everReached.has(id);
  const down = new Set(services.filter((s) => now.get(s.id) === false && previousOk.get(s.id) === false && eligible(s.id)).map((s) => s.id));
  const groups = new Map<string, { layer: IncidentDecision["layer"]; provider: string; members: DetectService[] }>();
  for (const s of services) for (const g of groupsOf(s)) {
    const k = `${g.layer}|${g.provider}`;
    if (!groups.has(k)) groups.set(k, { ...g, members: [] });
    groups.get(k)!.members.push(s);
  }

  const incidents: IncidentDecision[] = [];
  for (const g of groups.values()) {
    const n = g.members.length;
    const failing = g.members.filter((m) => down.has(m.id));
    const canaryDown = g.layer === "region" && g.members.some((m) => m.canary && down.has(m.id));
    const nonCanaryFailing = failing.filter((m) => !m.canary).length;
    if (n < 3 || !(failing.length >= incidentThreshold(n) || (canaryDown && nonCanaryFailing >= 2))) continue;
    incidents.push({
      layer: g.layer, provider: g.provider, groupSize: n, canaryDown, share: failing.length / n,
      affected: failing.map((m) => ({ id: m.id, name: m.name })),
      atRisk: g.members.filter((m) => !down.has(m.id)).map((m) => ({ id: m.id, name: m.name })),
    });
  }

  // A region incident is the most precise diagnosis. Provider-, DNS- and CDN-wide incidents whose failing
  // services are already explained by a region incident would be a misdiagnosis (e.g. us-east-1 down also
  // makes "Route 53 DNS" look down because those services use it) -> keep them only if enough failures remain.
  const regional = incidents.filter((i) => i.layer === "region");
  const explained = new Set(regional.flatMap((r) => r.affected.map((a) => a.id)));
  const filtered = incidents.filter((i) => {
    if (i.layer === "region" || explained.size === 0) return true;
    const unexplained = i.affected.filter((a) => !explained.has(a.id)).length;
    return unexplained >= incidentThreshold(i.groupSize);
  });
  return { vantageSuspect: false, down, incidents: filtered };
}

// ---------------------------------------------------------------------------------------------------------------
// Early warning, rule ew-v2 (ew-v1 retired 2026-10-09 after 0 of 10 warnings were confirmed: the same three hosts
// per region intermittently gained ~+1.8 s together, a measurement-origin artefact, not a provider problem).
// A member is DEGRADED when it is >= 2.5x its own 24h median latency AND >= +400 ms, or fails with a healthy baseline.
// Independence: members are counted per ORGANISATION (registrable domain) — several endpoints of one company are one
// voice. A group needs >= 8 baselined organisations and >= max(4, 30%) of them degraded, and no open incident.
// More than half of all baselined services degraded => vantage suspect, nothing raised. Warnings explained by a
// regional warning are dropped. The job additionally re-probes candidates once and requires two consecutive sweeps.
// ---------------------------------------------------------------------------------------------------------------
export const EARLY_WARNING_RULE = "ew-v2";
export type DegradeService = DetectService & { latencyMs: number | null; ok: boolean; baselineMs: number | null; baselineN: number; org?: string };
export type WarningDecision = { layer: IncidentDecision["layer"]; provider: string; groupSize: number; degraded: Array<{ id: string; name: string; latencyMs: number | null; baselineMs: number | null }> };

export function isDegraded(s: DegradeService) {
  if (s.baselineN < 12 || s.baselineMs === null) return false;
  if (!s.ok) return true;
  return s.latencyMs !== null && s.latencyMs >= Math.max(2.5 * s.baselineMs, s.baselineMs + 400);
}

export function detectDegradation(services: DegradeService[], groupsWithIncident: Set<string>) {
  const baselined = services.filter((s) => s.baselineN >= 12 && s.baselineMs !== null);
  const degradedAll = baselined.filter(isDegraded);
  if (baselined.length >= 20 && degradedAll.length / baselined.length > 0.5) return { vantageSuspect: true, warnings: [] as WarningDecision[] };
  const groups = new Map<string, { layer: IncidentDecision["layer"]; provider: string; members: DegradeService[] }>();
  for (const s of baselined) for (const g of groupsOf(s)) {
    const k = `${g.layer}|${g.provider}`;
    if (!groups.has(k)) groups.set(k, { ...g, members: [] });
    groups.get(k)!.members.push(s);
  }
  const warnings: WarningDecision[] = [];
  for (const [k, g] of groups) {
    const orgOf = (m: DegradeService) => m.org ?? m.id;
    const n = new Set(g.members.map(orgOf)).size;
    if (n < 8 || groupsWithIncident.has(k)) continue;
    const bad = g.members.filter(isDegraded);
    const badOrgs = new Set(bad.map(orgOf)).size;
    if (badOrgs < Math.max(4, Math.ceil(0.3 * n))) continue;
    warnings.push({ layer: g.layer, provider: g.provider, groupSize: n,
      degraded: bad.map((m) => ({ id: m.id, name: m.name, latencyMs: m.latencyMs, baselineMs: m.baselineMs })) });
  }
  const regional = new Set(warnings.filter((w) => w.layer === "region").flatMap((w) => w.degraded.map((d) => d.id)));
  const filtered = warnings.filter((w) => w.layer === "region" || regional.size === 0
    || w.degraded.filter((d) => !regional.has(d.id)).length >= Math.max(4, Math.ceil(0.3 * w.groupSize)));
  return { vantageSuspect: false, warnings: filtered };
}
