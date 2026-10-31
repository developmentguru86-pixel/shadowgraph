import { researchJob } from "../../helpers/researchJob";

// Manual trigger. Safe to expose: researchJob holds a 20-minute lock, so it cannot be amplified.
export async function handle(_request: Request) {
  return Response.json(await researchJob(), { headers: { "Cache-Control": "no-store" } });
}
