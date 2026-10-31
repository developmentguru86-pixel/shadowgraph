import { createHash } from "crypto";
import { mppStore } from "./mppStore";
import { clientIp } from "./visitorStats";

/** Per-client hourly limit for public write endpoints (forms). The client is a hash of the IP; the IP is not stored. */
export async function withinHourlyLimit(request: Request, bucket: string, limit: number): Promise<boolean> {
  const client = createHash("sha256").update(clientIp(request) || "unknown").digest("hex").slice(0, 16);
  const key = `ratelimit:${bucket}:${client}:${new Date().toISOString().slice(0, 13)}`;
  return mppStore.update<boolean>(key, (cur) => {
    const n = Number((cur as { n?: number } | null)?.n ?? 0);
    if (n >= limit) return { op: "noop", result: false };
    return { op: "set", value: { n: n + 1 }, result: true };
  });
}