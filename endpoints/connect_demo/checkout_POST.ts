import Stripe from "stripe";
import { schema } from "../connect_demo_checkout_POST.schema";
import {
  applicationFeeAmount,
  checkoutIntegrationIdentifier,
  getConnectBaseUrl,
  getConnectProductMapping,
  getStripeConnectClient,
  requireConnectDemoEnabled,
  safeConnectError,
} from "../../helpers/stripeConnect";

import { isMaintenanceRequest, maintenanceResponse } from "../../helpers/maintenance";
export async function handle(request: Request) {
  if (isMaintenanceRequest(request)) return maintenanceResponse();
  try {
    requireConnectDemoEnabled();
    const input = schema.parse(await request.json());
    const stripeClient = getStripeConnectClient();

    // Retrieve the platform Product and expand its default Price.
    const product = await stripeClient.products.retrieve(input.productId, {
      expand: ["default_price"],
    });
    const price = typeof product.default_price === "object" && product.default_price
      ? product.default_price as Stripe.Price
      : null;
    if (!price?.id || price.unit_amount === null) {
      throw new Error("This product does not have a usable default Price.");
    }

    const dbMapping = await getConnectProductMapping(product.id);
    const destinationAccountId =
      product.metadata?.connected_account_id || dbMapping?.connected_account_id;
    if (!destinationAccountId) {
      throw new Error("This product is not mapped to a connected account.");
    }

    // Do a live V2 capability check before creating Checkout. A destination
    // account that cannot receive Stripe transfers should not be offered for sale.
    const account = await stripeClient.v2.core.accounts.retrieve(destinationAccountId, {
      include: ["configuration.recipient", "requirements"],
    });
    const transferStatus =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
    if (transferStatus !== "active") {
      throw new Error(
        `Connected account is not ready for destination transfers (status: ${transferStatus ?? "unknown"}). Complete onboarding first.`,
      );
    }

    const totalAmount = price.unit_amount * input.quantity;
    const fee = applicationFeeAmount(totalAmount);
    const baseUrl = getConnectBaseUrl(request);

    // Destination Charge:
    // - the charge is created on the platform;
    // - application_fee_amount monetizes the platform;
    // - transfer_data.destination sends the remaining funds to the connected account.
    // Hosted Checkout keeps payment collection simple and avoids handling card
    // details in this application.
    const session = await stripeClient.checkout.sessions.create({
      line_items: [{
        price: price.id,
        quantity: input.quantity,
      }],
      payment_intent_data: {
        application_fee_amount: fee,
        transfer_data: {
          destination: destinationAccountId,
        },
      },
      mode: "payment",
      success_url: `${baseUrl}/connect-demo?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/connect-demo?checkout=cancelled`,
      integration_identifier: checkoutIntegrationIdentifier(),
      metadata: {
        connect_demo: "true",
        product_id: product.id,
        connected_account_id: destinationAccountId,
      },
    });

    if (!session.url) throw new Error("Stripe Checkout did not return a hosted URL.");
    return Response.json({
      url: session.url,
      sessionId: session.id,
      applicationFeeAmount: fee,
      destinationAccountId,
    });
  } catch (error) {
    return safeConnectError(error);
  }
}
