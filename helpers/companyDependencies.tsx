import { sql } from "kysely";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { rankCompanies } from "./companySearchRank";

/**
 * Company pages built from SEC customer-concentration disclosures (10-K / 20-F, XBRL):
 *  - as a filer: which customers carry 10%+ of its revenue, year by year since the first filing we have;
 *  - as a customer: which listed suppliers depend on it, and how much.
 * Point-in-time: every share belongs to a fiscal period and the filing that reported it. Only named counterparties
 * (entry_kind = 'customer', set by the sg_customer_fill trigger) and the revenue benchmark are used.
 * Slug: lower-case ticker for listed companies, a slug of the name for unlisted customers ("u-s-government").
 */
export type ShareYear = { period: string; share: number; filedAt: string; url: string };
export type Relation = {
  name: string; ticker: string | null; slug: string;
  latest: ShareYear; history: ShareYear[];
  /** still disclosed in the counterparty filer's latest fiscal period */
  current: boolean;
  change: { kind: "new" | "up" | "down" | "steady"; from: number | null } | null;
};
export type CompanyPage = {
  slug: string; name: string; ticker: string | null; cik: string | null;
  customers: Relation[];  // this company as a supplier: its major customers
  suppliers: Relation[];  // this company as a customer: suppliers that depend on it
  firstPeriod: string | null; lastFiled: string | null; latestPeriod: string | null;
  concentration: number | null; // sum of disclosed shares in the latest fiscal period (as filer)
};
export type CompanyIndexEntry = {
  slug: string; name: string; ticker: string | null; customers: number; suppliers: number;
  /** largest current relationship: its biggest customer (as filer) or the supplier most dependent on it (as customer) */
  top: { name: string; share: number; role: "customer" | "supplier" } | null;
};
export const COMPANY_INDEX_KEY = "cache:company-index:v2";

const slugOf = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const SLUG_SQL = sql`trim(both '-' from regexp_replace(lower(replace(customer_display, '&', ' and ')), '[^a-z0-9]+', '-', 'g'))`;

/** "CIRRUS LOGIC, INC." -> "Cirrus Logic"; mixed-case names keep their case, legal suffixes go. */
export function displayName(raw: string): string {
  let s = raw.trim().replace(/\s*\/[A-Z]{1,4}\/?\s*$/, "");
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
  s = s.replace(/[,\s]+(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|l\.p|n\.v|s\.a|sa|ag|se)\.?$/i, "").replace(/[,\s]+(inc|corp|ltd)\.?$/i, "");
  s = s.replace(/,$/, "").trim();
  // "BALL Corp" -> "BALL" -> "Ball"; short all-caps names stay (IBM, AT&T)
  if (/^(nvidia|ametek|caci|asml|idexx)$/i.test(s)) return s.toUpperCase(); // brands written in capitals
  return /^[A-Z]{4,}$/.test(s) ? s[0] + s.slice(1).toLowerCase() : s;
}

type Fact = { filerCik: string; filerTicker: string; filerName: string; customer: string; customerTicker: string | null; customerSlug: string;
  period: string; share: number; filedAt: string; url: string };

// one share per (filer, customer, fiscal period): the most recently filed value (restatements win)
async function facts(where: ReturnType<typeof sql>): Promise<Fact[]> {
  const r = await sql<Fact>`
    SELECT DISTINCT ON (filer_cik, coalesce(customer_ticker, customer_display), period_end)
      filer_cik AS "filerCik", filer_ticker AS "filerTicker", filer_name AS "filerName", customer_display AS customer,
      customer_ticker AS "customerTicker", coalesce(lower(customer_ticker), ${SLUG_SQL}) AS "customerSlug",
      period_end::date::text AS period, share, filed_at::date::text AS "filedAt", doc_url AS url
    FROM customer_concentration_facts
    WHERE entry_kind = 'customer' AND benchmark = 'revenue' AND customer_display IS NOT NULL AND ${where}
    ORDER BY filer_cik, coalesce(customer_ticker, customer_display), period_end, filed_at DESC`.execute(db);
  return r.rows.map((x) => ({ ...x, share: Number(x.share) }));
}

function relations(list: Fact[], key: (f: Fact) => string, meta: (f: Fact) => { name: string; ticker: string | null; slug: string }, latestPeriodOf: (f: Fact) => string | null): Relation[] {
  const by = new Map<string, Fact[]>();
  for (const f of list) by.set(key(f), [...(by.get(key(f)) ?? []), f]);
  const out: Relation[] = [];
  for (const fs of by.values()) {
    const hist = fs.sort((a, b) => a.period.localeCompare(b.period)).map((f) => ({ period: f.period, share: f.share, filedAt: f.filedAt, url: f.url }));
    const latest = hist[hist.length - 1];
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const lp = latestPeriodOf(fs[0]);
    const current = !!lp && latest.period === lp;
    // year-on-year: previous fiscal year must be within ~13 months, otherwise the customer was below 10% in between
    const prevAdjacent = prev && Date.parse(latest.period) - Date.parse(prev.period) < 400 * 86_400_000 ? prev : null;
    const change: Relation["change"] = !current ? null
      : !prevAdjacent ? { kind: "new", from: null }
      : Math.abs(latest.share - prevAdjacent.share) >= 0.05 ? { kind: latest.share > prevAdjacent.share ? "up" : "down", from: prevAdjacent.share }
      : { kind: "steady", from: prevAdjacent.share };
    out.push({ ...meta(fs[0]), latest, history: hist, current, change });
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || b.latest.share - a.latest.share);
}

async function latestPeriods(ciks: string[]): Promise<Map<string, string>> {
  if (!ciks.length) return new Map();
  const r = await sql<{ cik: string; p: string }>`
    SELECT filer_cik AS cik, max(period_end)::date::text AS p FROM customer_concentration_facts
    WHERE benchmark = 'revenue' AND filer_cik IN (${sql.join(ciks)}) GROUP BY filer_cik`.execute(db);
  return new Map(r.rows.map((x) => [x.cik, x.p]));
}

export const companyDependencies = {
  slugOf,

  async page(rawSlug: string): Promise<CompanyPage | null> {
    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 80);
    if (!slug) return null;
    const ticker = slug.toUpperCase();
    const [asFiler, asCustomer] = await Promise.all([
      facts(sql`upper(filer_ticker) = ${ticker}`),
      facts(sql`(upper(customer_ticker) = ${ticker} OR (customer_ticker IS NULL AND ${SLUG_SQL} = ${slug}))`),
    ]);
    if (!asFiler.length && !asCustomer.length) return null;
    const periods = await latestPeriods([...new Set([...asFiler, ...asCustomer].map((f) => f.filerCik))]);
    const customers = relations(asFiler, (f) => f.customerSlug, (f) => ({ name: f.customer, ticker: f.customerTicker, slug: f.customerSlug }), (f) => periods.get(f.filerCik) ?? null);
    const suppliers = relations(asCustomer, (f) => f.filerCik, (f) => ({ name: displayName(f.filerName), ticker: f.filerTicker, slug: f.filerTicker.toLowerCase() }), (f) => periods.get(f.filerCik) ?? null);
    const filer = asFiler[0];
    const name = filer ? displayName(filer.filerName) : asCustomer[0].customer;
    const lp = filer ? periods.get(filer.filerCik) ?? null : null;
    const all = [...asFiler, ...asCustomer];
    return {
      slug, name, ticker: filer?.filerTicker ?? asCustomer[0]?.customerTicker ?? null, cik: filer?.filerCik ?? null,
      customers, suppliers,
      firstPeriod: all.map((f) => f.period).sort()[0] ?? null,
      lastFiled: all.map((f) => f.filedAt).sort().reverse()[0] ?? null,
      latestPeriod: lp,
      concentration: lp ? asFiler.filter((f) => f.period === lp).reduce((s, f) => s + f.share, 0) : null,
    };
  },

  /** Every company with at least one disclosed relationship, cached 6 h (cleared by the daily SEC scan). */
  async index(): Promise<CompanyIndexEntry[]> {
    const key = COMPANY_INDEX_KEY;
    const c = (await mppStore.get(key)) as { at: number; list: CompanyIndexEntry[] } | null;
    if (c && Date.now() - c.at < 6 * 3600_000) return c.list;
    const [filers, custs, all] = await Promise.all([
      sql<{ slug: string; name: string; ticker: string; n: number }>`
        SELECT lower(filer_ticker) AS slug, max(filer_name) AS name, filer_ticker AS ticker, count(DISTINCT coalesce(customer_ticker, customer_display))::int AS n
        FROM customer_concentration_facts WHERE entry_kind = 'customer' AND benchmark = 'revenue' GROUP BY filer_ticker`.execute(db),
      sql<{ slug: string; name: string; ticker: string | null; n: number }>`
        SELECT coalesce(lower(customer_ticker), ${SLUG_SQL}) AS slug, max(customer_display) AS name, max(customer_ticker) AS ticker, count(DISTINCT filer_cik)::int AS n
        FROM customer_concentration_facts WHERE entry_kind = 'customer' AND benchmark = 'revenue' AND customer_display IS NOT NULL
        GROUP BY 1`.execute(db),
      facts(sql`true`),
    ]);
    // top relationship in each filer's latest fiscal period
    const lp = new Map<string, string>();
    for (const f of all) if (!lp.has(f.filerCik) || f.period > lp.get(f.filerCik)!) lp.set(f.filerCik, f.period);
    const topAsFiler = new Map<string, { name: string; share: number }>();
    const topAsCustomer = new Map<string, { name: string; share: number }>();
    for (const f of all) {
      if (f.period !== lp.get(f.filerCik)) continue;
      const fs = f.filerTicker.toLowerCase();
      if ((topAsFiler.get(fs)?.share ?? 0) < f.share) topAsFiler.set(fs, { name: f.customer, share: f.share });
      if ((topAsCustomer.get(f.customerSlug)?.share ?? 0) < f.share) topAsCustomer.set(f.customerSlug, { name: displayName(f.filerName), share: f.share });
    }
    const by = new Map<string, CompanyIndexEntry>();
    for (const f of filers.rows) {
      const t = topAsFiler.get(f.slug);
      by.set(f.slug, { slug: f.slug, name: displayName(f.name), ticker: f.ticker, customers: f.n, suppliers: 0, top: t ? { ...t, role: "customer" } : null });
    }
    for (const c2 of custs.rows) {
      if (!c2.slug) continue;
      const cur = by.get(c2.slug);
      const t = topAsCustomer.get(c2.slug);
      if (cur) { cur.suppliers = c2.n; if (!cur.top && t) cur.top = { ...t, role: "supplier" }; }
      else by.set(c2.slug, { slug: c2.slug, name: c2.name, ticker: c2.ticker, customers: 0, suppliers: c2.n, top: t ? { ...t, role: "supplier" } : null });
    }
    const list = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
    await mppStore.put(key, { at: Date.now(), list });
    return list;
  },

  /** Company pages matching a typed name or ticker (header search, /search). */
  async search(q: string, limit = 6): Promise<CompanyIndexEntry[]> {
    return rankCompanies(await this.index(), q, limit);
  },
};
