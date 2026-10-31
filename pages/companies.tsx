import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { CompanySearch } from "../components/CompanySearch";
import { getCompanyIndex } from "../endpoints/company/index_GET.schema";
import { getCompanyChanges } from "../endpoints/company/changes_GET.schema";
import { SITE_URL } from "../helpers/site";
import styles from "./companies.module.css";

const letterOf = (name: string) => (/^[a-z]/i.test(name) ? name[0].toUpperCase() : "#");

/** A–Z of every company in the SEC customer-concentration data, with a filter. Server-rendered for crawlers. */
export default function CompaniesPage() {
  const q = useQuery({ queryKey: ["company-index"], queryFn: getCompanyIndex, staleTime: 3600_000 });
  const ch = useQuery({ queryKey: ["company-changes"], queryFn: getCompanyChanges, staleTime: 1800_000 });
  const [filter, setFilter] = useState("");
  const list = q.data?.companies ?? [];
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? list.filter((c) => c.name.toLowerCase().includes(f) || (c.ticker ?? "").toLowerCase() === f) : list;
  }, [list, filter]);
  const groups = useMemo(() => {
    const g = new Map<string, typeof shown>();
    for (const c of shown) g.set(letterOf(c.name), [...(g.get(letterOf(c.name)) ?? []), c]);
    return [...g.entries()].sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0].localeCompare(b[0])));
  }, [shown]);
  const mostDepended = [...list].sort((a, b) => b.suppliers - a.suppliers).slice(0, 8);
  const desc = `${list.length.toLocaleString("en-GB")} companies and their major customers from SEC annual filings: who depends on whom, by share of revenue, year by year since 2011.`;

  return (
    <>
      <Helmet>
        <title>Major customers and revenue dependence of listed companies · ShadowGraph</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={`${SITE_URL}/companies`} />
        <meta property="og:title" content="Who depends on whom: major customers of listed companies" />
        <meta property="og:description" content={desc} />
      </Helmet>
      <SiteHeader active="data" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>SEC filings · customer concentration</span>
          <h1 className={styles.h1}>Who depends on whom</h1>
          <p className={styles.lead}>Every company that appears in the major-customer disclosures of SEC annual reports: its customers worth 10% or more of revenue, the listed suppliers that depend on it, and how those shares moved year by year.</p>
          <div className={styles.search}><CompanySearch /></div>
          <p className={styles.try}>Try {[["Apple", "aapl"], ["Walmart", "wmt"], ["NVIDIA", "nvda"], ["U.S. Government", "u-s-government"], ["Fabrinet", "fn"]].map(([n, s], i) => <span key={s}>{i ? ", " : ""}<a href={`/company/${s}`}>{n}</a></span>)}</p>
        </header>

        {(ch.data?.filings.length ?? 0) > 0 && (
          <section>
            <h2 className={styles.h2}>Latest changes</h2>
            <p className={styles.muted}>Annual reports of the last 90 days in which a major customer was added, dropped, or moved by 5 points or more.</p>
            <ul className={styles.changes}>{ch.data!.filings.slice(0, 12).map((f) => (
              <li key={f.accession}>
                <div className={styles.changeHead}><a href={`/company/${f.filerSlug}`}>{f.filerName}</a><span>{f.form} · filed {f.filedAt}</span></div>
                <ul>{f.lines.map((l) => <li key={l.slug + l.kind} className={styles[`k_${l.kind}`]}>{l.text}</li>)}</ul>
              </li>
            ))}</ul>
          </section>
        )}

        {mostDepended.length > 0 && (
          <section>
            <h2 className={styles.h2}>Most depended on</h2>
            <div className={styles.chips}>{mostDepended.map((c) => <a key={c.slug} href={`/company/${c.slug}`}>{c.name}<small>{c.suppliers} suppliers</small></a>)}</div>
          </section>
        )}

        <section>
          <div className={styles.head}>
            <h2 className={styles.h2}>All companies <span className={styles.count}>{list.length.toLocaleString("en-GB")}</span></h2>
            <input className={styles.filter} placeholder="Filter by name or ticker" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter companies" />
          </div>
          <nav className={styles.letters} aria-label="Jump to letter">{groups.map(([l]) => <a key={l} href={`#l-${l}`}>{l}</a>)}</nav>
          {q.isLoading && <p className={styles.muted}>Loading…</p>}
          {groups.map(([l, cs]) => (
            <div key={l} id={`l-${l}`} className={styles.group}>
              <h3 className={styles.letter}>{l}</h3>
              <ul className={styles.list}>{cs.map((c) => (
                <li key={c.slug}><a href={`/company/${c.slug}`}>{c.name}</a>
                  <small>{[c.ticker && /^[A-Z.]{1,6}$/.test(c.ticker) ? c.ticker : null, c.customers ? `${c.customers} customer${c.customers === 1 ? "" : "s"}` : null, c.suppliers ? `${c.suppliers} supplier${c.suppliers === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</small></li>
              ))}</ul>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
