/**
 * Pure statistics for ShadowGraph Research (no I/O, unit-tested, deterministic with a fixed seed).
 *  - wilson(): 95% Wilson score interval for a proportion
 *  - bootstrapMedianCI(): percentile bootstrap CI for a median
 *  - sharedFate(): circular-shift permutation test for correlated failures within infrastructure groups
 *  - concentration(): provider shares and Herfindahl-Hirschman index
 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Proportion = { k: number; n: number; p: number | null; lo: number | null; hi: number | null };

export function wilson(k: number, n: number, z = 1.96): Proportion {
  if (n <= 0) return { k, n, p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function bootstrapMedianCI(xs: number[], reps = 2000, seed = 7) {
  const med = median(xs);
  if (xs.length < 3 || med === null) return { median: med, lo: null, hi: null, n: xs.length };
  const r = rng(seed);
  const meds: number[] = [];
  for (let b = 0; b < reps; b++) {
    const sample = Array.from({ length: xs.length }, () => xs[Math.floor(r() * xs.length)]);
    meds.push(median(sample)!);
  }
  meds.sort((a, b) => a - b);
  return { median: med, lo: meds[Math.floor(0.025 * reps)], hi: meds[Math.floor(0.975 * reps)], n: xs.length };
}

/** Do two closed intervals [a0,a1] and [b0,b1] overlap? */
export const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 <= b1 && b0 <= a1;

export type SharedFateInput = {
  T: number;                                  // number of measurement sweeps (time steps)
  failures: Map<string, number[]>;            // service id -> sweep indices where the service failed
  groups: Record<string, Map<string, string>>; // layer -> (service id -> group key); services without a key are omitted
};
export type SharedFateLayer = {
  layer: string; observed: number; expected: number; nullLo: number; nullHi: number; lift: number | null; p: number;
};

/** Number of co-failing pairs that share a group in this layer, summed over sweeps. */
function coFailPairs(T: number, fails: Map<string, number[]>, groupOf: Map<string, string>, shift?: Map<string, number>) {
  const buckets = new Map<string, number>();
  for (const [id, idx] of fails) {
    const g = groupOf.get(id);
    if (!g) continue;
    const off = shift?.get(id) ?? 0;
    for (const t of idx) {
      const k = `${(t + off) % T}|${g}`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
  }
  let pairs = 0;
  for (const c of buckets.values()) pairs += (c * (c - 1)) / 2;
  return pairs;
}

/**
 * Null model: every service's failure series is rotated by an independent random offset. This keeps each service's
 * failure rate and its own temporal clustering, and destroys only the cross-sectional alignment between services.
 * Lift = observed co-failing pairs / mean under the null; p = one-sided permutation p-value (add-one corrected).
 */
export function sharedFate(input: SharedFateInput, reps = 500, seed = 11): SharedFateLayer[] {
  const r = rng(seed);
  const ids = [...input.failures.keys()];
  const layers = Object.keys(input.groups);
  const observed = Object.fromEntries(layers.map((l) => [l, coFailPairs(input.T, input.failures, input.groups[l])]));
  const nulls: Record<string, number[]> = Object.fromEntries(layers.map((l) => [l, [] as number[]]));
  for (let b = 0; b < reps; b++) {
    const shift = new Map(ids.map((id) => [id, Math.floor(r() * input.T)]));
    for (const l of layers) nulls[l].push(coFailPairs(input.T, input.failures, input.groups[l], shift));
  }
  return layers.map((l) => {
    const xs = nulls[l].sort((a, b) => a - b);
    const expected = xs.reduce((s, x) => s + x, 0) / reps;
    const ge = xs.filter((x) => x >= observed[l]).length;
    return {
      layer: l, observed: observed[l], expected,
      nullLo: xs[Math.floor(0.025 * reps)], nullHi: xs[Math.min(reps - 1, Math.floor(0.975 * reps))],
      lift: expected > 0 ? observed[l] / expected : null, p: (ge + 1) / (reps + 1),
    };
  });
}

/**
 * Shared fate on continuous event times (official incident declarations).
 * Statistic: pairs of incidents from DIFFERENT organisations of the same group declared within `tolMs` of each other.
 * Null: each organisation's incident times are rotated by an independent random offset inside [t0, t1)
 * (keeps every organisation's incident rate and its own clustering; destroys cross-organisation alignment).
 */
export type EventFateLayer = SharedFateLayer & { groups: number; organisations: number; incidents: number };

function closePairs(events: Array<{ org: string; t: number }>, tolMs: number) {
  const s = [...events].sort((a, b) => a.t - b.t);
  let pairs = 0;
  for (let i = 0, j = 0; i < s.length; i++) {
    while (s[i].t - s[j].t > tolMs) j++;
    for (let k = j; k < i; k++) if (s[k].org !== s[i].org) pairs++;
  }
  return pairs;
}

export function eventFate(
  times: Map<string, number[]>, groups: Record<string, Map<string, string>>, span: [number, number], tolMs: number, reps = 1000, seed = 17,
  shiftUnitMs = 1,
): EventFateLayer[] {
  const [t0, t1] = span;
  const L = t1 - t0;
  const r = rng(seed);
  // shiftUnitMs = one week keeps hour-of-week seasonality (incidents cluster in working hours) out of the null
  const units = Math.max(1, Math.floor(L / shiftUnitMs));
  const stat = (groupOf: Map<string, string>, shift?: Map<string, number>) => {
    const byGroup = new Map<string, Array<{ org: string; t: number }>>();
    for (const [org, ts] of times) {
      const g = groupOf.get(org);
      if (!g) continue;
      const off = shift?.get(org) ?? 0;
      const list = byGroup.get(g) ?? byGroup.set(g, []).get(g)!;
      for (const t of ts) list.push({ org, t: t0 + ((t - t0 + off) % L) });
    }
    // rotation is circular: pairs across the wrap point are counted by duplicating the head of the window
    let total = 0;
    for (const ev of byGroup.values()) {
      const head = ev.filter((e) => e.t - t0 < tolMs).map((e) => ({ org: e.org, t: e.t + L }));
      total += closePairs([...ev, ...head], tolMs) - closePairs(head, tolMs);
    }
    return total;
  };
  const orgs = [...times.keys()];
  const layers = Object.keys(groups);
  const observed = Object.fromEntries(layers.map((l) => [l, stat(groups[l])]));
  const nulls: Record<string, number[]> = Object.fromEntries(layers.map((l) => [l, [] as number[]]));
  for (let b = 0; b < reps; b++) {
    const shift = new Map(orgs.map((o) => [o, Math.floor(r() * units) * shiftUnitMs]));
    for (const l of layers) nulls[l].push(stat(groups[l], shift));
  }
  return layers.map((l) => {
    const xs = nulls[l].sort((a, b) => a - b);
    const expected = xs.reduce((s, x) => s + x, 0) / reps;
    const members = [...groups[l]].filter(([o]) => times.has(o));
    return {
      layer: l, observed: observed[l], expected,
      nullLo: xs[Math.floor(0.025 * reps)], nullHi: xs[Math.min(reps - 1, Math.floor(0.975 * reps))],
      lift: expected > 0 ? observed[l] / expected : null, p: (xs.filter((x) => x >= observed[l]).length + 1) / (reps + 1),
      groups: new Set(members.map(([, g]) => g)).size, organisations: members.length,
      incidents: members.reduce((s, [o]) => s + (times.get(o)?.length ?? 0), 0),
    };
  });
}

/** Holm-Bonferroni adjusted p-values (same order as input). */
export function holm(ps: number[]) {
  const idx = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const out = new Array<number>(ps.length);
  let run = 0;
  idx.forEach(({ p, i }, rank) => { run = Math.max(run, Math.min(1, (ps.length - rank) * p)); out[i] = run; });
  return out;
}

export function concentration(keys: Array<string | null>) {
  const known = keys.filter((k): k is string => !!k);
  const counts = new Map<string, number>();
  for (const k of known) counts.set(k, (counts.get(k) ?? 0) + 1);
  const n = known.length;
  const shares = [...counts].map(([provider, c]) => ({ provider, count: c, share: n ? c / n : 0 })).sort((a, b) => b.count - a.count);
  const hhi = Math.round(shares.reduce((s, x) => s + (x.share * 100) ** 2, 0));
  return { known: n, total: keys.length, hhi, top: shares.slice(0, 8), providers: counts.size };
}
