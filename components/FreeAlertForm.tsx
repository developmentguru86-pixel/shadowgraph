import { useState } from "react";
import { postFreeAlert } from "../endpoints/free_alert/subscribe_POST.schema";
import styles from "./FreeAlertForm.module.css";

const COPY = {
  en: {
    badge: "Free",
    h: (n: string) => `Get an email when ${n} goes down`,
    sub: (n: string) => `Checked every 5 minutes from independent probes. We also tell you when the cloud, CDN or DNS provider underneath ${n} has an outage, and when it works again. No account, unsubscribe with one click.`,
    sent: (n: string) => `Check your inbox: click the link in our email to switch on your ${n} alert.`,
    queued: (n: string) => `You're on the list. We'll email you a confirmation link shortly; your ${n} alert starts when you click it.`,
    placeholder: "you@example.com", email: "Email address", sending: "Sending…", btn: "Alert me for free",
    error: "Something went wrong. Please try again.",
    legal: "We only use your address for this alert. Double opt-in, see our", privacy: "privacy notice",
  },
  de: {
    badge: "Gratis",
    h: (n: string) => `E-Mail bekommen, wenn ${n} ausfällt`,
    sub: (n: string) => `Alle 5 Minuten unabhängig geprüft. Wir melden uns auch, wenn der Cloud-, CDN- oder DNS-Anbieter hinter ${n} eine Störung hat, und wenn es wieder geht. Kein Konto, Abmeldung mit einem Klick.`,
    sent: (n: string) => `Schau in dein Postfach: Klick auf den Link in unserer E-Mail, um die Benachrichtigung für ${n} einzuschalten.`,
    queued: (n: string) => `Du bist eingetragen. Wir schicken dir gleich einen Bestätigungslink; die Benachrichtigung für ${n} startet, sobald du ihn anklickst.`,
    placeholder: "du@beispiel.at", email: "E-Mail-Adresse", sending: "Wird gesendet…", btn: "Gratis benachrichtigen",
    error: "Etwas ist schiefgelaufen. Bitte versuch es noch einmal.",
    legal: "Wir nutzen deine Adresse nur für diese Benachrichtigung. Double-Opt-in, siehe", privacy: "Datenschutzhinweis",
  },
};

/** Free email alert for one status page (double opt-in). The lead magnet for the paid stack alerts. */
export function FreeAlertForm({ serviceIds, name, source, lang = "en" }: { serviceIds: string[]; name: string; source: string; lang?: "en" | "de" }) {
  const t = COPY[lang];
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (!serviceIds.length) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const r = await postFreeAlert({ email, serviceIds: serviceIds.slice(0, 10), name, source });
      if ("error" in r) { setState("error"); setMsg(r.error); return; }
      setState(r.status);
    } catch { setState("error"); setMsg(t.error); }
  };

  return (
    <section className={styles.box} aria-labelledby="free-alert-h">
      <div className={styles.copy}>
        <span className={styles.badge}>{t.badge}</span>
        <h2 id="free-alert-h" className={styles.h}>{t.h(name)}</h2>
        <p className={styles.sub}>{t.sub(name)}</p>
      </div>
      {state === "sent" || state === "queued" ? (
        <p className={styles.done} role="status">{state === "sent" ? t.sent(name) : t.queued(name)}</p>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <input type="email" required autoComplete="email" placeholder={t.placeholder} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t.email} />
          <button type="submit" disabled={state === "sending"}>{state === "sending" ? t.sending : t.btn}</button>
          {state === "error" && <p className={styles.err} role="alert">{msg}</p>}
          <p className={styles.legal}>{t.legal} <a href="/privacy">{t.privacy}</a>.</p>
        </form>
      )}
    </section>
  );
}
