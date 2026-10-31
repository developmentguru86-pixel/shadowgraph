import { createHash } from "crypto";
import { schema } from "../dora_scan_POST.schema";
import { mppStore } from "../../helpers/mppStore";
import { normalizeDomain, vendorScan } from "../../helpers/vendorScan";

// Free fourth-party dependency mini-scan (max 10 vendor domains). Rate-limited per client and globally.
const PER_CLIENT_PER_HOUR = 15;
const GLOBAL_PER_HOUR = 400;

async function allow(key: string, limit: number) {
  return mppStore.update<boolean>(key, (cur) => {
    const n = Number((cur as { n?: number } | null)?.n ?? 0);
    if (n >= limit) return { op: "noop", result: false };
    return { op: "set", value: { n: n + 1 }, result: true };
  });
}

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Send 1 to 10 vendor domains." }, { status: 400 }); }
  const hour = new Date().toISOString().slice(0, 13);
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const client = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  if (!(await allow(`ratelimit:dora:${client}:${hour}`, PER_CLIENT_PER_HOUR)) || !(await allow(`ratelimit:dora:all:${hour}`, GLOBAL_PER_HOUR))) {
    return Response.json({ error: "Scan limit reached. Please try again in an hour." }, { status: 429 });
  }
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const d of input.domains) { const n = normalizeDomain(d); if (n && !valid.includes(n)) valid.push(n); else if (!n) rejected.push(d); }
  if (!valid.length) return Response.json({ error: "No valid domains. Use e.g. stripe.com" }, { status: 400 });
  const result = await vendorScan(valid);
  return Response.json({ ...result, rejected }, { headers: { "Cache-Control": "no-store" } });
}