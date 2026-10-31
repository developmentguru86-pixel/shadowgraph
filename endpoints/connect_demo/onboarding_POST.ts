import { schema } from "../connect_demo_onboarding_POST.schema";
import {
  getConnectAccountMapping,
  getConnectBaseUrl,
  getStripeConnectClient,
  requireConnectDemoEnabled,
  safeConnectError,
} from "../../helpers/stripeConnect";

export async function handle(request: Request) {
  try {
    requireConnectDemoEnabled();
    const input = schema.parse(await request.json());
    const mapping = await getConnectAccountMapping(input.userId);
    if (!mapping) {
      return new Response(JSON.stringify({
        error: "Create a connected account before starting onboarding.",
      }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const stripeClient = getStripeConnectClient();
    const baseUrl = getConnectBaseUrl(request);
    const user = encodeURIComponent(input.userId);
    const account = encodeURIComponent(mapping.accountId);

    // Account Links are short-lived, so create a fresh link every time the user
    // clicks the onboarding button instead of storing the URL.
    const accountLink = await stripeClient.v2.core.accountLinks.create({
      account: mapping.accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          // stripe-node v23 / 2026-09-30.endive no longer exposes a
          // "configurations" create parameter here. The account already has
          // recipient configured, so the hosted onboarding flow collects its
          // current recipient requirements.
          refresh_url: `${baseUrl}/connect-demo?userId=${user}&onboarding=refresh`,
          return_url: `${baseUrl}/connect-demo?userId=${user}&accountId=${account}&onboarding=returned`,
        },
      },
    });

    return Response.json({ url: accountLink.url, accountId: mapping.accountId });
  } catch (error) {
    return safeConnectError(error);
  }
}
