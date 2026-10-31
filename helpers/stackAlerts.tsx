import Stripe from "stripe";
import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "kysely";
import { sendEmail } from "@runtime/email";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { customMonitors, type Expect } from "./customMonitors";
import { planOf, PLANS, type PlanId } from "./alertPlans";
import { statusBoards, type BoardInput } from "./statusBoards";
import { ALERTS_FREE, FREE_SESSION } from "./promo";

/**
 * Paid stack alerts ($29/month, 14-day trial). A subscriber picks up to 25 radar services and one or more channels
 * (Slack, Microsoft Teams, generic JSON webhook; email once a sending domain is verified). After every radar sweep,
 * dispatch() turns radar facts into at most one alert per (subscription, event): provider incidents and their
 * resolution, early warnings, a service going down, certificate and domain risk, infrastructure changes.
 */
const PRODUCT = "stack-alerts";
const TRIAL_DAYS = 14;
const MAX_SERVICES = PLANS.alerts.services;
const BASE_URL = "https://shadowalpha.online";
const AUTO_CA = /Let's Encrypt|ZeroSSL|Google Trust Services|Amazon|Cloudflare/i;
const ACTIVE = new Set(["active", "trialing", "past_due"]);

function stripe() {
  const key = (Reflect.get(process.env, "STRIPE_LIVE_SECRET_KEY_V2") as string | undefined)?.trim();
  if (!key) throw new Error("Stripe is not configured");
  return new Stripe(key);
}
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function validWebhook(kind: "slack" | "teams" | "generic", url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new Error(`Invalid ${kind} webhook URL`); }
  if (u.protocol !== "https:") throw new Error(`${kind} webhook must use https`);
  const h = u.hostname.toLowerCase();
  if (kind === "slack" && !(h === "hooks.slack.com" && u.pathname.startsWith("/services/"))) throw new Error("Slack webhook must start with https://hooks.slack.com/services/");
  if (kind === "teams" && !/(\.webhook\.office\.com|\.logic\.azure\.com|\.powerplatform\.com|\.api\.powerplatform\.com)$/.test(h)) throw new Error("Teams webhook must be a Microsoft (webhook.office.com, logic.azure.com or powerplatform.com) URL");
  if (kind === "generic" && (/^(localhost|.*\.local|.*\.internal)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || u.port)) throw new Error("Webhook must be a public https hostname");
  return u.toString();
}

type Event = { key: string; kind: string; title: string; lines: string[]; link: string };

async function deliver(sub: { id: string; email: string; slackWebhook: string | null; teamsWebhook: string | null; genericWebhook: string | null }, e: Event) {
  const text = `*${e.title}*\n${e.lines.join("\n")}\n<${e.link}|Open in ShadowGraph>`;
  const results: Record<string, string> = {};
  const post = async (name: string, url: string, body: unknown) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      results[name] = r.ok ? "ok" : `http ${r.status}`;
    } catch (err) { results[name] = err instanceof Error ? err.message.slice(0, 80) : "error"; }
  };
  if (sub.slackWebhook) await post("slack", sub.slackWebhook, { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] });
  if (sub.teamsWebhook) await post("teams", sub.teamsWebhook, { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    type: "AdaptiveCard", version: "1.4", $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    body: [{ type: "TextBlock", text: e.title, weight: "Bolder", wrap: true }, ...e.lines.map((l) => ({ type: "TextBlock", text: l, wrap: true }))],
    actions: [{ type: "Action.OpenUrl", title: "Open in ShadowGraph", url: e.link }] } }] });
  if (sub.genericWebhook) await post("webhook", sub.genericWebhook, { source: "shadowgraph", event: e.kind, key: e.key, title: e.title, details: e.lines, url: e.link, sentAt: new Date().toISOString() });
  const from = (await mppStore.get("config:alerts:emailFrom")) as string | null; // set once a sending domain is verified
  if (from) {
    const r = await sendEmail({ from, to: sub.email, subject: e.title, text: `${e.lines.join("\n")}\n\n${e.link}`,
      html: `<p><strong>${e.title}</strong></p>${e.lines.map((l) => `<p>${l.replace(/[<>&]/g, "")}</p>`).join("")}<p><a href="${e.link}">Open in ShadowGraph</a></p>` });
    results.email = r.ok ? "ok" : r.error.code;
  }
  return results;
}

export const stackAlerts = {
  priceLabel: "$29 / month",
  trialDays: TRIAL_DAYS,
  maxServices: MAX_SERVICES,

  async createCheckout(origin: string, email: string, serviceIds: string[], planId: PlanId = "alerts") {
    const plan = planOf(planId);
    const ids = [...new Set(serviceIds)].slice(0, plan.services);
    const id = randomUUID();
    if (ALERTS_FREE && plan.id === "alerts") {
      const mail = email.toLowerCase();
      const allowed = await mppStore.update<boolean>(`ratelimit:freealerts:${mail}:${new Date().toISOString().slice(0, 13)}`, (cur) => {
        const n = Number((cur as { n?: number } | null)?.n ?? 0);
        return n >= 3 ? { op: "noop", result: false } : { op: "set", value: { n: n + 1 }, result: true };
      });
      if (!allowed) throw new Error("Too many requests for this address. Please try again in an hour.");
      const from = (await mppStore.get("config:alerts:emailFrom")) as string | null;
      if (!from) throw new Error("Email sending is not configured");
      const token = `sga_${randomBytes(24).toString("base64url")}`;
      await db.insertInto("alertSubscriptions").values({
        id, email: mail, serviceIds: ids as never, status: "pending", plan: plan.id,
        stripeSubscriptionId: FREE_SESSION, stripeSessionId: `free_${id}`, manageTokenHash: hash(token),
      }).execute();
      const link = `${origin}/alerts?m=${token}`;
      const r = await sendEmail({ from, to: mail, subject: "Activate your free ShadowGraph stack alerts",
        text: `Open this link to activate your alerts for ${ids.length} service${ids.length === 1 ? "" : "s"} and to manage channels (Slack, Teams, webhook, email):\n\n${link}\n\nKeep this link private: it is your access to the settings. If you did not request this, ignore this email; nothing will be sent.`,
        html: `<p>Open this link to activate your alerts for ${ids.length} service${ids.length === 1 ? "" : "s"} and to manage channels (Slack, Teams, webhook, email):</p><p><a href="${link}">Activate and manage my alerts</a></p><p>Keep this link private: it is your access to the settings. If you did not request this, ignore this email; nothing will be sent.</p>` });
      if (!r.ok) throw new Error("The activation email could not be sent");
      return `${origin}/alerts?free=sent&e=${encodeURIComponent(mail)}`;
    }
    await db.insertInto("alertSubscriptions").values({ id, email: email.toLowerCase(), serviceIds: ids as never, status: "pending", plan: plan.id }).execute();
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: plan.priceCents, recurring: { interval: "month" },
        product_data: plan.id === "team"
          ? { name: "ShadowGraph Team", description: `Alerts for up to ${plan.services} services and ${plan.monitors} own endpoints, plus ${plan.boards} branded status boards for your teams or clients.` }
          : { name: "ShadowGraph Stack Alerts", description: `Outage, early-warning, certificate and infrastructure alerts for up to ${plan.services} services.` } } }],
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { product: PRODUCT, subscriptionId: id, plan: plan.id } },
      metadata: { product: PRODUCT, subscriptionId: id, plan: plan.id },
      allow_promotion_codes: true,
      success_url: `${origin}/alerts?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/alerts?s=${encodeURIComponent(ids.join(","))}`,
    });
    await db.updateTable("alertSubscriptions").set({ stripeSessionId: session.id }).where("id", "=", id).execute();
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return session.url;
  },

  /** Exchanges a completed checkout for the private management link (shown once). */
  async claim(sessionId: string): Promise<{ status: "issued"; token: string } | { status: "already_claimed" | "not_paid" | "not_found" }> {
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return { status: "not_found" };
    let s: Stripe.Checkout.Session;
    try { s = await stripe().checkout.sessions.retrieve(sessionId); } catch { return { status: "not_found" }; }
    if (s.metadata?.product !== PRODUCT || !s.metadata.subscriptionId) return { status: "not_found" };
    if (s.status !== "complete") return { status: "not_paid" };
    const sub = await db.selectFrom("alertSubscriptions").selectAll().where("id", "=", s.metadata.subscriptionId).executeTakeFirst();
    if (!sub || sub.stripeSessionId !== s.id) return { status: "not_found" };
    if (sub.manageTokenHash) return { status: "already_claimed" };
    const token = `sga_${randomBytes(24).toString("base64url")}`;
    const updated = await db.updateTable("alertSubscriptions").set({
      manageTokenHash: hash(token), status: "active", subscriptionCheckedAt: sql`now()`, updatedAt: sql`now()`,
      stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
      email: s.customer_details?.email ?? sub.email,
    }).where("id", "=", sub.id).where("manageTokenHash", "is", null).executeTakeFirst();
    if (!updated.numUpdatedRows) return { status: "already_claimed" };
    return { status: "issued", token };
  },

  async byToken(token: string) {
    if (!token?.startsWith("sga_")) return null;
    return (await db.selectFrom("alertSubscriptions").selectAll().where("manageTokenHash", "=", hash(token)).executeTakeFirst()) ?? null;
  },

  async view(token: string) {
    let sub = await this.byToken(token);
    if (!sub) return null;
    // free plan: opening the emailed management link proves the address and activates the subscription
    if (sub.status === "pending" && sub.stripeSubscriptionId === FREE_SESSION) {
      await db.updateTable("alertSubscriptions").set({ status: "active", updatedAt: sql`now()` }).where("id", "=", sub.id).execute();
      sub = { ...sub, status: "active" };
    }
    const deliveries = await db.selectFrom("alertDeliveries").select(["kind", "title", "createdAt", "channels"])
      .where("subscriptionId", "=", sub.id).orderBy("createdAt", "desc").limit(20).execute();
    const mask = (u: string | null) => (u ? `${u.slice(0, 32)}…` : null);
    const plan = planOf(sub.plan);
    return { email: sub.email, status: sub.status, free: sub.stripeSubscriptionId === FREE_SESSION, serviceIds: sub.serviceIds as string[], slack: mask(sub.slackWebhook), teams: mask(sub.teamsWebhook),
      webhook: mask(sub.genericWebhook), emailEnabled: Boolean(await mppStore.get("config:alerts:emailFrom")), deliveries,
      monitors: await customMonitors.list(sub.id), monitorLimit: plan.monitors,
      plan: plan.id, planName: plan.name, serviceLimit: plan.services, boardLimit: plan.boards, boards: await statusBoards.list(sub.id) };
  },

  async addMonitor(token: string, input: { name: string; url: string; expect: Expect }) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    if (sub.status !== "active") throw new Error("Your subscription is not active");
    await customMonitors.add(sub.id, input, planOf(sub.plan).monitors);
    return this.view(token);
  },

  async removeMonitor(token: string, monitorId: string) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    await customMonitors.remove(sub.id, monitorId);
    return this.view(token);
  },

  async saveBoard(token: string, input: BoardInput) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    await statusBoards.save(sub, input);
    return this.view(token);
  },

  async removeBoard(token: string, boardId: string) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    await statusBoards.remove(sub.id, boardId);
    return this.view(token);
  },

  async update(token: string, input: { serviceIds?: string[]; slack?: string | null; teams?: string | null; webhook?: string | null }) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    const patch: Record<string, unknown> = { updatedAt: sql`now()` };
    if (input.serviceIds) patch.serviceIds = [...new Set(input.serviceIds)].slice(0, planOf(sub.plan).services);
    if (input.slack !== undefined) patch.slackWebhook = validWebhook("slack", input.slack);
    if (input.teams !== undefined) patch.teamsWebhook = validWebhook("teams", input.teams);
    if (input.webhook !== undefined) patch.genericWebhook = validWebhook("generic", input.webhook);
    await db.updateTable("alertSubscriptions").set(patch as never).where("id", "=", sub.id).execute();
    return this.view(token);
  },

  async test(token: string) {
    const sub = await this.byToken(token);
    if (!sub) throw new Error("Unknown management link");
    const ok = await mppStore.update<boolean>(`ratelimit:alert-test:${sub.id}`, (cur) => {
      const at = (cur as { at?: number } | null)?.at ?? 0;
      if (Date.now() - at < 60_000) return { op: "noop", result: false };
      return { op: "set", value: { at: Date.now() }, result: true };
    });
    if (!ok) throw new Error("Please wait a minute between test alerts");
    const e: Event = { key: `test:${Date.now()}`, kind: "test", title: "ShadowGraph test alert", lines: ["Your stack alerts are connected. You will hear from us when a monitored service or the provider underneath it has a problem."], link: `${BASE_URL}/radar` };
    const channels = await deliver(sub, e);
    await db.insertInto("alertDeliveries").values({ subscriptionId: sub.id, dedupeKey: e.key, kind: e.kind, title: e.title, channels: channels as never }).execute();
    return channels;
  },

  async portal(token: string, returnUrl: string) {
    const sub = await this.byToken(token);
    if (sub?.stripeSubscriptionId === FREE_SESSION) throw new Error("Your plan is free: nothing to bill. To stop alerts, remove the channels and services.");
    if (!sub?.stripeSubscriptionId) throw new Error("No Stripe subscription");
    const s = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    const session = await stripe().billingPortal.sessions.create({ customer: typeof s.customer === "string" ? s.customer : s.customer.id, return_url: returnUrl });
    return session.url;
  },

  /** Called after every radar sweep. Idempotent: each (subscription, event key) is delivered once. */
  async dispatch() {
    // only paid subscriptions (the public demo board has no Stripe subscription and must never send anything)
    const subs = await db.selectFrom("alertSubscriptions").selectAll().where("status", "=", "active").where("stripeSubscriptionId", "is not", null).execute();
    if (!subs.length) return { subscriptions: 0, sent: 0 };

    // daily subscription status re-check against Stripe
    for (const s of subs) {
      if (!s.stripeSubscriptionId || s.stripeSubscriptionId === FREE_SESSION || (s.subscriptionCheckedAt && Date.now() - new Date(s.subscriptionCheckedAt).getTime() < 24 * 3600_000)) continue;
      try {
        const st = (await stripe().subscriptions.retrieve(s.stripeSubscriptionId)).status;
        await db.updateTable("alertSubscriptions").set({ status: ACTIVE.has(st) ? "active" : "inactive", subscriptionCheckedAt: sql`now()` }).where("id", "=", s.id).execute();
        if (!ACTIVE.has(st)) s.status = "inactive";
      } catch { /* Stripe unreachable: keep the last known status */ }
    }
    const live = subs.filter((s) => s.status === "active");
    if (!live.length) return { subscriptions: 0, sent: 0 };

    const services = new Map((await db.selectFrom("radarServices").select(["id", "name", "hostingProvider", "hostingRegion", "cdn", "dnsProvider"]).where("active", "=", true).execute()).map((s) => [s.id, s]));
    const lastRun = (await mppStore.get("radar:lastRun")) as { runId?: string } | null;
    // index-friendly: only the last 30 minutes of checks (radar_checks_checked_at_idx) instead of a DISTINCT over the whole table
    const runs = (await sql<{ runId: string }>`
      SELECT run_id AS "runId" FROM radar_checks
      WHERE checked_at > (SELECT max(checked_at) FROM radar_checks) - interval '30 minutes'
      GROUP BY run_id ORDER BY run_id DESC LIMIT 2`.execute(db)).rows;
    const checks = runs.length ? await db.selectFrom("radarChecks").select(["serviceId", "runId", "ok", "error", "httpStatus"]).where("runId", "in", runs.map((r) => r.runId)).execute() : [];
    const nowOk = new Map(checks.filter((c) => c.runId === (lastRun?.runId ?? runs[0]?.runId)).map((c) => [c.serviceId, c]));
    const prevOk = new Map(checks.filter((c) => c.runId === runs[1]?.runId).map((c) => [c.serviceId, c.ok]));
    const incidents = await db.selectFrom("radarIncidents").selectAll().where(({ or, eb }) => or([eb("status", "=", "open"), eb("resolvedAt", ">", new Date(Date.now() - 30 * 60_000))])).execute();
    const warnings = await db.selectFrom("radarWarnings").selectAll().where("closedAt", "is", null).execute();
    const upstream = await db.selectFrom("upstreamEvents").select(["id", "candidates", "incidents"]).where("lastAt", ">", new Date(Date.now() - 3 * 3600_000)).execute();
    const expiry = new Map((await db.selectFrom("radarExpiry").selectAll().execute()).map((x) => [x.serviceId, x]));
    const changes = await db.selectFrom("radarChanges").selectAll().where("detectedAt", ">", new Date(Date.now() - 24 * 3600_000)).execute();
    // private custom monitors of the live subscriptions, with each monitor's own 24h latency baseline and last two probes
    const monitors = await db.selectFrom("customMonitors").selectAll().where("active", "=", true).where("subscriptionId", "in", live.map((s) => s.id)).execute();
    const monIds = monitors.map((m) => m.id);
    const monBase = monIds.length ? new Map((await sql<{ id: string; ms: number; n: number }>`
      SELECT monitor_id AS id, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::float AS ms, count(*)::int AS n
      FROM custom_checks WHERE ok AND latency_ms IS NOT NULL AND checked_at > now() - interval '24 hours' AND monitor_id IN (${sql.join(monIds)})
      GROUP BY monitor_id`.execute(db)).rows.map((r) => [r.id, r])) : new Map<string, { id: string; ms: number; n: number }>();
    const monLast = monIds.length ? (await sql<{ id: string; ok: boolean; latency: number | null; rn: number }>`
      SELECT monitor_id AS id, ok, latency_ms AS latency, rn FROM (
        SELECT monitor_id, ok, latency_ms, row_number() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
        FROM custom_checks WHERE checked_at > now() - interval '30 minutes' AND monitor_id IN (${sql.join(monIds)})) t WHERE rn <= 2`.execute(db)).rows : [];
    const monGroup = (m: (typeof monitors)[number], layer: string, provider: string) =>
      (layer === "region" && m.hostingRegion && `${m.hostingProvider} ${m.hostingRegion}` === provider) || (layer === "hosting" && m.hostingProvider === provider)
      || (layer === "cdn" && m.cdn === provider) || (layer === "dns" && m.dnsProvider === provider);
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Array<{ id: string; name: string }>;
    const day = new Date().toISOString().slice(0, 10);
    const inGroup = (sid: string, layer: string, provider: string) => {
      const s = services.get(sid);
      if (!s) return false;
      return (layer === "region" && `${s.hostingProvider} ${s.hostingRegion}` === provider) || (layer === "hosting" && s.hostingProvider === provider)
        || (layer === "cdn" && s.cdn === provider) || (layer === "dns" && s.dnsProvider === provider);
    };

    let sent = 0;
    for (const sub of live) {
      const ids = new Set(sub.serviceIds as string[]);
      const name = (id: string) => services.get(id)?.name ?? id;
      const events: Event[] = [];
      for (const inc of incidents) {
        const hit = parse(inc.affected).filter((a) => ids.has(a.id)), risk = parse(inc.atRisk).filter((a) => ids.has(a.id));
        if (!hit.length && !risk.length) continue;
        if (inc.status === "open") events.push({ key: `incident:${inc.id}`, kind: "incident", title: `${inc.provider}: provider incident affecting your stack`,
          lines: [hit.length ? `Down now: ${hit.map((a) => a.name).join(", ")}` : "", risk.length ? `At risk (same ${inc.layer}): ${risk.map((a) => a.name).join(", ")}` : ""].filter(Boolean),
          link: `${BASE_URL}/radar` });
        else events.push({ key: `incident_resolved:${inc.id}`, kind: "incident_resolved", title: `Resolved: ${inc.provider} incident`, lines: [`The services we track for you on ${inc.provider} answer normally again.`], link: `${BASE_URL}/radar` });
      }
      for (const w of warnings) {
        const mine = [...ids].filter((id) => inGroup(id, w.layer, w.provider));
        if (!mine.length) continue;
        events.push({ key: `warning:${w.id}`, kind: "warning", title: `Early warning: ${w.provider} is degrading`,
          lines: [`Several services on ${w.provider} are much slower than normal or failing, before any outage is declared.`, `Your services on it: ${mine.map(name).join(", ")}`], link: `${BASE_URL}/outlook` });
      }
      // upstream signals (rule cs-v1): companies sharing a provider declared incidents together within the last 3 hours
      for (const u of upstream) {
        const cands = u.candidates as unknown as Array<{ layer: string; provider: string }>;
        const mine = [...ids].filter((id) => cands.some((c) => inGroup(id, c.layer, c.provider)));
        if (!mine.length) continue;
        const companies = [...new Set((u.incidents as unknown as Array<{ name: string }>).map((c) => c.name))];
        events.push({ key: `upstream:${u.id}`, kind: "upstream", title: `Upstream signal: ${cands[0]?.provider ?? "shared provider"}`,
          lines: [`${companies.length} companies on this provider declared incidents within the same hour: ${companies.slice(0, 6).join(", ")}.`, `Your services on it: ${mine.map(name).join(", ")}`],
          link: `${BASE_URL}/signals` });
      }
      for (const id of ids) {
        const c = nowOk.get(id);
        if (c && !c.ok && prevOk.get(id) === false) events.push({ key: `down:${id}:${day}`, kind: "down", title: `${name(id)} is down`,
          lines: [`Two consecutive checks failed (${c.error ?? `HTTP ${c.httpStatus}`}).`], link: `${BASE_URL}/radar` });
        const x = expiry.get(id);
        if (x?.certNotAfter) {
          const days = Math.floor((new Date(x.certNotAfter).getTime() - Date.now()) / 86_400_000);
          const tier = days < 0 ? "expired" : days < 7 ? "under 7 days" : days < 14 && x.certIssuer && AUTO_CA.test(x.certIssuer) ? "renewal overdue" : null;
          if (tier) events.push({ key: `cert:${id}:${new Date(x.certNotAfter).toISOString().slice(0, 10)}:${tier}`, kind: "certificate", title: `${name(id)}: TLS certificate ${tier}`,
            lines: [`${x.host} certificate ${days < 0 ? `expired ${-days} days ago` : `expires in ${days} days`} (${x.certIssuer ?? "unknown issuer"}).`], link: `${BASE_URL}/outlook` });
        }
        if (x?.domainExpiresAt && x.domain) {
          const days = Math.floor((new Date(x.domainExpiresAt).getTime() - Date.now()) / 86_400_000);
          if (days < 14) events.push({ key: `domain:${x.domain}:${new Date(x.domainExpiresAt).toISOString().slice(0, 10)}`, kind: "domain", title: `${x.domain}: domain registration ${days < 0 ? "expired" : `expires in ${days} days`}`,
            lines: [`Used by ${name(id)}. Registrar: ${x.domainRegistrar ?? "unknown"}.`], link: `${BASE_URL}/outlook` });
        }
      }
      for (const ch of changes) if (ids.has(ch.serviceId)) events.push({ key: `change:${ch.id}`, kind: "change", title: `${name(ch.serviceId)} changed its infrastructure`,
        lines: [`${ch.field.replace("_", " ")}: ${ch.oldValue} → ${ch.newValue}`, "Migrations are when outages are most likely; worth watching for a few days."], link: `${BASE_URL}/outlook` });

      // ---- the subscriber's own endpoints ----
      for (const m of monitors.filter((x) => x.subscriptionId === sub.id)) {
        const infra = [m.hostingProvider && `hosting ${m.hostingProvider}${m.hostingRegion ? ` ${m.hostingRegion}` : ""}`, m.cdn && `CDN ${m.cdn}`, m.dnsProvider && `DNS ${m.dnsProvider}`].filter(Boolean).join(" · ");
        const link = `${BASE_URL}/alerts`;
        if (m.consecutiveFailures >= 2 && m.downSince) events.push({ key: `cm-down:${m.id}:${new Date(m.downSince).toISOString()}`, kind: "down", title: `${m.name} is down`,
          lines: [`${m.url} failed ${m.consecutiveFailures} checks in a row: ${m.lastError ?? "no response"}.`, infra ? `Runs on ${infra}.` : ""].filter(Boolean), link });
        const rec = (await mppStore.get(`cm:recovered:${m.id}`)) as { downSince: string; at: string } | null;
        if (rec) {
          const mins = Math.max(1, Math.round((Date.parse(rec.at) - Date.parse(rec.downSince)) / 60_000));
          events.push({ key: `cm-up:${m.id}:${rec.downSince}`, kind: "recovered", title: `${m.name} is back up`, lines: [`Down for about ${mins} minutes (since ${rec.downSince.slice(11, 16)} UTC).`], link });
          await mppStore.delete(`cm:recovered:${m.id}`);
        }
        const b = monBase.get(m.id), last = monLast.filter((r) => r.id === m.id);
        if (b && b.n >= 12 && last.length === 2 && last.every((r) => r.ok && r.latency !== null && r.latency >= Math.max(2.5 * b.ms, b.ms + 400)))
          events.push({ key: `cm-slow:${m.id}:${new Date().toISOString().slice(0, 13)}`, kind: "slow", title: `${m.name} is much slower than normal`,
            lines: [`Last two checks: ${last.map((r) => `${r.latency} ms`).join(", ")} vs a 24-hour median of ${Math.round(b.ms)} ms.`], link });
        if (m.certNotAfter) {
          const days = Math.floor((new Date(m.certNotAfter).getTime() - Date.now()) / 86_400_000);
          const tier = days < 0 ? "expired" : days < 7 ? "under 7 days" : days < 14 && m.certIssuer && AUTO_CA.test(m.certIssuer) ? "renewal overdue" : days < 21 ? "under 21 days" : null;
          if (tier) events.push({ key: `cm-cert:${m.id}:${new Date(m.certNotAfter).toISOString().slice(0, 10)}:${tier}`, kind: "certificate", title: `${m.name}: TLS certificate ${tier}`,
            lines: [`Certificate ${days < 0 ? `expired ${-days} days ago` : `expires in ${days} days`} (${m.certIssuer ?? "unknown issuer"}).`], link });
        }
        if (m.domainExpiresAt && m.domain) {
          const days = Math.floor((new Date(m.domainExpiresAt).getTime() - Date.now()) / 86_400_000);
          if (days < 30) events.push({ key: `cm-domain:${m.id}:${new Date(m.domainExpiresAt).toISOString().slice(0, 10)}`, kind: "domain", title: `${m.domain}: domain ${days < 0 ? "expired" : `expires in ${days} days`}`,
            lines: [`Used by your endpoint ${m.name}. Renew it before it lapses: an expired domain takes everything on it offline.`], link });
        }
        for (const inc of incidents) if (inc.status === "open" && monGroup(m, inc.layer, inc.provider)) events.push({ key: `cm-provider:${inc.id}:${m.id}`, kind: "incident",
          title: `${inc.provider} incident: your endpoint ${m.name} depends on it`, lines: [`${m.name} uses ${inc.provider} (${inc.layer}). It is ${m.lastOk ? "still answering" : "failing"} right now.`], link: `${BASE_URL}/radar` });
        for (const w of warnings) if (monGroup(m, w.layer, w.provider)) events.push({ key: `cm-warning:${w.id}:${m.id}`, kind: "warning",
          title: `Early warning: ${w.provider} is degrading, and ${m.name} depends on it`, lines: [`Several services on ${w.provider} are slower than normal or failing, before any outage is declared.`], link: `${BASE_URL}/outlook` });
        for (const ch of changes) if (ch.serviceId === m.id) events.push({ key: `change:${ch.id}`, kind: "change", title: `${m.name}: infrastructure changed`,
          lines: [`${ch.field.replace("_", " ")}: ${ch.oldValue} → ${ch.newValue}`], link });
      }

      for (const e of events) {
        const row = await db.insertInto("alertDeliveries").values({ subscriptionId: sub.id, dedupeKey: e.key, kind: e.kind, title: e.title, payload: { lines: e.lines } as never })
          .onConflict((oc) => oc.columns(["subscriptionId", "dedupeKey"]).doNothing()).returning("id").executeTakeFirst();
        if (!row) continue;
        const channels = await deliver(sub, e);
        await db.updateTable("alertDeliveries").set({ channels: channels as never }).where("id", "=", row.id).execute();
        sent++;
      }
    }
    return { subscriptions: live.length, sent };
  },
};
