import { mppStore } from "../../helpers/mppStore";
import { STUDY_KEY, EVENTS_KEY, type StudyEvent } from "../../helpers/concentrationSignal";

// Concentration-change signal test: summary as JSON, or every event as CSV (?format=csv) so anyone can re-run the numbers.
export async function handle(request: Request) {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    const ev = (await mppStore.get(EVENTS_KEY)) as { generatedAt: string; events: StudyEvent[] } | null;
    if (!ev) return new Response("not run yet\n", { status: 404 });
    const cols: Array<keyof StudyEvent> = ["ticker", "form", "filed", "fiscalYearEnd", "accession", "c0", "c1", "delta", "group", "arDay0", "arM1", "arM3", "arY1", "arM3Iwm"];
    const head = ["ticker", "form", "filed", "fiscal_year_end", "accession", "concentration_prior_year", "concentration_current_year", "change", "group",
      "abnormal_return_day0_1", "abnormal_return_day2_21", "abnormal_return_day2_61", "abnormal_return_day2_250", "abnormal_return_day2_61_vs_iwm"];
    const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1e5) / 1e5) : String(v));
    const body = [head.join(","), ...ev.events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\n");
    return new Response(body + "\n", { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="shadowgraph-concentration-signal-${ev.generatedAt.slice(0, 10)}.csv"`,
      "Cache-Control": "public, s-maxage=3600", "Access-Control-Allow-Origin": "*",
    } });
  }
  const result = await mppStore.get(STUDY_KEY);
  if (!result) return Response.json({ status: "not_run" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600", "Access-Control-Allow-Origin": "*" } });
}