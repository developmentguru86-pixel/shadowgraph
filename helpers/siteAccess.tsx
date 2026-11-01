/**
 * Bulk data access policy (owner decision 2026-11-01): the complete infrastructure mapping and the measurement tables
 * are no longer an open API. The site's own pages still load them in the browser; direct machine access needs a data key.
 *
 * A browser that fetches from the site's own page sends Sec-Fetch-Site: same-origin (all current browsers). Older
 * browsers send no Sec-Fetch-* headers; for those the Referer must point at one of our own hosts.
 * This stops plain bulk downloads (curl, scripts, scrapers that call the API); it cannot stop a full headless browser.
 */
const OWN_HOST = /^(?:www\.)?shadowalpha\.online$|^(?:www\.)?shadowalphatrade\.com$/;

export function isOwnSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "same-site";
  const ref = request.headers.get("referer") ?? request.headers.get("origin");
  if (!ref) return false;
  try { return OWN_HOST.test(new URL(ref).hostname.toLowerCase()); } catch { return false; }
}

export const DATA_ACCESS_URL = "https://shadowalpha.online/research/data";

/** 403 for direct bulk access without a key. */
export function bulkAccessDenied() {
  return Response.json(
    { error: "Bulk access to ShadowGraph's infrastructure mapping and measurement data requires a data key.", access: DATA_ACCESS_URL },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
