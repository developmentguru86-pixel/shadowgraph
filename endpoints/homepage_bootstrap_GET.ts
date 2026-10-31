import { homepageBootstrap } from "../helpers/homepageBootstrap";

export async function handle() {
  try {
    const output = await homepageBootstrap();
    return new Response(JSON.stringify(output), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Homepage bootstrap unavailable",
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
