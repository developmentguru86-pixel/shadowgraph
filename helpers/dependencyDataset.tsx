import Stripe from "stripe";
import { createHash, randomBytes } from "crypto";
import { sql } from "kysely";
import { db } from "./db";
import { dependencyGraph, type DependencyRow } from "./dependencyGraph";
import { mppStore } from "./mppStore";

/**
 * Supply-chain dependency dataset product.
 * - sample: free, official XBRL rows only
 * - full: every row, behind a subscriber API key
 * Keys are issued once per paid Stripe Checkout session; only SHA-256 hashes are stored.
 * Subscription status is re-checked against Stripe at most every 24h per key.
 */
const PRICE_CENTS = 9900;
const PRODUCT_TAG = "dependency-dataset";
const PRODUCT_NAME = "ShadowGraph Supply-Chain Dependency Data (monthly)";
const ACTIVE_SUB = new Set(["active", "trialing", "past_due"]);
const COLUMNS: Array<keyof DependencyRow> = [
  "customer", "customerTicker", "supplier", "supplierTicker", "supplierCik", "revenueShare",
  "fiscalPeriodEnd", "form", "filedAt", "attribution", "sourceUrl", "evidence",
];

function stripe() {
  const key = (Reflect.get(process.env, "STRIPE_LIVE_SECRET_KEY_V2") as string | undefined)?.trim();
  if (!key) throw new Error("Stripe is not configured");
  return new Stripe(key);
}
const hashKey = (raw: string) => createHash("sha256").update(raw).digest("hex");

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const dependencyDataset = {
  priceCents: PRICE_CENTS,
  priceLabel: "$99 / month",

  async rows(): Promise<DependencyRow[]> {
    // The underlying query scans ~50k historical facts; the data changes weekly, so cache for 15 minutes.
    const cached = (await mppStore.get("cache:dependency-dataset:v1")) as { at: number; rows: DependencyRow[] } | null;
    if (cached && Date.now() - cached.at < 15 * 60_000) return cached.rows;
    const rows = (await dependencyGraph()).rows;
    await mppStore.put("cache:dependency-dataset:v1", { at: Date.now(), rows });
    return rows;
  },

  stats(rows: DependencyRow[]) {
    return {
      relationships: rows.length,
      official: rows.filter((r) => r.attribution === "official").length,
      suppliers: new Set(rows.map((r) => r.supplierCik)).size,
      customers: new Set(rows.map((r) => r.customerTicker ?? r.customer)).size,
      latestFiling: rows.reduce((m, r) => (r.filedAt > m ? r.filedAt : m), ""),
    };
  },

  toCsv(rows: DependencyRow[]) {
    return [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
  },

  async createCheckout(origin: string) {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRICE_CENTS,
          recurring: { interval: "month" },
          product_data: {
            name: PRODUCT_NAME,
            description: "Full customer-supplier dependency dataset from SEC XBRL filings, weekly refresh, CSV/JSON API.",
          },
        },
      }],
      metadata: { product: PRODUCT_TAG },
      subscription_data: { metadata: { product: PRODUCT_TAG } },
      allow_promotion_codes: true,
      success_url: `${origin}/data?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/data`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return session.url;
  },

  /** Issues the API key for a paid session exactly once. */
  async claim(sessionId: string): Promise<
    { status: "issued"; key: string; email: string | null } | { status: "already_claimed" | "not_paid" | "not_found" }
  > {
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return { status: "not_found" };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe().checkout.sessions.retrieve(sessionId);
    } catch {
      return { status: "not_found" };
    }
    if (session.metadata?.product !== PRODUCT_TAG) return { status: "not_found" };
    if (session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) {
      return { status: "not_paid" };
    }
    const raw = `sgd_${randomBytes(24).toString("base64url")}`;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    const email = session.customer_details?.email ?? null;
    const inserted = await db.insertInto("datasetApiKeys")
      .values({
        keyHash: hashKey(raw), keyPrefix: raw.slice(0, 10), stripeSessionId: session.id,
        stripeSubscriptionId: subscriptionId, customerEmail: email, subscriptionCheckedAt: sql`now()`,
      })
      .onConflict((oc) => oc.column("stripeSessionId").doNothing())
      .returning("keyHash")
      .executeTakeFirst();
    if (!inserted) return { status: "already_claimed" };
    return { status: "issued", key: raw, email };
  },

  async authorize(raw: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!raw || !raw.startsWith("sgd_")) return { ok: false, reason: "missing_or_malformed_key" };
    const row = await db.selectFrom("datasetApiKeys").selectAll().where("keyHash", "=", hashKey(raw)).executeTakeFirst();
    if (!row) return { ok: false, reason: "unknown_key" };
    let status = row.status;
    const stale = !row.subscriptionCheckedAt || Date.now() - new Date(row.subscriptionCheckedAt).getTime() > 24 * 3600_000;
    if (stale && row.stripeSubscriptionId) {
      try {
        const sub = await stripe().subscriptions.retrieve(row.stripeSubscriptionId);
        status = ACTIVE_SUB.has(sub.status) ? "active" : "inactive";
        await db.updateTable("datasetApiKeys").set({ status, subscriptionCheckedAt: sql`now()` })
          .where("keyHash", "=", row.keyHash).execute();
      } catch {
        // Stripe unreachable: keep last known status rather than locking out a paying customer.
      }
    }
    if (status !== "active") return { ok: false, reason: "subscription_inactive" };
    await db.updateTable("datasetApiKeys")
      .set({ lastUsedAt: sql`now()`, requestCount: sql`request_count + 1` })
      .where("keyHash", "=", row.keyHash).execute();
    return { ok: true };
  },
};
