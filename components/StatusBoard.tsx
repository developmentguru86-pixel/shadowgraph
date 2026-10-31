import type { CSSProperties } from "react";
import type { PublicBoard, BoardItem, BoardEvent, BoardDependency, DayBar } from "../helpers/statusBoards";
import styles from "./StatusBoard.module.css";

const STATE: Record<BoardItem["state"], string> = { up: "Operational", degraded: "Degraded", down: "Down", unknown: "No data" };
const HEADLINE: Record<PublicBoard["overall"], string> = {
  operational: "All systems operational", degraded: "Some systems are degraded", outage: "Some systems are down", unknown: "Waiting for the first checks",
};
const LAYER: Record<BoardDependency["layer"], string> = { hosting: "Hosting", cdn: "Content delivery", dns: "DNS" };
const SOURCE: Record<BoardEvent["kind"], string> = { detected: "Detected by probes", declared: "Declared by vendor", provider: "Provider notice" };

const pct = (v: number | null, d = 2) => (v === null ? "—" : `${(v * 100).toFixed(v >= 0.99995 ? 0 : d)}%`);
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dur = (a: string, b: string | null) => {
  if (!b) return "ongoing";
  if (Date.parse(b) < Date.parse(a)) return "resolved";
  const m = Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
  return m < 90 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
};
const tone = (d: DayBar) => (d.up === null ? "none" : d.up >= 0.999 && !d.disruptions ? "ok" : d.up >= 0.99 ? "minor" : d.up >= 0.95 ? "warn" : "bad");

function Bars({ days, from }: { days: DayBar[]; from: number }) {
  const shown = days.slice(from);
  return (
    <div className={styles.bars} role="img" aria-label={`Daily availability, last ${shown.length} days`}>
      {shown.map((d) => (
        <span key={d.d} className={`${styles.bar} ${styles[`b_${tone(d)}`]}`}
          data-tip={`${dayLabel(d.d)} · ${d.up === null ? "no data yet" : `${pct(d.up)} available`}${d.disruptions ? ` · ${d.disruptions} disruption${d.disruptions > 1 ? "s" : ""}` : ""}`} />
      ))}
    </div>
  );
}

function Budget({ i, month, target }: { i: BoardItem; month: string; target: number }) {
  const m = i.month;
  if (m.budgetMin === null || m.up === null) return null;
  const used = m.usedShare ?? 0;
  const level = used > 1 ? "bad" : used >= 0.5 ? "warn" : "ok";
  return (
    <div className={styles.budget}>
      <span className={styles.budgetText}>
        {month}: <b>{Math.round(m.downMin)} of {Math.round(m.budgetMin)} min</b> allowed downtime used{used > 1 ? ` · below the ${(target * 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}% target` : ""}
      </span>
      <span className={styles.budgetTrack} aria-hidden="true"><i className={styles[`u_${level}`]} style={{ width: `${Math.min(100, Math.max(used > 0 ? 2 : 0, used * 100))}%` }} /></span>
    </div>
  );
}

function ItemRow({ i, compact, from, fromLabel, month, target }: { i: BoardItem; compact: boolean; from: number; fromLabel: string; month: string; target: number | null }) {
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <span className={`${styles.dot} ${styles[`d_${i.state}`]}`} aria-hidden="true" />
        <span className={styles.itemName}>{i.name}</span>
        {i.statusPage && !compact && <a className={styles.official} href={i.statusPage} target="_blank" rel="noopener noreferrer">Official status</a>}
        <span className={styles.itemState}>{i.state === "up" ? pct(i.uptime30) : STATE[i.state]}{i.state === "down" && i.since ? ` since ${when(i.since)}` : ""}</span>
      </div>
      <Bars days={i.days} from={from} />
      <div className={styles.itemFoot}>
        <span>{fromLabel}</span>
        <span className={styles.runs}>{[i.runsOn, i.p50 !== null ? `median ${ms(i.p50)}` : null].filter(Boolean).join(" · ")}</span>
        <span>Today</span>
      </div>
      {target !== null && !compact && <Budget i={i} month={month} target={target} />}
    </li>
  );
}

function SharedRisk({ deps, total }: { deps: BoardDependency[]; total: number }) {
  const top = deps.flatMap((d) => d.providers.map((p) => ({ ...p, layer: d.layer }))).sort((a, b) => b.count - a.count)[0];
  if (!top || total < 2) return null;
  return (
    <section className={styles.section} aria-labelledby="risk-h">
      <div className={styles.sectionHead}>
        <h2 id="risk-h" className={styles.h2}>Shared risk</h2>
        <span className={styles.sectionNote}>What these tools have in common underneath</span>
      </div>
      {top.count >= 2 && (
        <p className={styles.callout}>
          <b>{top.count} of {total}</b> depend on <b>{top.name}</b> for {top.layer === "dns" ? "DNS" : LAYER[top.layer].toLowerCase()}. One incident there can reach {top.count === total ? "all of them" : "these"} at the same time, even when each vendor's own status page looks fine.
        </p>
      )}
      <div className={styles.layers}>
        {deps.map((d) => (
          <div key={d.layer} className={styles.layer}>
            <span className={styles.layerName}>{LAYER[d.layer]}</span>
            <div className={styles.stack} aria-hidden="true">
              {d.providers.map((p, k) => <i key={p.name} style={{ width: `${(p.count / total) * 100}%`, opacity: Math.max(0.35, 1 - k * 0.22) }} />)}
            </div>
            <span className={styles.layerList}>
              {d.providers.length ? d.providers.slice(0, 3).map((p) => `${p.name} ${p.count}`).join(" · ") : "Not observable"}
              {total - d.known > 0 && d.providers.length ? ` · unknown ${total - d.known}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Events({ events, compact }: { events: BoardEvent[]; compact: boolean }) {
  const list = compact ? events.slice(0, 3) : events.slice(0, 12);
  return (
    <section className={styles.section} aria-labelledby="ev-h">
      <div className={styles.sectionHead}>
        <h2 id="ev-h" className={styles.h2}>Recent events</h2>
        <span className={styles.sectionNote}>Last 30 days, from three independent sources</span>
      </div>
      {list.length === 0 ? <p className={styles.quiet}>Nothing to report in the last 30 days.</p> : (
        <ol className={styles.events}>
          {list.map((e, k) => (
            <li key={k} className={styles.event}>
              <span className={styles.evWhen}>{when(e.at)}</span>
              <div className={styles.evBody}>
                <span className={styles.badges}>
                  <span className={`${styles.badge} ${styles[`k_${e.kind}`]}`}>{e.kind === "declared" ? `Declared by ${e.source}` : e.kind === "provider" ? `${e.source} notice` : SOURCE[e.kind]}</span>
                  {e.leadMinutes !== null && <span className={`${styles.badge} ${styles.k_lead}`}>Our checks saw it {e.leadMinutes} min before the vendor posted</span>}
                </span>
                <p className={styles.evTitle}>{e.link ? <a href={e.link} target="_blank" rel="noopener noreferrer">{e.title}</a> : e.title}</p>
                <span className={styles.evMeta}>{dur(e.at, e.endedAt)} · {e.affects.slice(0, 4).join(", ")}{e.affects.length > 4 ? ` and ${e.affects.length - 4} more` : ""}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Branded, read-only status board. The owner's accent carries the brand; status colours stay semantic. */
export function StatusBoard({ board, compact = false, fill = true }: { board: PublicBoard; compact?: boolean; fill?: boolean }) {
  const services = board.items.filter((i) => i.group === "service");
  const endpoints = board.items.filter((i) => i.group === "endpoint");
  const s = board.summary;
  const counted = board.items.filter((i) => i.state !== "unknown").length;
  // start the bars at the first measured day (at least 7 bars), so a young board is not mostly grey
  const n = board.items[0]?.days.length ?? 30;
  const first = Math.min(...board.items.map((i) => { const k = i.days.findIndex((d) => d.up !== null); return k < 0 ? n : k; }), n);
  const from = Math.max(0, Math.min(first, n - 7, compact ? n - 14 : n));
  const fromLabel = from === 0 || !board.items[0] ? `${n} days ago` : `Since ${dayLabel(board.items[0].days[from].d)}`;
  const target = s.slaTarget;
  const monthShort = s.monthLabel.split(" ")[0];
  return (
    <div className={`${styles.board} ${board.theme === "light" ? styles.light : ""} ${compact ? styles.compact : ""} ${fill ? "" : styles.framed}`} style={{ "--accent": board.accent } as CSSProperties}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <div className={styles.brand}>
            {board.logoUrl && <img src={board.logoUrl} alt="" className={styles.logo} />}
            <h1 className={styles.title}>{board.title}</h1>
          </div>
          <span className={styles.live}><i aria-hidden="true" />Live · checked {ago(board.checkedAt)}</span>
        </header>
        {board.note && !compact && <p className={styles.note}>{board.note}</p>}

        <section className={`${styles.hero} ${styles[`o_${board.overall}`]}`} role="status">
          <div className={styles.heroMain}>
            <span className={styles.heroIcon} aria-hidden="true">{board.overall === "operational" ? "✓" : board.overall === "unknown" ? "…" : "!"}</span>
            <div>
              <p className={styles.headline}>{HEADLINE[board.overall]}</p>
              <p className={styles.sub}>{counted} of {board.items.length} systems reporting{board.incidents.length ? ` · ${board.incidents.length} provider incident${board.incidents.length > 1 ? "s" : ""} in progress` : ""}</p>
            </div>
          </div>
          {!compact && (
            <dl className={`${styles.kpis} ${target !== null ? styles.kpis4 : ""}`}>
              <div><dt>Availability</dt><dd>{pct(s.uptime30, 3)}</dd><small>over {s.daysWithData} day{s.daysWithData === 1 ? "" : "s"} measured</small></div>
              {target !== null && <div><dt>SLA {`${+(target * 100).toFixed(2)}%`}</dt><dd className={s.overBudget ? styles.kpiBad : undefined}>{s.withinBudget} of {s.withinBudget + s.overBudget}</dd><small>within allowed downtime in {monthShort}</small></div>}
              {s.earlierThanVendor > 0
                ? <div><dt>Ahead of the vendor</dt><dd>{s.earlierThanVendor}</dd><small>incident{s.earlierThanVendor > 1 ? "s" : ""} we saw before it was posted</small></div>
                : <div><dt>Disruptions</dt><dd>{s.disruptions30}</dd><small>detected in 30 days</small></div>}
              <div><dt>Median response</dt><dd>{ms(s.medianMs)}</dd><small>last 7 days</small></div>
            </dl>
          )}
        </section>

        {board.incidents.length > 0 && (
          <section className={styles.incidents} aria-label="Incidents in progress">
            {board.incidents.map((x) => (
              <div key={x.provider + x.startedAt} className={styles.incident}>
                <b>{x.provider}</b> {x.layer === "region" ? "cloud region" : x.layer} incident since {when(x.startedAt)}
                <span>Affects {x.affects.join(", ")}</span>
              </div>
            ))}
          </section>
        )}

        {endpoints.length > 0 && (
          <section className={styles.section} aria-labelledby="own-h">
            <div className={styles.sectionHead}><h2 id="own-h" className={styles.h2}>Our systems</h2></div>
            <ul className={styles.items}>{endpoints.map((i) => <ItemRow key={i.key} i={i} compact={compact} from={from} fromLabel={fromLabel} month={monthShort} target={target} />)}</ul>
          </section>
        )}
        {services.length > 0 && (
          <section className={styles.section} aria-labelledby="svc-h">
            <div className={styles.sectionHead}>
              <h2 id="svc-h" className={styles.h2}>{endpoints.length ? "Third-party services" : "Services"}</h2>
              <span className={styles.legend} aria-hidden="true"><i className={styles.b_ok} />Up<i className={styles.b_warn} />Degraded<i className={styles.b_bad} />Down<i className={styles.b_none} />No data</span>
            </div>
            <ul className={styles.items}>{services.map((i) => <ItemRow key={i.key} i={i} compact={compact} from={from} fromLabel={fromLabel} month={monthShort} target={target} />)}</ul>
          </section>
        )}

        {!compact && <SharedRisk deps={board.dependencies} total={board.items.length} />}
        <Events events={board.events} compact={compact} />

        <footer className={styles.foot}>
          <span>Every system is checked every 5 minutes. History starts with our first measurement; grey days have no data.</span>
          <span>Independent external checks. Not affiliated with or endorsed by the vendors shown; all trademarks belong to their owners.</span>
          {board.evidenceUrl && <a href={board.evidenceUrl}>Download SLA evidence (CSV)</a>}
          {board.showPowered && <a href="https://shadowalpha.online/boards" target="_blank" rel="noopener noreferrer">Status data by ShadowGraph</a>}
        </footer>
      </div>
    </div>
  );
}
