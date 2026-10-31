import { orgOf, slaBudget, monthMinutes, leadMinutes } from "./boardMath";
import { rankCompanies } from "./companySearchRank";

describe("status board math", () => {
  it("maps hosts to organisations", () => {
    expect(orgOf("api.github.com")).toBe("github.com");
    expect(orgOf("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(orgOf("status.zoom.us")).toBe("zoom.us");
    expect(orgOf("localhost")).toBeNull();
    expect(orgOf(null)).toBeNull();
  });

  it("computes month length and the SLA error budget", () => {
    expect(monthMinutes(new Date("2026-10-18T12:00:00Z"))).toBe(31 * 1440);
    expect(monthMinutes(new Date("2026-02-10T00:00:00Z"))).toBe(28 * 1440);
    const b = slaBudget(1000, 1009, 0.999, 31 * 1440);
    expect(b.downMin).toBe(45);
    expect(b.budgetMin).toBeCloseTo(44.64, 2);
    expect(b.usedShare!).toBeGreaterThan(1);
    expect(slaBudget(10, 10, null, 1440).budgetMin).toBeNull();
    expect(slaBudget(0, 0, 0.999, 1440).up).toBeNull();
  });

  it("credits a lead only when our failure came first and was still relevant", () => {
    const posted = Date.parse("2026-10-15T10:07:00Z");
    expect(leadMinutes(posted, [{ start: posted - 26 * 60_000, end: null }], posted + 1)).toBe(26);
    expect(leadMinutes(posted, [{ start: posted + 60_000, end: null }])).toBeNull(); // after the post
    expect(leadMinutes(posted, [{ start: posted - 5 * 3600_000, end: posted - 4 * 3600_000 }])).toBeNull(); // too early, over
    expect(leadMinutes(posted, [{ start: posted - 90 * 60_000, end: posted - 60 * 60_000 }])).toBeNull(); // recovered long before
  });
});

describe("company search ranking", () => {
  const list = [
    { slug: "aapl", name: "Apple", ticker: "AAPL", customers: 0, suppliers: 12 },
    { slug: "googl", name: "Alphabet", ticker: "GOOGL", customers: 1, suppliers: 3 },
    { slug: "appf", name: "AppFolio", ticker: "APPF", customers: 1, suppliers: 0 },
    { slug: "u-s-government", name: "U.S. Government", ticker: null, customers: 0, suppliers: 24 },
  ];
  it("prefers exact ticker, then name prefix", () => {
    expect(rankCompanies(list, "AAPL")[0].slug).toBe("aapl");
    expect(rankCompanies(list, "app")[0].slug).toBe("aapl");
  });
  it("finds brand aliases and dotted names", () => {
    expect(rankCompanies(list, "google")[0].slug).toBe("googl");
    expect(rankCompanies(list, "us government")[0].slug).toBe("u-s-government");
  });
  it("returns nothing for an empty query", () => {
    expect(rankCompanies(list, "  ")).toEqual([]);
  });
});