import { schema } from "../connect_demo_product_POST.schema";
import {
  getConnectAccountMapping,
  getStripeConnectClient,
  requireConnectDemoEnabled,
  safeConnectError,
  saveConnectProductMapping,
} from "../../helpers/stripeConnect";

export async function handle(request: Request) {
  try {
    requireConnectDemoEnabled();
    const input = schema.parse(await request.json());
    const mapping = await getConnectAccountMapping(input.userId);
    if (!mapping) {
      return new Response(JSON.stringify({
        error: "Create a connected account before creating a product.",
      }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const stripeClient = getStripeConnectClient();

    // IMPORTANT: no stripeAccount/connected-account request option is passed.
    // This Product therefore lives on the PLATFORM, exactly as requested.
    const product = await stripeClient.products.create({
      name: input.name,
      description: input.description || undefined,
      default_price_data: {
        unit_amount: input.priceInCents,
        currency: input.currency.toLowerCase(),
      },
      // Metadata makes the destination relationship inspectable in Stripe.
      // The same mapping is also stored locally for defense-in-depth.
      metadata: {
        connected_account_id: mapping.accountId,
        owner_user_id: input.userId,
        connect_demo: "true",
      },
    });

    await saveConnectProductMapping(product.id, mapping.accountId, input.userId);

    const defaultPriceId =
      typeof product.default_price === "string"
        ? product.default_price
        : product.default_price?.id ?? null;

    return Response.json({
      productId: product.id,
      priceId: defaultPriceId,
      connectedAccountId: mapping.accountId,
    });
  } catch (error) {
    return safeConnectError(error);
  }
}
