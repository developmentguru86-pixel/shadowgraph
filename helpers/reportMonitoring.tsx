/**
 * Private monitoring for paid DORA reports: once a report is unlocked, the endpoints of the vendors marked critical are
 * probed every radar sweep (5 minutes) as private custom monitors, plus one DNS check per zone of a critical endpoint
 * against its authoritative name servers. They belong to a synthetic, Stripe-less subscription "dora_<scan id>", so they
 * appear on no public page and are not counted as customers. Alert emails go only to an address the report owner has
 * confirmed (double opt-in) or the Stripe buyer address.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import { sendEmail } from "@runtime/email";
import { db } from "./db";
import { getMppSecret, mppStore } from "./mppStore";
import { assertPublicUrl } from "./customMonitors";
import { registrableDomain } from "./vendorScan";
import { SITE_URL } from "./site";
import type { VendorRow } from "./vendorList";

const MAX_MONITORS = 25;
const VERSION = "v2"; // bump when new monitor kinds are added, so existing reports get them once
export const reportSubscriptionId = (scanId: string) => `dora_${scanId}`;

/** Idempotent: creates the subscription and any missing monitors; afterwards a stored flag makes later calls a no-op. */
export async function ensureReportMonitors(scanId: string, rows: VendorRow[], email: string | null) {
  const flag = `dora:monitors:${VERSION}:${scanId}`;
  if (await mppStore.get(flag)) return { created: 0 };
  const subId = reportSubscriptionId(scanId);
  await db.insertInto("alertSubscriptions").values({ id: subId, email: email ?? "", plan: "dora-report", status: "active" })
    .onConflict((oc) => oc.column("id").doNothing()).execute();
  const existing = await db.selectFrom("customMonitors").select(["url", "expect"]).where("subscriptionId", "=", subId).execute();
  const have = new Set(existing.map((m) => `${m.url}|${m.expect}`));
  let count = existing.length, created = 0;
  const add = async (name: string, url: string, expect: string) => {
    if (count >= MAX_MONITORS || have.has(`${url}|${expect}`)) return;
    try {
      const u = await assertPublicUrl(url); // public hosts only, never private address space
      await db.insertInto("customMonitors").values({ id: `cm_${randomUUID()}`, subscriptionId: subId, name: name.slice(0, 80), url: u.toString(), expect }).execute();
      have.add(`${u.toString()}|${expect}`); count++; created++;
    } catch { /* not publicly resolvable: not monitored */ }
  };
  const crit = rows.filter((r) => r.critical && r.status === "ok" && r.host && !/^\d{1,3}(\.\d{1,3}){3}$/.test(r.host));
  const seen = new Set<string>();
  for (const r of crit) if (!seen.has(r.host!)) { seen.add(r.host!); await add(r.name, `https://${r.host}/`, "reachable"); }
  // one DNS check per zone of a critical endpoint, asked directly at the zone's authoritative name servers
  const zones = new Map<string, { host: string; ns: string[]; provider: string }>();
  for (const r of crit) {
    const ns = (r.evidence?.ns ?? []).map((n) => n.replace(/\.$/, "").toLowerCase()).filter(Boolean).sort();
    if (!ns.length) continue;
    const zone = registrableDomain(r.host!);
    if (!zones.has(zone)) zones.set(zone, { host: r.host!, ns, provider: r.dns ?? ns[0] });
  }
  for (const [zone, z] of zones) await add(`DNS ${z.provider.replace(/^(Other|Sonstige|Self-hosted|Selbst betrieben) \((.+)\)$/, "$2")} · ${zone}`, `https://${z.host}/`, `dns:${z.ns.slice(0, 4).join(",")}`);
  await mppStore.put(flag, { at: new Date().toISOString(), created });
  return { created };
}

export type MonitorEvidence = { host: string; since: string | null; n: number; ok: number; outages: Array<[number, number]> };

/** Outages (2+ consecutive failed checks, 30 min or more) per monitored host of one report, from the private check history. */
export async function reportMonitorEvidence(scanId: string, sinceMs: number): Promise<Map<string, MonitorEvidence>> {
  const mons = await db.selectFrom("customMonitors").select(["id", "url"]).where("subscriptionId", "=", reportSubscriptionId(scanId)).where("active", "=", true)
    .where("expect", "not like", "dns:%").execute();
  const out = new Map<string, MonitorEvidence>();
  if (!mons.length) return out;
  const checks = await db.selectFrom("customChecks").select(["monitorId", "ok", "checkedAt"]).where("monitorId", "in", mons.map((m) => m.id))
    .where("checkedAt", ">", new Date(sinceMs)).orderBy("checkedAt").execute();
  const now = Date.now();
  for (const m of mons) {
    const cs = checks.filter((c) => c.monitorId === m.id);
    const outages: Array<[number, number]> = [];
    let start: number | null = null, fails = 0;
    let seenOk = false; // no outage before the endpoint has answered once (blocked probe or wrong target)
    for (const c of cs) {
      const t = new Date(c.checkedAt).getTime();
      if (!c.ok) { if (!seenOk) continue; if (start === null) start = t; fails++; }
      else { if (start !== null && fails >= 2 && t - start >= 30 * 60_000) outages.push([start, t]); start = null; fails = 0; seenOk = true; }
    }
    if (start !== null && fails >= 2 && now - start >= 30 * 60_000) outages.push([start, now]);
    out.set(new URL(m.url).hostname, { host: new URL(m.url).hostname, since: cs[0] ? new Date(cs[0].checkedAt).toISOString() : null, n: cs.length, ok: cs.filter((c) => c.ok).length, outages });
  }
  return out;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

/** Step 1 of the alert-email double opt-in: store a pending address and send the confirmation link to it. */
export async function requestAlertEmail(scanId: string, email: string, lang: "de" | "en") {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RX.test(e) || e.length > 200) throw new Error(lang === "de" ? "Bitte eine gültige E-Mail-Adresse eingeben." : "Please enter a valid email address.");
  const key = `dora:alertEmail:pending:${scanId}`;
  const prev = (await mppStore.get(key)) as { at: number } | null;
  if (prev && Date.now() - prev.at < 2 * 60_000) throw new Error(lang === "de" ? "Bitte kurz warten und dann erneut versuchen." : "Please wait a moment and try again.");
  const token = randomBytes(18).toString("base64url");
  await mppStore.put(key, { email: e, token, at: Date.now(), lang });
  const from = (await mppStore.get("config:alerts:emailFrom")) as string | null;
  if (!from) throw new Error("Email sending is not configured.");
  const link = `${SITE_URL}/_api/vendors/report_alert_confirm?id=${encodeURIComponent(scanId)}&t=${token}`;
  const de = lang === "de";
  const subject = de ? "Bitte bestätigen: Ausfall-Benachrichtigungen für Ihren DORA-Bericht" : "Please confirm: outage alerts for your DORA report";
  const text = de
    ? `Sie (oder jemand mit dem Link zu Ihrem Bericht) möchten Benachrichtigungen erhalten, wenn ein kritischer Dienstleister ausfällt, die 2-Stunden-Schwelle überschreitet oder wieder erreichbar ist.\n\nBestätigen: ${link}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail; es wird nichts gesendet.`
    : `You (or someone with the link to your report) asked to be notified when a critical vendor goes down, passes the 2-hour threshold or recovers.\n\nConfirm: ${link}\n\nIf you did not request this, ignore this email; nothing will be sent.`;
  const r = await sendEmail({ from, to: e, subject, text, html: text.split("\n\n").map((p) => `<p>${p.replace(/[<>&]/g, "").replace(link, `<a href="${link}">${link}</a>`)}</p>`).join("") });
  if (!r.ok) throw new Error(de ? "Die Bestätigungs-E-Mail konnte nicht gesendet werden." : "The confirmation email could not be sent.");
}

/** Step 2: the link in the confirmation email activates the address for this report's alerts. */
export async function confirmAlertEmail(scanId: string, token: string): Promise<{ ok: boolean; lang: "de" | "en" }> {
  const key = `dora:alertEmail:pending:${scanId}`;
  const p = (await mppStore.get(key)) as { email: string; token: string; at: number; lang: "de" | "en" } | null;
  if (!p || p.token !== token || Date.now() - p.at > 7 * 86_400_000) return { ok: false, lang: p?.lang ?? "de" };
  const subId = reportSubscriptionId(scanId);
  await db.insertInto("alertSubscriptions").values({ id: subId, email: p.email, plan: "dora-report", status: "active" })
    .onConflict((oc) => oc.column("id").doUpdateSet({ email: p.email, updatedAt: new Date() })).execute();
  await mppStore.delete(key);
  return { ok: true, lang: p.lang };
}

/** Unsubscribe link for alert emails: a keyed hash of the subscription id, so the link cannot be guessed for other reports. */
export async function alertUnsubscribeUrl(scanId: string) {
  const t = createHash("sha256").update(`${await getMppSecret()}|unsub|${reportSubscriptionId(scanId)}`).digest("base64url").slice(0, 24);
  return `${SITE_URL}/_api/vendors/report_alert_off?id=${encodeURIComponent(scanId)}&t=${t}`;
}
export async function unsubscribeAlerts(scanId: string, token: string) {
  const expected = new URL(await alertUnsubscribeUrl(scanId)).searchParams.get("t");
  if (!expected || token !== expected) return false;
  await db.updateTable("alertSubscriptions").set({ email: "", updatedAt: new Date() }).where("id", "=", reportSubscriptionId(scanId)).execute();
  return true;
}
