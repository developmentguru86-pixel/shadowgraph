import { isOwnSiteRequest, bulkAccessDenied } from "./siteAccess";

const req = (headers: Record<string, string>) => new Request("https://shadowalpha.online/_api/radar/status", { headers });

describe("bulk data access", () => {
  it("lets the site's own pages load the radar", () => {
    expect(isOwnSiteRequest(req({ "sec-fetch-site": "same-origin" }))).toBeTrue();
    expect(isOwnSiteRequest(req({ "sec-fetch-site": "same-site" }))).toBeTrue();
  });
  it("accepts older browsers by referer from our own hosts", () => {
    expect(isOwnSiteRequest(req({ referer: "https://shadowalpha.online/radar" }))).toBeTrue();
    expect(isOwnSiteRequest(req({ referer: "https://www.shadowalpha.online/" }))).toBeTrue();
  });
  it("refuses direct and cross-site requests", () => {
    expect(isOwnSiteRequest(req({}))).toBeFalse();
    expect(isOwnSiteRequest(req({ "sec-fetch-site": "cross-site" }))).toBeFalse();
    expect(isOwnSiteRequest(req({ "sec-fetch-site": "none" }))).toBeFalse();
    expect(isOwnSiteRequest(req({ referer: "https://evil.example/shadowalpha.online" }))).toBeFalse();
    expect(isOwnSiteRequest(req({ referer: "https://shadowalpha.online.evil.example/" }))).toBeFalse();
  });
  it("answers 403 without caching", async () => {
    const r = bulkAccessDenied();
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
