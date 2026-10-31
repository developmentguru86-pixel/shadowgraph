/**
 * Maintenance switch (owner request 2026-10-18, scoped per domain 2026-10-19).
 * While MAINTENANCE is true:
 * - shadowalpha.online (and www) show the maintenance screen on every page and refuse sign-ups, checkouts, scans and lead forms with 503;
 * - the internal platform address and previews work normally;
 * - background measurement keeps running everywhere, so the availability history has no gap.
 * Unknown hosts on the server default to maintenance (safe side); the browser then decides from its real hostname.
 */
export const MAINTENANCE = false; // owner switched the site back online 2026-10-19

/** Domains that show the maintenance screen. */
export const MAINTENANCE_HOSTS = ["shadowalpha.online", "www.shadowalpha.online"];
/** Domains that stay fully open while maintenance is on. */
export const OPEN_HOSTS: string[] = [];

const clean = (host: string | null | undefined) => (host ?? "").toLowerCase().split(":")[0];

/** Server side (SSR, endpoints): maintenance unless the host is explicitly open. */
export const serverMaintenance = (host: string | null | undefined) => MAINTENANCE && !OPEN_HOSTS.includes(clean(host));

/** Browser side: maintenance only on the public domains, so previews and internal addresses work. */
export const clientMaintenance = (host: string) => MAINTENANCE && MAINTENANCE_HOSTS.includes(clean(host));

/** Endpoint guard: true when this request arrived on a domain that is in maintenance. */
export function isMaintenanceRequest(request: Request) {
  if (!MAINTENANCE) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return MAINTENANCE_HOSTS.includes(clean(host));
}

export function maintenanceResponse() {
  return Response.json(
    { error: "The site is in maintenance. Please try again later." },
    { status: 503, headers: { "Retry-After": "86400", "Cache-Control": "no-store" } },
  );
}
