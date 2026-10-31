import { radarJob } from "../../helpers/radarJob";

// Manual trigger (dev/testing). Safe to expose: radarJob holds a 4-minute lock, so it cannot be amplified.
export async function handle(_request: Request) {
  return Response.json(await radarJob(), { headers: { "Cache-Control": "no-store" } });
}