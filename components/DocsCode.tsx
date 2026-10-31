import { useState, type ReactNode } from "react";
import styles from "./DocsCode.module.css";

/** Code blocks for the API documentation: copy button, optional tabs (languages / clients) and JSON highlighting. */

export function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    if (m[1]) { out.push(<span key={i++} className={m[2] ? styles.tKey : styles.tStr}>{m[1]}</span>); if (m[2]) out.push(m[2]); }
    else if (m[3]) out.push(<span key={i++} className={styles.tLit}>{m[3]}</span>);
    else out.push(<span key={i++} className={styles.tNum}>{m[4]}</span>);
    last = re.lastIndex;
  }
  out.push(src.slice(last));
  return out;
}

/** Shell, Python and JS comments dimmed; strings tinted. Cheap and good enough for short samples. */
function shade(src: string): ReactNode[] {
  return src.split("\n").map((line, i, all) => {
    const c = /^\s*(#|\/\/)/.test(line);
    return <span key={i} className={c ? styles.tCom : undefined}>{line}{i < all.length - 1 ? "\n" : ""}</span>;
  });
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={styles.copy} onClick={() => {
      try { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : label}</button>
  );
}

export function CodeBlock({ code, json, title, extra, className, maxHeight }: { code: string; json?: boolean; title?: ReactNode; extra?: ReactNode; className?: string; maxHeight?: number }) {
  return (
    <div className={`${styles.code} ${className ?? ""}`}>
      <div className={styles.bar}><span className={styles.title}>{title}</span><span className={styles.actions}>{extra}<CopyButton text={code} /></span></div>
      <pre style={maxHeight ? { maxHeight } : undefined}><code>{json ? highlight(code) : shade(code)}</code></pre>
    </div>
  );
}

export type CodeTab = { label: string; code: string; json?: boolean; note?: ReactNode; file?: string };

export function TabbedCode({ tabs, className, maxHeight }: { tabs: CodeTab[]; className?: string; maxHeight?: number }) {
  const [i, setI] = useState(0);
  const t = tabs[Math.min(i, tabs.length - 1)];
  return (
    <div className={`${styles.code} ${className ?? ""}`}>
      <div className={styles.bar}>
        <span className={styles.tabs} role="tablist">
          {tabs.map((x, k) => <button key={x.label} type="button" role="tab" aria-selected={k === i} className={k === i ? styles.tabOn : styles.tab} onClick={() => setI(k)}>{x.label}</button>)}
        </span>
        <span className={styles.actions}><CopyButton text={t.code} /></span>
      </div>
      {(t.file || t.note) && <div className={styles.note}>{t.file && <code>{t.file}</code>}{t.note}</div>}
      <pre style={maxHeight ? { maxHeight } : undefined}><code>{t.json ? highlight(t.code) : shade(t.code)}</code></pre>
    </div>
  );
}
