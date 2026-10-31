import { wilson, bootstrapMedianCI, sharedFate, concentration, overlaps, median, eventFate, holm } from "./researchStats";

describe("wilson", () => {
  it("matches the textbook interval for 8/10", () => {
    const w = wilson(8, 10);
    expect(w.p).toBe(0.8);
    expect(w.lo!).toBeCloseTo(0.4902, 3);
    expect(w.hi!).toBeCloseTo(0.9433, 3);
  });
  it("returns nulls, not zeros, when there is no data", () => {
    expect(wilson(0, 0)).toEqual({ k: 0, n: 0, p: null, lo: null, hi: null });
  });
  it("never leaves [0,1]", () => {
    const w = wilson(0, 3);
    expect(w.lo).toBe(0);
    expect(w.hi!).toBeLessThan(1);
  });
});

describe("median / bootstrap", () => {
  it("computes even and odd medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("brackets the median and is deterministic", () => {
    const xs = [-12, -8, -5, -3, -1, 0, 2, 4, 9, 15];
    const a = bootstrapMedianCI(xs), b = bootstrapMedianCI(xs);
    expect(a).toEqual(b);
    expect(a.lo!).toBeLessThanOrEqual(a.median!);
    expect(a.hi!).toBeGreaterThanOrEqual(a.median!);
  });
  it("refuses an interval below three observations", () => {
    expect(bootstrapMedianCI([1, 2]).lo).toBeNull();
  });
});

describe("overlaps", () => {
  it("treats touching intervals as overlapping", () => {
    expect(overlaps(0, 5, 5, 9)).toBe(true);
    expect(overlaps(0, 4, 5, 9)).toBe(false);
  });
});

describe("sharedFate", () => {
  // 20 services in two groups of 10. In group A, services always fail together at the same sweeps;
  // group B services fail at independent, scattered sweeps.
  const T = 200;
  const failures = new Map<string, number[]>();
  const groupOf = new Map<string, string>();
  for (let i = 0; i < 10; i++) {
    failures.set(`a${i}`, [10, 50, 90, 130, 170]);
    groupOf.set(`a${i}`, "A");
    failures.set(`b${i}`, [(i * 17 + 3) % T, (i * 31 + 101) % T, (i * 7 + 60) % T, (i * 13 + 150) % T, (i * 23 + 33) % T]);
    groupOf.set(`b${i}`, "B");
  }
  it("detects correlated failures inside a shared group", () => {
    const [res] = sharedFate({ T, failures, groups: { hosting: groupOf } }, 300);
    expect(res.lift!).toBeGreaterThan(5);
    expect(res.p).toBeLessThan(0.01);
  });
  it("finds no excess when only independent services are grouped", () => {
    const onlyB = new Map([...groupOf].filter(([id]) => id.startsWith("b")));
    const [res] = sharedFate({ T, failures, groups: { hosting: onlyB } }, 300);
    expect(res.p).toBeGreaterThan(0.05);
  });
});

describe("eventFate", () => {
  const H = 3_600_000;
  const span: [number, number] = [0, 90 * 24 * H];
  // 12 organisations. Group "X" (6 orgs) shares 5 upstream events (declared within 20 min of each other);
  // group "Y" (6 orgs) has independent incidents spread over the window.
  const times = new Map<string, number[]>();
  const groupOf = new Map<string, string>();
  for (let i = 0; i < 6; i++) {
    times.set(`x${i}`, [10, 25, 40, 61, 80].map((d) => d * 24 * H + i * 4 * 60_000));
    groupOf.set(`x${i}`, "X");
    times.set(`y${i}`, [3 + i * 7, 17 + i * 5, 33 + i * 3, 52 + i * 2, 70 + i].map((d) => d * 24 * H + i * 3 * H));
    groupOf.set(`y${i}`, "Y");
  }
  it("finds the planted shared upstream", () => {
    const onlyX = new Map([...groupOf].filter(([o]) => o.startsWith("x")));
    const [res] = eventFate(times, { X: onlyX }, span, H, 300);
    expect(res.observed).toBe(75); // 5 events x C(6,2) cross-org pairs
    expect(res.lift!).toBeGreaterThan(10);
    expect(res.p).toBeLessThan(0.01);
    expect(res.organisations).toBe(6);
  });
  it("finds nothing in independent organisations", () => {
    const onlyY = new Map([...groupOf].filter(([o]) => o.startsWith("y")));
    const [res] = eventFate(times, { Y: onlyY }, span, H, 300);
    expect(res.p).toBeGreaterThan(0.05);
  });
  it("counts pairs across the wrap-around of the window exactly once", () => {
    const t = new Map([["a", [span[1] - 10 * 60_000]], ["b", [5 * 60_000]]]);
    const g = new Map([["a", "G"], ["b", "G"]]);
    expect(eventFate(t, { G: g }, span, H, 10)[0].observed).toBe(1);
  });
});

describe("holm", () => {
  it("adjusts and keeps monotonicity", () => {
    const adj = holm([0.01, 0.04, 0.03]);
    expect(adj[0]).toBeCloseTo(0.03, 10);
    expect(adj[2]).toBeCloseTo(0.06, 10);
    expect(adj[1]).toBeCloseTo(0.06, 10);
  });
});

describe("concentration", () => {
  it("computes HHI over known values only", () => {
    const c = concentration(["AWS", "AWS", "GCP", "Azure", null]);
    expect(c.known).toBe(4);
    expect(c.total).toBe(5);
    expect(c.hhi).toBe(3750);
    expect(c.top[0]).toEqual({ provider: "AWS", count: 2, share: 0.5 });
  });
});
