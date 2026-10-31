import type { OutputType } from "./global_markets_GET.schema";
import { globalMarkets } from "../helpers/globalMarkets";
import { PUBLISH_MARKET_QUOTES, WITHHELD } from "../helpers/licensing";

export async function handle() {
  if (!PUBLISH_MARKET_QUOTES) {
    return Response.json({ fetchedAt: new Date().toISOString(), quotes: [], notice: WITHHELD.quotes }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  try {
    const output: OutputType = await globalMarkets();
    return new Response(JSON.stringify(output), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=240",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Global market data unavailable",
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
