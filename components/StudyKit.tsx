import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { fmt, lift, pv, verdict } from "../helpers/researchFormat";
import styles from "./StudyKit.module.css";

/** Building blocks shared by the Research pages and the Upstream Signals page. */

export function PageIntro({ eyebrow, title, lede, meta, className }: {
  eyebrow: string; title: ReactNode; lede: ReactNode; meta?: Array<[string, ReactNode]>; className?: string;
}) {
  return (
    <header className={`${styles.intro} ${className ?? ""}`}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.h1}>{title}</h1>
      <p className={styles.lede}>{lede}</p>
      {meta && meta.length > 0 && (
        <dl className={styles.meta}>
          {meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </header>
  );
}

export function PlainWords({ title = "In plain words", items, className }: { title?: string; items: ReactNode[]; className?: string }) {
  return (
    <aside className={`${styles.plain} ${className ?? ""}`} aria-label={title}>
      <span className={styles.plainTitle}>{title}</span>
      <ol>{items.map((it, i) => <li key={i}>{it}</li>)}</ol>
    </aside>
  );
}

export type Metric = { label: string; value: ReactNode; note?: ReactNode; tone?: "good" | "warn" | "muted" };
export function Metrics({ items, className }: { items: Metric[]; className?: string }) {
  return (
    <div className={`${styles.metrics} ${className ?? ""}`} style={{ ["--cols" as string]: String(Math.min(items.length, 4)) }}>
      {items.map((m) => (
        <div key={m.label} className={styles.metric}>
          <span className={styles.metricLabel}>{m.label}</span>
          <b className={m.tone ? styles[m.tone] : undefined}>{m.value}</b>
          {m.note && <small>{m.note}</small>}
        </div>
      ))}
    </div>
  );
}

export function Block({ id, num, title, intro, children, className }: {
  id?: string; num?: string; title: ReactNode; intro?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <section id={id} className={`${styles.block} ${className ?? ""}`}>
      <div className={styles.blockHead}>
        {num && <span className={styles.num}>{num}</span>}
        <h2 className={styles.h2}>{title}</h2>
      </div>
      {intro && <div className={styles.blockIntro}>{intro}</div>}
      {children}
    </section>
  );
}

export function Chip({ tone, children }: { tone: "yes" | "no" | "few" | "live" | "info"; children: ReactNode }) {
  return <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{children}</span>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

export function Table({ head, rows, align, empty = "No rows yet.", highlight }: {
  head: ReactNode[]; rows: ReactNode[][]; align?: Array<"l" | "r">; empty?: string; highlight?: (i: number) => boolean;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{head.map((h, i) => <th key={i} className={align?.[i] === "r" ? styles.r : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className={styles.muted}>{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className={highlight?.(i) ? styles.shaded : undefined}>
              {r.map((c, j) => <td key={j} className={align?.[j] === "r" ? styles.r : undefined}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type FateRow = { layer: string; observed: number; expected: number; nullLo: number; nullHi: number; lift: number | null; p: number;
  organisations?: number; incidents?: number; pAdj?: number; kind?: string };

export function FateTable({ rows, perProvider, counts = true }: { rows: FateRow[]; perProvider?: boolean; counts?: boolean }) {
  const head = [perProvider ? "Provider" : "Shared layer", ...(perProvider ? ["Layer"] : []), ...(counts ? ["Companies", "Incidents"] : []),
    "Pairs observed", "Expected by chance", "Lift", perProvider ? "p (Holm)" : "p", "Verdict"];
  const align: Array<"l" | "r"> = ["l", ...(perProvider ? ["l" as const] : []), ...(counts ? ["r" as const, "r" as const] : []), "r", "r", "r", "r", "l"];
  return (
    <Table head={head} align={align} highlight={(i) => /control/i.test(rows[i].layer)}
      rows={rows.map((l) => {
        const p = perProvider ? l.pAdj ?? l.p : l.p;
        const v = verdict(l, p);
        return [
          l.layer, ...(perProvider ? [<span className={styles.muted}>{l.kind}</span>] : []),
          ...(counts ? [fmt(l.organisations), fmt(l.incidents)] : []),
          fmt(l.observed), <>{fmt(l.expected, 1)} <span className={styles.muted}>({fmt(l.nullLo)}–{fmt(l.nullHi)})</span></>,
          v.key === "few" ? "—" : <span className={v.key === "yes" ? styles.good : undefined}>{lift(l.lift)}</span>,
          v.key === "few" ? "—" : pv(p), <Chip tone={v.key}>{v.label}</Chip>,
        ];
      })}
    />
  );
}

export function NextLinks({ links, title = "Continue" }: { links: Array<{ href: string; label: string; desc: string }>; title?: string }) {
  return (
    <nav className={styles.next} aria-label={title}>
      <span className={styles.eyebrow}>{title}</span>
      <div>
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            <span><b>{l.label}</b><small>{l.desc}</small></span>
            <ArrowRight size={16} />
          </a>
        ))}
      </div>
    </nav>
  );
}

export function DataState({ loading, error }: { loading: boolean; error: unknown }) {
  if (error) return <p className={styles.state}>The live results are temporarily unavailable. Please try again in a minute.</p>;
  if (loading) return <p className={styles.state}>Loading the latest results…</p>;
  return null;
}
