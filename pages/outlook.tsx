import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getRadarOutlook, type OutputType as Outlook } from "../endpoints/radar_outlook_GET.schema";
import styles from "./outlook.module.css";

const FIELD: Record<string, string> = { hosting_provider: "Hosting", hosting_region: "Region", cdn: "CDN", dns_provider: "DNS", email_provider: "Email" };
const RISK: Record<string, string> = { expired: "Expired", critical: "Under 7 days", renewal_overdue: "Renewal overdue", watch: "Renewal window" };
const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export default function OutlookPage() {
  const [d, setD] = useState<Outlook | null>(null);
  const [failed, setFailed] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => getRadarOutlook().then((x) => alive && setD(x)).catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const openWarnings = d?.warnings.filter((w) => !w.closedAt) ?? [];
  const urgentCerts = d?.certificates.filter((c) => c.risk !== "watch") ?? [];
  const watchCerts = d?.certificates.filter((c) => c.risk === "watch") ?? [];
  const tr = d?.trackRecord;

  return (
    <>
      <Helmet>
        <title>Risk outlook: outages you can see coming · ShadowGraph</title>
        <meta name="description" content="Early warnings before outages are declared, with a public track record. Expiring TLS certificates and domains of 3,000+ services. Infrastructure changes as they happen." />
        <meta property="og:title" content="Risk outlook: outages you can see coming" />
        <meta property="og:description" content="Early warnings before outages are declared, with a public track record. Expiring TLS certificates and domains of 3,000+ services. Infrastructure changes as they happen." />
      </Helmet>
      <SiteHeader active="outlook" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Risk outlook · updated every 5 minutes</span>
          <h1 className={styles.h1}>Some outages <em>announce themselves.</em></h1>
          <p className={styles.lead}>Slowdowns before a provider admits a problem. Certificates and domains with a known expiry date. Vendors quietly moving their infrastructure. We watch all of it, and we publish how often our warnings were right.</p>
          {failed && <p className={styles.warn}>Outlook data unavailable right now.</p>}
        </header>

        <section className={styles.section}>
          <div className={styles.sHead}><span className={styles.num}>01</span><h2 className={styles.h2}>Early warnings</h2></div>
          <div className={styles.track}>
            <div><b>{tr ? tr.warnings : "—"}</b><span>warnings in 30 days</span></div>
            <div><b>{tr ? `${tr.confirmed}/${tr.scored}` : "—"}</b><span>confirmed by an incident</span></div>
            <div><b>{tr?.precision != null ? `${Math.round(tr.precision * 100)}%` : "—"}</b><span>hit rate (published)</span></div>
            <div><b>{tr?.medianLeadMinutes != null ? `${tr.medianLeadMinutes} min` : "—"}</b><span>median warning lead time</span></div>
          </div>
          <p className={styles.method}>Rule ew-v2: a warning fires when at least 4 independent organisations, and 30% of a provider, region, CDN or DNS group of 8+ organisations with history, run at 2.5× their own 24-hour median latency (and +400 ms) or start failing; the slow services are re-measured immediately, and the condition must hold in two consecutive sweeps. It counts as confirmed if a provider incident opens on the same group within 30 minutes. Scoring is automatic; nothing is edited by hand. {tr && tr.scored < 10 ? "The track record is still young: treat the hit rate as preliminary until it covers more events." : ""}</p>
          {d?.retiredRule && (
            <p className={styles.retired}><b>Retired rule {d.retiredRule.rule} ({d.retiredRule.retiredAt}):</b> {d.retiredRule.confirmed} of {d.retiredRule.scored} scored warnings were confirmed. {d.retiredRule.reason} We replaced it rather than hide its record.</p>
          )}
          {d && openWarnings.length === 0 && <p className={styles.calm}><i />No early warning is active right now.</p>}
          {openWarnings.map((w) => (
            <article key={w.id} className={styles.warning}>
              <div className={styles.wHead}><span className={styles.bWarn}>early warning</span><b>{w.provider}</b><span className={styles.muted}>{w.layer} · since {ago(w.openedAt)}</span></div>
              <p>{w.evidence.degraded?.length ?? 0} of {w.evidence.groupSize ?? "—"} services degraded: {w.evidence.degraded?.slice(0, 10).map((x) => `${x.name} (${x.latencyMs ?? "failing"}${x.latencyMs ? " ms" : ""} vs ${Math.round(x.baselineMs ?? 0)} ms normal)`).join(", ")}</p>
            </article>
          ))}
          {(d?.warnings.filter((w) => w.closedAt).length ?? 0) > 0 && (
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Group</th><th>Opened</th><th>Outcome</th><th className={styles.r}>Lead</th></tr></thead>
              <tbody>{d!.warnings.filter((w) => w.closedAt).slice(0, 12).map((w) => (
                <tr key={w.id}><td>{w.provider}<small>{w.layer}</small></td><td className={styles.mono}>{new Date(w.openedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                  <td>{w.outcome === "incident" ? <span className={styles.bHit}>confirmed</span> : w.outcome === "no_incident" ? <span className={styles.bMiss}>no incident</span> : <span className={styles.bIdle}>pending</span>}</td>
                  <td className={styles.r}>{w.leadMinutes != null ? `${w.leadMinutes} min` : "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sHead}><span className={styles.num}>02</span><h2 className={styles.h2}>Certificates</h2></div>
          <p className={styles.method}>We read the TLS certificate of every monitored endpoint daily ({d?.coverage.certs ?? "—"} certificates). Auto-renewing authorities (Let's Encrypt, Google, Amazon, Cloudflare) renew about 30 days before expiry, so under 14 days left on such a certificate means renewal is overdue and probably failing.</p>
          {d && urgentCerts.length === 0 && <p className={styles.calm}><i />No certificate is expired, under 7 days, or overdue for renewal.</p>}
          {urgentCerts.length > 0 && <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Service</th><th>Host</th><th>Issuer</th><th>Status</th><th className={styles.r}>Expires</th></tr></thead>
            <tbody>{urgentCerts.map((c) => (
              <tr key={c.id}><td>{c.name}<small>{c.category}</small></td><td className={styles.mono}>{c.host}</td><td>{c.certIssuer ?? "—"}</td>
                <td><span className={c.risk === "renewal_overdue" ? styles.bWarn : styles.bDown}>{RISK[c.risk]}</span></td>
                <td className={styles.r}>{c.daysLeft < 0 ? `${-c.daysLeft} d ago` : `in ${c.daysLeft} d`}<small>{date(c.certNotAfter)}</small></td></tr>
            ))}</tbody>
          </table></div>}
          {watchCerts.length > 0 && (
            <>
              <button className={styles.toggle} onClick={() => setShowWatch((v) => !v)}>{showWatch ? "Hide" : "Show"} {watchCerts.length} certificates in their normal renewal window</button>
              {showWatch && <div className={styles.tableWrap}><table className={styles.table}><tbody>{watchCerts.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td className={styles.mono}>{c.host}</td><td>{c.certIssuer ?? "—"}</td><td className={styles.r}>in {c.daysLeft} d</td></tr>
              ))}</tbody></table></div>}
            </>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sHead}><span className={styles.num}>03</span><h2 className={styles.h2}>Domains</h2></div>
          <p className={styles.method}>Registration expiry from the registries' official RDAP records ({d?.coverage.domains ?? "—"} domains). Some registries (for example .io, .de, .at) do not publish RDAP; we report them as unavailable rather than guess. Large companies usually auto-renew; the risk is a domain inside its last two weeks that has not been renewed.</p>
          {d && d.domains.length === 0 && <p className={styles.calm}><i />No monitored domain expires in the next 60 days.</p>}
          {(d?.domains.length ?? 0) > 0 && <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Domain</th><th>Used by</th><th>Registrar</th><th className={styles.r}>Expires</th></tr></thead>
            <tbody>{d!.domains.map((x) => (
              <tr key={x.domain ?? x.name}><td className={styles.mono}>{x.domain}</td><td>{x.name}</td><td>{x.domainRegistrar ?? "—"}</td>
                <td className={styles.r}><span className={x.daysLeft < 0 ? styles.bDown : x.daysLeft < 14 ? styles.bWarn : styles.bIdle}>{x.daysLeft < 0 ? "expired" : `in ${x.daysLeft} d`}</span><small>{date(x.domainExpiresAt)}</small></td></tr>
            ))}</tbody>
          </table></div>}
        </section>

        <section className={styles.section}>
          <div className={styles.sHead}><span className={styles.num}>04</span><h2 className={styles.h2}>Infrastructure changes</h2></div>
          <p className={styles.method}>Recorded when a re-mapping finds a different hosting provider, region, CDN, DNS or email provider than before. Migrations are when outages are most likely; a change is a reason to watch, not proof of a problem.</p>
          {d && d.changes.length === 0 && <p className={styles.calm}><i />No infrastructure change detected in the last 30 days. Services are re-mapped weekly, so changes appear gradually.</p>}
          {(d?.changes.length ?? 0) > 0 && <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Service</th><th>Layer</th><th>From</th><th>To</th><th className={styles.r}>Detected</th></tr></thead>
            <tbody>{d!.changes.map((c) => (
              <tr key={c.id}><td>{c.name}<small>{c.category}</small></td><td>{FIELD[c.field] ?? c.field}</td><td className={styles.muted}>{c.oldValue}</td><td>{c.newValue}</td><td className={styles.r}>{ago(c.detectedAt)}</td></tr>
            ))}</tbody>
          </table></div>}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}