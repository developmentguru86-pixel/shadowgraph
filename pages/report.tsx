import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getReportInternet, type OutputType as Report } from "../endpoints/report_internet_GET.schema";
import { useScrollReveal } from "../helpers/useScrollReveal";
import styles from "./report.module.css";

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));

function Bars({ rows, max }: { rows: Array<{ name: string; share: number; services: number }>; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.share), 0.01);
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.name} className={styles.bar}>
          <span className={styles.barName}>{r.name}</span>
          <span className={styles.track}><i style={{ width: `${(r.share / top) * 100}%` }} /></span>
          <span className={styles.barVal}>{pct(r.share, 1)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportPage() {
  // server-rendered via report.prefetch.ts, so search engines and link previews see the real numbers
  const q = useQuery({ queryKey: ["report-internet"], queryFn: () => getReportInternet(), staleTime: 30 * 60_000 });
  const r: Report | null = q.data ?? null;
  const failed = q.isError;
  const s1 = useScrollReveal(), s2 = useScrollReveal(), s3 = useScrollReveal(), s4 = useScrollReveal(), s5 = useScrollReveal(), s6 = useScrollReveal();

  const aws = r?.blastRadius.find((b) => b.name === "AWS");
  const cf = r?.blastRadius.find((b) => b.name === "Cloudflare");
  const cdnShare = r ? r.coverage.behindCdn / Math.max(r.coverage.servicesMapped, 1) : null;
  const blastMax = r ? Math.max(...r.blastRadius.map((b) => b.services), 1) : 1;
  const description = aws && cf
    ? `One AWS problem can reach ${pct(aws.share)} of the services we monitor, Cloudflare ${pct(cf.share)}. A data report on cloud, CDN, DNS and email concentration, refreshed daily.`
    : "Which cloud, CDN, DNS and email providers carry the internet? A data report on the hidden dependencies behind 3,000+ monitored services, refreshed daily.";

  return (
    <>
      <Helmet>
        <title>Who runs the internet? The hidden dependencies behind 3,000+ services · ShadowGraph report</title>
        <meta name="description" content={description} />
        <meta property="og:title" content="Who runs the internet? A data report on hidden dependencies" />
        <meta property="og:description" content={description} />
      </Helmet>
      <SiteHeader />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>ShadowGraph report · data as of {r?.asOf ?? "—"}</span>
          <h1 className={styles.h1}>Who runs the internet?</h1>
          <p className={styles.lead}>
            We mapped the infrastructure behind {fmt(r?.coverage.servicesMapped)} APIs, SaaS platforms, banks, shops and media sites,
            and probed them every five minutes. The internet looks decentralised from the outside. Underneath, a handful of companies
            carry most of it.
          </p>
          {failed && <p className={styles.warn}>The report is temporarily unavailable.</p>}
        </header>

        <section className={styles.findings} aria-label="Key findings">
          <article><b>{pct(aws?.share)}</b><p>of monitored services depend on <strong>AWS</strong> for hosting, CDN or DNS. One AWS incident can reach all of them.</p></article>
          <article><b>{pct(cf?.share)}</b><p>depend on <strong>Cloudflare</strong>, mostly as their edge network and DNS.</p></article>
          <article><b>{pct(cdnShare)}</b><p>sit behind a <strong>CDN</strong>. Their real hosting is invisible from outside, and so is part of their risk.</p></article>
          <article><b>{pct(r?.singleVendor.share)}</b><p>run hosting, DNS and edge on <strong>one single vendor</strong>: no independent layer left.</p></article>
        </section>

        <section ref={s1} className={`${styles.section} ${styles.reveal}`}>
          <div className={styles.sHead}><span className={styles.num}>01</span><h2 className={styles.h2}>The blast radius ranking</h2></div>
          <p className={styles.body}>How many services would be touched if a provider failed, counting every layer we can see: hosting, CDN/edge and DNS.</p>
          <div className={styles.blast}>
            {r?.blastRadius.map((b) => (
              <div key={b.name} className={styles.blastRow}>
                <span className={styles.blastName}>{b.name}</span>
                <span className={styles.blastTrack}><i style={{ width: `${(b.services / blastMax) * 100}%` }} /></span>
                <span className={styles.blastVal}>{fmt(b.services)} <small>{pct(b.share)}</small></span>
                <span className={styles.blastVia}>hosting {b.viaHosting} · CDN {b.viaCdn} · DNS {b.viaDns}</span>
              </div>
            ))}
          </div>
        </section>

        <section ref={s2} className={`${styles.section} ${styles.reveal}`}>
          <div className={styles.sHead}><span className={styles.num}>02</span><h2 className={styles.h2}>Four layers, four oligopolies</h2></div>
          <div className={styles.layers}>
            <div><h3>Hosting</h3>{r && <Bars rows={r.hosting} />}</div>
            <div><h3>CDN / edge</h3>{r && <Bars rows={r.cdn} />}</div>
            <div><h3>DNS</h3>{r && <Bars rows={r.dns} />}</div>
            <div><h3>Email</h3>{r && <Bars rows={r.email} />}</div>
          </div>
          <p className={styles.note}>Share of all mapped services. Hosting is only visible for services not hidden behind a CDN, so hosting shares are lower bounds.</p>
        </section>

        <section ref={s3} className={`${styles.section} ${styles.reveal}`}>
          <div className={styles.sHead}><span className={styles.num}>03</span><h2 className={styles.h2}>Every sector has its single point of failure</h2></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Sector</th><th className={styles.r}>Services</th><th>Largest dependency</th><th className={styles.r}>Share</th></tr></thead>
              <tbody>{r?.categories.slice(0, 16).map((c) => (
                <tr key={c.category}><td>{c.category}</td><td className={styles.r}>{c.services}</td><td>{c.topDependency ?? "—"}</td><td className={styles.r}><span className={styles.mini}><i style={{ width: `${c.topShare * 100}%` }} /></span>{pct(c.topShare)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section ref={s4} className={`${styles.section} ${styles.split} ${styles.reveal}`}>
          <div>
            <div className={styles.sHead}><span className={styles.num}>04</span><h2 className={styles.h2}>All eggs, one basket</h2></div>
            <p className={styles.body}>{fmt(r?.singleVendor.services)} services ({pct(r?.singleVendor.share)}) run their hosting, DNS and edge on the same provider. If that provider has a bad day, there is no independent layer left to route around it.</p>
            <div className={styles.chips}>{r?.singleVendor.byFamily.map((f) => <span key={f.name}>{f.name} <b>{f.services}</b></span>)}</div>
          </div>
          <div className={styles.examples}><span className={styles.label}>Examples</span>{r?.singleVendor.examples.map((e) => <span key={e}>{e}</span>)}</div>
        </section>

        <section ref={s5} className={`${styles.section} ${styles.reveal}`}>
          <div className={styles.sHead}><span className={styles.num}>05</span><h2 className={styles.h2}>Money has the same shape</h2></div>
          <p className={styles.body}>From official SEC filings: {fmt(r?.sec.relationships)} disclosed customer-to-supplier revenue links across {fmt(r?.sec.suppliers)} companies. {fmt(r?.sec.majorityDependent)} of them earn more than half of their revenue from a single customer.</p>
          <div className={styles.split2}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Supplier</th><th>Single customer</th><th className={styles.r}>Revenue share</th></tr></thead>
                <tbody>{r?.sec.topMajority.map((m) => (
                  <tr key={`${m.supplierTicker}${m.customer}`}><td>{m.supplier} <span className={styles.tick}>{m.supplierTicker}</span></td><td>{m.customer}</td><td className={styles.r}><a href={m.sourceUrl} target="_blank" rel="noopener">{pct(m.share)}</a></td></tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <span className={styles.label}>Customers with the most dependent suppliers</span>
              <ol className={styles.hubs}>{r?.sec.hubs.map((h) => <li key={h.ticker}><span>{h.name}</span><b>{h.suppliers}</b></li>)}</ol>
            </div>
          </div>
        </section>

        <section ref={s6} className={`${styles.section} ${styles.method} ${styles.reveal}`}>
          <div>
            <h2 className={styles.h2}>Method and limits</h2>
            <ul>{r?.method.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className={styles.note}>Measured reachability over the last 7 days: {pct(r?.reliability.uptime7d, 2)} across {fmt(r?.coverage.probes7d)} probes; {fmt(r?.reliability.incidents30d)} provider incidents detected in 30 days.</p>
          </div>
          <div className={styles.cite}>
            <span className={styles.label}>Cite this report</span>
            <p>ShadowGraph ({r?.asOf.slice(0, 4) ?? "2026"}). <em>Who runs the internet? Hidden dependencies behind critical services.</em> Data as of {r?.asOf ?? "—"}. https://shadowalpha.online/report</p>
            <a href="/_api/report/internet" target="_blank" rel="noopener">Download the data (JSON)</a>
            <a href="/radar">See it live on the radar</a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}