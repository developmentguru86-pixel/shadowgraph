import { poissonBinomialTail, detectUpstream, classifyEvidence, seasonality, familyOf, type OrgIncident, type Group, type ProviderIncident } from "./upstreamDetect";

const MIN = 60_000, H = 3_600_000, DAY = 24 * H;
const T0 = Date.UTC(2026, 8, 1, 12); // a Tuesday noon
const flat = new Array(168).fill(1);
const inc = (org: string, t: number, title = "Elevated errors"): OrgIncident => ({ org, t, id: `${org}-${t}`, title, impact: "minor", link: null });

describe("poissonBinomialTail", () => {
  it("matches hand-computed values", () => {
    expect(poissonBinomialTail([0.5, 0.5], 1)).toBeCloseTo(0.75, 10);
    expect(poissonBinomialTail([0.5, 0.5], 2)).toBeCloseTo(0.25, 10);
    expect(poissonBinomialTail([0.1, 0.2, 0.3], 0)).toBe(1);
    expect(poissonBinomialTail([0.1, 0.2, 0.3], 3)).toBeCloseTo(0.006, 10);
  });
});

describe("seasonality", () => {
  it("has mean 1 and weights busy hours higher", () => {
    const s = seasonality([T0, T0 + 60_000, T0 + 120_000]);
    expect(s.reduce((a, b) => a + b, 0) / 168).toBeCloseTo(1, 10);
    expect(s[new Date(T0).getUTCDay() * 24 + 12]).toBeGreaterThan(s[0]);
  });
});

describe("detectUpstream", () => {
  const quiet = new Map<string, number>();
  const busy = new Map<string, number>();
  const members = Array.from({ length: 10 }, (_, i) => `c${i}.com`);
  for (const m of members) { quiet.set(m, 1 / (30 * 24)); busy.set(m, 2); }
  const g: Group = { layer: "cdn", provider: "Cloudflare", members };

  it("fires when rarely-failing companies on one provider declare together", () => {
    const evs = detectUpstream([inc("c1.com", T0), inc("c4.com", T0 + 12 * MIN), inc("c7.com", T0 + 25 * MIN)], [g], quiet, flat);
    expect(evs.length).toBe(1);
    expect(evs[0].orgs.sort()).toEqual(["c1.com", "c4.com", "c7.com"]);
    expect(evs[0].p).toBeLessThan(1e-3);
    expect(evs[0].candidates[0].provider).toBe("Cloudflare");
  });
  it("stays silent for companies that declare incidents all the time", () => {
    expect(detectUpstream([inc("c1.com", T0), inc("c4.com", T0 + 12 * MIN)], [g], busy, flat).length).toBe(0);
  });
  it("does not pair incidents more than an hour apart", () => {
    expect(detectUpstream([inc("c1.com", T0), inc("c4.com", T0 + 3 * H)], [g], quiet, flat).length).toBe(0);
  });
  it("never counts one company twice", () => {
    expect(detectUpstream([inc("c1.com", T0), inc("c1.com", T0 + 5 * MIN)], [g], quiet, flat).length).toBe(0);
  });
  it("merges nested groups and ranks the more specific one first", () => {
    const region: Group = { layer: "region", provider: "Amazon Web Services us-east-1", members: ["a.com", "b.com", "c.com"] };
    const hosting: Group = { layer: "hosting", provider: "Amazon Web Services", members: ["a.com", "b.com", "c.com", ...members] };
    const rates = new Map([...quiet, ["a.com", 1 / 720], ["b.com", 1 / 720], ["c.com", 1 / 720]]);
    const evs = detectUpstream([inc("a.com", T0), inc("b.com", T0 + 9 * MIN)], [region, hosting], rates, flat);
    expect(evs.length).toBe(1);
    expect(evs[0].candidates.map((c) => c.layer)).toEqual(["region", "hosting"]);
  });
  it("does not count an incident that blames another provider", () => {
    const evs = detectUpstream([inc("c1.com", T0), inc("c4.com", T0 + 12 * MIN, "AWS us-east-1 connectivity failures")], [g], quiet, flat);
    expect(evs.length).toBe(0);
  });
  it("keeps separate events days apart", () => {
    const evs = detectUpstream([inc("c1.com", T0), inc("c2.com", T0 + 5 * MIN), inc("c3.com", T0 + 3 * DAY), inc("c5.com", T0 + 3 * DAY + 5 * MIN)], [g], quiet, flat);
    expect(evs.length).toBe(2);
  });
});

describe("classifyEvidence", () => {
  const g: Group = { layer: "region", provider: "Amazon Web Services us-east-1", members: ["a.com", "b.com", "c.com"] };
  const rates = new Map([["a.com", 1 / 720], ["b.com", 1 / 720], ["c.com", 1 / 720]]);
  const [ev] = detectUpstream([inc("a.com", T0), inc("b.com", T0 + 10 * MIN, "Possible outage in AWS us-east-1")], [g], rates, flat);
  const pi = (region: string | null, start: number): ProviderIncident => ({ source: "aws", id: "x", family: "aws", provider: "Amazon Web Services", region, title: "Increased Error Rates", startedAt: start, declaredAt: start + 30 * MIN, resolvedAt: start + 2 * H, link: null, severe: true });

  it("confirms with an overlapping provider incident in the same region and measures the lead", () => {
    const e = classifyEvidence(ev, [pi("us-east-1", T0 - 5 * MIN)]);
    expect(e.tier).toBe("confirmed");
    expect(e.minutesVsProvider).toBe(-15); // fired 10 min after T0, provider declared 25 min after T0
  });
  it("ignores provider incidents in another region", () => {
    expect(classifyEvidence(ev, [pi("eu-west-1", T0)]).tier).toBe("named");
  });
  it("marks events named by a company title", () => {
    const e = classifyEvidence(ev, []);
    expect(e.tier).toBe("named");
    expect(e.namedBy).toEqual(["b.com"]);
  });
  it("maps provider names to families", () => {
    expect(familyOf("AWS Route 53")).toBe("aws");
    expect(familyOf("Google Cloud DNS")).toBe("google");
    expect(familyOf("Akamai Edge DNS")).toBe("akamai");
  });
});
