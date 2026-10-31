import { useEffect, useMemo, useState } from "react";
import { getSignalsBoard, type OutputType as Board } from "../endpoints/signals_board_GET.schema";
import styles from "./IntelligenceSignals.module.css";

type Kind = "all" | "rising" | "falling" | "new_major" | "dropped";
const KIND_LABEL: Record<Exclude<Kind, "all">, string> = { rising: "Rising dependence", falling: "Falling dependence", new_major: "New major customer", dropped: "Below 10% now" };
const VERDICT: Record<string, string> = { supported: "Supported", not_supported: "Not supported", collecting: "Collecting", pending: "Pending" };
const share = (v: number | null) => (v === null ? "<10%" : `${Math.round(v * 100)}%`);

/** Top of the Intelligence workspace: the verified signals first, in the brand's design language. */
export function IntelligenceSignals() {
  const [b, setB] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<Kind>("all");
  const [more, setMore] = useState(false);
  const [cat, setCat] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    getSignalsBoard().then((x) => alive && setB(x)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const shifts = useMemo(() => (b?.shifts.events ?? []).filter((s) => kind === "all" || s.kind === kind), [b, kind]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of b?.tenders.notices ?? []) for (const c of t.categories) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([c]) => c);
  }, [b]);
  const tenders = (b?.tenders.notices ?? []).filter((t) => cat === "all" || t.categories.includes(cat));
  const counts = b?.shifts.counts;
  const total = counts ? counts.rising + counts.falling + counts.newMajor + counts.dropped : null;
  const tested = b?.scoreboard.filter((s) => s.verdict !== "collecting" && s.verdict !== "pending").length ?? null;
  const passed = b?.scoreboard.filter((s) => s.verdict === "supported").length ?? null;

  return (
    <div className={styles.wrap}>
      <header className={styles.hero} id="signals">
        <span className={styles.eyebrow}>Intelligence · official records, checked</span>
        <h1 className={styles.h1}>What changed in the economy this year, <em>and what did not hold up.</em></h1>
        <p className={styles.lead}>Every signal on this page comes from an official record (SEC annual filings, EU tender notices) and links to it. Every trading idea we tested is listed with its result, including the ones that failed.</p>
        <div className={styles.kpis}>
          <div><b>{total ?? "—"}</b><span>customer-dependence changes in the latest annual filings</span></div>
          <div><b>{b ? b.tenders.total : "—"}</b><span>open public contracts in {b ? b.tenders.countries : "—"} countries</span></div>
          <div><b>{tested === null ? "—" : `${passed} of ${tested}`}</b><span>trading ideas passed our tests</span></div>
          <div><b>{b ? new Date(b.generatedAt).toISOString().slice(11, 16) : "—"}</b><span>last refresh, UTC</span></div>
        </div>
        {failed && <p className={styles.warn}>Signals are temporarily unavailable.</p>}
      </header>

      <section className={styles.block} id="shifts">
        <div className={styles.head}>
          <div>
            <span className={styles.num}>01</span>
            <h2 className={styles.h2}>Who became more, or less, dependent on one customer</h2>
            <p className={styles.sub}>From each company's latest annual SEC filing: a customer's share of its revenue this fiscal year against last year. A rising share is concentration risk; a falling or lost customer can mean a contract ended.</p>
          </div>
        </div>
        <div className={styles.filters} role="tablist" aria-label="Filter dependency changes">
          {(["all", "rising", "falling", "new_major", "dropped"] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? styles.on : ""} onClick={() => { setKind(k); setMore(false); }}>
              {k === "all" ? "All" : KIND_LABEL[k]}
              {counts && <small>{k === "all" ? total : counts[k === "new_major" ? "newMajor" : k]}</small>}
            </button>
          ))}
        </div>
        <div className={styles.cards}>
          {!b && !failed && Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.skel} />)}
          {shifts.slice(0, more ? 24 : 9).map((s) => (
            <a key={`${s.supplierTicker}-${s.customer}`} className={`${styles.card} ${styles[`k_${s.kind}`]}`} href={s.sourceUrl} target="_blank" rel="noreferrer">
              <span className={styles.kind}>{KIND_LABEL[s.kind]}</span>
              <span className={styles.move}>{share(s.previous)}<i>→</i>{share(s.current)}</span>
              <p>{s.sentence}</p>
              <span className={styles.meta}><b>{s.supplierTicker}</b>{s.customerTicker ? ` · customer ${s.customerTicker}` : ""} · filed {s.filedAt}<em>Source filing ↗</em></span>
            </a>
          ))}
        </div>
        {shifts.length > 9 && <button className={styles.more} onClick={() => setMore((v) => !v)}>{more ? "Show fewer" : `Show ${Math.min(24, shifts.length) - 9} more`}</button>}
        <div className={styles.upsell}>
          <p><b>The complete dataset</b> — every disclosed customer relationship with share, period and source, refreshed weekly, as CSV or API.</p>
          <a href="/data">Get the dependency data · $99 / month</a>
        </div>
      </section>

      <section className={styles.block} id="scoreboard">
        <div className={styles.head}>
          <div>
            <span className={styles.num}>02</span>
            <h2 className={styles.h2}>Trading ideas we tested, and the verdict</h2>
            <p className={styles.sub}>We only call an idea supported after it survives trading costs and out-of-sample testing. Negative results stay public.</p>
          </div>
        </div>
        <ol className={styles.board}>
          {b?.scoreboard.map((s, i) => (
            <li key={s.id}>
              <span className={styles.idx}>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.finding}</p>
                <small>{s.sample} · <a href={s.url} target="_blank" rel="noreferrer">evidence ↗</a></small>
              </div>
              <span className={`${styles.verdict} ${styles[`v_${s.verdict}`]}`}>{VERDICT[s.verdict] ?? s.verdict}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.block} id="contracts">
        <div className={styles.head}>
          <div>
            <span className={styles.num}>03</span>
            <h2 className={styles.h2}>Open public contracts in digital and energy infrastructure</h2>
            <p className={styles.sub}>Official EU tender notices (TED), one row per notice. Open a notice for its value, lots and deadline. Listed suppliers are companies in our graph with a matching capability, not bidders.</p>
          </div>
        </div>
        {cats.length > 0 && (
          <div className={styles.filters} role="tablist" aria-label="Filter contracts by category">
            <button role="tab" aria-selected={cat === "all"} className={cat === "all" ? styles.on : ""} onClick={() => setCat("all")}>All</button>
            {cats.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? styles.on : ""} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        )}
        <ul className={styles.contracts}>
          {tenders.slice(0, 12).map((t) => (
            <li key={t.url}>
              <a href={t.url} target="_blank" rel="noreferrer">
                <span className={styles.cc}>{t.country}</span>
                <div>
                  <b>{t.buyer}</b>
                  <span>{t.categories.join(" · ") || "See notice"}</span>
                  <small>Fits: {t.capability ?? "—"} · e.g. {t.suppliers.slice(0, 3).join(", ")}</small>
                </div>
                <span className={styles.date}>{t.firstSeen.slice(0, 10)}<em>Open notice ↗</em></span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
