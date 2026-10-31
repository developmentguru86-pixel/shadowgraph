import superjson from "superjson";
import { alphaSnapshot } from "../helpers/alphaSnapshot";
import { PUBLISH_MARKET_QUOTES, WITHHELD } from "../helpers/licensing";
export async function handle() {
 if (!PUBLISH_MARKET_QUOTES) return new Response(superjson.stringify({ error: WITHHELD.quotes }), { status: 503, headers: { "Cache-Control": "public, s-maxage=300" } });
 try { return new Response(superjson.stringify(await alphaSnapshot()), {headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=90"}}); }
 catch(error) { return new Response(superjson.stringify({error:error instanceof Error ? error.message : "Alpha engine unavailable"}),{status:502}); }
}