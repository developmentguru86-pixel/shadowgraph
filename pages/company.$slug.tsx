import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { WatchForm } from "../components/WatchForm";
import { CompanySearch } from "../components/CompanySearch";
import { getCompanyPage } from "../endpoints/company/page_GET.schema";
import type { CompanyPage, Relation, ShareYear } from "../helpers/companyDependencies";
import { SITE_URL } from "../helpers/site";
import styles from "./company.$slug.module.css";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fy = (iso: string) => `FY ${iso.slice(0, 4)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const tickerLabel = (t: string | null) => (t && /^[A-Z.]{1,6}$/.test(t) ? t : null);

/** Year-by-year share as small bars, oldest left. Gaps (years below the 10% line) stay empty. */
function Spark({ history }: { history: ShareYear[] }) {
  const first = Number(history[0].period.slice(0, 4)), last = Number(history[history.length - 1].period.slice(0, 4));
  const years = Array.from({ length: Math.min(16, last - first + 1) }, (_, i) => last - Math.min(16, last - first + 1) + 1 + i);
  const by = new Map(history.map((h) => [Number(h.period.slice(0, 4)), h.share]));
  const w = 7, gap = 2, H = 26;
  return (
    <svg className={styles.spark} width={years.length * (w + gap)} height={H} viewBox={`0 0 ${years.length * (w + gap)} ${H}`} role="img"
      aria-label={history.map((h) => `${fy(h.period)} ${pct(h.share)}`).join(", ")}>
      {years.map((y, i) => {
        const s = by.get(y);
        return s === undefined
          ? <rect key={y} x={i * (w + gap)} y={H - 1} width={w} height={1} className={styles.sparkGap} />
          : <rect key={y} x={i * (w + gap)} y={H - Math.max(2, s * H)} width={w} height={Math.max(2, s * H)} className={styles.sparkBar}><title>{`${fy(String(y))}: ${pct(s)}`}</title></rect>;
      })}
    </svg>
  );
}

function ChangeTag({ r }: { r: Relation }) {
  if (!r.current) return <span className={`${styles.tag} ${styles.tagOld}`}>last {fy(r.latest.period)}</span>;
  if (!r.change) return null;
  if (r.change.kind === "new") return <span className={`${styles.tag} ${styles.tagNew}`}>new</span>;
  if (r.change.kind === "steady") return <span className={styles.tag}>from {pct(r.change.from ?? 0)}</span>;
  return <span className={`${styles.tag} ${r.change.kind === "up" ? styles.tagUp : styles.tagDown}`}>{r.change.kind === "up" ? "▲" : "▼"} from {pct(r.change.from ?? 0)}</span>;
}

function Table({ rows, who }: { rows: Relation[]; who: "customer" | "supplier" }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>
          <th>{who === "customer" ? "Customer" : "Supplier"}</th>
          <th className={styles.num}>{who === "customer" ? "Share of revenue" : "Its revenue from this company"}</th>
          <th>Change vs prior year</th><th>History</th><th>Latest filing</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.slug} className={r.current ? undefined : styles.past}>
            <td><a href={`/company/${r.slug}`} className={styles.name}>{r.name}</a>{tickerLabel(r.ticker) && <span className={styles.ticker}>{r.ticker}</span>}</td>
            <td className={styles.num}><span className={styles.bar}><i style={{ width: `${Math.min(100, r.latest.share * 100)}%` }} /></span>{pct(r.latest.share)}</td>
            <td><ChangeTag r={r} /></td>
            <td><Spark history={r.history} /><span className={styles.years}>{r.history.length} {r.history.length === 1 ? "year" : "years"}</span></td>
            <td><a className={styles.link} href={r.latest.url} target="_blank" rel="noopener noreferrer">{fy(r.latest.period)} · filed {day(r.latest.filedAt)}</a></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function summary(d: CompanyPage): string {
  const top = d.customers.find((c) => c.current);
  const dep = d.suppliers.filter((s) => s.current);
  const parts: string[] = [];
  if (top) parts.push(`${top.name} accounted for ${pct(top.latest.share)} of ${d.name}'s revenue in ${fy(top.latest.period)}${top.change?.from != null ? `, ${top.change.kind === "steady" ? "about the same as" : top.change.kind === "up" ? "up from" : "down from"} ${pct(top.change.from)} a year earlier` : ""}.`);
  if (dep.length) parts.push(`${dep.length} listed ${dep.length === 1 ? "supplier reports" : "suppliers report"} ${d.name} as a customer worth 10% or more of their revenue${dep[0] ? `, led by ${dep[0].name} at ${pct(dep[0].latest.share)}` : ""}.`);
  if (!parts.length) parts.push(`${d.name} appears in ${d.customers.length + d.suppliers.length} disclosed customer relationships between ${d.firstPeriod?.slice(0, 4)} and ${d.lastFiled?.slice(0, 4)}.`);
  return parts.join(" ");
}

export default function CompanyDependencyPage() {
  const { slug: raw = "" } = useParams();
  const slug = decodeURIComponent(raw).toLowerCase();
  const q = useQuery({ queryKey: ["company", slug], queryFn: () => getCompanyPage(slug), retry: false, staleTime: 3600_000 });
  const d = q.data;
  const t = tickerLabel(d?.ticker ?? null);
  const label = d ? `${d.name}${t ? ` (${t})` : ""}` : slug.toUpperCase();
  const asCustomerMain = d ? d.suppliers.length > 0 && d.customers.length === 0 : false;
  const title = !d ? "Company not found · ShadowGraph"
    : asCustomerMain ? `Who depends on ${label}? Suppliers by revenue share · ShadowGraph`
    : `${label} major customers: revenue concentration since ${d.firstPeriod?.slice(0, 4)} · ShadowGraph`;
  const desc = d ? `${summary(d)} From SEC annual filings, year by year, with links to every filing.` : "";
  const url = `${SITE_URL}/company/${slug}`;
  const currentCustomers = d?.customers.filter((c) => c.current) ?? [];
  const pastCustomers = d?.customers.filter((c) => !c.current) ?? [];
  const currentSuppliers = d?.suppliers.filter((c) => c.current) ?? [];
  const pastSuppliers = d?.suppliers.filter((c) => !c.current) ?? [];

  return (
    <>
      <Helmet>
        <title>{title}</title>
        {d && <meta name="description" content={desc} />}
        {d && <link rel="canonical" href={url} />}
        {d && <meta property="og:title" content={title.replace(" · ShadowGraph", "")} />}
        {d && <meta property="og:description" content={desc} />}
        {d && <meta property="og:url" content={url} />}
        {!d && q.isError && <meta name="robots" content="noindex" />}
        {d && <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Companies", item: `${SITE_URL}/companies` },
            { "@type": "ListItem", position: 2, name: d.name, item: url },
          ],
        })}</script>}
      </Helmet>
      <SiteHeader active="data" />
      <main className={styles.page}>
        <div className={styles.topbar}>
          <nav className={styles.crumbs} aria-label="Breadcrumb"><a href="/companies">Companies</a><span>/</span><span>{d?.name ?? slug.toUpperCase()}</span></nav>
          <CompanySearch size="compact" placeholder="Another company or ticker" />
        </div>
        {q.isLoading && <p className={styles.muted}>Loading…</p>}
        {q.isError && <><h1 className={styles.h1}>No disclosed customer relationships for “{slug}”</h1><p className={styles.lead}>We only list companies that appear in the major-customer disclosures of SEC annual filings. <a href="/companies">Browse all companies</a>.</p></>}
        {d && (
          <>
            <header className={styles.hero}>
              <span className={styles.eyebrow}>SEC filings · customer concentration{t ? ` · ${t}` : ""}</span>
              <h1 className={styles.h1}>{asCustomerMain ? <>Who depends on {d.name}</> : <>{d.name}'s major customers</>}</h1>
              <p className={styles.lead}>{summary(d)}</p>
            </header>

            <section className={styles.stats} aria-label="Overview">
              <div><b>{currentCustomers.length}</b><span>major customers now</span></div>
              <div><b>{d.concentration != null && currentCustomers.length ? pct(d.concentration) : "—"}</b><span>of revenue from them</span></div>
              <div><b>{currentSuppliers.length}</b><span>listed suppliers depending on it</span></div>
              <div><b>{d.firstPeriod ? `${d.firstPeriod.slice(0, 4)}–${(d.lastFiled ?? "").slice(0, 4)}` : "—"}</b><span>years covered</span></div>
            </section>

            <WatchForm slug={d.slug} name={d.name} source={`company:${d.slug}`} />

            {d.customers.length > 0 && (
              <section className={styles.sec}>
                <h2 className={styles.h2}>Major customers of {d.name}</h2>
                <p className={styles.muted}>Customers that {d.name} named in its annual report as 10% or more of revenue. A missing year means the customer was below that line or not named.</p>
                {currentCustomers.length > 0 && <Table rows={currentCustomers} who="customer" />}
                {pastCustomers.length > 0 && <><h3 className={styles.h3}>Formerly disclosed</h3><Table rows={pastCustomers} who="customer" /></>}
              </section>
            )}

            {d.suppliers.length > 0 && (
              <section className={styles.sec}>
                <h2 className={styles.h2}>Suppliers that depend on {d.name}</h2>
                <p className={styles.muted}>Listed companies whose annual report names {d.name} as a customer worth 10% or more of their revenue. If {d.name} cuts orders or switches supplier, these are the companies that feel it.</p>
                {currentSuppliers.length > 0 && <Table rows={currentSuppliers} who="supplier" />}
                {pastSuppliers.length > 0 && <><h3 className={styles.h3}>Formerly disclosed</h3><Table rows={pastSuppliers} who="supplier" /></>}
              </section>
            )}

            <section className={styles.note}>
              <h2 className={styles.h2}>About this data</h2>
              <p>US-listed companies must disclose revenue from any single customer that reaches 10% of their total (ASC 280). ShadowGraph reads these disclosures from the XBRL data of every 10-K and 20-F we scan, keeps one value per fiscal year (restatements replace earlier values) and links each number to its filing. Companies that describe a customer only as "Customer A" are not listed by name. Figures are as reported; nothing here is investment advice.</p>
              <p><a href="/companies">All companies</a> · <a href="/signals">Latest dependency shifts</a> · <a href="/data">Bulk data and API</a></p>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
