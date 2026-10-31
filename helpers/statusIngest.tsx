import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { STATUS_PAGES } from "./statusRegistry";

/**
 * Ingestion of official status information.
 *  - collectStatusIncidents(): incident histories of 182 companies' machine-readable status pages -> status_incidents
 *  - collectProviderIncidents(): the infrastructure providers' own public records -> provider_incidents
 *      AWS Health Dashboard public history (service-region keys), Google Cloud incidents.json,
 *      Cloudflare / Akamai / Vercel status pages (Statuspage API).
 */
const UA = { "user-agent": "ShadowGraph-Research/1.0 (+https://shadowalpha.online/research)" };

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

type RawIncident = { id?: string; name?: string; impact?: string; status?: string; created_at?: string; started_at?: string | null;
  resolved_at?: string | null; shortlink?: string | null; components?: Array<{ name?: string }> };

async function fetchStatuspage(host: string) {
  const r = await fetch(`https://${host}/api/v2/incidents.json`, { headers: UA, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as { incidents?: RawIncident[] };
  if (!Array.isArray(j.incidents)) throw new Error("no incidents array");
  return j.incidents.filter((i) => i.id && i.created_at);
}

export async function collectStatusIncidents() {
  let ok = 0, rows = 0;
  const failed: string[] = [];
  await pool(Object.entries(STATUS_PAGES), 16, async ([org, host]) => {
    try {
      const vals = (await fetchStatuspage(host)).map((i) => ({
        pageHost: host, incidentId: String(i.id), org, name: String(i.name ?? "").slice(0, 300),
        impact: String(i.impact ?? "none"), status: String(i.status ?? ""), createdAt: new Date(i.created_at!),
        startedAt: i.started_at ? new Date(i.started_at) : null, resolvedAt: i.resolved_at ? new Date(i.resolved_at) : null,
        components: (i.components ?? []).map((c) => c.name).filter(Boolean) as never, shortlink: i.shortlink ?? null,
      }));
      if (vals.length) {
        await db.insertInto("statusIncidents").values(vals).onConflict((oc) => oc.columns(["pageHost", "incidentId"]).doUpdateSet((eb) => ({
          name: eb.ref("excluded.name"), impact: eb.ref("excluded.impact"), status: eb.ref("excluded.status"),
          startedAt: eb.ref("excluded.startedAt"), resolvedAt: eb.ref("excluded.resolvedAt"),
          components: eb.ref("excluded.components"), shortlink: eb.ref("excluded.shortlink"), fetchedAt: sql`now()`,
        }))).execute();
      }
      ok++; rows += vals.length;
    } catch {
      failed.push(host);
    }
  });
  const res = { at: new Date().toISOString(), pages: Object.keys(STATUS_PAGES).length, ok, rows, failed };
  await mppStore.put("research:groundTruth:last", res);
  return res;
}

type ProviderRow = {
  source: string; incidentId: string; family: string; provider: string; region: string | null; title: string;
  startedAt: Date; declaredAt: Date; resolvedAt: Date | null; severe: boolean; link: string | null;
};
const REGION_RE = /^(.*?)-((?:us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d)$/;

async function awsHistory(): Promise<ProviderRow[]> {
  const r = await fetch("https://history-events-us-west-2-prod.s3.amazonaws.com/historyevents.json", { headers: UA, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json()) as Record<string, Array<{ summary?: string; arn?: string; date?: string; event_log?: Array<{ timestamp: number; status?: string }> }>>;
  const out: ProviderRow[] = [];
  for (const [key, evs] of Object.entries(j)) {
    const m = key.match(REGION_RE);
    const service = m ? m[1] : key, region = m ? m[2] : null;
    const provider = /route53/.test(service) ? "AWS Route 53" : /cloudfront/.test(service) ? "Amazon Web Services (CloudFront)" : "Amazon Web Services";
    for (const e of evs) {
      if (!e.date) continue;
      const start = new Date(Number(e.date) * 1000);
      const log = e.event_log ?? [];
      const last = log.length ? new Date(log[log.length - 1].timestamp * 1000) : null;
      out.push({
        source: "aws-health", incidentId: e.arn ?? `${key}-${e.date}`, family: "aws", provider, region,
        title: `${String(e.summary ?? "").replace(/^\[RESOLVED\]\s*/i, "")} (${service}${region ? ` ${region}` : ""})`.slice(0, 300),
        startedAt: start, declaredAt: start, resolvedAt: /RESOLVED/i.test(e.summary ?? "") ? last : null, severe: true,
        link: "https://health.aws.amazon.com/health/status",
      });
    }
  }
  return out;
}

async function googleCloud(): Promise<ProviderRow[]> {
  const r = await fetch("https://status.cloud.google.com/incidents.json", { headers: UA, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json()) as Array<{ id: string; begin: string; created: string; end?: string | null; external_desc?: string; severity?: string; uri?: string }>;
  return j.map((i) => ({
    source: "gcp-status", incidentId: i.id, family: "google", provider: "Google Cloud", region: null,
    title: String(i.external_desc ?? "Google Cloud incident").slice(0, 300), startedAt: new Date(i.begin), declaredAt: new Date(i.created),
    resolvedAt: i.end ? new Date(i.end) : null, severe: i.severity !== "low", link: i.uri ? `https://status.cloud.google.com/${i.uri}` : "https://status.cloud.google.com/",
  }));
}

async function statuspageProvider(host: string, family: string, provider: string): Promise<ProviderRow[]> {
  return (await fetchStatuspage(host)).filter((i) => i.impact && i.impact !== "none").map((i) => ({
    source: host, incidentId: String(i.id), family, provider, region: null, title: String(i.name ?? "").slice(0, 300),
    startedAt: new Date(i.started_at ?? i.created_at!), declaredAt: new Date(i.created_at!), resolvedAt: i.resolved_at ? new Date(i.resolved_at) : null,
    severe: i.impact === "major" || i.impact === "critical", link: i.shortlink ?? `https://${host}/`,
  }));
}

export async function collectProviderIncidents() {
  const sources: Array<[string, () => Promise<ProviderRow[]>]> = [
    ["aws-health", awsHistory],
    ["gcp-status", googleCloud],
    ["www.cloudflarestatus.com", () => statuspageProvider("www.cloudflarestatus.com", "cloudflare", "Cloudflare")],
    ["www.akamaistatus.com", () => statuspageProvider("www.akamaistatus.com", "akamai", "Akamai")],
    ["www.vercel-status.com", () => statuspageProvider("www.vercel-status.com", "vercel", "Vercel")],
  ];
  const result: Record<string, number | string> = {};
  for (const [name, fn] of sources) {
    try {
      const rows = await fn();
      for (let i = 0; i < rows.length; i += 200) {
        await db.insertInto("providerIncidents").values(rows.slice(i, i + 200)).onConflict((oc) => oc.columns(["source", "incidentId"]).doUpdateSet((eb) => ({
          title: eb.ref("excluded.title"), resolvedAt: eb.ref("excluded.resolvedAt"), severe: eb.ref("excluded.severe"), fetchedAt: sql`now()`,
        }))).execute();
      }
      result[name] = rows.length;
    } catch (e) {
      result[name] = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
    }
  }
  await mppStore.put("upstream:providerSources:last", { at: new Date().toISOString(), result });
  return result;
}
