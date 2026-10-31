import { createHash } from "crypto";
import { sql } from "kysely";
import { db } from "./db";

/**
 * Privacy-friendly visitor counting (no cookies, nothing stored on the device, no IP stored).
 * A visitor is identified per day by sha256(daily salt + IP + user agent). The daily salt is derived from a secret
 * in app_config plus the date, so the same person gets a different hash tomorrow and cannot be followed across days.
 */

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|scrap|curl|wget|python|httpx|node|undici|axios|okhttp|go-http|java\/|libwww|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|monitor|uptime|scan|probe|audit|harvest|collector|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|bingpreview|regression|ahrefs|semrush|mj12|dotbot|petal|bytespider|gptbot|claude|anthropic|perplexity|ccbot|amazonbot|applebot|yandex|baidu/i;

export const isBotUA = (ua: string) => !ua || ua.length < 20 || BOT_RE.test(ua);
export const deviceOf = (ua: string) => (/ipad|tablet/i.test(ua) ? "tablet" : /mobile|iphone|android/i.test(ua) ? "mobile" : "desktop");
export const cleanPath = (p: string) => {
  const path = (p || "/").split(/[?#]/)[0].slice(0, 160) || "/";
  return path.startsWith("/") ? path : `/${path}`;
};
export function referrerHost(ref: string | undefined, ownHost: string | null): string | null {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
    const own = (ownHost ?? "").replace(/^www\./, "").toLowerCase();
    if (!h || h === own || h.startsWith("shadowalpha")) return null;
    return h.slice(0, 80);
  } catch { return null; }
}
export function clientIp(req: Request): string {
  const h = req.headers;
  const cf = h.get("cloudfront-viewer-address");
  if (cf) return cf.replace(/:\d+$/, "");
  return (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
}
export function countryOf(req: Request): string | null {
  const c = req.headers.get("cloudfront-viewer-country") ?? req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry");
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

let saltCache: { secret: string } | null = null;
async function dailySalt(day: string) {
  if (!saltCache) {
    const row = await db.selectFrom("appConfig").select("value").where("key", "=", "visitor_salt").executeTakeFirst();
    if (!row?.value) throw new Error("visitor salt missing");
    saltCache = { secret: row.value };
  }
  return createHash("sha256").update(`${saltCache.secret}:${day}`).digest("hex");
}

export async function recordVisit(req: Request, input: { path: string; referrer?: string }) {
  const ua = req.headers.get("user-agent") ?? "";
  const day = new Date().toISOString().slice(0, 10);
  const path = cleanPath(input.path);
  // real browsers always send Accept-Language; headless Chrome announces itself in the client hints
  const bot = isBotUA(ua) || !req.headers.get("accept-language") || /headless/i.test(req.headers.get("sec-ch-ua") ?? "");
  const hash = createHash("sha256").update(`${await dailySalt(day)}|${clientIp(req)}|${ua}`).digest("hex").slice(0, 32);
  const ownHost = (() => { try { return new URL(req.url).hostname; } catch { return null; } })();
  await db.insertInto("visitorDays").values({
    day, visitorHash: hash, pages: 1, firstPath: path, lastPath: path, referrerHost: referrerHost(input.referrer, ownHost),
    country: countryOf(req), device: deviceOf(ua), isBot: bot,
  }).onConflict((oc) => oc.columns(["day", "visitorHash"]).doUpdateSet({
    pages: sql`visitor_days.pages + 1`, lastPath: path, lastSeen: new Date(),
    referrerHost: sql`coalesce(visitor_days.referrer_host, excluded.referrer_host)`,
  })).execute();
  await db.insertInto("pageViewsDaily").values({ day, path, views: bot ? 0 : 1, botViews: bot ? 1 : 0 })
    .onConflict((oc) => oc.columns(["day", "path"]).doUpdateSet({
      views: sql`page_views_daily.views + ${bot ? 0 : 1}`, botViews: sql`page_views_daily.bot_views + ${bot ? 1 : 0}`,
    })).execute();
}

export async function checkStatsKey(key: string | null) {
  if (!key) return false;
  const row = await db.selectFrom("appConfig").select("value").where("key", "=", "stats_key").executeTakeFirst();
  return !!row?.value && row.value === key;
}

type Count = { k: string; n: number };
export type VisitorSummary = {
  generatedAt: string;
  since: string | null;
  totals: { today: number; last7: number; last30: number; allTime: number; pageViews30: number; bots30: number };
  days: Array<{ day: string; visitors: number; pageViews: number; bots: number; countries: Count[] }>;
  pages: Count[];
  referrers: Count[];
  countries: Count[];
  devices: Count[];
  entryPages: Count[];
  /** Period before exact counting, reconstructed from server logs (estimate, see visits_estimated_daily). */
  estimate: { days: Array<{ day: string; pageLoads: number; browserLoads: number; visits: number; topPages: string }>; visits: number; pageLoads: number; browserLoads: number };
  /** owner business funnel (added by the stats endpoint) */
  business?: import("./ownerBusiness").BusinessSummary | null;
};

export async function visitorSummary(): Promise<VisitorSummary> {
  const n = (v: unknown) => Number(v ?? 0);
  // aliases without underscores: the CamelCasePlugin rewrites snake_case result keys
  const totals = await sql<{ today: string; last7: string; last30: string; alltime: string; bots30: string; since: string | null }>`
    select
      count(*) filter (where not is_bot and day = current_date) as today,
      count(*) filter (where not is_bot and day > current_date - 7) as last7,
      count(*) filter (where not is_bot and day > current_date - 30) as last30,
      count(*) filter (where not is_bot) as alltime,
      count(*) filter (where is_bot and day > current_date - 30) as bots30,
      min(day)::text as since
    from visitor_days`.execute(db);
  const days = await sql<{ day: string; visitors: string; pageviews: string; bots: string }>`
    select d::date::text as day,
      (select count(*) from visitor_days v where v.day = d::date and not v.is_bot) as visitors,
      (select coalesce(sum(views),0) from page_views_daily p where p.day = d::date) as pageviews,
      (select count(*) from visitor_days v where v.day = d::date and v.is_bot) as bots
    from generate_series(current_date - 29, current_date, interval '1 day') d order by 1 desc`.execute(db);
  // visitor countries per day (humans only), for the per-day rows
  const perDay = await sql<{ day: string; k: string; n: string }>`
    select day::text as day, coalesce(country, 'unknown') as k, count(*) as n
    from visitor_days where not is_bot and day > current_date - 30 group by 1, 2 order by 1 desc, 3 desc`.execute(db);
  const byDay = new Map<string, Count[]>();
  for (const r of perDay.rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), { k: r.k, n: n(r.n) }]);
  const top = async (q: ReturnType<typeof sql<{ k: string | null; n: string }>>) =>
    (await q.execute(db)).rows.map((r) => ({ k: r.k ?? "—", n: n(r.n) }));
  const pages = await top(sql`select path as k, sum(views) as n from page_views_daily where day > current_date - 30 group by path having sum(views) > 0 order by 2 desc limit 15`);
  const referrers = await top(sql`select coalesce(referrer_host, 'direct / unknown') as k, count(*) as n from visitor_days where not is_bot and day > current_date - 30 group by 1 order by 2 desc limit 12`);
  const countries = await top(sql`select coalesce(country, 'unknown') as k, count(*) as n from visitor_days where not is_bot and day > current_date - 30 group by 1 order by 2 desc limit 12`);
  const devices = await top(sql`select device as k, count(*) as n from visitor_days where not is_bot and day > current_date - 30 group by 1 order by 2 desc`);
  const entryPages = await top(sql`select first_path as k, count(*) as n from visitor_days where not is_bot and day > current_date - 30 group by 1 order by 2 desc limit 10`);
  const est = await sql<{ day: string; loads: number; browser: number; visits: number; top: string }>`
    select day::text as day, page_loads as loads, browser_loads as browser, est_visits as visits, top_pages as top
    from visits_estimated_daily order by day desc`.execute(db);
  const estDays = est.rows.map((r) => ({ day: r.day, pageLoads: n(r.loads), browserLoads: n(r.browser), visits: n(r.visits), topPages: r.top }));
  const t = totals.rows[0];
  const pageViews30 = days.rows.reduce((s, r) => s + n(r.pageviews), 0);
  return {
    generatedAt: new Date().toISOString(),
    since: t?.since ?? null,
    totals: { today: n(t?.today), last7: n(t?.last7), last30: n(t?.last30), allTime: n(t?.alltime), pageViews30, bots30: n(t?.bots30) },
    days: days.rows.map((r) => ({ day: r.day, visitors: n(r.visitors), pageViews: n(r.pageviews), bots: n(r.bots), countries: byDay.get(r.day) ?? [] })),
    pages, referrers, countries, devices, entryPages,
    estimate: {
      days: estDays,
      visits: estDays.reduce((s, d) => s + d.visits, 0),
      pageLoads: estDays.reduce((s, d) => s + d.pageLoads, 0),
      browserLoads: estDays.reduce((s, d) => s + d.browserLoads, 0),
    },
  };
}
