import { signalsBoard } from "../helpers/signalsBoard";

// Plain-language Terminal layer: dependency shifts from SEC filings, the research scoreboard, and EU tender notices.
export async function handle(_request: Request) {
  try {
    return Response.json(await signalsBoard.get(), { headers: { "Cache-Control": "public, s-maxage=600" } });
  } catch (e) {
    console.error("signals board failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Signals temporarily unavailable" }, { status: 503 });
  }
}