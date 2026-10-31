import { schema } from "./confirm_POST.schema";
import { concentrationWatch } from "../../helpers/concentrationWatch";

export async function handle(request: Request) {
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Invalid link." }, { status: 400 }); }
  const r = await concentrationWatch.confirm(input.t);
  if (!r) return Response.json({ error: "This confirmation link is invalid or was already used." }, { status: 404 });
  return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
}
