import { useEffect, useRef, useState } from "react";
import { getSearch } from "../endpoints/search_GET.schema";
import { getStatusPage, type OutputType as PageData } from "../endpoints/status/page_GET.schema";
import type { SearchService } from "../helpers/globalSearch";
import { verdictFor, ago, statusPath, type Lang } from "../helpers/statusCopy";
import styles from "./DownCheck.module.css";

const T = {
  en: {
    label: "Does it work right now?", placeholder: "e.g. GitHub, Netflix, Stripe, bank99", button: "Check",
    none: (q: string) => `We don't monitor "${q}" yet. Try the brand name or the website address.`,
    checking: "Checking the latest measurement…", failed: "Could not load the status. Please try again.",
    details: "Details & what it runs on", alert: "Email me when it fails", checked: (a: string) => `Checked ${a}`,
    note: "Measured every 5 minutes from independent probes, not from user reports.",
  },
  de: {
    label: "Funktioniert es gerade?", placeholder: "z. B. George, ORF, A1, Netflix", button: "Prüfen",
    none: (q: string) => `„${q}“ überwachen wir noch nicht. Versuch den Markennamen oder die Web-Adresse.`,
    checking: "Letzte Messung wird geladen…", failed: "Der Status konnte nicht geladen werden. Bitte versuch es noch einmal.",
    details: "Details & worauf es läuft", alert: "Per E-Mail benachrichtigen", checked: (a: string) => `Geprüft ${a}`,
    note: "Alle 5 Minuten unabhängig gemessen, nicht aus Nutzer-Meldungen geschätzt.",
  },
};

/**
 * "Does X work right now?" — type a name, get a one-sentence answer with a traffic light, since when, and the cause
 * if a provider is involved. Same verdict rules as the status pages. Suggestions come from the site search (quick mode).
 */
export function DownCheck({ lang, compact = false, examples = [] }: { lang: Lang; compact?: boolean; examples?: Array<{ slug: string; name: string }> }) {
  const t = T[lang];
  const [q, setQ] = useState("");
  const [list, setList] = useState<SearchService[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<{ slug: string; name: string } | null>(null);
  const [page, setPage] = useState<PageData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "none" | "error">("idle");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || (picked && term === picked.name)) { setList([]); return; }
    const timer = setTimeout(() => {
      abort.current?.abort();
      const ac = new AbortController(); abort.current = ac;
      getSearch(term, true, ac.signal).then((r) => { setList(r.services.slice(0, 6)); setActive(0); setOpen(true); }).catch(() => undefined);
    }, 220);
    return () => clearTimeout(timer);
  }, [q, picked]);

  const check = async (s: { slug: string; name: string }) => {
    setPicked(s); setQ(s.name); setOpen(false); setState("loading"); setPage(null);
    try { setPage(await getStatusPage(s.slug)); setState("idle"); } catch { setState("error"); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    if (list[active]) return check(list[active]);
    setState("loading");
    try {
      const r = await getSearch(term, true);
      if (r.services[0]) return check(r.services[0]);
      setPage(null); setState("none");
    } catch { setState("error"); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !list.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === "Escape") setOpen(false);
  };

  const v = page ? verdictFor(lang, page) : null;
  const dot = (s: string) => (s === "up" ? styles.dUp : s === "down" ? styles.dDown : s === "degraded" ? styles.dWarn : styles.dIdle);

  return (
    <section className={`${styles.wrap} ${compact ? styles.compact : ""}`} aria-label={t.label}>
      <form className={styles.form} onSubmit={submit} role="search">
        <label className={styles.label} htmlFor={`downcheck-${lang}`}>{t.label}</label>
        <div className={styles.row}>
          <div className={styles.field}>
            <input id={`downcheck-${lang}`} value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); }} onKeyDown={onKey}
              onFocus={() => list.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={t.placeholder} autoComplete="off" spellCheck={false} role="combobox" aria-expanded={open} aria-controls={`downcheck-list-${lang}`} aria-autocomplete="list" />
            {open && list.length > 0 && (
              <ul id={`downcheck-list-${lang}`} className={styles.list} role="listbox">
                {list.map((s, i) => (
                  <li key={s.id} role="option" aria-selected={i === active}>
                    <button type="button" className={i === active ? styles.on : undefined} onMouseDown={(e) => { e.preventDefault(); check(s); }}>
                      <i className={dot(s.state)} /><span>{s.name}</span><small>{s.domain}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" className={styles.go}>{t.button}</button>
        </div>
        {!page && state === "idle" && examples.length > 0 && (
          <div className={styles.examples}>{examples.map((x) => <button type="button" key={x.slug} onClick={() => check(x)}>{x.name}</button>)}</div>
        )}
      </form>

      {state === "loading" && <p className={styles.muted} role="status">{t.checking}</p>}
      {state === "none" && <p className={styles.muted} role="status">{t.none(q.trim())}</p>}
      {state === "error" && <p className={styles.warn} role="status">{t.failed}</p>}
      {page && v && picked && (
        <div className={`${styles.answer} ${styles[`a_${v.level}`]}`} role="status" aria-live="polite">
          <i className={styles.adot} />
          <div className={styles.body}>
            <p className={styles.head}>{v.headline}</p>
            <p className={styles.detail}>{v.detail}</p>
            <p className={styles.meta}>{page.checkedAt ? `${t.checked(ago(lang, page.checkedAt))} · ` : ""}{t.note}</p>
            <div className={styles.actions}>
              <a href={statusPath(lang, page.slug)}>{t.details}</a>
              <a href={`${statusPath(lang, page.slug)}#alert`} className={styles.secondary}>{t.alert}</a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
