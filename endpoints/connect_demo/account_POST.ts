import { schema } from "../connect_demo_account_POST.schema";
import {
  getConnectAccountMapping,
  getStripeConnectClient,
  requireConnectDemoEnabled,
  safeConnectError,
  saveConnectAccountMapping,
} from "../../helpers/stripeConnect";

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  try {
    // The sample is intentionally opt-in so a public deployment cannot create
    // Stripe resources until the platform owner explicitly enables it.
    requireConnectDemoEnabled();

    const input = schema.parse(await request.json());

    // In a real app this must be your authenticated user ID, not a browser-
    // supplied identifier. We first reuse an existing mapping to avoid creating
    // duplicate Connect accounts for the same application user.
    const existing = await getConnectAccountMapping(input.userId);
    if (existing) {
      return Response.json({ ...existing, created: false });
    }

    // Use ONE Stripe Client instance for this request and every Stripe operation.
    const stripeClient = getStripeConnectClient();

    // V2 Accounts: only the properties requested for this sample are sent.
    // Do NOT add top-level type: "express", "standard", or "custom".
    const account = await stripeClient.v2.core.accounts.create({
      display_name: input.displayName,
      contact_email: input.contactEmail,
      identity: {
        country: "us",
      },
      dashboard: "express",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {
                requested: true,
              },
            },
          },
        },
      },
    });

    // Persist only the app-user ↔ Stripe-account mapping and basic display data.
    // Onboarding status is deliberately NOT stored; the status endpoint always
    // retrieves it directly from Stripe.
    await saveConnectAccountMapping({
      userId: input.userId,
      accountId: account.id,
      displayName: input.displayName,
      contactEmail: input.contactEmail,
    });

    return Response.json({
      userId: input.userId,
      accountId: account.id,
      displayName: input.displayName,
      contactEmail: input.contactEmail,
      created: true,
    });
  } catch (error) {
    return safeConnectError(error);
  }
}
