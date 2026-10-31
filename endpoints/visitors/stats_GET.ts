import { checkStatsKey, visitorSummary } from "../../helpers/visitorStats";
import { businessSummary } from "../../helpers/ownerBusiness";

export async function handle(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!(await checkStatsKey(key))) return Response.json({ error: "Not authorised" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const [visitors, business] = await Promise.all([visitorSummary(), businessSummary().catch(() => null)]);
  return Response.json({ ...visitors, business }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
