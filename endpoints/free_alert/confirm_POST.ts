import { schema } from "./confirm_POST.schema";
import { freeAlerts } from "../../helpers/freeAlerts";

export async function handle(request: Request) {
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Invalid link." }, { status: 400 }); }
  const r = await freeAlerts.confirm(input.t);
  if (!r) return Response.json({ error: "This confirmation link is invalid or was already used." }, { status: 404 });
  return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
