import { secConcJob } from "../helpers/secConcJob";

// Public but self-throttled (shared 6-day claim with the weekly job): cannot amplify SEC traffic.
export async function handle(_request: Request) {
  return Response.json(await secConcJob());
}
