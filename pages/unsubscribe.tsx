import { useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { postUnsubscribe } from "../endpoints/email/unsubscribe_POST.schema";
import styles from "./alerts.confirm.module.css";

/** Unsubscribe page: a button, never on page load (mail scanners open links). */
export default function Unsubscribe() {
  const [done, setDone] = useState<"idle" | "busy" | "done">("idle");
  const go = async () => {
    setDone("busy");
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    try { await postUnsubscribe(t); } catch { /* the endpoint always answers ok */ }
    setDone("done");
  };
  return (
    <>
      <Helmet><title>Unsubscribe · ShadowGraph</title><meta name="robots" content="noindex" /></Helmet>
      <SiteHeader />
      <main className={styles.page}>
        {done === "done" ? (
          <><h1 className={styles.h1}>You're unsubscribed.</h1><p className={styles.lead}>We won't email this address about this alert again.</p><a className={styles.ghost} href="/is-it-down">Back to live status</a></>
        ) : (
          <><h1 className={styles.h1}>Stop these alert emails?</h1><p className={styles.lead}>One click and we stop emailing this address about this alert.</p>
            <button className={styles.primary} style={{ border: 0, cursor: "pointer", font: "inherit" }} onClick={go} disabled={done === "busy"}>{done === "busy" ? "Unsubscribing…" : "Unsubscribe"}</button></>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
