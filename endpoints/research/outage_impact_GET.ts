import { outageEventStudy } from "../../helpers/outageEventStudy";

// Public, pre-registered historical event study: do major infrastructure outages create a tradable move in the
// provider's stock? Result cached 24h; the conclusion is published whether positive or negative.
export async function handle(_request: Request) {
  try {
    return Response.json(await outageEventStudy.get(), { headers: { "Cache-Control": "public, s-maxage=3600" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Study unavailable" }, { status: 503 });
  }
}