import { schema } from "./visit_POST.schema";
import { recordVisit } from "../helpers/visitorStats";

export async function handle(request: Request) {
  try {
    const input = schema.parse(await request.json());
    await recordVisit(request, input);
  } catch (e) {
    // counting must never break a page view; log and answer ok
    console.error("visit record failed", e instanceof Error ? e.message : e);
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
