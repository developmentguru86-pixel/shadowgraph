import { doraReport } from "../../helpers/doraReport";
import { outageEvidenceLog } from "../../helpers/radarEvidence";

/** GET /_api/vendors/evidence_csv?id=<scan id> → measurement log behind the measured outages (CSV). Part of the paid report. */
export async function handle(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const report = await doraReport.get(id, "en");
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  if (!report.paid) return Response.json({ error: "The measurement log is part of the paid report." }, { status: 402 });
  try {
    const rows = await outageEvidenceLog(report.observed);
    const cell = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ["vendor", "measured_on", "source", "time_utc", "probe_location", "probe_network", "checks", "checks_ok", "checks_failed", "result"];
    const note = "# Own probe: one check every 5 minutes, aggregated per hour (raw 5-minute results are kept for 48 hours). Worldwide probes: independent locations on other networks, each check listed. Times in UTC.";
    const csv = "﻿" + [note, head.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
    const slug = (report.company ?? "scan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scan";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="measurement-log-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "export failed" }, { status: 500 });
  }
}
