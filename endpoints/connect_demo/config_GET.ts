import { connectConfigState } from "../../helpers/stripeConnect";

export async function handle() {
  const state = connectConfigState();
  const missing = [
    !state.keyConfigured ? "STRIPE_CONNECT_SECRET_KEY" : null,
    !state.webhookConfigured ? "STRIPE_CONNECT_WEBHOOK_SECRET" : null,
    !state.demoEnabled ? "STRIPE_CONNECT_DEMO_ENABLED=true" : null,
  ].filter((value): value is string => Boolean(value));

  return new Response(JSON.stringify({ ...state, missing }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
