import { radarExpiryJob } from "../../helpers/radarExpiryJob";

// Manual trigger for the daily certificate/domain expiry check (30-minute lock inside the job).
export async function handle(_request: Request) {
  return Response.json(await radarExpiryJob(), { headers: { "Cache-Control": "no-store" } });
}