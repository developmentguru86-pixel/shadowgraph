import { queueTask } from "@runtime/queueTask";
import { lastAgentProbe } from "../../helpers/agentProbeJob";

// Manual trigger for the hourly agent reachability check (background; the job holds a 40-minute lock).
export async function handle(_request: Request) {
  await queueTask("agentProbeJob", {});
  return Response.json({ queued: true, last: await lastAgentProbe() }, { headers: { "Cache-Control": "no-store" } });
}
