import { useState } from "react";
import { postWatchSubscribe } from "../endpoints/watch/subscribe_POST.schema";
import styles from "./WatchForm.module.css";

/** Free concentration watch for one company (double opt-in, up to 10 companies per address). */
export function WatchForm({ slug, name, source }: { slug: string; name: string; source: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued" | "added" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [count, setCount] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const r = await postWatchSubscribe({ email, slug, source });
      if ("error" in r) { setState("error"); setMsg(r.error); return; }
      setCount(r.count); setState(r.status);
    } catch { setState("error"); setMsg("Something went wrong. Please try again."); }
  };

  return (
    <section className={styles.box} aria-labelledby="watch-h">
      <div className={styles.copy}>
        <span className={styles.badge}>Free</span>
        <h2 id="watch-h" className={styles.h}>Get an email when {name}'s customer concentration changes</h2>
        <p className={styles.sub}>When a new annual report adds a 10% customer, drops one, or moves a share by 5 points or more, you get the change and the filing link. Up to 10 companies per address, no account, unsubscribe with one click.</p>
      </div>
      {state === "sent" || state === "queued" || state === "added" ? (
        <p className={styles.done} role="status">
          {state === "added" ? `Added. You are now watching ${count} ${count === 1 ? "company" : "companies"}.`
            : state === "sent" ? `Check your inbox: click the link in our email to start watching ${name}.`
            : `You're on the list. We'll email you a confirmation link shortly; the watch starts when you click it.`}
        </p>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
          <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : `Watch ${name}`}</button>
          {state === "error" && <p className={styles.err} role="alert">{msg}</p>}
          <p className={styles.legal}>We only use your address for this watch. Double opt-in, see our <a href="/privacy">privacy notice</a>.</p>
        </form>
      )}
    </section>
  );
}
