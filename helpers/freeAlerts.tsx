import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "kysely";
import { sendEmail } from "@runtime/email";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { SITE_URL } from "./site";

/**
 * Free email alert for one status page (lead magnet for the paid $29 stack alerts).
 * - Double opt-in: nothing is sent except the confirmation email until the link in it is clicked.
 * - One active free alert per email address; confirming a new one replaces the old one.
 * - Alerts: the service is down (two failed sweeps), it recovered, or a provider incident hits it. At most 6 emails per day.
 * - Every email carries a one-click unsubscribe link and List-Unsubscribe headers.
 * Sending needs a verified sender domain (mppStore "config:alerts:emailFrom", shared with the paid alerts); until then
 * sign-ups are kept and their confirmation emails go out with the first sweep after the domain is configured.
 */
const MAX_IDS = 10;
const DAILY_CAP = 6;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e.trim());

async function senderFrom() {
  return (await mppStore.get("config:alerts:emailFrom")) as string | null;
}

/** German sign-ups (from /de/status/…) are stored with a "de:" source prefix and get German emails. */
const isDe = (source: string | null | undefined) => !!source?.startsWith("de:");

function shell(title: string, body: string, unsubUrl: string, de = false) {
  return `<!doctype html><html><body style="margin:0;background:#05070a;font-family:Helvetica,Arial,sans-serif;color:#eef2f5">
<div style="max-width:560px;margin:0 auto;padding:28px 22px">
<p style="font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7c8a96;margin:0 0 18px">ShadowGraph · Internet Outage Radar</p>
<h1 style="font-size:22px;font-weight:600;margin:0 0 14px;color:#eef2f5">${esc(title)}</h1>
${body}
<hr style="border:0;border-top:1px solid #1a222b;margin:28px 0 14px">
<p style="font-size:12px;color:#7c8a96;line-height:1.6;margin:0">${de
  ? `Du bekommst diese E-Mail, weil diese Adresse eine Gratis-Benachrichtigung von ShadowGraph angefordert hat. <a href="${unsubUrl}" style="color:#7c8a96">Abmelden</a> mit einem Klick.<br>ShadowGraph · Wien, Österreich`
  : `You receive this because this address asked for a free ShadowGraph alert. <a href="${unsubUrl}" style="color:#7c8a96">Unsubscribe</a> with one click.<br>ShadowGraph · Vienna, Austria`}</p>
</div></body></html>`;
}
const p = (t: string) => `<p style="font-size:15px;line-height:1.6;color:#c9d3db;margin:0 0 12px">${t}</p>`;
const btn = (href: string, label: string) => `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#eef2f5;color:#05070a;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${esc(label)}</a></p>`;
/** body link → page with an Unsubscribe button (scanners open links); header → one-click POST endpoint (RFC 8058) */
const unsubPage = (token: string) => `${SITE_URL}/unsubscribe?t=${token}`;
const unsubHeaders = (token: string) => [{ name: "List-Unsubscribe", value: `<${SITE_URL}/_api/email/unsubscribe?t=${token}>` }, { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" }];

async function sendConfirmation(a: { id: string; email: string; pageName: string; unsubToken: string; source?: string | null }, from: string) {
  const token = randomBytes(24).toString("base64url");
  await db.updateTable("freeAlerts").set({ confirmHash: hash(token), confirmSentAt: new Date() }).where("id", "=", a.id).execute();
  const confirmUrl = `${SITE_URL}/alerts/confirm?t=${token}`;
  const unsubUrl = unsubPage(a.unsubToken);
  if (isDe(a.source)) {
    const confirmUrl = `${SITE_URL}/alerts/confirm?t=${token}&l=de`;
    const r = await sendEmail({
      from, to: a.email, subject: `Bestätige deine Gratis-Benachrichtigung für ${a.pageName}`,
      text: `Bestätige deine Gratis-Benachrichtigung für ${a.pageName}: ${confirmUrl}\n\nWir schreiben dir, wenn ${a.pageName} ausfällt, wieder geht oder von einer Anbieter-Störung betroffen ist. Bis zur Bestätigung schicken wir nichts.\n\nAbmelden: ${unsubUrl}`,
      html: shell(`Benachrichtigung für ${a.pageName} bestätigen`, p(`Wir schreiben dir, wenn <b>${esc(a.pageName)}</b> ausfällt, wieder geht oder von einer Störung beim Cloud-, CDN- oder DNS-Anbieter betroffen ist. Bis zur Bestätigung schicken wir nichts.`)
        + btn(confirmUrl, "Gratis-Benachrichtigung bestätigen") + p(`<span style="font-size:13px;color:#7c8a96">Wenn du das nicht angefordert hast, ignoriere diese E-Mail einfach.</span>`), unsubUrl, true),
      headers: unsubHeaders(a.unsubToken),
    });
    return r.ok;
  }
  const r = await sendEmail({
    from, to: a.email, subject: `Confirm your free ${a.pageName} outage alert`,
    text: `Confirm your free alert for ${a.pageName}: ${confirmUrl}\n\nWe will email you when ${a.pageName} goes down, recovers, or is hit by a provider outage. Nothing is sent until you confirm.\n\nUnsubscribe: ${unsubUrl}`,
    html: shell(`Confirm your ${a.pageName} alert`, p(`We will email you when <b>${esc(a.pageName)}</b> goes down, comes back, or is hit by a cloud, CDN or DNS provider outage. Nothing is sent until you confirm.`)
      + btn(confirmUrl, "Confirm my free alert") + p(`<span style="font-size:13px;color:#7c8a96">If you did not ask for this, ignore this email.</span>`), unsubUrl),
    headers: unsubHeaders(a.unsubToken),
  });
  return r.ok;
}

export const freeAlerts = {
  async subscribe(input: { email: string; serviceIds: string[]; name: string; source?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!validEmail(email)) throw new Error("Please enter a valid email address.");
    const ids = [...new Set(input.serviceIds)].slice(0, MAX_IDS);
    if (!ids.length) throw new Error("Nothing to watch on this page yet.");
    const known = await db.selectFrom("radarServices").select("id").where("id", "in", ids).where("active", "=", true).execute();
    if (!known.length) throw new Error("Unknown service.");
    // abuse guard: at most 3 sign-ups per address per day
    const recent = await db.selectFrom("freeAlerts").select(sql<number>`count(*)::int`.as("n")).where(sql`lower(email)`, "=", email)
      .where("createdAt", ">", new Date(Date.now() - 86_400_000)).executeTakeFirst();
    if ((recent?.n ?? 0) >= 3) throw new Error("Too many sign-ups for this address today. Check your inbox for the confirmation email.");
    const row = { id: randomUUID(), email, serviceIds: known.map((k) => k.id) as never, pageName: input.name.slice(0, 120), source: input.source?.slice(0, 80) ?? null,
      status: "pending", confirmHash: hash(randomBytes(24).toString("hex")), unsubToken: randomBytes(24).toString("base64url") };
    await db.insertInto("freeAlerts").values(row).execute();
    const from = await senderFrom();
    if (!from) return { status: "queued" as const };
    return { status: (await sendConfirmation(row, from)) ? ("sent" as const) : ("queued" as const) };
  },

  async confirm(token: string) {
    if (!token || token.length < 20) return null;
    const a = await db.selectFrom("freeAlerts").selectAll().where("confirmHash", "=", hash(token)).executeTakeFirst();
    if (!a || a.status === "unsubscribed") return null;
    if (a.status !== "active") {
      await db.updateTable("freeAlerts").set({ status: "replaced" }).where(sql`lower(email)`, "=", a.email.toLowerCase()).where("status", "=", "active").where("id", "<>", a.id).execute();
      await db.updateTable("freeAlerts").set({ status: "active", confirmedAt: new Date() }).where("id", "=", a.id).execute();
    }
    return { name: a.pageName, serviceIds: a.serviceIds as string[] };
  },

  async unsubscribe(token: string) {
    if (!token) return false;
    const r = await db.updateTable("freeAlerts").set({ status: "unsubscribed" }).where("unsubToken", "=", token).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  /** After every radar sweep: send queued confirmations, then alerts for active free alerts. Idempotent per (alert, event). */
  async dispatch() {
    const from = await senderFrom();
    if (!from) return { confirmations: 0, sent: 0 };
    let confirmations = 0, sent = 0;
    const pending = await db.selectFrom("freeAlerts").select(["id", "email", "pageName", "unsubToken", "source"]).where("status", "=", "pending").where("confirmSentAt", "is", null)
      .where("createdAt", ">", new Date(Date.now() - 14 * 86_400_000)).limit(50).execute();
    for (const a of pending) if (await sendConfirmation(a, from)) confirmations++;

    const active = await db.selectFrom("freeAlerts").selectAll().where("status", "=", "active").execute();
    if (!active.length) return { confirmations, sent };
    // the three newest sweeps straight from radar_checks (radar_runs is only filled hourly, which delayed alerts by up to an hour)
    const runs = (await sql<{ runId: string }>`
      SELECT run_id AS "runId" FROM radar_checks WHERE checked_at > now() - interval '30 minutes'
      GROUP BY run_id ORDER BY run_id DESC LIMIT 3`.execute(db)).rows;
    const lastRun = (await mppStore.get("radar:lastRun")) as { runId?: string; vantageSuspect?: boolean } | null;
    if (!runs.length || (lastRun?.runId === runs[0].runId && lastRun.vantageSuspect)) return { confirmations, sent };
    const allIds = [...new Set(active.flatMap((a) => a.serviceIds as string[]))];
    const checks = await db.selectFrom("radarChecks").select(["serviceId", "runId", "ok", "error", "httpStatus"])
      .where("runId", "in", runs.map((r) => r.runId)).where("serviceId", "in", allIds).execute();
    const at = (run: number, id: string) => checks.find((c) => c.runId === runs[run]?.runId && c.serviceId === id);
    const names = new Map((await db.selectFrom("radarServices").select(["id", "name"]).where("id", "in", allIds).execute()).map((s) => [s.id, s.name]));
    const incidents = await db.selectFrom("radarIncidents").select(["id", "provider", "layer", "affected", "atRisk"]).where("status", "=", "open").execute();
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v ?? []) as Array<{ id: string; name: string }>;
    const day = new Date().toISOString().slice(0, 10);

    for (const a of active) {
      const ids = a.serviceIds as string[];
      const de = isDe(a.source);
      const events: Array<{ key: string; kind: string; subject: string; lines: string[] }> = [];
      for (const id of ids) {
        const c0 = at(0, id), c1 = at(1, id), c2 = at(2, id);
        const n = names.get(id) ?? id;
        // newly down: failed the last two sweeps, was fine the sweep before
        if (c0 && c1 && !c0.ok && !c1.ok && c2?.ok) events.push({ key: `down:${id}:${day}:${runs[0].runId}`, kind: "down",
          subject: de ? `${n} ist ausgefallen` : `${n} is down`,
          lines: de
            ? [`${n} hat zwei Prüfungen hintereinander nicht bestanden (${c0.error ?? `HTTP ${c0.httpStatus}`}).`, "Wir prüfen alle 5 Minuten weiter und melden uns, sobald es wieder geht."]
            : [`${n} failed two checks in a row (${c0.error ?? `HTTP ${c0.httpStatus}`}).`, "We check again every 5 minutes and will tell you when it is back."] });
        // recovered: up now after two or more failures
        if (c0?.ok && c1 && c2 && !c1.ok && !c2.ok) events.push({ key: `up:${id}:${runs[0].runId}`, kind: "up",
          subject: de ? `${n} funktioniert wieder` : `${n} is back up`,
          lines: [de ? `${n} antwortet wieder normal.` : `${n} answers normally again.`] });
      }
      for (const inc of incidents) {
        const hit = [...parse(inc.affected), ...parse(inc.atRisk)].filter((x) => ids.includes(x.id));
        if (hit.length) events.push({ key: `incident:${inc.id}`, kind: "incident",
          subject: de ? `Störung bei ${inc.provider} betrifft ${a.pageName}` : `${inc.provider} outage affects ${a.pageName}`,
          lines: de
            ? [`Wir haben eine Störung beim Anbieter ${inc.provider} (${inc.layer}) erkannt.`, `${hit.map((h) => h.name).join(", ")} ${hit.length > 1 ? "hängen" : "hängt"} davon ab.`]
            : [`We detected a provider incident on ${inc.provider} (${inc.layer}).`, `${hit.map((h) => h.name).join(", ")} ${hit.length > 1 ? "depend" : "depends"} on it.`] });
      }
      if (!events.length) continue;
      const today = await db.selectFrom("freeAlertDeliveries").select(sql<number>`count(*)::int`.as("n")).where("alertId", "=", a.id)
        .where("sentAt", ">", new Date(Date.now() - 86_400_000)).executeTakeFirst();
      let budget = DAILY_CAP - (today?.n ?? 0);
      for (const e of events) {
        if (budget <= 0) break;
        const claimed = await db.insertInto("freeAlertDeliveries").values({ alertId: a.id, dedupeKey: e.key, kind: e.kind })
          .onConflict((oc) => oc.columns(["alertId", "dedupeKey"]).doNothing()).returning("alertId").executeTakeFirst();
        if (!claimed) continue;
        const unsubUrl = unsubPage(a.unsubToken);
        const r = de ? await sendEmail({
          from, to: a.email, subject: e.subject, headers: unsubHeaders(a.unsubToken),
          text: `${e.lines.join("\n")}\n\nLive-Status: ${SITE_URL}/de/ist-es-down\n\nAbmelden: ${unsubUrl}`,
          html: shell(e.subject, e.lines.map((l) => p(esc(l))).join("") + btn(`${SITE_URL}/de/ist-es-down`, "Live-Status ansehen"), unsubUrl, true),
        }) : await sendEmail({
          from, to: a.email, subject: e.subject, headers: unsubHeaders(a.unsubToken),
          text: `${e.lines.join("\n")}\n\nLive status: ${SITE_URL}/radar\n\nWatch your whole stack (up to 25 services, Slack/Teams/webhook, early warnings): ${SITE_URL}/alerts\n\nUnsubscribe: ${unsubUrl}`,
          html: shell(e.subject, e.lines.map((l) => p(esc(l))).join("") + btn(`${SITE_URL}/radar`, "Open the live radar")
            + p(`<span style="font-size:13px;color:#7c8a96">Running on more than one tool? Stack alerts watch up to 25 services and the providers underneath them, in Slack, Teams or email. <a href="${SITE_URL}/alerts" style="color:#5fe3a1">now free</a>.</span>`), unsubUrl),
        });
        if (r.ok) { await db.updateTable("freeAlertDeliveries").set({ messageId: r.messageId }).where("alertId", "=", a.id).where("dedupeKey", "=", e.key).execute(); sent++; budget--; }
      }
    }
    return { confirmations, sent };
  },
};
