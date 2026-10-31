import { gzipSync } from "zlib";

/**
 * JSON response, gzip-compressed when the client accepts it (the hosting edge does not compress API responses).
 * Large payloads such as the radar status shrink about 10x.
 */
export function jsonResponse(request: Request, data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const body = JSON.stringify(data);
  // public read-only data: callable from any web page (CORS), no credentials involved
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Accept-Encoding", "Access-Control-Allow-Origin": "*", ...(init.headers ?? {}) };
  if (body.length > 2048 && /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
    return new Response(gzipSync(body), { status: init.status ?? 200, headers: { ...headers, "Content-Encoding": "gzip" } });
  }
  return new Response(body, { status: init.status ?? 200, headers });
}
