import { upstreamJob } from "../../helpers/upstreamJob";

// Manual trigger. Safe to expose: upstreamJob holds an 8-minute lock, so it cannot be amplified.
export async function handle(_request: Request) {
  return Response.json(await upstreamJob(), { headers: { "Cache-Control": "no-store" } });
}
