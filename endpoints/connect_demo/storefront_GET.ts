import Stripe from "stripe";
import {
  getConnectProductMapping,
  getStripeConnectClient,
  listConnectAccountMappings,
  safeConnectError,
} from "../../helpers/stripeConnect";

export async function handle() {
  try {
    const stripeClient = getStripeConnectClient();

    // "All connected accounts" in this demo means all application users that
    // have a mapping in our DB. We still retrieve each account from Stripe so
    // capability/onboarding status is current, not cached locally.
    const mappings = await listConnectAccountMappings();
    const accounts = await Promise.all(mappings.map(async (mapping) => {
      try {
        const account = await stripeClient.v2.core.accounts.retrieve(mapping.accountId, {
          include: ["configuration.recipient", "requirements"],
        });
        const transferCapabilityStatus =
          account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ??
          "unknown";
        const requirementsStatus =
          account.requirements?.summary?.minimum_deadline?.status ?? null;
        return {
          ...mapping,
          readyToReceivePayments: transferCapabilityStatus === "active",
          onboardingComplete:
            requirementsStatus !== "currently_due" &&
            requirementsStatus !== "past_due",
          transferCapabilityStatus,
          requirementsStatus,
        };
      } catch (error) {
        return {
          ...mapping,
          readyToReceivePayments: false,
          onboardingComplete: false,
          transferCapabilityStatus: "unknown",
          requirementsStatus: null,
          statusError: error instanceof Error ? error.message : "Stripe status unavailable",
        };
      }
    }));

    // Products are platform-level. Expand default_price so the storefront can
    // render price and currency without a second API request per product.
    const productList = await stripeClient.products.list({
      active: true,
      limit: 100,
      expand: ["data.default_price"],
    });

    const products = await Promise.all(productList.data.map(async (product) => {
      const price = typeof product.default_price === "object" && product.default_price
        ? product.default_price as Stripe.Price
        : null;

      // Prefer Stripe metadata, with the DB mapping as a fallback. This is useful
      // if metadata was edited manually in the Dashboard.
      const dbMapping = await getConnectProductMapping(product.id);
      return {
        productId: product.id,
        name: product.name,
        description: product.description,
        priceId: price?.id ?? (typeof product.default_price === "string" ? product.default_price : null),
        unitAmount: price?.unit_amount ?? null,
        currency: price?.currency ?? null,
        connectedAccountId:
          product.metadata?.connected_account_id || dbMapping?.connected_account_id || null,
        ownerUserId:
          product.metadata?.owner_user_id || dbMapping?.owner_user_id || null,
      };
    }));

    return Response.json({ accounts, products });
  } catch (error) {
    return safeConnectError(error);
  }
}
