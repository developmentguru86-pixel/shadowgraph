import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { getVisitorStats, type OutputType } from "../endpoints/visitors/stats_GET.schema";
import type { VisitorSummary } from "../helpers/visitorStats";
import styles from "./stats.module.css";

const KEY = "sg-stats-key", OPT_OUT = "sg-notrack";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const FLAG = (c: string) => (/^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) + " " + c : c);

function List({ title, rows, total, map }: { title: string; rows: Array<{ k: string; n: number }>; total: number; map?: (k: string) => string }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>{title}</h2>
      {rows.length === 0 && <p className={styles.muted}>No data yet.</p>}
      <ul className={styles.list}>
        {rows.map((r) => (
          <li key={r.k}>
            <span className={styles.lk}>{map ? map(r.k) : r.k}</span>
            <span className={styles.track}><i style={{ width: `${Math.max(2, (r.n / Math.max(total, 1)) * 100)}%` }} /></span>
            <b>{r.n}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Owner-only visitor dashboard. Opened with /stats?key=…; the key is remembered in this browser. */
export default function StatsPage() {
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<OutputType | null>(null);
  const [excluded, setExcluded] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    if (fromUrl) { store.set(KEY, fromUrl); window.history.replaceState(null, "", "/stats"); }
    setKey(fromUrl ?? store.get(KEY));
    setExcluded(store.get(OPT_OUT) === "1");
  }, []);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () => getVisitorStats(key).then((d) => alive && setData(d)).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [key]);

  const s: VisitorSummary | null = data && !("error" in data) ? data : null;
  const maxDay = Math.max(1, ...(s?.days ?? []).map((d) => d.visitors));
  const toggleExclude = () => { const next = !excluded; store.set(OPT_OUT, next ? "1" : null); setExcluded(next); };

  return (
    <>
      <Helmet>
        <title>Visitors · ShadowGraph</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <SiteHeader />
      <main className={styles.page}>
        <span className={styles.eyebrow}>Owner · visitor statistics</span>
        <h1 className={styles.h1}>Who visits ShadowGraph</h1>
        <p className={styles.lead}>Unique visitors per day, counted without cookies: a visitor is a daily anonymous fingerprint (IP and browser, hashed with a salt that changes every day; neither is stored). Crawlers and scripts are counted separately and excluded from visitor numbers.{s?.since ? ` Counting since ${fmtDay(s.since)}.` : ""} Since 29 Oct a view counts only after the page was visible for 3 seconds in a real browser, and every browser that opens this page is excluded from the counts (your own visits).</p>

        {!key && <p className={styles.warn}>Open this page with the private link that contains your key.</p>}
        {data && "error" in data && <p className={styles.warn}>The key is not valid.</p>}

        {s && (
          <>
            {s.business && (
              <section className={styles.card}>
                <h2 className={styles.h2}>Business</h2>
                <section className={styles.kpis}>
                  <div><b>{s.business.paid.alerts + s.business.paid.team}</b><span>paying subscriptions ({s.business.paid.team} Team)</span></div>
                  <div><b>{s.business.paid.doraReports}</b><span>DORA reports sold ({s.business.paid.doraReports30} in 30 days)</span></div>
                  <div><b>{s.business.paid.datasetKeys}</b><span>data subscriptions</span></div>
                  <div><b>{s.business.leads.length}</b><span>inbound leads</span></div>
                </section>
                <p className={styles.muted}>Free: {s.business.free.outageAlerts} outage alerts · {s.business.free.concentrationWatches} concentration watches · {s.business.free.vendorScans30} vendor scans in 30 days · {s.business.free.savedBoards} saved boards · {s.business.free.doraFreeReports ?? 0} DORA reports unlocked free (promotion) · {s.business.free.freeStackAlerts ?? 0} free Stack Alerts plans (promotion). Subscriptions without a Stripe subscription (tests, demo) are not counted.</p>
                {s.business.leads.length > 0 && (
                  <ul className={styles.list}>
                    {s.business.leads.map((l) => <li key={l.at + l.source}><span className={styles.lk}>{fmtDay(l.at.slice(0, 10))} · {l.source} · @{l.emailDomain}</span><span className={styles.muted}>{l.note}</span></li>)}
                  </ul>
                )}
              </section>
            )}
            <section className={styles.kpis}>
              <div><b>{s.totals.today}</b><span>visitors today</span></div>
              <div><b>{s.totals.last7}</b><span>last 7 days</span></div>
              <div><b>{s.totals.last30}</b><span>last 30 days</span></div>
              <div><b>{s.totals.pageViews30}</b><span>page views · 30 days</span></div>
              <div><b>{s.totals.bots30}</b><span>crawlers · 30 days</span></div>
            </section>

            <section className={styles.card}>
              <h2 className={styles.h2}>Visitors per day</h2>
              <div className={styles.days}>
                {s.days.map((d) => (
                  <div key={d.day} className={styles.dayRow}>
                    <span className={styles.dayLabel}>{fmtDay(d.day)}</span>
                    <span className={styles.track}><i style={{ width: `${(d.visitors / maxDay) * 100}%` }} /></span>
                    <b>{d.visitors}</b>
                    <span className={styles.dim}>{d.pageViews} views · {d.bots} bots</span>
                    {d.countries?.length > 0 && <span className={styles.dayCountries}>{d.countries.map((c) => `${FLAG(c.k)} ${c.n}`).join(" · ")}</span>}
                  </div>
                ))}
              </div>
            </section>

            <div className={styles.grid}>
              <List title="Pages viewed · 30 days" rows={s.pages} total={s.pages[0]?.n ?? 1} />
              <List title="Where visitors came from" rows={s.referrers} total={s.referrers[0]?.n ?? 1} />
              <List title="Countries" rows={s.countries} total={s.countries[0]?.n ?? 1} map={FLAG} />
              <List title="Landing pages" rows={s.entryPages} total={s.entryPages[0]?.n ?? 1} />
              <List title="Devices" rows={s.devices} total={s.devices[0]?.n ?? 1} />
            </div>
            {s.estimate.days.length > 0 && (
              <section className={`${styles.card} ${styles.estimate}`}>
                <h2 className={styles.h2}>Before exact counting · estimate from server logs</h2>
                <p className={styles.muted}>
                  Exact counting started {s.since ? fmtDay(s.since) : "recently"}. For the days before, visits are reconstructed from the server request log, which has no IP or browser information:
                  a <b>browser load</b> is a page request followed within 15 seconds by the page's own data requests (a browser ran the page; most crawlers do not), and loads are grouped into <b>visits</b> when more than 30 minutes apart.
                  Visitors arriving at the same time merge into one visit, so this is a lower bound, and your own and our test visits are included.
                </p>
                <div className={styles.estTotals}>
                  <div><b>≈ {s.estimate.visits}</b><span>estimated visits</span></div>
                  <div><b>{s.estimate.browserLoads}</b><span>browser page loads</span></div>
                  <div><b>{s.estimate.pageLoads}</b><span>all page loads incl. crawlers</span></div>
                </div>
                <div className={styles.days}>
                  {s.estimate.days.map((d) => (
                    <div key={d.day} className={styles.estRow}>
                      <span className={styles.dayLabel}>{fmtDay(d.day)}</span>
                      <b>≈ {d.visits}</b>
                      <span className={styles.dim}>{d.browserLoads} browser · {d.pageLoads} total</span>
                      <span className={styles.estTop}>{d.topPages}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className={styles.muted}>Updated {new Date(s.generatedAt).toLocaleTimeString("en-GB")} · refreshes every minute.</p>
          </>
        )}

        <section className={styles.card}>
          <h2 className={styles.h2}>Your own visits</h2>
          <p className={styles.muted}>{excluded ? "This browser is excluded: your own visits are not counted." : "This browser is counted like any visitor. Exclude it so your own checks do not inflate the numbers."}</p>
          <button className={styles.btn} onClick={toggleExclude}>{excluded ? "Count this browser again" : "Don't count this browser"}</button>
        </section>
      </main>
    </>
  );
}
