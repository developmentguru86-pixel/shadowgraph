import { cleanDomain, parseVendorList, summarizePortfolio, vendorCsv, type VendorRow } from "./vendorList";

const row = (name: string, o: Partial<VendorRow> = {}): VendorRow => ({
  name, domain: name.toLowerCase() + ".com", fn: null, critical: false, status: "ok", host: null, hosting: null, hostingCategory: null, region: null,
  country: null, confidence: null, cdn: null, originHidden: false, dns: null, email: null, certIssuer: null, certNotAfter: null, certNote: null,
  registrar: null, domainExpiresAt: null, domainNote: null, evidence: { ips: [], cnames: [], ns: [], mx: [], asn: null }, scannedAt: "2026-10-13T00:00:00Z", ...o,
});

describe("vendor list parsing", () => {
  it("cleans URLs to domains", () => {
    expect(cleanDomain("https://www.Stripe.com/de/pricing")).toBe("stripe.com");
    expect(cleanDomain("not a domain")).toBeNull();
  });
  it("reads a headed semicolon CSV in any column order", () => {
    const r = parseVendorList("Anbieter;Funktion;Kritisch;Website\nStripe;Zahlungen;ja;https://stripe.com\nSalesforce;CRM;nein;salesforce.com\nKaputt;x;ja;???");
    expect(r.vendors).toEqual([
      { name: "Stripe", domain: "stripe.com", fn: "Zahlungen", critical: true },
      { name: "Salesforce", domain: "salesforce.com", fn: "CRM", critical: false },
    ]);
    expect(r.rejected.length).toBe(1);
  });
  it("reads plain lines and headerless rows, dedupes", () => {
    const r = parseVendorList("stripe.com\nAdyen, adyen.com, payments, x\nstripe.com");
    expect(r.vendors.map((v) => v.domain)).toEqual(["stripe.com", "adyen.com"]);
    expect(r.vendors[1]).toEqual({ name: "Adyen", domain: "adyen.com", fn: "payments", critical: true });
  });
  it("caps at 300", () => {
    const text = Array.from({ length: 320 }, (_, i) => `v${i}.example.com`).join("\n");
    const r = parseVendorList(text);
    expect(r.vendors.length).toBe(300);
    expect(r.truncated).toBe(20);
  });
  it("keeps exact hosts: host column, sub-domains and public IPs; refuses private IPs", () => {
    const r = parseVendorList("name;domain;host;kritisch\nARZ;bank99.at;meine.bank99.at;ja\nWeb;www.bank99.at;;nein\nRZ;;193.110.183.243;ja\nIntern;;10.0.0.5;ja");
    expect(r.vendors).toEqual([
      { name: "ARZ", domain: "bank99.at", host: "meine.bank99.at", fn: null, critical: true },
      { name: "Web", domain: "bank99.at", fn: null, critical: false },
      { name: "RZ", domain: "193.110.183.243", host: "193.110.183.243", fn: null, critical: true },
    ]);
    expect(r.rejected.length).toBe(1);
    const p = parseVendorList("Online-Banking, meine.bank99.at, x");
    expect(p.vendors[0].host).toBe("meine.bank99.at");
  });
});

describe("portfolio summary", () => {
  it("finds concentration with critical counts and expiring certificates", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    const s = summarizePortfolio([
      row("A", { hosting: "Amazon Web Services", region: "eu-central-1", dns: "Cloudflare", critical: true, certNotAfter: "2026-10-20T00:00:00Z" }),
      row("B", { hosting: "Amazon Web Services", region: "eu-central-1", dns: "Cloudflare" }),
      row("C", { hosting: "Hetzner", dns: "Other (foo.de)" }),
      row("D", { status: "no_dns" }),
    ], now);
    expect(s.scanned).toBe(3); expect(s.unresolved).toBe(1); expect(s.critical).toBe(1);
    const top = s.scenarios[0];
    expect(top.vendors).toBe(2); expect(top.critical).toBe(1);
    expect(s.layers.find((l) => l.layer === "cloud region")!.providers[0].provider).toBe("Amazon Web Services eu-central-1");
    expect(s.certsExpiring).toEqual([{ name: "A", domain: "a.com", date: "2026-10-20T00:00:00Z", days: 7 }]);
  });
});

describe("csv export", () => {
  it("quotes, neutralises formulas and keeps one row per vendor", () => {
    const csv = vendorCsv([row("=cmd", { fn: "Pay, card" })]);
    const lines = csv.trim().split("\r\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("'=cmd");
    expect(lines[1]).toContain('"Pay, card"');
  });
});
