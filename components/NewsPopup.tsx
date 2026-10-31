import { useEffect, useState } from "react";
import { X } from "lucide-react";
import styles from "./NewsPopup.module.css";

/** Current announcement on the homepage. Change id when the story changes; a visitor who closed or opened it does not see it again. */
const NEWS = {
  id: "php2shell-2026-10",
  href: "/research/php2shell",
  eyebrow: "New research · 21 October",
  title: "PHP2Shell: who went offline?",
  text: "173 long outages in one day, five European research networks down, and TYPO3 sites hit far more often than others. What our radar measured after the PHP flaws were disclosed.",
  cta: "Read the case study",
};
const KEY = "sg-news-seen";

const seen = () => { try { return window.localStorage.getItem(KEY) === NEWS.id; } catch { return false; } };
const markSeen = () => { try { window.localStorage.setItem(KEY, NEWS.id); } catch { /* storage blocked: it just shows again next visit */ } };

export function NewsPopup() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (seen()) return;
    const t = setTimeout(() => setOpen(true), 1800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => { markSeen(); setOpen(false); };
  if (!open) return null;
  return (
    <aside className={styles.card} role="dialog" aria-modal="false" aria-labelledby="news-title">
      <button type="button" className={styles.close} onClick={close} aria-label="Close"><X size={16} /></button>
      <span className={styles.eyebrow}><i className={styles.dot} />{NEWS.eyebrow}</span>
      <h2 id="news-title" className={styles.title}>{NEWS.title}</h2>
      <p className={styles.text}>{NEWS.text}</p>
      <div className={styles.actions}>
        <a href={NEWS.href} className={styles.cta} onClick={markSeen}>{NEWS.cta}</a>
        <button type="button" className={styles.later} onClick={close}>Not now</button>
      </div>
    </aside>
  );
}
