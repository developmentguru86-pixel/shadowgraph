import { useEffect, useState } from "react";
import { getVendorIncidents, type OutputType } from "../endpoints/vendors/incidents_GET.schema";
import { postReportAlertEmail } from "../endpoints/vendors/report_alert_email_POST.schema";
import type { ReportLang } from "../helpers/doraReportText";
import styles from "./DoraIncidents.module.css";

const TX = {
  de: {
    h: "Vorfallakte (DORA)",
    lead: "Jeder gemessene Ausfall eines Dienstleister-Endpunkts als fertige Vorfallakte: Zeitlinie, Vorprüfung der Klassifizierungskriterien, Meldefristen, SLA-Auswirkung und ein vorbefüllter Entwurf der Erstmeldung. Die Vorprüfung ersetzt nicht die Einstufung durch das Institut.",
    monitoring: (n: number, c: number, since: string) => `${n} kritische ${n === 1 ? "Endpunkt wird" : "Endpunkte werden"} seit ${since} alle 5 Minuten privat überwacht (${c} Prüfungen inkl. DNS direkt bei den zuständigen Nameservern).`,
    alertsOn: (e: string) => `Benachrichtigungen bei Ausfall, nach 2 Stunden und bei Behebung gehen an ${e}.`,
    alertsOff: "Benachrichtigungen per E-Mail: Adresse eintragen, Sie erhalten einen Bestätigungslink.",
    emailPh: "name@bank.at", consent: "Ich möchte Ausfall-Benachrichtigungen zu diesem Bericht per E-Mail erhalten (jederzeit abbestellbar).",
    send: "Bestätigungslink senden", sending: "Wird gesendet…", sent: "Bitte den Link in der E-Mail bestätigen.",
    confirmed: "E-Mail-Adresse bestätigt. Benachrichtigungen sind aktiv.", invalid: "Der Bestätigungslink ist ungültig oder abgelaufen.",
    noMonitoring: "Für diesen Bericht ist kein kritischer Endpunkt in Überwachung (keine Dienstleister als kritisch markiert).",
    none: "Kein Ausfall in den letzten 35 Tagen.",
    loading: "Vorfälle werden geladen…",
    checkNow: "Jetzt prüfen", below: "Unter Schwelle", ongoing: "läuft", since: "seit",
    duration: "Dauer", source: { monitor: "eigene Überwachung", radar: "Radar" }, criteria: "Klassifizierungskriterien (Del. VO (EU) 2024/1772)",
    status: { met: "erfüllt", not_met: "nicht erfüllt", check: "zu prüfen" }, deadlines: "Fristen", sla: "SLA-Auswirkung",
    slaLine: (s: OutputType["incidents"][number]["sla"]) => `${s.month}: ${Math.round(s.downtimeMinutes)} Min. Ausfall, Verfügbarkeit ${s.availability.toLocaleString("de-AT")} %. Erlaubt bei 99,9 %: ${s.allowed999} Min., bei 99,5 %: ${s.allowed995} Min.`,
    draft: "Entwurf der Erstmeldung", copy: "Entwurf kopieren", copied: "Kopiert", download: "Als Text herunterladen", shared: "Zeitgleich beim selben Hoster ausgefallen",
  },
  en: {
    h: "Incident file (DORA)",
    lead: "Every measured outage of a vendor endpoint as a ready incident file: timeline, pre-check of the classification criteria, reporting deadlines, SLA effect and a pre-filled draft of the initial notification. The pre-check does not replace the entity's own classification.",
    monitoring: (n: number, c: number, since: string) => `${n} critical ${n === 1 ? "endpoint is" : "endpoints are"} monitored privately every 5 minutes since ${since} (${c} checks including DNS asked directly at the authoritative name servers).`,
    alertsOn: (e: string) => `Alerts when an outage starts, passes 2 hours and is resolved go to ${e}.`,
    alertsOff: "Email alerts: enter an address and you will receive a confirmation link.",
    emailPh: "name@bank.com", consent: "I want outage alerts for this report by email (unsubscribe any time).",
    send: "Send confirmation link", sending: "Sending…", sent: "Please confirm the link in the email.",
    confirmed: "Email address confirmed. Alerts are active.", invalid: "The confirmation link is invalid or has expired.",
    noMonitoring: "No critical endpoint is monitored for this report (no vendor marked critical).",
    none: "No outage in the last 35 days.",
    loading: "Loading incidents…",
    checkNow: "Check now", below: "Below threshold", ongoing: "ongoing", since: "since",
    duration: "Duration", source: { monitor: "own monitoring", radar: "radar" }, criteria: "Classification criteria (Del. Reg. (EU) 2024/1772)",
    status: { met: "met", not_met: "not met", check: "to check" }, deadlines: "Deadlines", sla: "SLA effect",
    slaLine: (s: OutputType["incidents"][number]["sla"]) => `${s.month}: ${Math.round(s.downtimeMinutes)} min downtime, availability ${s.availability}%. Allowed at 99.9%: ${s.allowed999} min, at 99.5%: ${s.allowed995} min.`,
    draft: "Draft initial notification", copy: "Copy draft", copied: "Copied", download: "Download as text", shared: "Failed at the same time on the same hoster",
  },
};

export function DoraIncidents({ id, lang }: { id: string; lang: ReportLang }) {
  const t = TX[lang];
  const [data, setData] = useState<OutputType | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("alerts");
    if (a === "on") setMsg(t.confirmed); else if (a === "invalid") setMsg(t.invalid);
  }, [t]);
  const requestAlerts = async () => {
    setSendState("sending"); setMsg(null);
    const r = await postReportAlertEmail({ id, email, consent: true, lang }).catch(() => ({ error: "Network error" }));
    if ("ok" in r) { setSendState("sent"); setMsg(t.sent); } else { setSendState("idle"); setMsg(r.error); }
  };
  useEffect(() => {
    let live = true;
    getVendorIncidents(id, lang).then((d) => live && setData(d), () => live && setFailed(true));
    return () => { live = false; };
  }, [id, lang]);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "de" ? "de-AT" : "en-GB", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const hm = (m: number) => (lang === "de" ? `${Math.floor(m / 60)} Std. ${m % 60} Min.` : `${Math.floor(m / 60)} h ${m % 60} min`);
  const copy = async (key: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ } };
  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (failed) return null;

  return (
    <section className={styles.wrap} id="vorfaelle">
      <h2 className={styles.h2}>{t.h}</h2>
      <p className={styles.lead}>{t.lead}</p>
      {!data ? <p className={styles.muted}>{t.loading}</p> : (
        <>
          <p className={styles.mon}>{data.monitoring.hosts.length && data.monitoring.since ? t.monitoring(data.monitoring.hosts.length, data.monitoring.checks, when(data.monitoring.since)) : t.noMonitoring}</p>
          <div className={styles.alerts}>
            <p className={styles.small}>{data.alertEmail ? t.alertsOn(data.alertEmail) : t.alertsOff}</p>
            {sendState !== "sent" && (
              <form className={styles.form} onSubmit={(ev) => { ev.preventDefault(); if (consent && email) void requestAlerts(); }}>
                <input className={styles.input} type="email" required value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder={t.emailPh} aria-label="E-Mail" />
                <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} /> {t.consent}</label>
                <button type="submit" className={styles.btn} disabled={!consent || !email || sendState === "sending"}>{sendState === "sending" ? t.sending : t.send}</button>
              </form>
            )}
            {msg && <p className={styles.notice} role="status">{msg}</p>}
          </div>
          {data.incidents.length === 0 ? <p className={styles.muted}>{t.none}</p> : (
            <div className={styles.list}>
              {data.incidents.map((x, i) => (
                <details key={x.id} className={styles.item} open={i === 0 && x.verdict === "check_now"}>
                  <summary className={styles.sum}>
                    <span className={`${styles.badge} ${x.verdict === "check_now" ? styles.hot : styles.calm}`}>{x.verdict === "check_now" ? t.checkNow : t.below}</span>
                    <b>{x.vendor}</b>
                    <span className={styles.meta}>{x.host} · {t.since} {when(x.startedAt)} · {x.endedAt ? hm(x.minutes) : `${t.ongoing}, ${hm(x.minutes)}`} · {t.source[x.source]}</span>
                  </summary>
                  <div className={styles.body}>
                    <p className={styles.verdict}>{x.verdictText}</p>
                    {x.sharedWith.length > 0 && <p className={styles.small}><b>{t.shared}:</b> {x.sharedWith.join(", ")}</p>}
                    <h3 className={styles.h3}>{t.criteria}</h3>
                    <table className={styles.table}>
                      <tbody>{x.criteria.map((c) => (
                        <tr key={c.key}><td className={styles.crit}>{c.label}</td><td><span className={`${styles.st} ${styles[`st_${c.status}`]}`}>{t.status[c.status]}</span></td><td className={styles.note}>{c.note}</td></tr>
                      ))}</tbody>
                    </table>
                    {x.deadlines.length > 0 && (
                      <>
                        <h3 className={styles.h3}>{t.deadlines}</h3>
                        <ul className={styles.dl}>{x.deadlines.map((d) => <li key={d.label}><b>{d.label}{d.due ? `: ${when(d.due)}` : ""}</b> · {d.note}</li>)}</ul>
                      </>
                    )}
                    <h3 className={styles.h3}>{t.sla}</h3>
                    <p className={styles.small}>{t.slaLine(x.sla)}</p>
                    <h3 className={styles.h3}>{t.draft}</h3>
                    <textarea className={styles.draft} readOnly value={x.draft} rows={14} />
                    <div className={styles.actions}>
                      <button type="button" className={styles.btn} onClick={() => copy(x.id, x.draft)}>{copied === x.id ? t.copied : t.copy}</button>
                      <button type="button" className={styles.btn} onClick={() => download(`dora-vorfall-${x.id}.txt`, x.draft)}>{t.download}</button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
