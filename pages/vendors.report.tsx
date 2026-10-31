import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getVendorReport, type OutputType as Report } from "../endpoints/vendors/report_GET.schema";
import { reportPdfUrl } from "../endpoints/vendors/report_pdf_GET.schema";
import { registerCsvUrl } from "../endpoints/vendors/register_csv_GET.schema";
import { evidenceCsvUrl } from "../endpoints/vendors/evidence_csv_GET.schema";
import { postVendorReportCheckout } from "../endpoints/vendors/report_checkout_POST.schema";
import { postVendorReportClaim } from "../endpoints/vendors/report_claim_POST.schema";
import { T, fmtDate, fmtInt, layerLabel, pct, type ReportLang } from "../helpers/doraReportText";
import { DORA_REPORT_FREE, DORA_REPORT_PRICE_LABEL } from "../helpers/promo";
import { DoraIncidents } from "../components/DoraIncidents";
import styles from "./vendors.report.module.css";

const PRICE = DORA_REPORT_PRICE_LABEL;

/** Paid ICT concentration risk assessment for one vendor scan, in English or German, with a server-generated PDF. */
export default function VendorReportPage() {
  const [id, setId] = useState<string | null>(null);
  const [lang, setLang] = useState<ReportLang>("en");
  const [r, setR] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [buying, setBuying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const t = T[lang];
  const L = (l: Parameters<typeof layerLabel>[0]) => layerLabel(l, lang);
  const day = (x: string | null | undefined) => fmtDate(x, lang);
  const country = (c: string) => { try { return new Intl.DisplayNames([lang === "de" ? "de-AT" : "en-GB"], { type: "region" }).of(c) ?? c; } catch { return c; } };

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const scanId = p.get("id");
    const q = p.get("lang");
    const l: ReportLang = q === "de" || q === "en" ? q : navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
    setLang(l);
    const session = p.get("session_id");
    if (!scanId) { setState("missing"); return; }
    setId(scanId);
    (async () => {
      if (session) {
        const c = await postVendorReportClaim({ id: scanId, sessionId: session }).catch(() => ({ status: "not_found" as const }));
        setNote(c.status === "paid" ? T[l].paidNote : c.status === "not_paid" ? T[l].notPaidNote : null);
        window.history.replaceState(null, "", `/vendors/report?id=${scanId}&lang=${l}`);
      }
      try { setR(await getVendorReport(scanId, l)); setState("ready"); }
      catch (e) { setState(e instanceof Error && e.message === "not_found" ? "missing" : "error"); }
    })();
  }, []);

  const switchLang = async () => {
    if (!id) return;
    const next: ReportLang = lang === "de" ? "en" : "de";
    setLang(next);
    window.history.replaceState(null, "", `/vendors/report?id=${id}&lang=${next}`);
    try { setR(await getVendorReport(id, next)); } catch { /* keep the current one */ }
  };

  const buy = async () => {
    if (!id) return;
    setBuying(true); setNote(null);
    const res = await postVendorReportCheckout({ id }).catch(() => ({ error: "Checkout is temporarily unavailable." }));
    if ("url" in res) { window.location.href = res.url; return; }
    setNote(res.error); setBuying(false);
  };

  const title = r?.company ? `${t.title} · ${r.company}` : t.title;
  const sev = (k: string) => t.rating[k as keyof typeof t.rating] ?? k;

  return (
    <>
      <Helmet htmlAttributes={{ lang }}>
        <title>{`${title} · ShadowGraph`}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className={styles.noPrint}><SiteHeader active="check" /></div>
      <main className={styles.page}>
        <div className={`${styles.toolbar} ${styles.noPrint}`}>
          <a href={id ? `/vendors?id=${id}` : "/vendors"}>{t.back}</a>
          <div className={styles.tools}>
            <button className={styles.secondary} onClick={switchLang}>{t.langSwitch}</button>
            {r?.paid && id && <a className={styles.secondary} href={registerCsvUrl(id)}>{t.registerCsv}</a>}
            {r?.paid && id && <a className={styles.primary} href={reportPdfUrl(id, lang)}>{t.download}</a>}
          </div>
        </div>
        {note && <p className={`${styles.note} ${styles.noPrint}`}>{note}</p>}

        {state === "loading" && <p className={styles.muted}>{t.loading}</p>}
        {state === "missing" && <p className={styles.muted}>{t.missing} <a href="/vendors">{t.startScan}</a></p>}
        {state === "error" && <p className={styles.muted}>{t.unavailable}</p>}

        {r && (
          <article className={styles.doc}>
            <header className={styles.cover}>
              <span className={styles.eyebrow}>ShadowGraph · {t.eyebrow}</span>
              <h1 className={styles.h1}>{t.title}</h1>
              {r.company && <p className={styles.company}>{t.preparedFor}: {r.company}</p>}
              <dl className={styles.meta}>
                <div><dt>{t.meta.vendors}</dt><dd>{r.scope.vendors}</dd></div>
                <div><dt>{t.meta.critical}</dt><dd>{r.scope.critical}</dd></div>
                <div><dt>{t.meta.collected}</dt><dd>{day(r.scannedAt)}</dd></div>
                <div><dt>{t.meta.generated}</dt><dd>{day(r.generatedAt)}</dd></div>
              </dl>
              <div className={`${styles.overall} ${styles[`ov_${r.overall}`]}`}><span>{t.overall}</span><b>{sev(r.overall)}</b></div>
            </header>

            {r.paid && id && <DoraIncidents id={id} lang={lang} />}

            <section className={styles.sec}>
              <h2>{t.s1}</h2>
              <p>{t.s1Lead(r.scope.vendors, r.scope.resolved, r.scope.unresolved)}</p>
              <div className={styles.scope}>
                <h3 className={styles.h3}>{t.scopeH}</h3>
                <div className={styles.scopeCols}>
                  <div><b>{t.scopeYesH}</b><ul>{t.scopeYes.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div><b>{t.scopeNoH}</b><ul>{t.scopeNo.map((x) => <li key={x}>{x}</li>)}</ul></div>
                </div>
              </div>
              {r.keyFigures.length > 0 && (
                <div className={styles.kf}>{r.keyFigures.map((k) => <div key={k.label}><b>{k.value}</b><span>{k.label}</span></div>)}</div>
              )}
              <h3 className={styles.h3}>{t.findings}</h3>
              <ul className={styles.findings}>
                {r.findings.map((f) => (
                  <li key={f.title}><span className={`${styles.sev} ${styles[`sev_${f.severity}`]}`}>{sev(f.severity)}</span><div><b>{f.title}</b><p>{f.detail}</p></div></li>
                ))}
              </ul>
            </section>

            {!r.paid ? (
              <section className={`${styles.locked} ${styles.noPrint}`}>
                <h2>{t.lockedH}</h2>
                <p>{t.lockedLead}</p>
                <ol>{t.lockedItems(r.scope.vendors).map((x) => <li key={x}>{x}</li>)}</ol>
                <div className={styles.buy}>
                  {DORA_REPORT_FREE
                    ? <div><b>{t.freePrice}</b><span>{t.freeNote(PRICE)}</span></div>
                    : <div><b>{PRICE}</b><span>{t.buyNote}</span></div>}
                  <button className={styles.primaryBtn} onClick={buy} disabled={buying}>
                    {DORA_REPORT_FREE ? (buying ? t.freeBuying : t.freeBtn) : (buying ? t.buying : t.buyBtn(PRICE))}
                  </button>
                </div>
                <p className={styles.fine}>{DORA_REPORT_FREE ? t.freeFine : t.secure}</p>
              </section>
            ) : (
              <>
                {r.actionPlan.length > 0 && (
                  <section className={styles.sec}>
                    <h2>{t.apH(r.company)}</h2>
                    <p>{t.apLead}</p>
                    {r.actionPlan.map((a, i) => (
                      <div key={a.title} className={styles.ap}>
                        <h3 className={styles.h3}>{i + 1}. {a.title}</h3>
                        <p className={styles.fine}><b>{t.apEvidence}:</b> {a.evidence}</p>
                        <div className={styles.apCols}>
                          <div><b>{t.apInternal}</b><ul>{a.internal.map((x) => <li key={x}>{x}</li>)}</ul></div>
                          <div><b>{t.apVendor}</b><ul>{a.vendor.map((x) => <li key={x}>{x}</li>)}</ul></div>
                        </div>
                        <table className={`${styles.table} ${styles.apFill}`}><tbody><tr>{t.apFill.map((f) => <td key={f}><small>{f}</small></td>)}</tr></tbody></table>
                        <div className={styles.ref}>{a.ref}</div>
                      </div>
                    ))}
                  </section>
                )}
                <section className={styles.sec}>
                  <h2>{t.s2}</h2>
                  <p>{t.s2Lead}</p>
                  {r.decisions.length > 0 && (
                    <>
                      <h3 className={styles.h3}>{t.decH}</h3>
                      <p className={styles.fine}>{t.decLead}</p>
                      <div className={styles.scroll}>
                        <table className={styles.table}>
                          <thead><tr><th>{t.thPriority}</th><th>{t.thVendor}</th><th>{t.thSignals}</th><th>{t.thDecision}</th><th>{t.thOpen}</th></tr></thead>
                          <tbody>{r.decisions.map((x) => (
                            <tr key={x.vendor}>
                              <td><span className={`${styles.sev} ${styles[`sev_${x.priority}`]}`}>{t.priority[x.priority]}</span></td>
                              <td><b>{x.vendor}</b></td>
                              <td><ul className={styles.sig}>{x.signals.map((s) => <li key={s}>{s}</li>)}</ul></td>
                              <td>{x.decision}<div className={styles.ref}>{x.ref}</div></td>
                              <td className={styles.mutedInline}>{x.open}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                      <h3 className={styles.h3}>{t.allActions}</h3>
                    </>
                  )}
                  <table className={styles.table}>
                    <thead><tr><th>{t.thPriority}</th><th>{t.thAction}</th><th>{t.thRef}</th></tr></thead>
                    <tbody>{r.actions.map((a) => (
                      <tr key={a.action}><td><span className={`${styles.sev} ${styles[`sev_${a.priority}`]}`}>{t.priority[a.priority]}</span></td><td>{a.action}</td><td className={styles.ref}>{a.ref}</td></tr>
                    ))}</tbody>
                  </table>
                </section>

                <section className={styles.sec}>
                  <h2>{t.s3}</h2>
                  <p>{t.s3Lead}</p>
                  <div className={styles.scroll}>
                    <table className={styles.table}>
                      <thead><tr><th>{t.thLayer}</th><th className={styles.num}>{t.thKnown}</th><th className={styles.num}>{t.thHhi}</th><th>{t.thRating}</th><th>{t.thLargest}</th><th>{t.thAmongCrit}</th></tr></thead>
                      <tbody>{r.layers.map((l) => (
                        <tr key={l.layer}>
                          <td>{L(l.layer)}</td><td className={styles.num}>{l.resolved} {t.of} {r.scope.companies ?? r.scope.resolved}</td><td className={styles.num}>{l.meaningful === false ? "—" : fmtInt(l.hhi, lang)}</td>
                          <td>{l.layer === "email" || l.layer === "certificate authority" ? <span className={styles.ref}>{t.informative}</span> : l.meaningful === false ? <span className={styles.ref}>{t.notMeaningful}</span> : <span className={`${styles.sev} ${styles[`sev_${l.rating}`]}`}>{t.rating[l.rating]}</span>}</td>
                          <td>{l.top[0] ? `${l.top[0].provider} · ${l.top[0].vendors} ${t.of} ${l.resolved}` : "—"}</td>
                          <td>{l.criticalTop ? `${l.criticalTop.provider} · ${l.criticalTop.critical} (${pct(l.criticalTop.share)})` : "—"}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.fine}>{t.infraNote}</p>
                </section>

                <section className={styles.sec}>
                  <h2>{t.s4}</h2>
                  <p>{t.s4Lead}</p>
                  {r.scenarios.length === 0 ? <p className={styles.muted}>{t.s4None}</p> : (
                    <div className={styles.scroll}>
                      <table className={styles.table}>
                        <thead><tr><th>{t.thProvider}</th><th>{t.thLayer}</th><th className={styles.num}>{t.thVendors}</th><th className={styles.num}>{t.thCritical}</th><th>{t.thCritAffected}</th></tr></thead>
                        <tbody>{r.scenarios.map((s) => (
                          <tr key={`${s.layer}|${s.provider}`}><td>{s.provider}</td><td>{L(s.layer)}</td><td className={styles.num}>{s.vendors} ({pct(s.share)})</td><td className={styles.num}>{s.critical}</td><td>{s.criticalNames.join(", ") || "—"}</td></tr>))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className={styles.sec}>
                  <h2>{t.s5}</h2>
                  {r.singlePoints.length === 0 ? <p>{t.s5None}</p> : (
                    <>
                      <p>{t.s5Lead}</p>
                      <ul className={styles.plain}>{r.singlePoints.map((p) => <li key={`${p.layer}|${p.provider}`}><b>{p.provider}</b> ({L(p.layer)}): {p.criticalNames.join(", ")}</li>)}</ul>
                    </>
                  )}
                </section>

                <section className={styles.sec}>
                  <h2>{t.s6}</h2>
                  <p>{t.s6Lead}</p>
                  <table className={styles.table}>
                    <thead><tr><th></th><th className={styles.num}>{t.euEea}</th><th className={styles.num}>{t.third}</th><th className={styles.num}>{t.undetermined}</th></tr></thead>
                    <tbody>
                      <tr><td>{t.s6Endpoint}</td><td className={styles.num}>{r.jurisdiction.endpoint.eu}</td><td className={styles.num}>{r.jurisdiction.endpoint.third}</td><td className={styles.num}>{r.jurisdiction.endpoint.unknown}</td></tr>
                      <tr><td>{t.s6Hq}</td><td className={styles.num}>{r.jurisdiction.hq.eu}</td><td className={styles.num}>{r.jurisdiction.hq.third}</td><td className={styles.num}>{r.jurisdiction.hq.unknown}</td></tr>
                    </tbody>
                  </table>
                  {r.jurisdiction.hq.byCountry.length > 0 && <p className={styles.fine}>{t.s6Hq}: {r.jurisdiction.hq.byCountry.map((c) => `${c.name} ${c.vendors}`).join(" · ")}. {t.s6HqNote}</p>}
                  <div className={styles.scroll}>
                    <table className={`${styles.table} ${styles.small}`}>
                      <thead><tr><th>{t.thVendor}</th><th>{t.thCrit}</th><th>{t.s6Endpoint}</th><th>{t.s6Hq}</th></tr></thead>
                      <tbody>{[...r.jurisdiction.rows].sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name)).map((x) => (
                        <tr key={x.name}><td><b>{x.name}</b></td><td>{x.critical ? t.yes : t.no}</td>
                          <td>{x.endpoint ? `${country(x.endpoint)} (${x.endpointBasis === "region" ? t.basisRegion : t.basisNetwork})` : <span className={styles.mutedInline}>{t.undetermined}</span>}</td>
                          <td>{x.hq ? country(x.hq) : "—"}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className={styles.sec}>
                  <h2>{t.s7}</h2>
                  <p>{t.s7Lead(day(r.ctpp.listDate))}</p>
                  {r.ctpp.exposures.length === 0 ? <p>{t.s7None}</p> : (
                    <table className={styles.table}>
                      <thead><tr><th>{t.thEntity}</th><th>{t.thVia}</th><th>{t.thAffected}</th></tr></thead>
                      <tbody>{r.ctpp.exposures.map((e) => (
                        <tr key={e.entity}><td><b>{e.entity}</b></td><td>{e.seenAs.join(", ")}</td><td>{e.vendors.map((v) => (e.critical.includes(v) ? `${v} *` : v)).join(", ")}</td></tr>))}
                      </tbody>
                    </table>
                  )}
                  <p className={styles.fine}>* {t.thCritical}. <a href={r.ctpp.source} target="_blank" rel="noopener noreferrer">ESA list of designated CTPPs</a></p>
                </section>

                <section className={styles.sec}>
                  <h2>{t.s8}</h2>
                  {r.incidents.length === 0 ? <p>{t.s8None}</p> : (
                    <table className={styles.table}>
                      <thead><tr><th>{t.thProvider}</th><th className={styles.num}>{t.thIncidents}</th><th className={styles.num}>{t.thSevere}</th><th>{t.thLatest}</th></tr></thead>
                      <tbody>{r.incidents.map((i) => <tr key={i.provider}><td>{i.provider}</td><td className={styles.num}>{i.incidents90d}</td><td className={styles.num}>{i.severe90d}</td><td>{day(i.lastAt)}: {i.lastTitle}</td></tr>)}</tbody>
                    </table>
                  )}
                  <h3 className={styles.h3}>{t.obsH}</h3>
                  <p className={styles.fine}>{t.obsLead}</p>
                  {r.observed.length === 0 ? <p>{t.obsNone}</p> : (
                    <>
                    <div className={styles.scroll}>
                      <table className={styles.table}>
                        <thead><tr><th>{t.thVendor}</th><th>{t.thMeasuredOn}</th><th className={styles.num}>{t.thUptime}</th><th className={styles.num}>{t.thOutages}</th><th className={styles.num}>{t.thDown}</th><th className={styles.num}>{t.thLongest}</th><th>{t.thShared}</th></tr></thead>
                        <tbody>{r.observed.map((o) => o.inferredFrom ? (
                          <tr key={o.vendor}>
                            <td>{o.vendor}{o.critical ? " *" : ""}</td>
                            <td>{t.notMeasured(o.inferredFrom)}</td>
                            <td className={styles.num}>—</td><td className={styles.num}>—</td><td className={styles.num}>—</td><td className={styles.num}>—</td><td>—</td>
                          </tr>
                        ) : (
                          <tr key={o.vendor}>
                            <td>{o.vendor}{o.critical ? " *" : ""}</td>
                            <td>{o.measuredOn}{o.basis === "same-hoster" ? ` (${t.sameHoster})` : o.basis === "report-monitor" ? ` (${t.ownMonitor})` : ""}{o.confirm ? <><br /><small>{t.worldwide(o.confirm.failed, o.confirm.checked)}</small></> : null}</td>
                            <td className={styles.num}>{o.uptimePct != null ? `${o.uptimePct.toLocaleString(t.locale)} %` : "—"}</td>
                            <td className={styles.num}>{o.outages}</td>
                            <td className={styles.num}>{(o.totalMinutes / 60).toLocaleString(t.locale, { maximumFractionDigits: 1 })} h</td>
                            <td className={styles.num}>{(o.longestMinutes / 60).toLocaleString(t.locale, { maximumFractionDigits: 1 })} h</td>
                            <td>{o.sharedWith.join(", ") || "—"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    {r.observed.some((o) => o.outages > 0 && !o.inferredFrom) && <p className={styles.fine}><a href={evidenceCsvUrl(r.id)} download>{t.evidenceCsv}</a></p>}
                    </>
                  )}
                  {r.publicIncidents.length > 0 && (
                    <>
                      <h3 className={styles.h3}>{t.pubH}</h3>
                      <p className={styles.fine}>{t.pubLead}</p>
                      {r.publicIncidents.map((p) => (
                        <div key={p.id}>
                          <p><b>{p.title}</b></p>
                          <p>{p.detail}</p>
                          <p className={styles.fine}>{p.vendors.join(", ")} · {p.sources.map((x, i) => <span key={x.url}>{i ? "; " : ""}<a href={x.url} target="_blank" rel="noopener noreferrer">{x.label}</a></span>)}</p>
                        </div>
                      ))}
                    </>
                  )}
                </section>

                <section className={styles.sec}>
                  <h2>{t.s9}</h2>
                  {r.expiring.certs.length + r.expiring.domains.length === 0 ? <p>{t.s9None}</p> : (
                    <table className={styles.table}>
                      <thead><tr><th>{t.thVendor}</th><th>{t.thItem}</th><th>{t.thExpires}</th><th className={styles.num}>{t.thDays}</th></tr></thead>
                      <tbody>
                        {r.expiring.domains.map((d) => <tr key={`d${d.domain}`}><td>{d.name}</td><td>{t.domain} {d.domain}</td><td>{day(d.date)}</td><td className={styles.num}>{d.days}</td></tr>)}
                        {r.expiring.certs.map((d) => <tr key={`c${d.domain}`}><td>{d.name}</td><td>{t.cert} {d.domain}</td><td>{day(d.date)}</td><td className={styles.num}>{d.days}</td></tr>)}
                      </tbody>
                    </table>
                  )}
                </section>

                <section className={styles.sec}>
                  <h2>{t.s10}</h2>
                  <table className={styles.table}>
                    <thead><tr><th>{t.thReq}</th><th>{t.thProvides}</th></tr></thead>
                    <tbody>{t.mapping.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
                  </table>
                  <p className={styles.fine}>{t.mappingNote}</p>
                </section>

                <section className={styles.sec}>
                  <h2>{t.s11}</h2>
                  {t.method.map((m) => <p key={m}>{m}</p>)}
                </section>

                <section className={styles.sec}>
                  <h2>{t.s12}</h2>
                  <dl className={styles.ctl}>
                    <div><dt>{t.docId}</dt><dd>{r.doc.id}</dd></div>
                    <div><dt>{t.version}</dt><dd>{r.doc.version}</dd></div>
                    <div><dt>{t.methodV}</dt><dd>{r.doc.method}</dd></div>
                    <div><dt>{t.snapshot}</dt><dd>{day(r.scannedAt)}</dd></div>
                    <div className={styles.wide}><dt>{t.integrity}</dt><dd className={styles.hash}>{r.doc.hash}</dd></div>
                    {r.doc.issuer && <div className={styles.wide}><dt>{t.issuer}</dt><dd>{[r.doc.issuer.name, r.doc.issuer.address, r.doc.issuer.email, r.doc.issuer.vatId, r.doc.issuer.register].filter(Boolean).join(" · ")}</dd></div>}
                  </dl>
                  {r.doc.history && r.doc.history.length > 0 && (
                    <>
                      <h3 className={styles.h3}>{t.histH}</h3>
                      <table className={styles.table}>
                        <thead><tr><th>{t.version}</th><th>{t.thDate}</th><th>{t.thChange}</th></tr></thead>
                        <tbody>{r.doc.history.map((h) => <tr key={h.version}><td>{h.version}</td><td>{day(h.date)}</td><td>{h.note}</td></tr>)}</tbody>
                      </table>
                    </>
                  )}
                  <p>{t.approvalLead}</p>
                  <table className={`${styles.table} ${styles.sign}`}>
                    <thead><tr><th>{t.thRole}</th><th>{t.thName}</th><th>{t.thDate}</th><th>{t.thSignature}</th></tr></thead>
                    <tbody>{t.roles.map((role) => <tr key={role}><td>{role}</td><td></td><td></td><td></td></tr>)}</tbody>
                  </table>
                </section>

                <section className={`${styles.sec} ${styles.annex}`}>
                  <h2>{t.annex}</h2>
                  <div className={styles.scroll}>
                    <table className={`${styles.table} ${styles.small}`}>
                      <thead><tr><th>{t.thVendor}</th><th>{t.thFunction}</th><th>{t.thCrit}</th><th>{t.thHostingCol}</th><th>{t.thCdn}</th><th>{t.thDns}</th><th>{t.thEmail}</th><th>{t.thCert}</th><th>{t.thDomain}</th></tr></thead>
                      <tbody>{[...r.register].sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name)).map((v) => (
                        <tr key={v.domain}>
                          <td><b>{v.name}</b><small>{v.domain}</small></td><td>{v.fn ?? "—"}</td><td>{v.critical ? t.yes : t.no}</td>
                          <td>{v.status !== "ok" ? t.noDns : [v.hosting ?? (v.originHidden ? t.hiddenByCdn : "—"), v.region, v.country].filter(Boolean).join(" · ")}</td>
                          <td>{v.cdn ?? "—"}</td><td>{(v.dns ?? "—").replace(/^Other \((.+)\)$/, "$1")}</td><td>{v.email ?? "—"}</td>
                          <td>{v.certIssuer ?? "—"}{v.certNotAfter && <small>{t.until} {day(v.certNotAfter)}</small>}</td>
                          <td>{v.registrar ?? "—"}{v.domainExpiresAt && <small>{t.until} {day(v.domainExpiresAt)}</small>}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <footer className={styles.docFoot}>ShadowGraph · shadowalpha.online · {r.doc.id} · v{r.doc.version} · {day(r.generatedAt)}</footer>
              </>
            )}
          </article>
        )}
        {r && (
          <aside className={`${styles.noPrint} ${styles.monitor}`}>
            <div>
              <b>{lang === "de" ? "Nach der Bewertung: laufende Überwachung" : "After the assessment: ongoing monitoring"}</b>
              <p>{lang === "de"
                ? "DORA verlangt, IKT-Drittdienstleister laufend zu überwachen, nicht nur einmal zu bewerten (Art. 28). Ein Status-Board zeigt Ihre Anbieter live, misst ihre Verfügbarkeit gegen das vertragliche SLA, exportiert den Nachweis monatlich und alarmiert Ihr Team in Slack oder Teams."
                : "DORA expects ICT third-party providers to be monitored continuously, not assessed once (Art. 28). A status board shows your providers live, measures their availability against the contractual SLA, exports the evidence monthly and alerts your team in Slack or Teams."}</p>
            </div>
            <a href="/boards" className={styles.primaryBtn}>{lang === "de" ? "Status-Boards ansehen" : "See status boards"}</a>
          </aside>
        )}
      </main>
      <div className={styles.noPrint}><SiteFooter /></div>
    </>
  );
}
