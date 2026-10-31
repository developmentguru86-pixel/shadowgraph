/**
 * Temporary promotions (pure module, safe in the browser).
 * DORA_REPORT_FREE: the free unlock (owner request 2026-10-21) ended on 2026-10-28 (owner request: charge $50 from now on).
 * Free unlocks are stored with report_session_id = FREE_SESSION so they never count as sales; reports already unlocked stay
 * unlocked. DORA_REPORT_PRICE_LABEL is the one place the displayed price lives (the charged amount is REPORT_PRICE_CENTS).
 */
export const DORA_REPORT_FREE = false;
export const DORA_REPORT_PRICE_LABEL = "$50";
export const FREE_SESSION = "free-promo";
/**
 * ALERTS_FREE (owner request 2026-10-25): the $29 Stack Alerts plan is free, without Stripe. A free subscription is stored
 * with stripe_subscription_id = FREE_SESSION, starts "pending" and becomes active only when the owner opens the
 * management link sent to the email address (proves the address). Free plans never count as paid. The Team plan stays paid.
 */
export const ALERTS_FREE = true;
