import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "kysely";
import { sendEmail } from "@runtime/email";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { SITE_URL } from "./site";
import { companyDependencies, displayName } from "./companyDependencies";

/**
 * Concentration watch: email when a watched company files a 10-K / 20-F that changes who its major customers are,
 * or when a supplier reports a changed dependence on a watched company.
 * - Free, up to MAX_SLUGS companies per address; double opt-in; one-click unsubscribe (List-Unsubscribe headers).
 * - Runs after the daily SEC scan (secConcJob). Only facts from filings of the last 60 days count, so historical
 *   backfills never trigger mail. Idempotent per (watch, filing accession).
 */
const MAX_SLUGS = 10;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e.trim());
const parseSlugs = (v: unknown) => ((typeof v === "string" ? JSON.parse(v) : v) ?? []) as string[];

async function senderFrom() { return (await mppStore.get("config:alerts:emailFrom")) as string | null; }
const unsubPage = (token: string) => `${SITE_URL}/unsubscribe?t=${token}`;
const unsubHeaders = (token: string) => [{ name: "List-Unsubscribe", value: `<${SITE_URL}/_api/email/unsubscribe?t=${token}>` }, { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" }];

function shell(title: string, body: string, unsubUrl: string) {
  return `<!doctype html><html><body style="margin:0;background:#05070a;font-family:Helvetica,Arial,sans-serif;color:#eef2f5">
<div style="max-width:560px;margin:0 auto;padding:28px 22px">
<p style="font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7c8a96;margin:0 0 18px">ShadowGraph · Concentration watch</p>
<h1 style="font-size:22px;font-weight:600;margin:0 0 14px;color:#eef2f5">${esc(title)}</h1>
${body}
<hr style="border:0;border-top:1px solid #1a222b;margin:28px 0 14px">
<p style="font-size:12px;color:#7c8a96;line-height:1.6;margin:0">You receive this because this address asked ShadowGraph to watch customer concentration for some companies. <a href="${unsubUrl}" style="color:#7c8a96">Unsubscribe</a> with one click.<br>Source: SEC EDGAR filings. Not investment advice.</p>
</div></body></html>`;
}
const p = (t: string) => `<p style="font-size:15px;line-height:1.6;color:#c9d3db;margin:0 0 12px">${t}</p>`;
const btn = (href: string, label: string) => `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#eef2f5;color:#05070a;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">${esc(label)}</a></p>`;

async function namesFor(slugs: string[]) {
  const idx = await companyDependencies.index();
  const by = new Map(idx.map((c) => [c.slug, c]));
  return slugs.map((s) => by.get(s)?.name ?? s.toUpperCase());
}

async function sendConfirmation(w: { id: string; email: string; slugs: unknown; unsubToken: string }, from: string) {
  const token = randomBytes(24).toString("base64url");
  await db.updateTable("concentrationWatch").set({ confirmHash: hash(token), confirmSentAt: new Date() }).where("id", "=", w.id).execute();
  const names = (await namesFor(parseSlugs(w.slugs))).join(", ");
  const url = `${SITE_URL}/watch/confirm?t=${token}`;
  const unsubUrl = unsubPage(w.unsubToken);
  const r = await sendEmail({
    from, to: w.email, subject: `Confirm your concentration watch: ${names}`.slice(0, 150), headers: unsubHeaders(w.unsubToken),
    text: `Confirm your concentration watch for ${names}: ${url}\n\nWe email you when a new 10-K or 20-F changes who these companies' major customers are, or when a supplier reports a changed dependence on them. Nothing is sent until you confirm.\n\nUnsubscribe: ${unsubUrl}`,
    html: shell("Confirm your concentration watch", p(`We will email you when a new annual filing changes the major customers of <b>${esc(names)}</b>: a new 10% customer, a customer that is no longer disclosed, or a share that moves by 5 points or more. Nothing is sent until you confirm.`)
      + btn(url, "Confirm my watch") + p(`<span style="font-size:13px;color:#7c8a96">If you did not ask for this, ignore this email.</span>`), unsubUrl),
  });
  return r.ok;
}

type Line = { slug: string; customer: string; text: string; kind: "new" | "dropped" | "up" | "down" | "steady" | "first" };
type FilingEvent = { accession: string; filerSlug: string; filerName: string; form: string; filedAt: string; period: string; url: string; lines: Array<Line & { customerSlug: string }> };

/**
 * What changed in each filing: per customer, the filing's latest fiscal period vs the fiscal year before.
 * `createdSince` = filings that reached our table since then (alerts); without it, every filing of the last `filedDays`.
 */
async function filingEvents(opts: { createdSince?: Date; filedDays: number }): Promise<FilingEvent[]> {
  const fresh = (await sql<{ cik: string; accession: string }>`
    SELECT filer_cik AS cik, accession FROM customer_concentration_facts
    WHERE ${opts.createdSince ? sql`created_at > ${opts.createdSince}` : sql`true`} AND filed_at > now() - make_interval(days => ${opts.filedDays})
      AND benchmark = 'revenue' AND entry_kind = 'customer'
    GROUP BY filer_cik, accession ORDER BY max(filed_at) DESC LIMIT 300`.execute(db)).rows;
  const out: FilingEvent[] = [];
  for (const f of fresh) {
    const rows = (await sql<{ ticker: string; name: string; customer: string; cslug: string; period: string; share: number; filed: string; form: string; url: string; accession: string }>`
      SELECT DISTINCT ON (coalesce(customer_ticker, customer_display), period_end)
        filer_ticker AS ticker, filer_name AS name, customer_display AS customer,
        coalesce(lower(customer_ticker), trim(both '-' from regexp_replace(lower(replace(customer_display, '&', ' and ')), '[^a-z0-9]+', '-', 'g'))) AS cslug,
        period_end::date::text AS period, share, filed_at::date::text AS filed, form, doc_url AS url, accession
      FROM customer_concentration_facts
      WHERE filer_cik = ${f.cik} AND benchmark = 'revenue' AND entry_kind = 'customer' AND customer_display IS NOT NULL AND filed_at <= (SELECT max(filed_at) FROM customer_concentration_facts WHERE accession = ${f.accession})
      ORDER BY coalesce(customer_ticker, customer_display), period_end, filed_at DESC`.execute(db)).rows;
    const mine = rows.filter((r) => r.accession === f.accession);
    if (!mine.length) continue;
    const p1 = mine.map((r) => r.period).sort().reverse()[0];
    const periods = [...new Set(rows.map((r) => r.period))].sort().reverse();
    const p0 = periods.find((p) => p < p1 && Date.parse(p1) - Date.parse(p) < 400 * 86_400_000) ?? null;
    const cur = new Map(rows.filter((r) => r.period === p1).map((r) => [r.cslug, r]));
    const prev = new Map(p0 ? rows.filter((r) => r.period === p0).map((r) => [r.cslug, r]) : []);
    const filerName = displayName(mine[0].name);
    const lines: FilingEvent["lines"] = [];
    for (const [slug, r] of cur) {
      const before = prev.get(slug);
      const share = Number(r.share);
      if (!p0) lines.push({ slug, customerSlug: slug, customer: r.customer, kind: "first", text: `${r.customer}: ${pct(share)} of revenue.` });
      else if (!before) lines.push({ slug, customerSlug: slug, customer: r.customer, kind: "new", text: `New major customer: ${r.customer} at ${pct(share)} of revenue (not disclosed as a 10% customer a year earlier).` });
      else {
        const d = share - Number(before.share);
        lines.push({ slug, customerSlug: slug, customer: r.customer, kind: Math.abs(d) >= 0.05 ? (d > 0 ? "up" : "down") : "steady",
          text: `${r.customer}: ${pct(share)} of revenue, ${Math.abs(d) >= 0.005 ? `${d > 0 ? "up" : "down"} from ${pct(Number(before.share))}` : "unchanged"} a year earlier.` });
      }
    }
    for (const [slug, r] of prev) if (!cur.has(slug)) lines.push({ slug, customerSlug: slug, customer: r.customer, kind: "dropped", text: `${r.customer} is no longer disclosed as a 10% customer (it was ${pct(Number(r.share))} a year earlier).` });
    const order = { new: 0, dropped: 1, up: 2, down: 3, first: 4, steady: 5 } as const;
    lines.sort((a, b) => order[a.kind] - order[b.kind]);
    out.push({ accession: f.accession, filerSlug: mine[0].ticker.toLowerCase(), filerName, form: mine[0].form, filedAt: mine[0].filed, period: p1, url: mine[0].url, lines });
  }
  return out;
}

export const concentrationWatch = {
  MAX_SLUGS,

  /** Filings of the last `days` days whose major customers changed (public feed on /companies), cached 1 h. */
  async recentChanges(days = 90) {
    const key = `cache:concentration-changes:${days}`;
    const c = (await mppStore.get(key)) as { at: number; list: FilingEvent[] } | null;
    if (c && Date.now() - c.at < 3600_000) return c.list;
    const list = (await filingEvents({ filedDays: days }))
      .map((e) => ({ ...e, lines: e.lines.filter((l) => l.kind === "new" || l.kind === "dropped" || l.kind === "up" || l.kind === "down") }))
      .filter((e) => e.lines.length)
      .sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    await mppStore.put(key, { at: Date.now(), list });
    return list;
  },

  async subscribe(input: { email: string; slug: string; source?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!validEmail(email)) throw new Error("Please enter a valid email address.");
    const page = await companyDependencies.page(input.slug);
    if (!page) throw new Error("Unknown company.");
    const slug = page.slug;
    const existing = await db.selectFrom("concentrationWatch").selectAll().where(sql`lower(email)`, "=", email)
      .where("status", "in", ["active", "pending"]).orderBy("createdAt", "desc").executeTakeFirst();
    if (existing) {
      const slugs = parseSlugs(existing.slugs);
      if (!slugs.includes(slug)) {
        if (slugs.length >= MAX_SLUGS) throw new Error(`The free watch covers up to ${MAX_SLUGS} companies. Remove one by unsubscribing and starting again.`);
        slugs.push(slug);
        await db.updateTable("concentrationWatch").set({ slugs: JSON.stringify(slugs) as never, updatedAt: new Date() }).where("id", "=", existing.id).execute();
      }
      if (existing.status === "active") return { status: "added" as const, count: slugs.length };
      // pending: resend the confirmation at most every 10 minutes
      const from = await senderFrom();
      if (from && (!existing.confirmSentAt || Date.now() - new Date(existing.confirmSentAt).getTime() > 10 * 60_000)) {
        return { status: (await sendConfirmation({ ...existing, slugs }, from)) ? ("sent" as const) : ("queued" as const), count: slugs.length };
      }
      return { status: "sent" as const, count: slugs.length };
    }
    const recent = await db.selectFrom("concentrationWatch").select(sql<number>`count(*)::int`.as("n")).where(sql`lower(email)`, "=", email)
      .where("createdAt", ">", new Date(Date.now() - 86_400_000)).executeTakeFirst();
    if ((recent?.n ?? 0) >= 3) throw new Error("Too many sign-ups for this address today. Check your inbox for the confirmation email.");
    const row = { id: randomUUID(), email, slugs: JSON.stringify([slug]) as never, status: "pending", confirmHash: hash(randomBytes(24).toString("hex")),
      unsubToken: randomBytes(24).toString("base64url"), source: input.source?.slice(0, 80) ?? null };
    await db.insertInto("concentrationWatch").values(row).execute();
    const from = await senderFrom();
    if (!from) return { status: "queued" as const, count: 1 };
    return { status: (await sendConfirmation({ ...row, slugs: [slug] }, from)) ? ("sent" as const) : ("queued" as const), count: 1 };
  },

  async confirm(token: string) {
    if (!token || token.length < 20) return null;
    const w = await db.selectFrom("concentrationWatch").selectAll().where("confirmHash", "=", hash(token)).executeTakeFirst();
    if (!w || w.status === "unsubscribed") return null;
    if (w.status !== "active") await db.updateTable("concentrationWatch").set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() }).where("id", "=", w.id).execute();
    const slugs = parseSlugs(w.slugs);
    return { slugs, names: await namesFor(slugs) };
  },

  async unsubscribe(token: string) {
    if (!token) return false;
    const r = await db.updateTable("concentrationWatch").set({ status: "unsubscribed", updatedAt: new Date() }).where("unsubToken", "=", token).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  /** After the daily SEC scan: queued confirmations, then one email per watch and filing. */
  async dispatch() {
    const from = await senderFrom();
    if (!from) return { confirmations: 0, sent: 0, filings: 0 };
    let confirmations = 0, sent = 0;
    const pending = await db.selectFrom("concentrationWatch").select(["id", "email", "slugs", "unsubToken"]).where("status", "=", "pending").where("confirmSentAt", "is", null)
      .where("createdAt", ">", new Date(Date.now() - 14 * 86_400_000)).limit(50).execute();
    for (const w of pending) if (await sendConfirmation(w, from)) confirmations++;

    const KEY = "concwatch:lastDispatch";
    const last = (await mppStore.get(KEY)) as string | null;
    const since = last ? new Date(last) : new Date(Date.now() - 2 * 86_400_000);
    const startedAt = new Date();
    const events = await filingEvents({ createdSince: since, filedDays: 60 });
    const active = events.length ? await db.selectFrom("concentrationWatch").selectAll().where("status", "=", "active").execute() : [];
    for (const w of active) {
      const slugs = parseSlugs(w.slugs);
      for (const e of events) {
        const asFiler = slugs.includes(e.filerSlug);
        const asCustomer = e.lines.filter((l) => slugs.includes(l.customerSlug));
        if (!asFiler && !asCustomer.length) continue;
        // watchers of the filer get the whole filing; watchers of a customer get only the lines about that customer
        const lines = asFiler ? e.lines : asCustomer;
        const changed = lines.some((l) => l.kind !== "steady");
        const claimed = await db.insertInto("concentrationWatchDeliveries").values({ watchId: w.id, dedupeKey: `filing:${e.accession}` })
          .onConflict((oc) => oc.columns(["watchId", "dedupeKey"]).doNothing()).returning("watchId").executeTakeFirst();
        if (!claimed) continue;
        const subject = asFiler
          ? `${e.filerName} ${e.form}: ${changed ? "major customers changed" : "major customers unchanged"}`
          : `${e.filerName} ${e.form}: its dependence on ${asCustomer.map((l) => l.customer).join(", ")}`;
        const page = `${SITE_URL}/company/${asFiler ? e.filerSlug : asCustomer[0].customerSlug}`;
        const unsubUrl = unsubPage(w.unsubToken);
        const intro = `${e.filerName} filed its ${e.form} on ${e.filedAt} (fiscal year ending ${e.period}).`;
        const r = await sendEmail({
          from, to: w.email, subject: subject.slice(0, 150), headers: unsubHeaders(w.unsubToken),
          text: `${intro}\n\n${lines.map((l) => `- ${l.text}`).join("\n")}\n\nFiling: ${e.url}\nHistory: ${page}\n\nUnsubscribe: ${unsubUrl}`,
          html: shell(subject, p(esc(intro)) + `<ul style="padding-left:18px;margin:0 0 12px">${lines.map((l) => `<li style="font-size:15px;line-height:1.6;color:${l.kind === "steady" || l.kind === "first" ? "#c9d3db" : "#eef2f5"};margin:0 0 6px">${esc(l.text)}</li>`).join("")}</ul>`
            + btn(page, "See the full history") + p(`<a href="${e.url}" style="color:#5fe3a1">Open the filing on SEC EDGAR</a>`), unsubUrl),
        });
        if (r.ok) { await db.updateTable("concentrationWatchDeliveries").set({ messageId: r.messageId }).where("watchId", "=", w.id).where("dedupeKey", "=", `filing:${e.accession}`).execute(); sent++; }
      }
    }
    await mppStore.put(KEY, startedAt.toISOString());
    return { confirmations, sent, filings: events.length };
  },
};
