import { schema } from "../machine_intelligence_POST.schema";
import { authorizeMachineIntelligence, type MachineMode } from "../../helpers/paidMachineIntelligence";

export async function handle(request: Request) {
  try {
    const rawBody = await request.clone().text();
    const parsed = schema.parse(rawBody.trim() ? JSON.parse(rawBody) : {});
    const mode = parsed.mode as MachineMode;
    const paid = await authorizeMachineIntelligence(request, mode, "/_api/machine/intelligence");
    if (paid.kind === "challenge") return paid.response;
    return new Response(JSON.stringify({
      requestId: paid.requestId,
      priceUsd: paid.priceUsd,
      intelligence: paid.intelligence,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Payment-Receipt": paid.receiptHeader,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Machine intelligence failed",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
