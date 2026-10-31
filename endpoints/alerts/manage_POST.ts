import { schema } from "../alerts_manage_POST.schema";
import { stackAlerts } from "../../helpers/stackAlerts";

// All subscriber self-service goes through the private management token (in the body, never in server logs' URLs).
export async function handle(request: Request) {
  let input;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  try {
    if (input.action === "view") {
      const view = await stackAlerts.view(input.token);
      return view ? Response.json({ view }) : Response.json({ error: "Unknown management link" }, { status: 404 });
    }
    if (input.action === "update") {
      const view = await stackAlerts.update(input.token, { serviceIds: input.serviceIds, slack: input.slack, teams: input.teams, webhook: input.webhook });
      return Response.json({ view });
    }
    if (input.action === "test") return Response.json({ channels: await stackAlerts.test(input.token) });
    if (input.action === "addMonitor") {
      if (!input.monitor) return Response.json({ error: "Missing monitor" }, { status: 400 });
      return Response.json({ view: await stackAlerts.addMonitor(input.token, input.monitor) });
    }
    if (input.action === "removeMonitor") {
      if (!input.monitorId) return Response.json({ error: "Missing monitor id" }, { status: 400 });
      return Response.json({ view: await stackAlerts.removeMonitor(input.token, input.monitorId) });
    }
    if (input.action === "saveBoard") {
      if (!input.board) return Response.json({ error: "Missing board" }, { status: 400 });
      return Response.json({ view: await stackAlerts.saveBoard(input.token, input.board) });
    }
    if (input.action === "removeBoard") {
      if (!input.boardId) return Response.json({ error: "Missing board id" }, { status: 400 });
      return Response.json({ view: await stackAlerts.removeBoard(input.token, input.boardId) });
    }
    const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
    return Response.json({ url: await stackAlerts.portal(input.token, `https://${host}/alerts`) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: 400 });
  }
}