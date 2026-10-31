import { fetchGlobalNews } from "../helpers/globalNews";
import { PUBLISH_NEWS_HEADLINES, WITHHELD } from "../helpers/licensing";

export async function handle() {
  if (!PUBLISH_NEWS_HEADLINES) {
    return Response.json({ fetchedAt: new Date().toISOString(), events: [], source: "withheld", notice: WITHHELD.news }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  try {
    const events = await fetchGlobalNews();
    return new Response(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      events,
      source: "Google News RSS global thematic feeds",
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=240, stale-while-revalidate=480",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Global news unavailable",
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}