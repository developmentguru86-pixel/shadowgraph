import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { worldMap } from "./worldMap";
import { buildRadarNodes, radarHotKeys, edgeOnlyCount } from "./radarNodes";
import { RadarGlobe } from "../components/RadarGlobe";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";

const svc = (id: string, region: string | null, country: string | null, state: "up" | "down" = "up"): RadarServiceRow => ({
  id, name: id, category: "Test", hostingProvider: "Amazon Web Services", hostingRegion: region, hostingCountry: country, cdn: null, dnsProvider: null, emailProvider: null,
  analyzedHost: null, state, httpStatus: 200, latencyMs: 50, error: null, uptime24h: 1, samples24h: 288,
} as RadarServiceRow);

describe("radar globe", () => {
  let originalEvent: typeof Event, originalCustomEvent: typeof CustomEvent;
  beforeEach(() => { originalEvent = globalThis.Event; originalCustomEvent = globalThis.CustomEvent; globalThis.Event = window.Event; globalThis.CustomEvent = window.CustomEvent; });
  afterEach(() => { cleanup(); globalThis.Event = originalEvent; globalThis.CustomEvent = originalCustomEvent; });

  it("unproject inverts project", () => {
    for (const [lat, lon] of [[38.9, -77.4], [1.35, 103.8], [-33.9, 151.2], [50.1, 8.7]]) {
      const [x, y] = worldMap.project(lat, lon);
      const [la, lo] = worldMap.unproject(x, y);
      expect(Math.abs(la - lat)).toBeLessThan(1e-9);
      expect(Math.abs(lo - lon)).toBeLessThan(1e-9);
    }
  });

  it("land cells are valid coordinates", () => {
    const land = worldMap.landLatLon();
    expect(land.length).toBeGreaterThan(2000);
    for (let i = 0; i < land.length; i += 2) {
      expect(land[i]).toBeLessThanOrEqual(76); expect(land[i]).toBeGreaterThanOrEqual(-56);
      expect(land[i + 1]).toBeGreaterThanOrEqual(-180); expect(land[i + 1]).toBeLessThanOrEqual(180);
    }
  });

  it("groups services by region and marks real incidents only", () => {
    const rows = [svc("a", "us-east-1", "US", "down"), svc("b", "us-east-1", "US", "down"), svc("c", "us-east-1", "US", "down"), svc("d", "us-east-1", "US"), svc("e", null, "DE"), svc("f", "eu-central-1", "DE", "down")];
    const nodes = buildRadarNodes(rows);
    expect(nodes[0].services.length).toBe(4);
    expect(nodes.length).toBe(3);
    const hot = radarHotKeys(nodes, []);
    expect(hot.has(nodes[0].key)).toBeTrue(); // 3 of 4 down
    expect(hot.size).toBe(1); // a single failing service does not turn a node red
  });

  it("prefers region, then geolocated city, then country, and counts edge-only services", () => {
    const city = { ...svc("c1", null, "US"), hostingCity: "Ashburn", geoCountry: "US", hostingLat: 39.04, hostingLon: -77.49 } as RadarServiceRow;
    const city2 = { ...svc("c2", null, "US"), hostingCity: "Ashburn", geoCountry: "US", hostingLat: 39.04, hostingLon: -77.49 } as RadarServiceRow;
    const regional = { ...svc("r1", "eu-central-1", "DE"), hostingCity: "Berlin", hostingLat: 52.5, hostingLon: 13.4 } as RadarServiceRow;
    const edge = { ...svc("e1", null, null), hostingProvider: null, cdn: "Cloudflare" } as RadarServiceRow;
    const fronted = { ...svc("f1", null, "US"), cdn: "Amazon Web Services (CloudFront)" } as RadarServiceRow; // origin hidden: no location
    expect(buildRadarNodes([fronted]).length).toBe(0);
    expect(edgeOnlyCount([fronted])).toBe(1);
    const nodes = buildRadarNodes([city, city2, regional, svc("k1", null, "JP"), edge]);
    const ash = nodes.find((n) => n.label === "Ashburn")!;
    expect(ash.kind).toBe("city"); expect(ash.services.length).toBe(2);
    expect(nodes.find((n) => n.sub === "eu-central-1")!.kind).toBe("region"); // region wins over a geolocated city
    expect(nodes.find((n) => n.sub === "JP")!.kind).toBe("country");
    expect(nodes.length).toBe(3);
    expect(edgeOnlyCount([city, regional, edge])).toBe(1);
  });

  it("renders controls and the detail panel for the selected node", () => {
    const nodes = buildRadarNodes([svc("svc-one", "eu-central-1", "DE"), svc("svc-two", "eu-central-1", "DE", "down")]);
    let sel: string | null = "x";
    const view = render(<QueryClientProvider client={new QueryClient()}><RadarGlobe nodes={nodes} hotKeys={new Set()} selected={nodes[0].key} onSelect={(k) => { sel = k; }} autoRotate={false} /></QueryClientProvider>);
    expect(view.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(view.container.textContent).toContain("Frankfurt");
    expect(view.container.textContent).toContain("svc-two");
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(sel).toBeNull();
  });
});
