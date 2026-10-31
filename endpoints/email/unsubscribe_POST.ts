import { freeAlerts } from "../../helpers/freeAlerts";
import { concentrationWatch } from "../../helpers/concentrationWatch";

// One-click unsubscribe (RFC 8058): token in the query string, body ignored (providers send a form body), always 200.
// The token is random per subscription, so trying both lists is safe: at most one of them matches.
export async function handle(request: Request) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  try { if (!(await freeAlerts.unsubscribe(t))) await concentrationWatch.unsubscribe(t); } catch (e) { console.error("unsubscribe failed", e instanceof Error ? e.message : e); }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
