import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import type { RadarMapNode } from "../components/RadarMapView";
import { worldMap } from "./worldMap";

/**
 * Group radar services by hosting location, most precise source first:
 *  1. cloud region from the provider's official IP ranges (exact),
 *  2. city from IP geolocation of a directly visible origin server (approximate, DB-IP Lite),
 *  3. country of the network owner (coarse).
 * Services behind a CDN/anycast edge have no fixed location and are not placed (see edgeOnlyCount).
 */
export function buildRadarNodes(services: RadarServiceRow[]): RadarMapNode[] {
  const m = new Map<string, RadarMapNode>();
  for (const s of services) {
    let key: string, lat: number, lon: number, label: string, sub: string, kind: RadarMapNode["kind"];
    if (s.hostingRegion && worldMap.regions[s.hostingRegion]) {
      const g = worldMap.regions[s.hostingRegion]; [lat, lon, label] = g; key = `r:${g[0]},${g[1]}`; sub = s.hostingRegion; kind = "region";
    } else if (s.hostingLat != null && s.hostingLon != null && s.hostingCity) {
      lat = s.hostingLat; lon = s.hostingLon; label = s.hostingCity; sub = s.geoCountry ?? s.hostingCountry ?? "";
      key = `g:${label},${sub}`; kind = "city";
    } else if (!s.cdn && s.hostingCountry && s.hostingProvider && worldMap.countries[s.hostingCountry]) {
      // behind a CDN the "country" is only where the network owner is registered, not where the server is: not placed
      const g = worldMap.countries[s.hostingCountry]; [lat, lon, label] = g; key = `c:${s.hostingCountry}`; sub = s.hostingCountry; kind = "country";
    } else continue;
    if (!m.has(key)) { const [x, y] = worldMap.project(lat, lon); m.set(key, { key, label, sub, x, y, services: [], kind }); }
    m.get(key)!.services.push(s);
  }
  return [...m.values()].sort((a, b) => b.services.length - a.services.length);
}

/** Services that sit only behind a CDN / anycast edge: they answer from many places, so they have no single location. */
export const edgeOnlyCount = (services: RadarServiceRow[]) =>
  services.filter((s) => s.category !== "Cloud region canary" && !(s.hostingRegion && worldMap.regions[s.hostingRegion]) && s.hostingLat == null
    && !(!s.cdn && s.hostingCountry && s.hostingProvider && worldMap.countries[s.hostingCountry])).length;

/** Red only for real incidents: an open region incident at that location, or >= 3 services down that are >= 10% of it. */
export function radarHotKeys(nodes: RadarMapNode[], incidents: Array<{ status: string; layer: string; provider: string }>): Set<string> {
  const hotRegions = new Set(incidents.filter((i) => i.status === "open" && i.layer === "region").map((i) => i.provider.split(" ").pop()));
  return new Set(nodes.filter((n) => {
    const down = n.services.filter((s) => s.state === "down").length;
    return hotRegions.has(n.sub) || (down >= 3 && down / n.services.length >= 0.1);
  }).map((n) => n.key));
}
