import { worldMap } from "./worldMap";

/**
 * Pure helpers for the "Agents" layer of the radar globe (no database access, so they are unit-testable).
 *
 * What is measured, and what is not:
 *  - Signals: real requests that other agents send to ShadowGraph's MCP / A2A / REST endpoints. The sender's position
 *    comes from the CDN's viewer-geolocation headers (city level, rounded to ~10 km); the IP address is never stored.
 *  - Directory: agents that publish a public endpoint in the official MCP Registry or the A2A Registry, located by
 *    resolving their host name. Agents behind an anycast edge (Cloudflare, CloudFront, Fastly, Vercel …) answer from
 *    many places at once and have no single location, so they are counted but not placed.
 *  - Traffic between third-party agents is not observable from outside and is never drawn.
 */

export type CallerGeo = { city: string | null; country: string | null; lat: number | null; lon: number | null; precision: "city" | "country" | null };

const GENERIC: Record<string, string> = {
  node: "Node.js client", bun: "Bun client", deno: "Deno client", curl: "curl", wget: "wget",
  "python-requests": "Python client", "python-httpx": "Python client (httpx)", "python-urllib": "Python client", aiohttp: "Python client (aiohttp)",
  axios: "Node.js client (axios)", undici: "Node.js client", "go-http-client": "Go client", okhttp: "Java/Kotlin client",
};

/** A readable sender name from a User-Agent header ("AgenstryBot/0.3.0 (+…)" → "AgenstryBot"). */
export function agentNameOf(ua: string | null | undefined): string {
  const u = (ua ?? "").trim();
  if (!u) return "Unnamed client";
  const compat = /compatible;\s*([A-Za-z][\w.-]*)\//.exec(u);
  if (compat) return compat[1];
  if (/^Mozilla\//.test(u)) {
    const bot = /\b([A-Za-z][\w-]*(?:bot|Bot|BOT|crawler|Crawler|agent|Agent))\//.exec(u);
    return bot ? bot[1] : "Web browser";
  }
  const first = u.split(/[/\s(;]/)[0].slice(0, 40);
  if (!first) return "Unnamed client";
  return GENERIC[first.toLowerCase()] ?? first;
}

/** True for generic HTTP libraries, which do not identify the agent behind them. */
export const isGenericClient = (name: string) => Object.values(GENERIC).includes(name) || name === "Unnamed client" || name === "Web browser";

/** Sender location from CloudFront viewer headers; coordinates rounded to 0.1° (~10 km). Country-only falls back to the country centre. */
export function callerGeoFromHeaders(h: { get(name: string): string | null }): CallerGeo {
  const country = (h.get("cloudfront-viewer-country") ?? h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? "").toUpperCase();
  const cc = /^[A-Z]{2}$/.test(country) ? country : null;
  const lat = Number(h.get("cloudfront-viewer-latitude") ?? h.get("x-vercel-ip-latitude") ?? NaN);
  const lon = Number(h.get("cloudfront-viewer-longitude") ?? h.get("x-vercel-ip-longitude") ?? NaN);
  const rawCity = h.get("cloudfront-viewer-city") ?? h.get("x-vercel-ip-city");
  let city: string | null = null;
  if (rawCity) { try { city = decodeURIComponent(rawCity).slice(0, 80); } catch { city = rawCity.slice(0, 80); } }
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
    return { city, country: cc, lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10, precision: "city" };
  }
  const c = cc ? worldMap.countries[cc] : undefined;
  if (c) return { city: null, country: cc, lat: c[0], lon: c[1], precision: "country" };
  return { city: null, country: cc, lat: null, lon: null, precision: null };
}

// ---------- directory placement ----------

export type Net = { base: number; mask: number; label: string; kind: "edge" | "region" };
export const ipInt = (ip: string) => ip.split(".").reduce((a, o) => (a * 256 + Number(o)) >>> 0, 0);
export const isIPv4 = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
export function cidr(c: string, label: string, kind: Net["kind"]): Net | null {
  const [b, l] = c.trim().split("/");
  const len = Number(l);
  if (!isIPv4(b) || !(len >= 0 && len <= 32)) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return { base: (ipInt(b) & mask) >>> 0, mask, label, kind };
}
/** nets must be sorted most specific first. */
export function matchNet(ip: string, nets: Net[]): Net | null {
  const x = ipInt(ip);
  for (const n of nets) if (((x & n.mask) >>> 0) === n.base) return n;
  return null;
}

/** Hosting platforms whose sub-domains are always served from an anycast edge. */
export const EDGE_SUFFIX: Array<[string, string]> = [
  ["workers.dev", "Cloudflare"], ["pages.dev", "Cloudflare"], ["vercel.app", "Vercel"], ["netlify.app", "Netlify"],
  ["deno.dev", "Deno Deploy"], ["deno.net", "Deno Deploy"], ["fly.dev", "Fly.io"], ["run.app", "Google Cloud Run"],
  ["web.app", "Firebase Hosting"], ["firebaseapp.com", "Firebase Hosting"], ["supabase.co", "Supabase"],
  ["up.railway.app", "Railway"], ["onrender.com", "Render"], ["lovable.app", "Lovable"],
];

/**
 * Shared front-end / anycast addresses of hosting platforms (custom domains point here). IP geolocation of these
 * returns the network's registration address (e.g. Walnut CA for Vercel), not the server, so they are never placed.
 */
export const KNOWN_EDGE: Array<[string, string]> = [
  ["76.76.21.0/24", "Vercel"], ["66.33.60.0/24", "Vercel"], ["64.29.17.0/24", "Vercel"], ["216.198.79.0/24", "Vercel"],
  ["216.150.1.0/24", "Vercel"], ["216.150.16.0/24", "Vercel"],
  ["69.46.46.0/24", "Railway"], ["216.24.57.0/24", "Render"], ["66.241.124.0/23", "Fly.io"], ["185.158.133.0/24", "Lovable"],
  ["75.2.60.0/24", "Netlify"], ["99.83.190.0/24", "Netlify"],
];
export const edgeBySuffix = (host: string) => EDGE_SUFFIX.find(([s]) => host === s || host.endsWith(`.${s}`))?.[1] ?? null;

export type GeoHit = { city?: { names?: { en?: string } }; country?: { iso_code?: string }; location?: { latitude?: number; longitude?: number } } | null;
export type Placement = { placement: "city" | "region" | "edge" | "unresolved"; network: string | null; region: string | null; city: string | null; country: string | null; lat: number | null; lon: number | null };

/** Decide where one agent host sits, most reliable evidence first. */
export function placeHost(host: string, ip: string | null, nets: Net[], geo: (ip: string) => GeoHit): Placement {
  const none: Placement = { placement: "unresolved", network: null, region: null, city: null, country: null, lat: null, lon: null };
  const suffix = edgeBySuffix(host);
  if (!ip) return suffix ? { ...none, placement: "edge", network: suffix } : none;
  const net = matchNet(ip, nets);
  if (net?.kind === "edge") return { ...none, placement: "edge", network: net.label };
  // a platform sub-domain is served by that platform's edge even when its DNS answer is a regional address
  if (suffix) return { ...none, placement: "edge", network: suffix };
  if (net?.kind === "region") {
    const [provider, region] = net.label.split("|");
    const r = worldMap.regions[region];
    if (r) return { placement: "region", network: provider, region, city: r[2], country: null, lat: r[0], lon: r[1] };
  }
  const g = geo(ip);
  const city = g?.city?.names?.en?.replace(/ \(.*\)$/, "") ?? null;
  const lat = g?.location?.latitude, lon = g?.location?.longitude;
  // Google's front end geolocates to its headquarters, not to a server: no usable location
  if (city === "Mountain View") return { ...none, placement: "edge", network: "Google front end" };
  if (lat == null || lon == null || !city) return { ...none, country: g?.country?.iso_code ?? null };
  return { placement: "city", network: net ? net.label.split("|")[0] : null, region: null, city, country: g?.country?.iso_code ?? null, lat, lon };
}

/** First usable remote endpoint of a registry entry (skips templated URLs such as https://{tenant}.example.com). */
export function firstRemoteUrl(urls: Array<string | undefined | null>): { url: string; host: string } | null {
  for (const u of urls) {
    if (!u || u.includes("{")) continue;
    try {
      const p = new URL(u);
      if ((p.protocol === "https:" || p.protocol === "http:") && p.hostname.includes(".") && p.hostname !== "localhost") return { url: u, host: p.hostname.toLowerCase() };
    } catch { /* skip */ }
  }
  return null;
}

// ---------- globe geometry ----------

/** Point at fraction t along the great circle from a to b (slerp), as [lat, lon]. */
export function greatCircle(a: [number, number], b: [number, number], t: number): [number, number] {
  const D = Math.PI / 180;
  const φ1 = a[0] * D, λ1 = a[1] * D, φ2 = b[0] * D, λ2 = b[1] * D;
  const v1 = [Math.cos(φ1) * Math.cos(λ1), Math.cos(φ1) * Math.sin(λ1), Math.sin(φ1)];
  const v2 = [Math.cos(φ2) * Math.cos(λ2), Math.cos(φ2) * Math.sin(λ2), Math.sin(φ2)];
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-6) return [a[0], a[1]];
  const s1 = Math.sin((1 - t) * ω) / Math.sin(ω), s2 = Math.sin(t * ω) / Math.sin(ω);
  const x = s1 * v1[0] + s2 * v2[0], y = s1 * v1[1] + s2 * v2[1], z = s1 * v1[2] + s2 * v2[2];
  return [Math.atan2(z, Math.hypot(x, y)) / D, Math.atan2(y, x) / D];
}

/** Central angle between two points in degrees. */
export function arcDegrees(a: [number, number], b: [number, number]): number {
  const D = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * D) / 2) ** 2 + Math.cos(a[0] * D) * Math.cos(b[0] * D) * Math.sin(((b[1] - a[1]) * D) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / D;
}
