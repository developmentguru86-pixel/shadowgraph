/**
 * Upstream Signals, rule cs-v1 (pure logic, unit-tested).
 *
 * Idea: when several independent companies that share an infrastructure provider declare incidents on their own
 * status pages within a short window, the shared provider is the likely cause, even if the provider says nothing.
 *
 *  - Groups: companies sharing a cloud region, hosting provider, CDN or DNS provider (from the dependency map).
 *  - Window: incidents declared within 60 minutes by >= 2 distinct companies of one group.
 *  - Surprise: probability that at least k of the group's n companies declare within the window by chance, from each
 *    company's own incident rate (84-day history) scaled by the hour-of-week rhythm of all declarations
 *    (Poisson-binomial tail). Fires when p < alpha (pre-specified 0.001).
 *  - Events of one group within 2 hours are merged; overlapping events whose company sets nest are merged and keep
 *    every shared provider as a candidate, ordered by surprise.
 *  - Evidence tiers: CONFIRMED (the provider's own status page or health feed reports an overlapping incident),
 *    NAMED (a company's incident title names the provider), STATISTICAL (neither).
 */
export const UPSTREAM_RULE = "cs-v1";
const MIN = 60_000, H = 3_600_000;
export const DEFAULT_UPSTREAM_OPTS = { windowMs: 60 * MIN, alpha: 1e-3, mergeGapMs: 2 * H };

export type OrgIncident = { org: string; t: number; id: string; title: string; impact: string; link: string | null };
export type Layer = "region" | "hosting" | "cdn" | "dns";
export type Group = { layer: Layer; provider: string; members: string[] };
export type Candidate = { layer: Layer; provider: string; groupSize: number; p: number };
export type UpstreamEvent = {
  openedAt: number; firedAt: number; lastAt: number; p: number;
  candidates: Candidate[]; orgs: string[]; incidents: OrgIncident[];
};

export const hourOfWeek = (t: number) => { const d = new Date(t); return d.getUTCDay() * 24 + d.getUTCHours(); };

/** Relative declaration intensity per hour of week (mean 1), add-one smoothed. */
export function seasonality(times: number[]) {
  const c = new Array(168).fill(1);
  for (const t of times) c[hourOfWeek(t)]++;
  const mean = c.reduce((s, x) => s + x, 0) / 168;
  return c.map((x) => x / mean);
}

/** P(at least k successes) for independent Bernoulli trials with probabilities ps. */
export function poissonBinomialTail(ps: number[], k: number) {
  if (k <= 0) return 1;
  let dp = new Array(ps.length + 1).fill(0);
  dp[0] = 1;
  ps.forEach((p, i) => {
    const next = new Array(ps.length + 1).fill(0);
    for (let j = 0; j <= i; j++) {
      next[j] += dp[j] * (1 - p);
      next[j + 1] += dp[j] * p;
    }
    dp = next;
  });
  let tail = 0;
  for (let j = k; j <= ps.length; j++) tail += dp[j];
  return Math.min(1, Math.max(0, tail));
}

export function detectUpstream(
  incidents: OrgIncident[], groups: Group[], ratePerHour: Map<string, number>, season: number[],
  opts = DEFAULT_UPSTREAM_OPTS,
): UpstreamEvent[] {
  const W = opts.windowMs;
  const raw: Array<UpstreamEvent & { key: string }> = [];
  for (const g of groups) {
    if (g.members.length < 2) continue;
    const mem = new Set(g.members);
    const fam = familyOf(g.provider);
    // an incident whose title blames a DIFFERENT provider family is not evidence against this group's provider
    const incs = incidents.filter((i) => {
      if (!mem.has(i.org)) return false;
      const named = namedFamilies(i.title);
      return named.length === 0 || named.includes(fam);
    }).sort((a, b) => a.t - b.t);
    let cur: (UpstreamEvent & { key: string }) | null = null;
    for (let i = 0, lo = 0; i < incs.length; i++) {
      const t = incs[i].t;
      while (t - incs[lo].t > W) lo++;
      const win = incs.slice(lo, i + 1);
      const orgs = new Set(win.map((x) => x.org));
      if (cur && t - cur.lastAt <= opts.mergeGapMs && t - cur.firedAt <= 6 * H) {
        // late joiners of an open event: member incidents inside the merge gap extend it (events last at most 6 h)
        for (const x of win) if (!cur.incidents.some((y) => y.id === x.id)) cur.incidents.push(x);
        cur.lastAt = t;
        cur.orgs = [...new Set(cur.incidents.map((x) => x.org))];
      }
      if (orgs.size < 2) continue;
      const f = season[hourOfWeek(t)] ?? 1;
      const ps = g.members.map((o) => 1 - Math.exp(-(ratePerHour.get(o) ?? 0) * f * (W / H)));
      const p = poissonBinomialTail(ps, orgs.size);
      if (p >= opts.alpha) continue;
      if (cur && t - cur.lastAt <= opts.mergeGapMs && t - cur.firedAt <= 6 * H) {
        cur.p = Math.min(cur.p, p);
        cur.candidates[0].p = cur.p;
      } else {
        cur = {
          key: `${g.layer}|${g.provider}|${t}`, openedAt: win[0].t, firedAt: t, lastAt: t, p,
          candidates: [{ layer: g.layer, provider: g.provider, groupSize: g.members.length, p }],
          orgs: [...orgs], incidents: [...win],
        };
        raw.push(cur);
      }
    }
  }
  // merge overlapping events whose company sets nest (e.g. "AWS us-east-1" inside "AWS", or AWS + Route 53)
  raw.sort((a, b) => a.p - b.p);
  const out: UpstreamEvent[] = [];
  for (const e of raw) {
    const s = new Set(e.orgs);
    const host = out.find((o) => o.openedAt <= e.lastAt + opts.mergeGapMs && e.openedAt <= o.lastAt + opts.mergeGapMs
      && (o.orgs.every((x) => s.has(x)) || e.orgs.every((x) => o.orgs.includes(x))));
    if (!host) { const { key: _k, ...rest } = e; out.push({ ...rest, candidates: [...e.candidates], incidents: [...e.incidents] }); continue; }
    for (const c of e.candidates) if (!host.candidates.some((x) => x.layer === c.layer && x.provider === c.provider)) host.candidates.push(c);
    for (const x of e.incidents) if (!host.incidents.some((y) => y.id === x.id)) host.incidents.push(x);
    host.orgs = [...new Set(host.incidents.map((x) => x.org))];
    host.openedAt = Math.min(host.openedAt, e.openedAt);
    host.firedAt = Math.min(host.firedAt, e.firedAt);
    host.lastAt = Math.max(host.lastAt, e.lastAt);
    host.p = Math.min(host.p, e.p);
  }
  for (const e of out) { e.candidates.sort((a, b) => a.p - b.p); e.incidents.sort((a, b) => a.t - b.t); }
  return out.sort((a, b) => b.firedAt - a.firedAt);
}

// ------------------------------------------------------------------ evidence
export type ProviderIncident = {
  source: string; id: string; family: string; provider: string; region: string | null; title: string;
  startedAt: number; declaredAt: number; resolvedAt: number | null; link: string | null; severe: boolean;
};

export function familyOf(provider: string) {
  if (/amazon|aws/i.test(provider)) return "aws";
  if (/google/i.test(provider)) return "google";
  if (/cloudflare/i.test(provider)) return "cloudflare";
  if (/akamai/i.test(provider)) return "akamai";
  if (/azure|microsoft/i.test(provider)) return "azure";
  if (/fastly/i.test(provider)) return "fastly";
  if (/vercel/i.test(provider)) return "vercel";
  return provider.toLowerCase();
}
const NAME_RE: Record<string, RegExp> = {
  aws: /\b(aws|amazon web services|cloudfront|route ?53|dynamodb|amazon s3|ec2)\b/i,
  google: /\b(google cloud|gcp|gcs|gke|cloud run)\b/i,
  cloudflare: /\bcloudflare\b/i, akamai: /\bakamai\b/i, azure: /\b(azure|front door)\b/i, fastly: /\bfastly\b/i, vercel: /\bvercel\b/i,
};
export const namedFamilies = (title: string) => Object.entries(NAME_RE).filter(([, re]) => re.test(title)).map(([f]) => f);
const regionOf = (c: Candidate) => (c.layer === "region" ? c.provider.split(" ").pop() ?? null : null);

export type Evidence = { tier: "confirmed" | "named" | "statistical"; providerIncident: ProviderIncident | null; minutesVsProvider: number | null; namedBy: string[] };

export function classifyEvidence(e: UpstreamEvent, providerIncidents: ProviderIncident[]): Evidence {
  const fams = new Set(e.candidates.map((c) => familyOf(c.provider)));
  const regions = new Set(e.candidates.map(regionOf).filter((r): r is string => !!r));
  const match = providerIncidents
    .filter((pi) => fams.has(pi.family) && (!pi.region || regions.size === 0 || regions.has(pi.region)))
    // the provider must have STARTED its incident near the event; a long-running minor incident elsewhere does not confirm
    .filter((pi) => pi.startedAt >= e.openedAt - 2 * H && pi.startedAt <= e.lastAt + 2 * H)
    .sort((a, b) => Math.abs(a.startedAt - e.firedAt) - Math.abs(b.startedAt - e.firedAt))[0] ?? null;
  const namedBy = [...new Set(e.incidents.filter((i) => [...fams].some((f) => NAME_RE[f]?.test(i.title))
    || [...regions].some((r) => i.title.toLowerCase().includes(r))).map((i) => i.org))];
  return {
    tier: match ? "confirmed" : namedBy.length ? "named" : "statistical",
    providerIncident: match, namedBy,
    minutesVsProvider: match ? Math.round((e.firedAt - match.declaredAt) / MIN) : null,
  };
}
