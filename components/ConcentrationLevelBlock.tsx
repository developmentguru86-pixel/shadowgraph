import { Block, Metrics, Table, Note, Chip } from "./StudyKit";
import type { LevelResult } from "../endpoints/research/concentration_level_GET.schema";
import type { LevelStat } from "../helpers/concentrationLevel";
import { fmt, day } from "../helpers/researchFormat";
import styles from "./ConcentrationLevelBlock.module.css";

const pts = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)} pts`);
const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pval = (p: number | null | undefined) => (p === null || p === undefined ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
const tv = (t: number | null | undefined) => (t === null || t === undefined ? "—" : t.toFixed(2));

function row(label: string, role: string, s: LevelStat, returns: string) {
  return [<><b>{label}</b><small className={styles.sub}>{role}</small></>, returns, `${fmt(s.nA)} · ${fmt(s.nB)}`, pc(s.meanA), pc(s.meanB),
    <b className={s.p !== null && s.p < 0.01 ? styles.hit : undefined}>{pts(s.spread)}</b>, s.ciLo === null ? "—" : `${pts(s.ciLo)} to ${pts(s.ciHi)}`, pval(s.p)];
}

/** Cumulative long-short (high minus low concentration) in calendar time, as a quiet line with a zero baseline. */
function Cumulative({ series }: { series: Array<{ month: string; ls: number }> }) {
  if (series.length < 2) return null;
  const cum: number[] = []; let v = 1; for (const s of series) { v *= 1 + s.ls; cum.push(v - 1); }
  const W = 720, Hh = 180, pad = 28;
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = Math.max(0.05, hi - lo);
  const x = (i: number) => pad + (i / (cum.length - 1)) * (W - pad * 2);
  const y = (val: number) => 12 + (1 - (val - lo) / span) * (Hh - 36);
  const years = series.map((s, i) => ({ y: s.month.slice(0, 4), i, jan: s.month.endsWith("-01") })).filter((s) => s.jan && Number(s.y) % 2 === 0);
  return (
    <figure className={styles.fig}>
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`Cumulative return of long high-concentration, short low-concentration: ${pc(cum[cum.length - 1])} from ${series[0].month} to ${series[series.length - 1].month}`}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className={styles.zero} />
        {years.map((t) => <text key={t.y} x={x(t.i)} y={Hh - 6} className={styles.tick} textAnchor="middle">{t.y}</text>)}
        <polyline points={cum.map((c, i) => `${x(i)},${y(c)}`).join(" ")} className={styles.line} />
        <text x={W - pad} y={y(cum[cum.length - 1]) - 8} textAnchor="end" className={styles.end}>{pc(cum[cum.length - 1])}</text>
      </svg>
      <figcaption>Long the most concentrated third, short the least concentrated third (volatility-matched), equal weight, rebalanced daily. Before costs and borrow fees.</figcaption>
    </figure>
  );
}

export function ConcentrationLevelBlock({ r }: { r: LevelResult }) {
  const c = r.calendar, p = r.primary, m = r.matching;
  return (
    <Block id="level" num="06" title={<>Follow-up: do the most dependent companies underperform? <Chip tone={r.verdict === "supported" ? "yes" : "no"}>{r.verdict === "supported" ? "Effect" : "No effect"}</Chip></>}
      intro={<>
        <p>The change test above showed one striking secondary row: the most concentrated third of companies trailed the least concentrated third over the following year. That row used log returns, which run lower for volatile stocks, and concentrated companies are more volatile. We fixed a new test (<code>{r.version}</code>, registered {day(r.registeredAt)}) before running it: simple returns, and each company compared only with companies of similar volatility that filed in the same year.</p>
        <p>{r.rule}</p>
      </>}>
      <Metrics items={[
        { label: "Spread, 1 year", value: pts(p.spread), note: "most minus least concentrated, volatility-matched", tone: r.verdict === "supported" ? "good" : undefined },
        { label: "p-value", value: pval(p.p), note: "labels shuffled within month and volatility band", tone: "muted" },
        { label: "Calendar-time alpha", value: c.alphaMonthly === null ? "—" : `${pc(c.alphaMonthly, 2)}/mo`, note: `t ${tv(c.tAlpha)} · ${fmt(c.months)} months, SPY and size factors` },
        { label: "Without matching, log returns", value: pts(r.secondary.unmatchedLog.spread), note: `p ${pval(r.secondary.unmatchedLog.p)}: the original lead, reproduced` },
      ]} />

      <Table head={["Test", "Returns", "High · low", "High", "Low", "Spread", "95% interval", "p"]} align={["l", "l", "r", "r", "r", "r", "r", "r"]} highlight={(i) => i === 0}
        rows={[
          row("Volatility-matched", "Primary", p, "simple, vs SPY"),
          row("Same, before 2021", "Stability", p.firstHalf, "simple, vs SPY"),
          row("Same, from 2021", "Stability", p.secondHalf, "simple, vs SPY"),
          row("No matching", "Secondary", r.secondary.unmatchedSimple, "simple, vs SPY"),
          row("No matching", "Secondary · replicates the lead", r.secondary.unmatchedLog, "log, vs SPY"),
          row("Matched on dollar volume", "Secondary · size proxy", r.secondary.dollarVolumeMatched, "simple, vs SPY"),
          row("Volatility-matched", "Secondary", r.secondary.primaryVsIwm, "simple, vs IWM"),
        ]} />
      <Note>Window: trading days +2 to +250 after the filing. Volatility check: the high group averaged {pc(m.volHigh, 0).replace("+", "")} annualised volatility and the low group {pc(m.volLow, 0).replace("+", "")} after matching ({pc(m.volHighUnmatched, 0).replace("+", "")} vs {pc(m.volLowUnmatched, 0).replace("+", "")} before). Concentration: {Math.round(m.c1High * 100)}% vs {Math.round(m.c1Low * 100)}% of revenue from 10% customers.</Note>

      <h3 className={styles.h3}>Inside each volatility band</h3>
      <Table head={["Volatility band", "Annualised volatility", "Pairs", "Spread", "p"]} align={["l", "r", "r", "r", "r"]}
        rows={r.byQuintile.map((q) => [q.quintile === 1 ? "1 (calmest)" : q.quintile === 5 ? "5 (most volatile)" : String(q.quintile), `${Math.round(q.volatility * 100)}%`, fmt(q.nA), pts(q.spread), pval(q.p)])} />

      <h3 className={styles.h3}>In calendar time</h3>
      <Cumulative series={c.series} />
      <Note>Monthly long-short mean {pc(c.meanMonthly, 2)} (Newey-West t {tv(c.tMean)}); alpha after SPY and IWM-minus-SPY {pc(c.alphaMonthly, 2)} per month (t {tv(c.tAlpha)}), betas {c.betaSpy?.toFixed(2)} and {c.betaSize?.toFixed(2)}. On an average day {fmt(c.avgLong)} stocks long and {fmt(c.avgShort)} short, {c.from} to {c.to}.</Note>

      <ul className={styles.caveats}>{r.caveats.map((x) => <li key={x}>{x}</li>)}</ul>
      <Note>Sample: {fmt(r.sample.events)} filings with a full year of prices after the filing and a year of history before it, {fmt(r.sample.labelled)} in the high or low third. Left out: {fmt(r.sample.noPrice)} without prices, {fmt(r.sample.penny)} under $1, {fmt(r.sample.shortHistory)} with less than 120 days of history, {fmt(r.sample.incomplete)} without a price 250 days later (mostly filed in the last year). Run {day(r.generatedAt)}.</Note>
    </Block>
  );
}
