import { agentNameOf, arcDegrees, callerGeoFromHeaders, cidr, firstRemoteUrl, greatCircle, isGenericClient, placeHost, type Net } from "./agentSignals";

const hdr = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe("agentNameOf", () => {
  it("reads bot names from user agents", () => {
    expect(agentNameOf("AgenstryBot/0.3.0 (+https://agenstry.com/bot)")).toBe("AgenstryBot");
    expect(agentNameOf("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")).toBe("ClaudeBot");
    expect(agentNameOf("A2A-Registry-TaskProbe/1.0 (+https://a2aregistry.org)")).toBe("A2A-Registry-TaskProbe");
    expect(agentNameOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15")).toBe("Web browser");
  });
  it("labels generic HTTP libraries as such", () => {
    expect(agentNameOf("node")).toBe("Node.js client");
    expect(agentNameOf("python-httpx/0.28.1")).toBe("Python client (httpx)");
    expect(agentNameOf(null)).toBe("Unnamed client");
    expect(isGenericClient("Node.js client")).toBeTrue();
    expect(isGenericClient("AgenstryBot")).toBeFalse();
  });
});

describe("callerGeoFromHeaders", () => {
  it("uses CDN coordinates, rounded to ~10 km", () => {
    const g = callerGeoFromHeaders(hdr({ "cloudfront-viewer-latitude": "48.20849", "cloudfront-viewer-longitude": "16.37208", "cloudfront-viewer-city": "Vienna", "cloudfront-viewer-country": "AT" }));
    expect(g).toEqual({ city: "Vienna", country: "AT", lat: 48.2, lon: 16.4, precision: "city" });
  });
  it("falls back to the country centre, or nothing", () => {
    expect(callerGeoFromHeaders(hdr({ "cloudfront-viewer-country": "DE" })).precision).toBe("country");
    expect(callerGeoFromHeaders(hdr({ "cloudfront-viewer-country": "ZZ" }))).toEqual({ city: null, country: "ZZ", lat: null, lon: null, precision: null });
    expect(callerGeoFromHeaders(hdr({})).lat).toBeNull();
  });
});

describe("placeHost", () => {
  const nets = [cidr("104.16.0.0/13", "Cloudflare", "edge"), cidr("3.5.0.0/16", "AWS|eu-central-1", "region")].filter(Boolean) as Net[];
  const geo = (ip: string) => (ip === "8.8.4.4" ? { city: { names: { en: "Mountain View" } }, location: { latitude: 37.4, longitude: -122.1 } }
    : { city: { names: { en: "Falkenstein" } }, country: { iso_code: "DE" }, location: { latitude: 50.5, longitude: 12.4 } });
  it("never places anycast edges", () => {
    expect(placeHost("x.example.com", "104.17.1.1", nets, geo).placement).toBe("edge");
    expect(placeHost("bot.workers.dev", null, nets, geo)).toEqual(jasmine.objectContaining({ placement: "edge", network: "Cloudflare" }));
    expect(placeHost("x.example.com", "8.8.4.4", nets, geo).placement).toBe("edge");
  });
  it("uses cloud regions, then city geolocation", () => {
    expect(placeHost("x.example.com", "3.5.1.1", nets, geo)).toEqual(jasmine.objectContaining({ placement: "region", region: "eu-central-1", lat: 50.1 }));
    expect(placeHost("x.example.com", "95.216.1.1", nets, geo)).toEqual(jasmine.objectContaining({ placement: "city", city: "Falkenstein", country: "DE" }));
    expect(placeHost("x.example.com", null, nets, geo).placement).toBe("unresolved");
  });
});

describe("firstRemoteUrl", () => {
  it("skips templated and local URLs", () => {
    expect(firstRemoteUrl(["https://{tenant}.x.com/mcp", "http://localhost:3000", "https://api.example.com/mcp"])).toEqual({ url: "https://api.example.com/mcp", host: "api.example.com" });
    expect(firstRemoteUrl([undefined, "not a url"])).toBeNull();
  });
});

describe("great-circle geometry", () => {
  it("interpolates between endpoints", () => {
    const a: [number, number] = [48.2, 16.4], b: [number, number] = [40.7, -74];
    const [la0, lo0] = greatCircle(a, b, 0), [la1, lo1] = greatCircle(a, b, 1);
    expect(la0).toBeCloseTo(48.2, 3); expect(lo0).toBeCloseTo(16.4, 3);
    expect(la1).toBeCloseTo(40.7, 3); expect(lo1).toBeCloseTo(-74, 3);
    expect(greatCircle(a, b, 0.5)[0]).toBeGreaterThan(48.2); // the great circle bends north over the Atlantic
    expect(arcDegrees(a, b)).toBeCloseTo(61.1, 0);
  });
});
