import { detectIncidents, detectDegradation, incidentThreshold, type DetectService, type DetectProbe } from "./radarDetect";

// Synthetic internet shaped like the live radar: two AWS regions with canaries, region-less AWS services,
// Cloudflare / Akamai fronted services, Google Cloud and Hetzner hosts, Route 53 / Cloudflare DNS.
function universe(): DetectService[] {
  const s: DetectService[] = [];
  const add = (prefix: string, n: number, f: Partial<DetectService>) => {
    for (let i = 0; i < n; i++) s.push({ id: `${prefix}${i}`, name: `${prefix}${i}`, hostingProvider: null, hostingRegion: null, cdn: null, dnsProvider: null, ...f });
  };
  add("use1-", 25, { hostingProvider: "Amazon Web Services", hostingRegion: "us-east-1", dnsProvider: "AWS Route 53" });
  s.push({ id: "aws-s3-us-east-1", name: "AWS S3 us-east-1", hostingProvider: "Amazon Web Services", hostingRegion: "us-east-1", cdn: null, dnsProvider: null, canary: true });
  add("euc1-", 15, { hostingProvider: "Amazon Web Services", hostingRegion: "eu-central-1", dnsProvider: "AWS Route 53" });
  s.push({ id: "aws-s3-eu-central-1", name: "AWS S3 eu-central-1", hostingProvider: "Amazon Web Services", hostingRegion: "eu-central-1", cdn: null, dnsProvider: null, canary: true });
  add("aws-", 40, { hostingProvider: "Amazon Web Services", dnsProvider: "AWS Route 53" });
  add("cf-", 30, { cdn: "Cloudflare", dnsProvider: "Cloudflare" });
  add("ak-", 20, { cdn: "Akamai", dnsProvider: "Akamai Edge DNS" });
  add("gcp-", 15, { hostingProvider: "Google Cloud" });
  add("htz-", 10, { hostingProvider: "Hetzner" });
  return s;
}

function sweep(services: DetectService[], failing: string[]): DetectProbe[] {
  const f = new Set(failing);
  return services.map((x) => ({ serviceId: x.id, ok: !f.has(x.id) }));
}
const prevFrom = (probes: DetectProbe[]) => new Map(probes.map((p) => [p.serviceId, p.ok]));
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const providersOf = (r: ReturnType<typeof detectIncidents>) => r.incidents.map((i) => `${i.layer}:${i.provider}`).sort();

describe("radar incident detection", () => {
  const svc = universe();

  it("detects a regional cloud outage (AWS us-east-1, Oct 2025 pattern) and lists the blast radius", () => {
    const failing = ["aws-s3-us-east-1", ...ids("use1-", 9)];
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(providersOf(r)).toEqual(["region:Amazon Web Services us-east-1"]);
    const inc = r.incidents[0];
    expect(inc.canaryDown).toBeTrue();
    expect(inc.affected.length).toBe(10);
    expect(inc.atRisk.length).toBe(16); // the rest of us-east-1 is flagged as at risk
  });

  it("does not raise an incident on the first failed sweep (degraded only)", () => {
    const failing = ["aws-s3-us-east-1", ...ids("use1-", 9)];
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, [])));
    expect(r.incidents).toEqual([]);
    expect(r.down.size).toBe(0);
  });

  it("detects a CDN-wide outage (Cloudflare pattern) from many independent fronted services", () => {
    const failing = ids("cf-", 12);
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(providersOf(r)).toContain("cdn:Cloudflare");
    expect(providersOf(r).some((p) => p.startsWith("region:") || p.startsWith("hosting:"))).toBeFalse();
  });

  it("ignores a single service that is down for a long time", () => {
    const r = detectIncidents(svc, sweep(svc, ["euc1-3"]), prevFrom(sweep(svc, ["euc1-3"])));
    expect(r.incidents).toEqual([]);
    expect(r.down.has("euc1-3")).toBeTrue();
  });

  it("ignores scattered, unrelated failures across providers", () => {
    const failing = ["use1-1", "euc1-2", "aws-5", "cf-7", "ak-3", "gcp-1", "htz-2", "aws-30"];
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(r.incidents).toEqual([]);
  });

  it("needs more than the canary plus one service to call a region down", () => {
    const failing = ["aws-s3-eu-central-1", "euc1-0"];
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(r.incidents).toEqual([]);
    const failing2 = ["aws-s3-eu-central-1", "euc1-0", "euc1-1"];
    const r2 = detectIncidents(svc, sweep(svc, failing2), prevFrom(sweep(svc, failing2)));
    expect(providersOf(r2)).toEqual(["region:Amazon Web Services eu-central-1"]);
  });

  it("suppresses everything when our own measurement node fails (>50% of probes)", () => {
    const failing = svc.slice(0, Math.ceil(svc.length * 0.6)).map((x) => x.id);
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(r.vantageSuspect).toBeTrue();
    expect(r.incidents).toEqual([]);
  });

  it("raises a provider-wide incident only when failures span beyond one region", () => {
    // 6 region-less AWS services + 4 us-east-1 services: no single region explains it, provider group (n=82) needs 9
    const failing = [...ids("aws-", 6), ...ids("use1-", 4)];
    const r = detectIncidents(svc, sweep(svc, failing), prevFrom(sweep(svc, failing)));
    expect(providersOf(r)).toContain("hosting:Amazon Web Services");
  });

  it("uses proportional thresholds for small and large groups", () => {
    expect(incidentThreshold(3)).toBe(3);
    expect(incidentThreshold(20)).toBe(5);
    expect(incidentThreshold(82)).toBe(9);
    expect(incidentThreshold(300)).toBe(30);
  });

  it("never counts targets we have never reached (bot walls) — regression for the 2026-10-08 false Akamai alarm", () => {
    const botWalled = ids("ak-", 11); // timed out from their very first probe
    const reached = new Set(svc.map((x) => x.id).filter((id) => !botWalled.includes(id)));
    const r = detectIncidents(svc, sweep(svc, botWalled), prevFrom(sweep(svc, botWalled)), reached);
    expect(r.incidents).toEqual([]);
    expect(r.down.size).toBe(0);
    // the same failures on services that WERE reachable before are a real Akamai incident
    const r2 = detectIncidents(svc, sweep(svc, botWalled), prevFrom(sweep(svc, botWalled)), new Set(svc.map((x) => x.id)));
    expect(providersOf(r2)).toContain("cdn:Akamai");
  });
});

describe("radar early warning (gray failures)", () => {
  const base = universe().map((s) => ({ ...s, latencyMs: 200, ok: true, baselineMs: 200, baselineN: 200 }));
  const withSlow = (ids: string[], ms = 1200) => base.map((s) => (ids.includes(s.id) ? { ...s, latencyMs: ms } : s));
  const keys = (r: ReturnType<typeof detectDegradation>) => r.warnings.map((w) => `${w.layer}:${w.provider}`).sort();

  it("warns when a cloud region slows down before anything fails", () => {
    const r = detectDegradation(withSlow(ids("use1-", 9)), new Set());
    expect(keys(r)).toEqual(["region:Amazon Web Services us-east-1"]);
    expect(r.warnings[0].degraded.length).toBe(9);
  });

  it("ignores a single slow service and mild slowness", () => {
    expect(detectDegradation(withSlow(["euc1-1"]), new Set()).warnings).toEqual([]);
    expect(detectDegradation(withSlow(ids("use1-", 9), 450), new Set()).warnings).toEqual([]); // 2.25x: below the 2.5x bar
  });

  it("stays silent when everything is slow (our own network)", () => {
    const r = detectDegradation(withSlow(base.map((s) => s.id)), new Set());
    expect(r.vantageSuspect).toBeTrue();
    expect(r.warnings).toEqual([]);
  });

  it("does not warn for a group that already has a declared incident", () => {
    const r = detectDegradation(withSlow(ids("use1-", 9)), new Set(["region|Amazon Web Services us-east-1"]));
    expect(r.warnings.filter((w) => w.layer === "region")).toEqual([]);
  });

  it("needs a baseline: new services without history never trigger a warning", () => {
    const fresh = base.map((s) => (s.id.startsWith("use1-") ? { ...s, baselineN: 3, latencyMs: 5000 } : s));
    expect(detectDegradation(fresh, new Set()).warnings).toEqual([]);
  });

  it("treats failures of previously healthy services as degradation", () => {
    const failing = base.map((s) => (ids("cf-", 10).includes(s.id) ? { ...s, ok: false, latencyMs: null } : s));
    expect(keys(detectDegradation(failing, new Set()))).toContain("cdn:Cloudflare");
  });

  it("regression ew-v1: three slow hosts in a small region group never warn", () => {
    // replay of 2026-10-09: eu-central-1 had 6 monitored services; 3 gained ~+1.8 s together (vantage artefact)
    const small = base.filter((s) => !s.id.startsWith("euc1-") || ["euc1-0", "euc1-1", "euc1-2", "euc1-3", "euc1-4"].includes(s.id))
      .map((s) => (["aws-s3-eu-central-1", "euc1-0", "euc1-1"].includes(s.id) ? { ...s, latencyMs: 2300, baselineMs: 450 } : s));
    expect(detectDegradation(small, new Set()).warnings.filter((w) => w.provider.includes("eu-central-1"))).toEqual([]);
  });

  it("counts several endpoints of one company as one organisation", () => {
    // 9 slow us-east-1 endpoints that all belong to the same company are one voice, not nine
    const oneOrg = withSlow(ids("use1-", 9)).map((s) => (s.id.startsWith("use1-") && Number(s.id.split("-")[1]) < 9 ? { ...s, org: "example.com" } : s));
    expect(detectDegradation(oneOrg, new Set()).warnings).toEqual([]);
  });
});
