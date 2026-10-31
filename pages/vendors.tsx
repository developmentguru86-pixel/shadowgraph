import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { postVendorScanStart } from "../endpoints/vendors/scan_start_POST.schema";
import { getVendorScan, type OutputType as Scan } from "../endpoints/vendors/scan_GET.schema";
import type { Layer } from "../helpers/vendorList";
import { DORA_REPORT_PRICE_LABEL } from "../helpers/promo";
import styles from "./vendors.module.css";

const EXAMPLE = `Vendor;Website;Function;Critical
Stripe;stripe.com;Card payments;yes
Adyen;adyen.com;Card acquiring;yes
Salesforce;salesforce.com;CRM;no
Twilio;twilio.com;SMS one-time passwords;yes
Okta;okta.com;Employee identity;yes
Onfido;onfido.com;KYC identity checks;yes
Zendesk;zendesk.com;Customer support;no
Datadog;datadoghq.com;Monitoring;no
Atlassian;atlassian.com;Ticketing, wiki;no
Slack;slack.com;Internal chat;no
MongoDB Atlas;mongodb.com;Database;yes
Mambu;mambu.com;Core banking;yes
Personio;personio.de;HR;no
DocuSign;docusign.com;E-signature;no
Plaid;plaid.com;Account data;yes
Sentry;sentry.io;Error tracking;no`;

const LAYERS: Array<[Layer, string]> = [["hosting", "Hosting"], ["cloud region", "Cloud region"], ["cdn", "CDN / edge"], ["dns", "DNS"], ["email", "Email"], ["certificate authority", "Certificate authority"]];
const LAYER_WORD: Record<Layer, string> = { hosting: "hosting", "cloud region": "cloud region", cdn: "CDN / edge", dns: "DNS", email: "email", "certificate authority": "certificate authority" };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function VendorsPage() {
  const [id, setId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [missing, setMissing] = useState(false);
  const [layer, setLayer] = useState<Layer>("hosting");
  const [q, setQ] = useState("");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("id");
    if (v) setId(v);
  }, []);

  // poll while the background scan runs
  useEffect(() => {
    if (!id) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await getVendorScan(id);
        if (stop) return;
        setScan(s); setMissing(false);
        if (s.status === "queued" || s.status === "running") timer = setTimeout(tick, 2500);
      } catch (e) {
        if (!stop && e instanceof Error && e.message === "not_found") setMissing(true);
        else if (!stop) timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [id]);

  const start = async () => {
    setStarting(true); setErr(null); setNotice(null);
    try {
      const r = await postVendorScanStart({ text, company: company || undefined, email: email || undefined });
      if ("error" in r) { setErr(r.error + (r.rejected?.length ? ` Not recognised: ${r.rejected.slice(0, 3).join(" · ")}` : "")); return; }
      const notes = [r.rejected.length ? `${r.rejected.length} line(s) without a domain were skipped` : "", r.truncated ? `${r.truncated} vendor(s) above the 300 limit were not scanned` : ""].filter(Boolean);
      if (notes.length) setNotice(notes.join(" · ") + ".");
      setScan(null); setId(r.id);
      window.history.replaceState(null, "", `/vendors?id=${r.id}`);
    } catch {
      setErr("Could not start the scan. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 400_000) { setErr("The file is larger than 400 KB. Export only the vendor name and website columns."); return; }
    setText(await f.text()); setErr(null);
  };

  const reset = () => { setId(null); setScan(null); setMissing(false); window.history.replaceState(null, "", "/vendors"); };

  const summary = scan?.summary ?? null;
  const layerData = summary?.layers.find((l) => l.layer === layer)?.providers ?? [];
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (scan?.rows ?? []).filter((r) => (!onlyCritical || r.critical) && (!t || [r.name, r.domain, r.fn, r.hosting, r.cdn, r.dns, r.email, r.certIssuer].some((x) => x?.toLowerCase().includes(t))))
      .sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name));
  }, [scan, q, onlyCritical]);
  const running = scan && (scan.status === "queued" || scan.status === "running");
  const shareUrl = typeof window !== "undefined" && id ? `${window.location.origin}/vendors?id=${id}` : "";

  return (
    <>
      <Helmet>
        <title>Vendor Map: ICT third-party dependencies for DORA · ShadowGraph</title>
        <meta name="description" content="Upload your ICT vendor list (up to 300) and see which cloud, CDN, DNS, email and certificate providers each vendor depends on, where they concentrate, and what fails together. CSV export for your DORA register of information." />
        <meta property="og:title" content="Vendor Map: ICT third-party dependencies for DORA" />
        <meta property="og:description" content="Upload your ICT vendor list (up to 300) and see which cloud, CDN, DNS, email and certificate providers each vendor depends on, where they concentrate, and what fails together. CSV export for your DORA register of information." />
        {id && <meta name="robots" content="noindex" />}
      </Helmet>
      <SiteHeader active="check" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Vendor Map · DORA Art. 28–29 · NIS2</span>
          <h1 className={styles.h1}>Who do your vendors depend on? <em>All of them, in one scan.</em></h1>
          <p className={styles.lead}>Paste or upload your list of ICT third-party providers (up to 300). For every vendor we read the public infrastructure behind it: hosting and cloud region, CDN, DNS, email, certificate authority, certificate and domain expiry. You get the concentration across your whole portfolio, the outages that would hit several vendors at once, and a CSV for your register of information.</p>
        </header>

        {!id && (
          <section className={styles.input} aria-label="Vendor list">
            <div className={styles.inputHead}>
              <label htmlFor="vendor-list" className={styles.label}>Vendor list</label>
              <div className={styles.inputActions}>
                <button type="button" className={styles.ghost} onClick={() => setText(EXAMPLE)}>Load example</button>
                <button type="button" className={styles.ghost} onClick={() => fileRef.current?.click()}>Upload CSV</button>
                <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
              </div>
            </div>
            <textarea id="vendor-list" className={styles.textarea} rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder={"One vendor per line, or a CSV with a header:\nVendor;Website;Function;Critical\nStripe;stripe.com;Card payments;yes\nsalesforce.com"} />
            <p className={styles.hint}>Recognised columns: vendor/name, website/domain/url, host/endpoint/IP, function/service, critical (yes/no). Separators: semicolon, comma or tab. Only the website or a host is required. A host (e.g. banking.yourbank.com) or a public IP is analysed exactly as given; a plain company domain is checked via its api./app./login. endpoints. Excel: save as CSV. The scan is free; the finished concentration risk assessment for your DORA file is {DORA_REPORT_PRICE_LABEL} (see a sample report for a regional bank with 42 vendors: <a href="/vendors/report?id=pmrHyotos8A3oe8xkLR58g&lang=en">English</a> · <a href="/vendors/report?id=pmrHyotos8A3oe8xkLR58g&lang=de" hrefLang="de" lang="de">Deutsch</a>).</p>
            <div className={styles.row}>
              <input id="vendor-company" className={styles.field} placeholder="Company (optional, used in the file name)" value={company} onChange={(e) => setCompany(e.target.value)} />
              <input id="vendor-email" className={styles.field} type="email" placeholder="Work email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="button" className={styles.primary} onClick={start} disabled={starting || text.trim().length < 3}>{starting ? "Starting…" : "Scan vendors"}</button>
            </div>
            {err && <p className={styles.err}>{err}</p>}
            <p className={styles.fine}>Only public information is read (DNS, network ownership, published cloud IP ranges, TLS certificates, RDAP). No access to your or your vendors' systems. The list and its results are stored under an unguessable link and deleted after 30 days. <a href="/privacy">Privacy</a></p>
          </section>
        )}

        {id && missing && (
          <section className={styles.card}><p className={styles.muted}>This scan does not exist or was deleted after 30 days.</p><button className={styles.ghost} onClick={reset}>Start a new scan</button></section>
        )}

        {id && !missing && (
          <>
            <section className={styles.status}>
              <div className={styles.statusText}>
                <b>{scan?.company ? `${scan.company} · ` : ""}{scan ? `${scan.done} of ${scan.total} vendors scanned` : "Loading…"}</b>
                <span>{running ? "Scanning in the background, about 20 seconds per 100 vendors. You can leave this page; the link keeps working." : scan?.status === "failed" ? "The scan stopped before the end. The results below are partial; start a new scan to finish the rest." : scan ? `Scanned ${fmtDate(scan.createdAt)} · results kept until ${fmtDate(scan.expiresAt)}` : ""}</span>
              </div>
              <div className={styles.statusActions}>
                {scan && scan.rows.length > 0 && <a className={styles.primary} href={`/_api/vendors/export?id=${id}`}>Download CSV</a>}
                {scan && scan.status === "done" && scan.rows.length > 0 && <a className={styles.ghost} href={`/vendors/report?id=${id}`}>Assessment report (PDF)</a>}
                <button className={styles.ghost} onClick={() => { navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined); }}>{copied ? "Link copied" : "Copy link"}</button>
                <button className={styles.ghost} onClick={reset}>New scan</button>
              </div>
              {scan && <div className={styles.progress}><i style={{ width: `${(scan.done / Math.max(1, scan.total)) * 100}%` }} /></div>}
              {notice && <p className={styles.muted}>{notice}</p>}
            </section>

            {summary && (
              <>
                <section className={styles.kpis} aria-label="Summary">
                  <div><b>{summary.scanned}</b><span>vendors resolved{summary.unresolved ? ` · ${summary.unresolved} without DNS` : ""}</span></div>
                  <div><b>{summary.critical}</b><span>marked critical</span></div>
                  <div><b>{summary.distinctHosting}</b><span>distinct hosting providers</span></div>
                  <div><b>{summary.scenarios[0] ? pct(summary.scenarios[0].share) : "—"}</b><span>{summary.scenarios[0] ? `of vendors share ${summary.scenarios[0].provider} (${LAYER_WORD[summary.scenarios[0].layer]})` : "largest shared provider"}</span></div>
                  <div><b>{summary.hiddenOrigins}</b><span>origins hidden behind a CDN</span></div>
                </section>

                <section className={styles.card}>
                  <h2 className={styles.h2}>What fails together</h2>
                  {summary.scenarios.length === 0 ? <p className={styles.muted}>No provider is shared by two or more vendors.</p> : (
                    <ol className={styles.scen}>
                      {summary.scenarios.map((s) => (
                        <li key={`${s.layer}|${s.provider}`}>
                          <div className={styles.scenHead}>
                            <b>{s.provider}</b><span className={styles.tag}>{LAYER_WORD[s.layer]}</span>
                            <span className={styles.scenN}>{s.vendors} vendors · {pct(s.share)}{s.critical ? <em> · {s.critical} critical</em> : null}</span>
                          </div>
                          <p>If {s.provider} has an outage, {s.vendors} of your vendors lose their {LAYER_WORD[s.layer]} at the same time: {s.names.slice(0, 12).join(", ")}{s.names.length > 12 ? ` and ${s.names.length - 12} more` : ""}.</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className={styles.card}>
                  <div className={styles.tabs} role="tablist" aria-label="Layer">
                    {LAYERS.map(([k, label]) => (
                      <button key={k} role="tab" aria-selected={layer === k} className={layer === k ? styles.tabOn : styles.tab} onClick={() => setLayer(k)}>{label}</button>
                    ))}
                  </div>
                  <ul className={styles.bars}>
                    {layerData.slice(0, 14).map((p) => (
                      <li key={p.provider}>
                        <span className={styles.barLabel} title={p.names.join(", ")}>{p.provider}</span>
                        <span className={styles.track}><i style={{ width: `${Math.max(2, p.share * 100)}%` }} />{p.critical > 0 && <i className={styles.crit} style={{ width: `${Math.max(1, (p.critical / Math.max(1, summary.scanned)) * 100)}%` }} />}</span>
                        <b>{p.vendors}</b>
                        <span className={styles.dim}>{pct(p.share)}{p.critical ? ` · ${p.critical} crit.` : ""}</span>
                      </li>
                    ))}
                    {layerData.length === 0 && <li className={styles.muted}>No data for this layer yet.</li>}
                  </ul>
                  <p className={styles.fine}>Bar = share of resolved vendors · bright segment = critical vendors. {layer === "hosting" ? "Behind a CDN the origin host is hidden; it is reported as hidden, never guessed." : layer === "cloud region" ? "Region from the provider's official IP ranges (AWS, Google Cloud). Only the region visible from outside; failover regions are invisible." : ""}</p>
                </section>

                <div className={styles.grid2}>
                  <section className={styles.card}>
                    <h2 className={styles.h2}>Provider incidents · last 90 days</h2>
                    {scan!.providerIncidents.length === 0 ? <p className={styles.muted}>No incidents recorded from the status feeds we read for these providers.</p> : (
                      <ul className={styles.incs}>
                        {scan!.providerIncidents.map((p) => (
                          <li key={p.provider}><b>{p.provider}</b><span>{p.incidents90d} reported{p.severe90d ? `, ${p.severe90d} severe` : ""}</span><small>Latest {fmtDate(p.lastAt)}: {p.lastTitle}</small></li>
                        ))}
                      </ul>
                    )}
                    <p className={styles.fine}>From the providers' own status pages, as recorded by the ShadowGraph radar.</p>
                  </section>
                  <section className={styles.card}>
                    <h2 className={styles.h2}>Coming due</h2>
                    {summary.certsExpiring.length + summary.domainsExpiring.length === 0 ? <p className={styles.muted}>No certificate within 30 days and no domain within 60 days of expiry.</p> : (
                      <ul className={styles.incs}>
                        {summary.domainsExpiring.map((d) => <li key={"d" + d.domain}><b>{d.name}</b><span className={d.days < 14 ? styles.warnText : undefined}>domain registration · {d.days < 0 ? "expired" : `${d.days} days`}</span><small>{d.domain} · {fmtDate(d.date)}</small></li>)}
                        {summary.certsExpiring.map((d) => <li key={"c" + d.domain}><b>{d.name}</b><span className={d.days < 7 ? styles.warnText : undefined}>TLS certificate · {d.days < 0 ? "expired" : `${d.days} days`}</span><small>{d.domain} · {fmtDate(d.date)} · most certificates renew automatically</small></li>)}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}

            {scan && scan.rows.length > 0 && (
              <section className={styles.card}>
                <div className={styles.tableHead}>
                  <h2 className={styles.h2}>All vendors ({rows.length})</h2>
                  <div className={styles.filters}>
                    <input id="vendor-filter" className={styles.field} placeholder="Filter: name, provider…" value={q} onChange={(e) => setQ(e.target.value)} />
                    <label className={styles.check}><input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} /> Critical only</label>
                  </div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Vendor</th><th>Hosting</th><th>CDN</th><th>DNS</th><th>Email</th><th>Certificate</th><th>Domain</th><th>Live</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.domain}>
                          <td><b>{r.name}</b>{r.critical && <span className={styles.critTag}>critical</span>}<small>{r.domain}{r.fn ? ` · ${r.fn}` : ""}</small></td>
                          <td>{r.status !== "ok" ? <span className={styles.warnText}>no DNS</span> : r.hosting ?? (r.originHidden ? <span className={styles.dimText}>hidden by CDN</span> : "—")}{r.region && <small>{r.region === "global" ? "global load balancer" : r.region}</small>}</td>
                          <td>{r.cdn ?? "—"}</td>
                          <td>{r.dns ?? "—"}</td>
                          <td>{r.email ?? "—"}</td>
                          <td>{r.certIssuer ?? <span className={styles.dimText}>{r.certNote ?? "—"}</span>}{r.certNotAfter && <small>until {fmtDate(r.certNotAfter)}</small>}</td>
                          <td>{r.domainExpiresAt ? fmtDate(r.domainExpiresAt) : <span className={styles.dimText}>{r.domainNote ? "not published" : "—"}</span>}{r.registrar && <small>{r.registrar}</small>}</td>
                          <td>{r.radar ? <a href={`/status/${r.radar.slug}`}>{r.radar.uptime24h != null ? `${(r.radar.uptime24h * 100).toFixed(1)}%` : "status"}</a> : <span className={styles.dimText}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className={styles.fine}>Live = 24 h availability where the vendor is also on the public ShadowGraph radar. Evidence (IP addresses, network owner, name servers, MX, CNAMEs) is in the CSV for every row. The scan sees what is publicly reachable; vendors' internal sub-processors are not visible from outside and still have to come from the vendor.</p>
              </section>
            )}

            {scan && scan.status === "done" && scan.rows.length > 0 && (
              <section className={styles.cta}>
                <div>
                  <h2>Turn this scan into your concentration risk assessment</h2>
                  <p>A finished document for your DORA file: executive summary and prioritised actions with DORA references, concentration per layer with HHI ratings, shared points of failure for critical functions, jurisdiction (EU/EEA or third country) per vendor, exposure to ESA-designated critical providers (CTPP), approval page, the full register annex and a pre-filled extract for your register of information (CSV, with LEI candidates and sub-contractors). It is the outside-in evidence for Art. 28–29; contract data and incident reporting stay with you. {DORA_REPORT_PRICE_LABEL} one-time, invoice included, PDF in English and German.</p>
                </div>
                <a className={styles.primary} href={`/vendors/report?id=${id}`}>See the report</a>
              </section>
            )}
            <section className={styles.cta}>
              <div>
                <h2>Keep this list under watch</h2>
                <p>A DORA pilot monitors these providers continuously: outage alerts with the vendors affected, monthly evidence report, register-ready export. Three months, by invoice.</p>
              </div>
              <a className={styles.primary} href="/pricing#enterprise">Request a pilot</a>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
