import { fetchGlobalOfficialSignals } from "../helpers/globalSources";

export async function handle() {
  try {
    const output = await fetchGlobalOfficialSignals();
    return new Response(JSON.stringify(output), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Global official sources unavailable",
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}