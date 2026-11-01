import { db } from "../../helpers/db";
import { registrableDomain } from "../../helpers/vendorScan";
import { DATASET_TABLES, type DatasetTable } from "./dataset_GET.schema";
import { dependencyDataset } from "../../helpers/dependencyDataset";

/**
 * ShadowGraph Measurement Dataset. Licensed access since 2026-11-01: every table needs a data key
 * ("Authorization: Bearer sgd_..." or "x-api-key"). Copies downloaded before that date were published under CC BY 4.0.
 * Versionless rolling tables; every row carries its own timestamps.
 * GET /_api/research/dataset?table=services|sweeps|episodes|hourly|status_incidents|provider_incidents|upstream_signals[&days=1..31 for hourly/sweeps]
 */
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(";") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (cols: string[], rows: Array<Record<string, unknown>>) =>
  [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";

async function load(table: DatasetTable, days: number): Promise<{ cols: string[]; rows: Array<Record<string, unknown>> }> {
  const since = new Date(Date.now() - days * 86_400_000);
  switch (table) {
    case "services": {
      const rows = await db.selectFrom("radarServices").selectAll().where("active", "=", true).orderBy("id").execute();
      return { cols: ["service_id", "name", "category", "probe_url", "organisation", "hosting_provider", "hosting_region", "hosting_country", "cdn", "dns_provider", "email_provider", "mapped_at"],
        rows: rows.map((r) => ({ service_id: r.id, name: r.name, category: r.category, probe_url: r.probeUrl, organisation: registrableDomain(new URL(r.probeUrl).hostname),
          hosting_provider: r.hostingProvider, hosting_region: r.hostingRegion, hosting_country: r.hostingCountry, cdn: r.cdn, dns_provider: r.dnsProvider, email_provider: r.emailProvider, mapped_at: r.mappedAt })) };
    }
    case "sweeps": {
      const rows = await db.selectFrom("radarRuns").selectAll().where("at", ">", since).orderBy("at").execute();
      return { cols: ["run_id", "at", "probes", "failed", "vantage_suspect", "failing_service_ids"],
        rows: rows.map((r) => ({ run_id: r.runId, at: r.at, probes: r.total, failed: r.nFailed, vantage_suspect: r.vantageSuspect, failing_service_ids: r.failing })) };
    }
    case "episodes": {
      const rows = await db.selectFrom("radarEpisodes").selectAll().orderBy("startedAt").execute();
      return { cols: ["service_id", "started_at", "last_failed_at", "recovered_at", "failed_sweeps", "reason"],
        rows: rows.map((r) => ({ service_id: r.serviceId, started_at: r.startedAt, last_failed_at: r.lastFailedAt, recovered_at: r.recoveredAt, failed_sweeps: r.nFailed, reason: r.reason })) };
    }
    case "hourly": {
      // note: the db helper camel-cases result keys, so rows are re-keyed explicitly
      const rows = await db.selectFrom("radarServiceHourly").selectAll().where("hour", ">", since).orderBy("hour").orderBy("serviceId").execute();
      const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
      return { cols: ["service_id", "hour", "probes", "reachable", "p50_ms", "p95_ms"],
        rows: rows.map((r) => ({ service_id: r.serviceId, hour: r.hour, probes: r.n, reachable: r.nOk, p50_ms: r1(r.p50Ms), p95_ms: r1(r.p95Ms) })) };
    }
    case "status_incidents": {
      const rows = await db.selectFrom("statusIncidents").selectAll().orderBy("createdAt").execute();
      return { cols: ["organisation", "status_page", "incident_id", "title", "impact", "status", "created_at", "started_at", "resolved_at", "components", "link"],
        rows: rows.map((r) => ({ organisation: r.org, status_page: r.pageHost, incident_id: r.incidentId, title: r.name, impact: r.impact, status: r.status,
          created_at: r.createdAt, started_at: r.startedAt, resolved_at: r.resolvedAt, components: r.components, link: r.shortlink })) };
    }
    case "provider_incidents": {
      const rows = await db.selectFrom("providerIncidents").selectAll().orderBy("startedAt").execute();
      return { cols: ["source", "incident_id", "provider", "region", "title", "started_at", "declared_at", "resolved_at", "severe", "link"],
        rows: rows.map((r) => ({ source: r.source, incident_id: r.incidentId, provider: r.provider, region: r.region, title: r.title,
          started_at: r.startedAt, declared_at: r.declaredAt, resolved_at: r.resolvedAt, severe: r.severe, link: r.link })) };
    }
    case "upstream_signals": {
      const rows = await db.selectFrom("upstreamEvents").selectAll().orderBy("firedAt").execute();
      return { cols: ["signal_id", "rule", "opened_at", "fired_at", "last_at", "likely_provider", "layer", "companies", "p_value", "evidence", "minutes_vs_provider", "first_seen_at"],
        rows: rows.map((r) => {
          const c = (r.candidates as unknown as Array<{ provider: string; layer: string }>)[0];
          const comps = [...new Set((r.incidents as unknown as Array<{ org: string }>).map((x) => x.org))];
          return { signal_id: r.id, rule: r.rule, opened_at: r.openedAt, fired_at: r.firedAt, last_at: r.lastAt, likely_provider: c?.provider ?? null,
            layer: c?.layer ?? null, companies: comps, p_value: r.p, evidence: r.tier, minutes_vs_provider: r.minutesVsProvider, first_seen_at: r.firstSeenAt };
        }) };
    }
  }
}

export async function handle(request: Request) {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  const key = (auth?.startsWith("Bearer ") ? auth.slice(7) : null) ?? request.headers.get("x-api-key");
  const check = await dependencyDataset.authorize(key?.trim() ?? null);
  if (!check.ok) {
    return Response.json(
      { error: "The measurement tables require a data key.", reason: check.reason, access: "https://shadowalpha.online/research/data" },
      { status: check.reason === "subscription_inactive" ? 402 : 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const table = url.searchParams.get("table") as DatasetTable | null;
  if (!table || !DATASET_TABLES.includes(table)) {
    return Response.json({ error: `table must be one of: ${DATASET_TABLES.join(", ")}` }, { status: 400 });
  }
  const days = Math.min(31, Math.max(1, Number(url.searchParams.get("days")) || 7));
  try {
    const { cols, rows } = await load(table, days);
    return new Response(toCsv(cols, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="shadowgraph-${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
        "X-License": "ShadowGraph data licence: internal use by the key holder; no redistribution or resale",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Dataset unavailable" }, { status: 503 });
  }
}
