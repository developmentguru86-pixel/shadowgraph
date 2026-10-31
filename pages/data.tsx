import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { Button } from "../components/Button";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getDatasetSample, type OutputType as Sample } from "../endpoints/dataset_sample_GET.schema";
import { postDatasetCheckout } from "../endpoints/dataset_checkout_POST.schema";
import { postDatasetClaim, type OutputType as Claim } from "../endpoints/dataset_claim_POST.schema";
import styles from "./data.module.css";

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value ?? "—"}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function ClaimPanel({ sessionId }: { sessionId: string }) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    postDatasetClaim({ sessionId }).then(setClaim).catch(() => setClaim({ status: "not_found" }));
  }, [sessionId]);
  if (!claim) return <section className={styles.claim}><p className={styles.muted}>Confirming your payment with Stripe…</p></section>;
  if (claim.status === "issued") {
    return (
      <section className={styles.claim}>
        <h2 className={styles.h2}>Your API key</h2>
        <p className={styles.warn}>Shown once. Copy it now and store it like a password; we only keep a hash.</p>
        <div className={styles.keyRow}>
          <code className={styles.key}>{claim.key}</code>
          <Button size="sm" onClick={() => { navigator.clipboard.writeText(claim.key); setCopied(true); }}>{copied ? "Copied" : "Copy"}</Button>
        </div>
        <pre className={styles.code}>{`curl -H "Authorization: Bearer ${claim.key}" \\\n  "https://shadowalpha.online/_api/dataset/full?format=csv" -o dependencies.csv`}</pre>
      </section>
    );
  }
  const msg = claim.status === "already_claimed"
    ? "This purchase already received its key. If you lost it, reply to your Stripe receipt email and we will rotate it."
    : claim.status === "not_paid"
      ? "Stripe has not confirmed this payment yet. Refresh in a minute."
      : "We could not find this checkout session.";
  return <section className={styles.claim}><p className={styles.muted}>{msg}</p></section>;
}

export default function DataPage() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [error, setError] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const sessionId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("session_id") : null;

  useEffect(() => { getDatasetSample().then(setSample).catch(() => setError(true)); }, []);

  const subscribe = async () => {
    setCheckingOut(true); setCheckoutError(null);
    try { window.location.href = (await postDatasetCheckout()).url!; }
    catch (e) { setCheckoutError(e instanceof Error ? e.message : "Checkout unavailable"); setCheckingOut(false); }
  };
  const s = sample?.stats;

  return (
    <>
    <SiteHeader active="data" />
    <main className={styles.page}>
      <Helmet>
        <title>Supply-Chain Dependency Data · ShadowGraph</title>
        <meta name="description" content="Customer–supplier revenue dependencies extracted from SEC XBRL filings. Every row links to its filing. Weekly refresh, CSV and JSON API." />
        <meta property="og:title" content="ShadowGraph supply-chain dependency data" />
        <meta property="og:description" content="Customer–supplier revenue dependencies extracted from SEC XBRL filings. Every row links to its filing. Weekly refresh, CSV and JSON API." />
      </Helmet>

      <header className={styles.hero}>
        <span className={styles.eyebrow}>Dataset · SEC XBRL · weekly refresh</span>
        <h1 className={styles.h1}>Who depends on whom, in revenue terms</h1>
        <p className={styles.lead}>
          Every disclosed major-customer relationship we can verify in SEC annual filings: the customer, the supplier,
          the share of the supplier's revenue, the fiscal period and the filing date. Each row links to the source document.
        </p>
        <p className={styles.lead} style={{ marginTop: 12 }}>
          Looking at a few companies? Every company has a free page with its major customers year by year and the suppliers that depend on it:{" "}
          <a className={styles.link} href="/companies" style={{ fontSize: "0.95rem" }}>browse companies</a>, and get an email when their concentration changes.
        </p>
      </header>

      {sessionId && <ClaimPanel sessionId={sessionId} />}

      <section className={styles.stats} aria-label="Coverage">
        <Stat label="relationships" value={s?.relationships} />
        <Stat label="customer & % both XBRL-tagged" value={s?.official} />
        <Stat label="suppliers" value={s?.suppliers} />
        <Stat label="customers" value={s?.customers} />
        <Stat label="latest filing" value={s?.latestFiling} />
      </section>

      <div className={styles.columns}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.h2}>Free sample</h2>
            <div className={styles.actions}>
              <Button variant="outline" size="sm" asChild><a href="/_api/dataset/sample?format=csv">CSV</a></Button>
              <Button variant="outline" size="sm" asChild><a href="/_api/dataset/sample" target="_blank" rel="noopener">JSON</a></Button>
            </div>
          </div>
          <p className={styles.muted}>Top {sample?.sampleSize ?? 25} relationships by revenue share where the filer tagged both the customer and the percentage.</p>
          {error && <p className={styles.warn}>Source unavailable right now. Try again shortly.</p>}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Customer</th><th>Supplier</th><th className={styles.num}>Share of supplier revenue</th><th>Period</th><th>Source</th></tr></thead>
              <tbody>
                {!sample && !error && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={5}><span className={styles.skeleton} /></td></tr>
                ))}
                {sample?.rows.map((r) => (
                  <tr key={`${r.customer}|${r.supplierCik}`}>
                    <td><span className={styles.name}>{r.customer}</span>{r.customerTicker && <span className={styles.ticker}>{r.customerTicker}</span>}</td>
                    <td><span className={styles.name}>{r.supplier}</span><span className={styles.ticker}>{r.supplierTicker}</span></td>
                    <td className={styles.num}>
                      <span className={styles.bar}><i style={{ width: `${Math.max(2, r.revenueShare * 100)}%` }} /></span>
                      {pct(r.revenueShare)}
                    </td>
                    <td className={styles.mono}>{r.fiscalPeriodEnd}</td>
                    <td><a className={styles.link} href={r.sourceUrl} target="_blank" rel="noopener">{r.form} · {r.filedAt}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={styles.side}>
          <section className={`${styles.card} ${styles.price}`}>
            <span className={styles.eyebrow}>Full dataset</span>
            <div className={styles.amount}>{sample?.price ?? "$99 / month"}</div>
            <ul className={styles.list}>
              <li>All {s?.relationships ?? "—"} relationships, refreshed weekly as new 10-K / 20-F filings land</li>
              <li>Point-in-time: fiscal period and filing date on every row</li>
              <li>Official vs inferred attribution, with the filing evidence</li>
              <li>CSV download and JSON API with your own key</li>
              <li>Cancel anytime in Stripe</li>
            </ul>
            <Button size="lg" onClick={subscribe} disabled={checkingOut}>{checkingOut ? "Opening Stripe…" : "Subscribe"}</Button>
            {checkoutError && <p className={styles.warn}>{checkoutError}</p>}
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>What this is, and is not</h2>
            <p className={styles.muted}>
              It is verified exposure data: concentration risk, counterparty mapping, supply-chain research.
              It is not a trading signal. Our own event study found suppliers price a major customer's shock on the same day,
              with no significant drift afterwards.
            </p>
            <a className={styles.link} href="/_api/research/customer_momentum" target="_blank" rel="noopener">Read the backtest →</a>
          </section>
        </aside>
      </div>
    </main>
    <SiteFooter />
    </>
  );
}