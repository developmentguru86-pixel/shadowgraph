import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { postConfirmFreeAlert } from "../endpoints/free_alert/confirm_POST.schema";
import styles from "./alerts.confirm.module.css";

const T = {
  en: {
    title: "Confirm your alert · ShadowGraph", loading: "Confirming…", badH: "This link did not work", fail: "Something went wrong. Please open the link again.",
    back: "Back to live status", backHref: "/is-it-down", eyebrow: "Alert active",
    h: (n: string) => `You'll hear from us when ${n} goes down.`,
    lead: (n: string) => `We check ${n} every 5 minutes and email you when it fails two checks in a row, when it is back, and when a cloud, CDN or DNS provider it depends on has an outage.`,
  },
  de: {
    title: "Benachrichtigung bestätigen · ShadowGraph", loading: "Wird bestätigt…", badH: "Dieser Link hat nicht funktioniert", fail: "Etwas ist schiefgelaufen. Bitte öffne den Link noch einmal.",
    back: "Zurück zum Live-Status", backHref: "/de/ist-es-down", eyebrow: "Benachrichtigung aktiv",
    h: (n: string) => `Wir melden uns, wenn ${n} ausfällt.`,
    lead: (n: string) => `Wir prüfen ${n} alle 5 Minuten und schreiben dir, wenn es zwei Prüfungen hintereinander nicht besteht, wenn es wieder geht und wenn ein Cloud-, CDN- oder DNS-Anbieter, an dem es hängt, eine Störung hat.`,
  },
};

/** Double opt-in landing page for the free alert, with the upgrade path to stack alerts. `?l=de` = German sign-up. */
export default function ConfirmFreeAlert() {
  const [lang, setLang] = useState<"en" | "de">("en");
  const t = T[lang];
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; name: string; ids: string[] } | { kind: "error"; msg: string }>({ kind: "loading" });
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const l = qs.get("l") === "de" ? "de" : "en";
    setLang(l);
    postConfirmFreeAlert(qs.get("t") ?? "").then((r) => setState("error" in r ? { kind: "error", msg: r.error } : { kind: "ok", name: r.name, ids: r.serviceIds }))
      .catch(() => setState({ kind: "error", msg: T[l].fail }));
  }, []);
  return (
    <>
      <Helmet htmlAttributes={{ lang }}><title>{t.title}</title><meta name="robots" content="noindex" /></Helmet>
      <SiteHeader />
      <main className={styles.page}>
        {state.kind === "loading" && <p className={styles.muted}>{t.loading}</p>}
        {state.kind === "error" && <><h1 className={styles.h1}>{t.badH}</h1><p className={styles.lead}>{state.msg}</p><a className={styles.ghost} href={t.backHref}>{t.back}</a></>}
        {state.kind === "ok" && (
          <>
            <span className={styles.eyebrow}>{t.eyebrow}</span>
            <h1 className={styles.h1}>{t.h(state.name)}</h1>
            <p className={styles.lead}>{t.lead(state.name)}</p>
            {lang === "de" ? (
              <a className={styles.ghost} href={t.backHref}>{t.back}</a>
            ) : (
              <section className={styles.card}>
                <h2 className={styles.h2}>Your business runs on more than one tool</h2>
                <p className={styles.muted}>Stack alerts watch up to 25 services and the shared providers underneath them, in Slack, Microsoft Teams, a webhook or email, with early warnings, certificate and domain expiry, and checks of your own endpoints.</p>
                <div className={styles.row}>
                  <a className={styles.primary} href={`/alerts?s=${encodeURIComponent(state.ids.join(","))}`}>Start 14 days free</a>
                  <a className={styles.ghost} href="/check">Check my stack first</a>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
