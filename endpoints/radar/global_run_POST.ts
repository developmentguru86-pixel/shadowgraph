import { globalProbeJob } from "../../helpers/globalProbeJob";

// Manual trigger (first fill / testing). Safe to expose: the job holds a 20-minute lock, so it cannot be amplified
// beyond the scheduled budget of the free Globalping tier.
export async function handle(_request: Request) {
  return Response.json(await globalProbeJob(), { headers: { "Cache-Control": "no-store" } });
}
