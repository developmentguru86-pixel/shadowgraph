import { geoRow, hostOf } from "./geoRefreshJob";

describe("weekly location refresh", () => {
  it("takes the analysed host first, else the probe URL host", () => {
    expect(hostOf("origin.example.com", "https://www.example.com/health")).toBe("origin.example.com");
    expect(hostOf(null, "https://www.example.com/health")).toBe("www.example.com");
    expect(hostOf(null, "not a url")).toBeNull();
  });
  it("stores a city location and rejects unusable lookups", () => {
    const g = { city: { names: { en: "Ashburn (Loudoun)" } }, subdivisions: [{ names: { en: "Virginia" } }], country: { iso_code: "US" }, location: { latitude: 39.04, longitude: -77.49 } };
    const row = geoRow("svc", "1.2.3.4", g, "dbip-city-lite-2026-10")!;
    expect(row.city).toBe("Ashburn");
    expect(row.regionName).toBe("Virginia");
    expect(row.lat).toBe(39.04);
    expect(geoRow("svc", "1.2.3.4", null, "x")).toBeNull();
    expect(geoRow("svc", "1.2.3.4", { ...g, city: { names: { en: "Mountain View" } } }, "x")).toBeNull(); // Google anycast HQ
    expect(geoRow("svc", "1.2.3.4", { ...g, location: {} }, "x")).toBeNull();
  });
});
