import Stripe from "stripe";
import { sql } from "kysely";
import { db } from "./db";

/**
 * Stripe Connect sample configuration.
 *
 * IMPORTANT:
 * - Never hard-code a Stripe key in source control.
 * - TODO: set STRIPE_CONNECT_SECRET_KEY in the server environment.
 * - TODO: set STRIPE_CONNECT_WEBHOOK_SECRET after creating a Thin webhook destination.
 * - TODO: set STRIPE_CONNECT_DEMO_ENABLED=true only when you intentionally want the
 *   sample's mutating endpoints (create account/product/checkout) enabled.
 *
 * The installed stripe-node SDK is 23.0.0. We intentionally do NOT pass an
 * apiVersion option; the SDK selects its pinned API version automatically.
 */
export const STRIPE_CONNECT_SDK_VERSION = "23.0.0";

function env(name: string) {
  return (Reflect.get(process.env, name) as string | undefined)?.trim();
}

export class StripeConnectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConnectConfigError";
  }
}

/**
 * Create exactly one Stripe client per request flow and use that instance for
 * every Stripe API call. This avoids the deprecated global API-key pattern.
 */
export function getStripeConnectClient() {
  const apiKey = env("STRIPE_CONNECT_SECRET_KEY");

  if (!apiKey) {
    throw new StripeConnectConfigError(
      "Stripe Connect is not configured. Set STRIPE_CONNECT_SECRET_KEY in the server environment. " +
      "Do not paste the key into source code.",
    );
  }

  if (!apiKey.startsWith("sk_") && !apiKey.startsWith("rk_")) {
    throw new StripeConnectConfigError(
      "STRIPE_CONNECT_SECRET_KEY does not look like a Stripe secret/restricted key. " +
      "Expected an sk_... or rk_... server-side key.",
    );
  }

  return new Stripe(apiKey);
}

/**
 * Mutating demo operations are off by default. This makes it safe to keep the
 * sample code deployed while the platform owner decides when to enable it.
 */
export function requireConnectDemoEnabled() {
  if (env("STRIPE_CONNECT_DEMO_ENABLED") !== "true") {
    throw new StripeConnectConfigError(
      "Stripe Connect demo mutations are disabled. Set STRIPE_CONNECT_DEMO_ENABLED=true " +
      "after configuring a Stripe sandbox/test key and reviewing the sample.",
    );
  }
}

export function getStripeConnectWebhookSecret() {
  const secret = env("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!secret) {
    throw new StripeConnectConfigError(
      "Stripe Connect webhook verification is not configured. " +
      "Set STRIPE_CONNECT_WEBHOOK_SECRET to the signing secret for the Thin event destination.",
    );
  }
  return secret;
}

/**
 * Use an explicit public base URL when provided; otherwise use the request
 * origin. In production, STRIPE_CONNECT_APP_URL is recommended so onboarding
 * and Checkout redirects always point at the intended public domain.
 */
export function getConnectBaseUrl(request: Request) {
  const configured = env("STRIPE_CONNECT_APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

/**
 * The storefront sample charges a configurable platform fee.
 * Default: 10% (1000 basis points).
 * TODO: set STRIPE_CONNECT_PLATFORM_FEE_BPS if your business model differs.
 */
export function applicationFeeAmount(totalAmount: number) {
  const raw = Number(env("STRIPE_CONNECT_PLATFORM_FEE_BPS") ?? "1000");
  const bps = Number.isFinite(raw) ? Math.min(10_000, Math.max(0, Math.round(raw))) : 1000;
  return Math.max(0, Math.min(totalAmount, Math.round(totalAmount * bps / 10_000)));
}

export function connectDemoEnabled() {
  return env("STRIPE_CONNECT_DEMO_ENABLED") === "true";
}

export function connectConfigState() {
  return {
    sdkVersion: STRIPE_CONNECT_SDK_VERSION,
    keyConfigured: Boolean(env("STRIPE_CONNECT_SECRET_KEY")),
    webhookConfigured: Boolean(env("STRIPE_CONNECT_WEBHOOK_SECRET")),
    demoEnabled: connectDemoEnabled(),
    appUrlConfigured: Boolean(env("STRIPE_CONNECT_APP_URL")),
    platformFeeBps: Number(env("STRIPE_CONNECT_PLATFORM_FEE_BPS") ?? "1000"),
  };
}

export type ConnectAccountMapping = {
  userId: string;
  accountId: string;
  displayName: string;
  contactEmail: string;
};

/**
 * This sample uses a userId string supplied by the demo UI because ShadowGraph
 * does not currently have an application-auth user model.
 *
 * PRODUCTION TODO: replace this userId with your authenticated application's
 * immutable user ID and never trust a browser-supplied user ID for authorization.
 */
export async function getConnectAccountMapping(userId: string): Promise<ConnectAccountMapping | null> {
  const result = await sql<{
    user_id: string;
    stripe_account_id: string;
    display_name: string;
    contact_email: string;
  }>`
    SELECT user_id, stripe_account_id, display_name, contact_email
    FROM stripe_connect_accounts
    WHERE user_id = ${userId}
    LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  return row ? {
    userId: row.user_id,
    accountId: row.stripe_account_id,
    displayName: row.display_name,
    contactEmail: row.contact_email,
  } : null;
}

export async function saveConnectAccountMapping(mapping: ConnectAccountMapping) {
  await sql`
    INSERT INTO stripe_connect_accounts
      (user_id, stripe_account_id, display_name, contact_email, created_at, updated_at)
    VALUES
      (${mapping.userId}, ${mapping.accountId}, ${mapping.displayName}, ${mapping.contactEmail}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_account_id = EXCLUDED.stripe_account_id,
      display_name = EXCLUDED.display_name,
      contact_email = EXCLUDED.contact_email,
      updated_at = now()
  `.execute(db);
}

export async function listConnectAccountMappings() {
  const result = await sql<{
    user_id: string;
    stripe_account_id: string;
    display_name: string;
    contact_email: string;
  }>`
    SELECT user_id, stripe_account_id, display_name, contact_email
    FROM stripe_connect_accounts
    ORDER BY created_at DESC
    LIMIT 100
  `.execute(db);

  return result.rows.map((row) => ({
    userId: row.user_id,
    accountId: row.stripe_account_id,
    displayName: row.display_name,
    contactEmail: row.contact_email,
  }));
}

export async function saveConnectProductMapping(productId: string, accountId: string, userId: string) {
  await sql`
    INSERT INTO stripe_connect_products
      (product_id, connected_account_id, owner_user_id, created_at)
    VALUES
      (${productId}, ${accountId}, ${userId}, now())
    ON CONFLICT (product_id) DO UPDATE SET
      connected_account_id = EXCLUDED.connected_account_id,
      owner_user_id = EXCLUDED.owner_user_id
  `.execute(db);
}

export async function getConnectProductMapping(productId: string) {
  const result = await sql<{
    product_id: string;
    connected_account_id: string;
    owner_user_id: string;
  }>`
    SELECT product_id, connected_account_id, owner_user_id
    FROM stripe_connect_products
    WHERE product_id = ${productId}
    LIMIT 1
  `.execute(db);
  return result.rows[0] ?? null;
}

export async function recordConnectWebhookEvent(eventId: string, eventType: string, accountId: string | null) {
  await sql`
    INSERT INTO stripe_connect_webhook_events
      (event_id, event_type, stripe_account_id, received_at)
    VALUES
      (${eventId}, ${eventType}, ${accountId}, now())
    ON CONFLICT (event_id) DO NOTHING
  `.execute(db);
}

export function safeConnectError(error: unknown) {
  const message = error instanceof Error ? error.message : "Stripe Connect request failed.";
  const status = error instanceof StripeConnectConfigError ? 503 : 400;
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Checkout requires a short identifier label on current API versions. Keep it
 * non-secret and random so separate checkout flows are distinguishable.
 */
export function checkoutIntegrationIdentifier() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `shadowgraph_connect_${suffix}`;
}
