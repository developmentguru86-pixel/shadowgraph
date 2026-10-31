import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { postWatchConfirm } from "../endpoints/watch/confirm_POST.schema";
import styles from "./alerts.confirm.module.css";

/** Double opt-in landing page for the concentration watch. */
export default function ConfirmWatch() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; slugs: string[]; names: string[] } | { kind: "error"; msg: string }>({ kind: "loading" });
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    postWatchConfirm(t).then((r) => setState("error" in r ? { kind: "error", msg: r.error } : { kind: "ok", slugs: r.slugs, names: r.names }))
      .catch(() => setState({ kind: "error", msg: "Something went wrong. Please open the link again." }));
  }, []);
  return (
    <>
      <Helmet><title>Confirm your watch · ShadowGraph</title><meta name="robots" content="noindex" /></Helmet>
      <SiteHeader />
      <main className={styles.page}>
        {state.kind === "loading" && <p className={styles.muted}>Confirming…</p>}
        {state.kind === "error" && <><h1 className={styles.h1}>This link did not work</h1><p className={styles.lead}>{state.msg}</p><a className={styles.ghost} href="/companies">Browse companies</a></>}
        {state.kind === "ok" && (
          <>
            <span className={styles.eyebrow}>Watch active</span>
            <h1 className={styles.h1}>You're watching {state.names.join(", ")}.</h1>
            <p className={styles.lead}>When a new 10-K or 20-F adds a 10% customer, drops one or moves a share by 5 points or more, you get an email with the change and the filing link. Add more companies from any company page, up to 10.</p>
            <div className={styles.row}>
              {state.slugs.slice(0, 3).map((s, i) => <a key={s} className={styles.ghost} href={`/company/${s}`}>{state.names[i]}</a>)}
              <a className={styles.primary} href="/companies">Add more companies</a>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
