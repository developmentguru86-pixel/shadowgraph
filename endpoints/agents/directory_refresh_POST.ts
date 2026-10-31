import { queueTask } from "@runtime/queueTask";
import { lastAgentDirectoryRun } from "../../helpers/agentDirectoryJob";

// Manual trigger for the weekly agent-directory refresh (runs in the background, several minutes).
// Safe to expose: the job itself holds a 6-hour lock, so repeated calls do nothing.
export async function handle(_request: Request) {
  await queueTask("agentDirectoryJob", {});
  return Response.json({ queued: true, last: await lastAgentDirectoryRun() }, { headers: { "Cache-Control": "no-store" } });
}
