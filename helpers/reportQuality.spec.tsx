import { companyOf, mailSetupOf, summarizePortfolio, type VendorRow } from "./vendorList";

/** Quality rules every DORA report follows (introduced with method SG-ICTCR 1.3); they apply to any vendor list. */
const row = (name: string, o: Partial<VendorRow> = {}): VendorRow => ({
  name, domain: name.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".com", fn: null, critical: false, status: "ok", host: null, hosting: null, hostingCategory: null, region: null,
  country: null, confidence: null, cdn: null, originHidden: false, dns: null, email: null, certIssuer: null, certNotAfter: null, certNote: null,
  registrar: null, domainExpiresAt: null, domainNote: null, evidence: { ips: [], cnames: [], ns: [], mx: [], asn: null }, scannedAt: "2026-10-26T00:00:00Z", ...o,
});

describe("report quality rules", () => {
  it("counts companies, not rows: 'Company - Service' rows and rows on one domain are one vendor", () => {
    expect(companyOf("Internex - Website", "hypovbg.at")).toBe(companyOf("Internex - Kundenbereich", "hypovbg.at"));
    expect(companyOf("AWS", "aws.amazon.com")).toBe(companyOf("AWS S3", "s3.amazon.com"));
    const s = summarizePortfolio([
      row("Internex - Website", { hosting: "Internex" }), row("Internex - Kundenbereich", { hosting: "Internex" }), row("Other", { hosting: "Hetzner" }),
    ]);
    const hosting = s.layers.find((l) => l.layer === "hosting")!;
    expect(hosting.providers.find((p) => p.provider === "Internex")!.vendors).toBe(1);
  });
  it("merges email per mail setup: two domains on the same mail exchangers are one mail dependency", () => {
    const mx = ["mx11.ubs.open.ch", "mx12.ubs.open.ch"];
    const a = row("UBS", { domain: "ubs.com", email: "Open Systems", evidence: { ips: [], cnames: [], ns: [], mx, asn: null } });
    const b = row("Credit Suisse", { domain: "credit-suisse.com", email: "Open Systems", evidence: { ips: [], cnames: [], ns: [], mx: [...mx].reverse(), asn: null } });
    expect(mailSetupOf(a)).toBe(mailSetupOf(b));
    const s = summarizePortfolio([a, b]);
    expect(s.layers.find((l) => l.layer === "email")!.providers[0].vendors).toBe(1);
  });
  it("never offers a single-company provider as a two-vendor scenario", () => {
    const s = summarizePortfolio([row("X - A", { dns: "Akamai Edge DNS" }), row("X - B", { dns: "Akamai Edge DNS" })]);
    expect(s.scenarios.length).toBe(0);
  });
});
