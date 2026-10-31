import { detectPriceLags } from "../helpers/priceLagEngine";

export async function handle() {
  try {
    const output = await detectPriceLags();
    return new Response(JSON.stringify(output), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Price-lag engine unavailable",
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}