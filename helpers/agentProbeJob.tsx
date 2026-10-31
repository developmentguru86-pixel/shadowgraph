import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";

/**
 * Hourly reachability check of the public AI agent endpoints that have a location on the globe (placement city/region).
 * One request per host and hour (endpoints on the same host share the result), so busy hosts such as mcp.apify.com
 * are not hammered. Any HTTP answer below 500 counts as reachable: agent endpoints answer a plain GET with 401, 405 or
 * 406 by design; timeouts, connection errors and 5xx count as unreachable. The last 24 results are kept per endpoint.
 */
const UA = "ShadowGraph-AgentMonitor/1.0 (+https://shadowalpha.online/radar; hourly reachability check, one request per host)";
const LAST = "agent-probe:last";

type Result = { host: string; ok: boolean; status: number | null; ms: number | null };

async function probe(host: string, url: string): Promise<Result> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "user-agent": UA, accept: "application/json, text/event-stream, */*" }, signal: AbortSignal.timeout(8000) });
    await r.body?.cancel().catch(() => undefined);
    return { host, ok: r.status > 0 && r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch {
    return { host, ok: false, status: null, ms: null };
  }
}

export async function agentProbeJob() {
  const gotLock = await mppStore.update<boolean>("agent-probe:lock", (cur) => {
    const at = (cur as { at?: number } | null)?.at ?? 0;
    if (Date.now() - at < 40 * 60_000) return { op: "noop", result: false };
    return { op: "set", value: { at: Date.now() }, result: true };
  });
  if (!gotLock) return { ran: false };

  const started = Date.now();
  const hosts = (await sql<{ host: string; url: string }>`
    select distinct on (host) host, url from agent_directory where placement in ('city', 'region') order by host, url`.execute(db)).rows;

  const results: Result[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(60, hosts.length) }, async () => {
    while (i < hosts.length && Date.now() - started < 12 * 60_000) { const h = hosts[i++]; results.push(await probe(h.host, h.url)); }
  }));

  for (let k = 0; k < results.length; k += 400) {
    const chunk = results.slice(k, k + 400);
    const values = sql.join(chunk.map((r) => sql`(${r.host}, ${r.ok}, ${r.status}::int, ${r.ms}::int)`));
    await sql`
      update agent_directory a set last_checked_at = now(), last_ok = v.ok, last_status = v.status, last_ms = v.ms,
        history = right(coalesce(a.history, '') || case when v.ok then '1' else '0' end, 24)
      from (values ${values}) as v(host, ok, status, ms)
      where a.host = v.host and a.placement in ('city', 'region')`.execute(db);
  }
  const summary = { at: new Date().toISOString(), hosts: hosts.length, checked: results.length, reachable: results.filter((r) => r.ok).length, seconds: Math.round((Date.now() - started) / 1000) };
  await mppStore.put(LAST, summary);
  // release the lock, so a manual run between two hourly runs never makes the next scheduled run skip
  await mppStore.put("agent-probe:lock", { at: 0 });
  return { ran: true, ...summary };
}

export async function lastAgentProbe() {
  return (await mppStore.get(LAST)) as null | { at: string; hosts: number; checked: number; reachable: number };
}
