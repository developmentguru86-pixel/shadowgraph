import { sql } from "kysely";
import { db } from "./db";

/**
 * Owner-only business funnel for /stats: paying customers, inbound leads and free sign-ups in one place, so a lead
 * left in the pricing form never sits unseen in the database. Test rows (no Stripe subscription) are not counted as paid.
 */
export type BusinessSummary = {
  paid: { alerts: number; team: number; datasetKeys: number; doraReports: number; doraReports30: number };
  trials: number;
  free: { outageAlerts: number; concentrationWatches: number; vendorScans30: number; savedBoards: number; doraFreeReports: number; freeStackAlerts: number };
  leads: Array<{ at: string; source: string; emailDomain: string; note: string }>;
};

export async function businessSummary(): Promise<BusinessSummary> {
  const n = (v: unknown) => Number(v ?? 0);
  const [c] = (await sql<Record<string, string>>`
    SELECT
      (SELECT count(*) FROM alert_subscriptions WHERE status = 'active' AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> 'free-promo' AND plan = 'alerts') AS alerts,
      (SELECT count(*) FROM alert_subscriptions WHERE status = 'active' AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> 'free-promo' AND plan = 'team') AS team,
      (SELECT count(*) FROM alert_subscriptions WHERE status = 'active' AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> 'free-promo' AND created_at > now() - interval '14 days') AS trials,
      (SELECT count(*) FROM alert_subscriptions WHERE status = 'active' AND stripe_subscription_id = 'free-promo') AS freestack,
      (SELECT count(*) FROM dataset_api_keys WHERE status = 'active') AS datasetkeys,
      (SELECT count(*) FROM vendor_scans WHERE report_paid_at IS NOT NULL AND report_session_id LIKE 'cs\_live\_%') AS dora,
      (SELECT count(*) FROM vendor_scans WHERE report_paid_at > now() - interval '30 days' AND report_session_id LIKE 'cs\_live\_%') AS dora30,
      (SELECT count(*) FROM vendor_scans WHERE report_paid_at IS NOT NULL AND report_session_id NOT LIKE 'cs\_live\_%') AS dorafree,
      (SELECT count(*) FROM free_alerts WHERE status = 'active') AS freealerts,
      (SELECT count(*) FROM concentration_watch WHERE status = 'active') AS watches,
      (SELECT count(*) FROM vendor_scans WHERE created_at > now() - interval '30 days') AS scans30,
      (SELECT count(*) FROM status_boards b JOIN alert_subscriptions s ON s.id = b.subscription_id WHERE b.active AND s.stripe_subscription_id IS NOT NULL AND s.stripe_subscription_id <> 'free-promo') AS boards`.execute(db)).rows;
  const leads = (await sql<{ at: Date; source: string; email: string; note: string | null }>`
    SELECT created_at AS at, 'pricing: ' || coalesce(channel, 'form') AS source, email, services AS note FROM radar_waitlist
    UNION ALL SELECT created_at, 'DORA pilot', email, company || coalesce(' · ' || role, '') || coalesce(' · ' || vendor_count, '') || coalesce(' · ' || message, '') FROM fintech_leads
    ORDER BY 1 DESC LIMIT 25`.execute(db)).rows;
  return {
    paid: { alerts: n(c.alerts), team: n(c.team), datasetKeys: n(c.datasetkeys), doraReports: n(c.dora), doraReports30: n(c.dora30) },
    trials: n(c.trials),
    free: { outageAlerts: n(c.freealerts), concentrationWatches: n(c.watches), vendorScans30: n(c.scans30), savedBoards: n(c.boards), doraFreeReports: n(c.dorafree), freeStackAlerts: n(c.freestack) },
    leads: leads.map((l) => ({ at: new Date(l.at).toISOString(), source: l.source, emailDomain: l.email.split("@")[1] ?? "", note: (l.note ?? "").slice(0, 200) })),
  };
}
