import { secReresolve } from "../helpers/secReresolve";
import { mppStore } from "../helpers/mppStore";

// Re-applies the current customer resolver to stored facts. Public but limited to once per hour.
export async function handle(_request: Request) {
  const ok = await mppStore.update<boolean>("job:sec-concentration:reresolve-claim", (cur) => {
    const last = (cur as { at?: string } | null)?.at;
    if (last && Date.now() - Date.parse(last) < 3600_000) return { op: "noop", result: false };
    return { op: "set", value: { at: new Date().toISOString() }, result: true };
  });
  if (!ok) return Response.json({ ran: false, reason: "cooldown" });
  return Response.json({ ran: true, ...(await secReresolve()) });
}
