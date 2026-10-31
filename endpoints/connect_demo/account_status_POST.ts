import { schema } from "../connect_demo_account_status_POST.schema";
import {
  getConnectAccountMapping,
  getStripeConnectClient,
  safeConnectError,
} from "../../helpers/stripeConnect";

export async function handle(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const mapping = await getConnectAccountMapping(input.userId);
    if (!mapping) {
      return new Response(JSON.stringify({
        error: "No connected account is mapped to this demo user yet. Create the account first.",
      }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const stripeClient = getStripeConnectClient();

    // Always ask Stripe for the current status. This intentionally avoids stale
    // onboarding/capability state in the local database.
    const account = await stripeClient.v2.core.accounts.retrieve(mapping.accountId, {
      include: ["configuration.recipient", "requirements"],
    });

    const transferCapabilityStatus =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ??
      "unknown";
    const requirementsStatus =
      account.requirements?.summary?.minimum_deadline?.status ?? null;

    const readyToReceivePayments = transferCapabilityStatus === "active";
    const onboardingComplete =
      requirementsStatus !== "currently_due" &&
      requirementsStatus !== "past_due";

    return Response.json({
      ...mapping,
      readyToReceivePayments,
      onboardingComplete,
      transferCapabilityStatus,
      requirementsStatus,
    });
  } catch (error) {
    return safeConnectError(error);
  }
}
