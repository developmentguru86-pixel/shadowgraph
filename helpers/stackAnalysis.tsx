/**
 * Stack analysis for the "Check your stack" tool and the "What if?" simulator.
 * Pure functions over observed infrastructure (no I/O). Every number is a count of mapped services;
 * grades and recommendations are fixed, published rules, not estimates.
 */
export type StackItem = {
  id: string; name: string; category?: string; own?: boolean;
  hostingProvider: string | null; hostingRegion: string | null; cdn: string | null; dnsProvider: string | null; emailProvider: string | null;
};
type Layer = "hosting" | "cdn" | "dns";

const FAMILY: Array<[RegExp, string]> = [
  [/Amazon|AWS|CloudFront|Route 53/i, "AWS"], [/Google/i, "Google Cloud"], [/Microsoft|Azure/i, "Microsoft Azure"],
  [/Cloudflare/i, "Cloudflare"], [/Akamai/i, "Akamai"], [/Fastly/i, "Fastly"], [/Oracle|Dyn/i, "Oracle"],
  [/Hetzner/i, "Hetzner"], [/OVH/i, "OVHcloud"], [/Imperva/i, "Imperva"], [/Vercel/i, "Vercel"], [/Netlify/i, "Netlify"],
  [/DigitalOcean/i, "DigitalOcean"], [/NS1/i, "NS1"], [/UltraDNS/i, "UltraDNS"],
];
export const providerFamily = (s: string | null | undefined) => (s && !/^Other \(/.test(s) ? FAMILY.find(([rx]) => rx.test(s))?.[1] ?? s : null);

function layersOf(i: StackItem): Array<{ family: string; layer: Layer }> {
  const out: Array<{ family: string; layer: Layer }> = [];
  for (const [layer, v] of [["hosting", i.hostingProvider], ["cdn", i.cdn], ["dns", i.dnsProvider]] as const) {
    const f = providerFamily(v);
    if (f) out.push({ family: f, layer });
  }
  return out;
}

export type Grade = "A" | "B" | "C" | "D" | "F";
export const GRADE_RULES: Array<[number, Grade]> = [[0.2, "A"], [0.35, "B"], [0.5, "C"], [0.65, "D"], [1.01, "F"]];

export const stackAnalysis = {
  analyze(items: StackItem[]) {
    const n = items.length;
    const fam = new Map<string, { items: StackItem[]; layers: Map<string, Set<Layer>> }>();
    for (const it of items) for (const { family, layer } of layersOf(it)) {
      if (!fam.has(family)) fam.set(family, { items: [], layers: new Map() });
      const f = fam.get(family)!;
      if (!f.items.includes(it)) f.items.push(it);
      f.layers.set(it.id, (f.layers.get(it.id) ?? new Set()).add(layer));
    }
    const families = [...fam.entries()].map(([name, f]) => ({
      name, count: f.items.length, share: f.items.length / Math.max(n, 1),
      items: f.items.map((i) => ({ id: i.id, name: i.name, via: [...(f.layers.get(i.id) ?? [])] })),
    })).sort((a, b) => b.count - a.count);

    const regionMap = new Map<string, StackItem[]>();
    for (const it of items) if (it.hostingRegion && it.hostingRegion !== "global" && it.hostingProvider) {
      const k = `${providerFamily(it.hostingProvider)} ${it.hostingRegion}`;
      regionMap.set(k, [...(regionMap.get(k) ?? []), it]);
    }
    const regions = [...regionMap.entries()].map(([name, list]) => ({ name, count: list.length, items: list.map((i) => i.name) })).sort((a, b) => b.count - a.count);

    const top = families[0] ?? null;
    const maxShare = top?.share ?? 0;
    const grade = (GRADE_RULES.find(([t]) => maxShare < t)?.[1] ?? "F") as Grade;
    const unmapped = items.filter((i) => layersOf(i).length === 0);
    const hiddenOrigin = items.filter((i) => i.cdn && !i.hostingProvider);
    const emailFam = new Map<string, number>();
    for (const it of items) { const e = providerFamily(it.emailProvider); if (e) emailFam.set(e, (emailFam.get(e) ?? 0) + 1); }

    const recs: string[] = [];
    if (top && top.share >= 0.5) recs.push(`${top.count} of your ${n} tools fail together with ${top.name}. Make sure your critical path (payments, sign-in, support) has a fallback that does not run on ${top.name}.`);
    const own = items.find((i) => i.own);
    if (own) {
      const h = providerFamily(own.hostingProvider), d = providerFamily(own.dnsProvider), c = providerFamily(own.cdn);
      if (d && (d === h || d === c)) recs.push(`Your own domain resolves its DNS through ${d}, the same company that ${d === c ? "fronts" : "hosts"} it. A ${d} incident takes out both; a secondary DNS provider removes that shared failure.`);
      if (own.emailProvider && top && providerFamily(own.emailProvider) === top.name) recs.push(`Your email also runs on ${top.name}. During a ${top.name} incident you may lose the channel you would use to tell customers.`);
    }
    if (regions[0] && regions[0].count >= 2) recs.push(`${regions[0].count} of your tools run in ${regions[0].name}. A regional incident there is your most likely multi-tool outage; check where your own workloads run.`);
    const cdnTop = families.find((f) => f.items.some((i) => i.via.includes("cdn")));
    if (cdnTop && cdnTop.items.filter((i) => i.via.includes("cdn")).length / Math.max(n, 1) >= 0.4) recs.push(`${cdnTop.name} sits in front of ${cdnTop.items.filter((i) => i.via.includes("cdn")).length} of your tools. Edge-network incidents are short but wide: keep an offline runbook for them.`);
    if (hiddenOrigin.length) recs.push(`${hiddenOrigin.length} tool${hiddenOrigin.length > 1 ? "s hide their" : " hides its"} origin behind a CDN, so part of your hosting risk is invisible from outside. Ask those vendors where they run.`);
    if (!recs.length && n >= 3) recs.push(`No provider carries more than ${Math.round(maxShare * 100)}% of your stack. That is a well-spread stack; keep re-checking as vendors migrate.`);

    return {
      n, grade, maxShare, top, families: families.slice(0, 8), regions: regions.slice(0, 5),
      scenarios: [...families.slice(0, 3).map((f) => ({ name: f.name, items: f.items })), ...(regions[0] && regions[0].count >= 2 ? [{ name: regions[0].name, items: regionMap.get(regions[0].name)!.map((i) => ({ id: i.id, name: i.name, via: ["hosting" as Layer] })) }] : [])],
      unmapped: unmapped.map((i) => i.name), email: [...emailFam.entries()].sort((a, b) => b[1] - a[1]), recommendations: recs.slice(0, 5),
    };
  },

  /** What happens to the whole radar if one provider family or one cloud region fails. */
  whatIf(target: string, kind: "provider" | "region", items: StackItem[]) {
    const isRegion = kind === "region";
    const hit = items.filter((i) => isRegion
      ? i.hostingProvider && i.hostingRegion && `${providerFamily(i.hostingProvider)} ${i.hostingRegion}` === target
      : layersOf(i).some((l) => l.family === target));
    const byCategory = new Map<string, { hit: number; total: number }>();
    for (const i of items) {
      const c = i.category ?? "Other";
      const e = byCategory.get(c) ?? { hit: 0, total: 0 };
      e.total++; if (hit.includes(i)) e.hit++;
      byCategory.set(c, e);
    }
    const viaCount = { hosting: 0, cdn: 0, dns: 0 };
    if (!isRegion) for (const i of hit) for (const l of layersOf(i)) if (l.family === target) viaCount[l.layer]++;
    return {
      target, isRegion, affected: hit.length, total: items.length, share: hit.length / Math.max(items.length, 1), via: viaCount,
      categories: [...byCategory.entries()].map(([category, v]) => ({ category, ...v, share: v.hit / v.total })).filter((c) => c.hit > 0).sort((a, b) => b.share - a.share),
      examples: hit.map((i) => i.name),
    };
  },

  /** Selectable failure targets for the simulator, largest first. */
  targets(items: StackItem[]) {
    const f = new Map<string, number>(), r = new Map<string, number>();
    for (const i of items) {
      for (const fam of new Set(layersOf(i).map((l) => l.family))) f.set(fam, (f.get(fam) ?? 0) + 1);
      if (i.hostingProvider && i.hostingRegion && i.hostingRegion !== "global") { const k = `${providerFamily(i.hostingProvider)} ${i.hostingRegion}`; r.set(k, (r.get(k) ?? 0) + 1); }
    }
    return {
      providers: [...f.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, count]) => ({ name, count })),
      regions: [...r.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    };
  },
};
