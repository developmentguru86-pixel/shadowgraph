import { Helmet } from "react-helmet";
import { useQuery } from "@tanstack/react-query";
import { PageIntro, PlainWords, Metrics, Block, Table, Note, NextLinks, DataState, Chip } from "../components/StudyKit";
import { getConcentrationSignal, type StudyResult } from "../endpoints/research/concentration_signal_GET.schema";
import { getConcentrationLevel, type LevelResult } from "../endpoints/research/concentration_level_GET.schema";
import { ConcentrationLevelBlock } from "../components/ConcentrationLevelBlock";
import type { SpreadStat } from "../helpers/concentrationSignal";
import { fmt, ago, day } from "../helpers/researchFormat";
import { SITE_URL } from "../helpers/site";
import styles from "./research.concentration-signal.module.css";

const sp = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const pts = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)} pts`);
const share = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const pval = (p: number | null | undefined) => (p === null || p === undefined ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

function Row(label: string, role: string, window: string, s: SpreadStat, a = "Rising", b = "Falling") {
  return [
    <><b>{label}</b><small className={styles.sub}>{role}</small></>, window,
    <span className={styles.nn}>{a} {fmt(s.nA)} · {b} {fmt(s.nB)}</span>,
    sp(s.meanA), sp(s.meanB), <b className={s.p !== null && s.p < 0.01 ? styles.hit : undefined}>{pts(s.spread)}</b>,
    s.ciLo === null ? "—" : `${pts(s.ciLo, 1)} to ${pts(s.ciHi, 1)}`, pval(s.p),
  ];
}

function plain(r: StudyResult, lvr: LevelResult | undefined) {
  const p = r.primary, fd = r.secondary.filingDay;
  const out = [
    <>{fmt(r.sample.counts.rise)} annual reports showed a company's dependence on its largest customers <strong>rising</strong> by 5 points or more; {fmt(r.sample.counts.fall)} showed it <strong>falling</strong> ({r.sample.firstFiled?.slice(0, 4)}–{r.sample.lastFiled?.slice(0, 4)}).</>,
    <>In the three months after the filing, companies with rising concentration returned {sp(p.meanA)} against the S&P 500, those with falling concentration {sp(p.meanB)}: a spread of <strong>{pts(p.spread)}</strong> (95% interval {pts(p.ciLo, 1)} to {pts(p.ciHi, 1)}, p {pval(p.p)}).</>,
    r.verdict === "supported"
      ? <>That passes every condition we fixed before the first run, so we report it as a <strong>signal</strong>. It is gross of costs and should be tested out of sample before anyone trades it.</>
      : <>That does <strong>not</strong> pass the conditions we fixed before the first run{p.p !== null && p.p >= 0.01 ? " (the difference is within what chance produces)" : !p.sameSign ? " (the sign flips between the two halves of the sample)" : " (the effect is too small to survive trading costs)"}. We publish no trading signal from this data.</>,
    <>On the filing day itself the spread is {pts(fd.spread)} (p {pval(fd.p)}){fd.p !== null && fd.p < 0.05 ? ": the market reacts to the disclosure when it comes out." : ": no clear reaction to the disclosure either."}</>,
  ];
  const lv = r.secondary.levelTopVsBottom;
  if (lv.p !== null && lv.p < 0.05 && lvr) out.push(
    <>A secondary row showed the <strong>most concentrated third</strong> trailing the least concentrated by {pts(lv.spread, 1)} over a year (p {pval(lv.p)}). We tested that separately with a new pre-registered design (<a href="#level">{lvr.version}</a>): with simple returns and companies of similar volatility the gap is {pts(lvr.primary.spread, 1)} (p {pval(lvr.primary.p)}). {lvr.verdict === "supported" ? <>That passes its rule.</> : <><strong>It was an artifact</strong> of log returns, which are lower for volatile stocks, not an effect of concentration.</>}</>,
  );
  else if (lv.p !== null && lv.p < 0.05) out.push(
    <>One secondary row stands out: the <strong>most concentrated third</strong> of companies trailed the least concentrated by {pts(lv.spread, 1)} over the following year (p {pval(lv.p)}). It was not the registered question, and highly concentrated companies are also more volatile, which by itself lowers log returns. We treat it as a lead for a new pre-registered test, not as a finding.</>,
  );
  return out;
}

export default function ConcentrationSignalPage() {
  const q = useQuery({ queryKey: ["concentration-signal"], queryFn: getConcentrationSignal, staleTime: 600_000, retry: 1 });
  const lq = useQuery({ queryKey: ["concentration-level"], queryFn: getConcentrationLevel, staleTime: 600_000, retry: 1 });
  const r = q.data;
  const p = r?.primary;
  const title = "Do changes in customer concentration predict stock returns?";
  const desc = "A pre-registered event study on SEC annual reports: when a company's dependence on its 10% customers rises or falls, does its stock drift afterwards? Every event downloadable as CSV.";
  const maxAbs = Math.max(0.01, ...(r?.years ?? []).flatMap((y) => [Math.abs(y.meanRise ?? 0), Math.abs(y.meanFall ?? 0)]));

  return (
    <>
      <Helmet>
        <title>{title} · ShadowGraph Research</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={`${SITE_URL}/research/concentration-signal`} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
      </Helmet>
      <PageIntro
        eyebrow={`Research · Customer concentration · rule ${r?.version ?? "cc-v1"}`}
        title={<>When a company's biggest customers matter more, <em>does the stock follow?</em></>}
        lede={<>Our <a href="/companies">company pages</a> track every 10% customer in SEC annual reports. A quant's first question is whether a change in that dependence predicts returns. We fixed the test on {day(r?.registeredAt ?? "2026-10-18")}, before running it, and publish the result either way.</>}
        meta={[
          ["Filings tested", fmt(r?.sample.priced ?? null)],
          ["Period", r ? `${r.sample.firstFiled?.slice(0, 4)}–${r.sample.lastFiled?.slice(0, 4)}` : "—"],
          ["Verdict", r ? <Chip tone={r.verdict === "supported" ? "yes" : "no"}>{r.verdict === "supported" ? "Signal" : "No signal"}</Chip> : "—"],
          ["Updated", ago(r?.generatedAt)],
        ]}
      />
      <DataState loading={q.isLoading} error={q.error} />

      {r && p && (
        <>
          <PlainWords items={plain(r, lq.data)} />

          <Metrics items={[
            { label: "Spread, 3 months", value: pts(p.spread), note: "rising minus falling concentration", tone: r.verdict === "supported" ? "good" : undefined },
            { label: "p-value", value: pval(p.p), note: "labels shuffled within filing month", tone: p.p !== null && p.p < 0.01 ? "good" : "muted" },
            { label: "Before 2021", value: pts(p.firstHalf.spread), note: `${fmt(p.firstHalf.nA + p.firstHalf.nB)} filings · p ${pval(p.firstHalf.p)}` },
            { label: "From 2021", value: pts(p.secondHalf.spread), note: `${fmt(p.secondHalf.nA + p.secondHalf.nB)} filings · p ${pval(p.secondHalf.p)}` },
          ]} />

          <Block num="01" title="The test, fixed before the first run" intro={<p>One primary question, one decision rule, and secondary rows that are reported but never used to pick a winner. The code is versioned as <code>{r.version}</code>; a change creates a new version.</p>}>
            <ol className={styles.steps}>
              <li><b>Events.</b> Every 10-K and 20-F of a US-listed company that discloses at least one customer worth 10% of revenue. Concentration is the sum of those shares (named and anonymous customers; sales channels and group companies excluded).</li>
              <li><b>Change.</b> Both years come from the <em>same</em> filing (current year and prior-year comparative), so nothing is used before it was public. Rising: +5 points or more. Falling: −5 points or more.</li>
              <li><b>Returns.</b> Stock minus S&P 500 (SPY), buy-and-hold, from trading day +2 after the EDGAR filing date to day +61. Prices under $1 excluded; extremes winsorised at 1% and 99%.</li>
              <li><b>Chance.</b> Labels are shuffled only among companies that filed in the same month (5,000 times), so a market move that hit everyone filing in March cannot create a result. 95% intervals resample whole months.</li>
              <li><b>Rule.</b> A signal only if p &lt; 0.01, the sign is the same before and from 2021, and the spread is at least 1 point, enough to survive about 1% round-trip costs.</li>
            </ol>
          </Block>

          <Block num="02" title="Results" intro="Primary row first. A positive spread means companies whose customer concentration rose did better than those whose concentration fell.">
            <Table head={["Test", "Window (trading days)", "Events", "Group A", "Group B", "Spread", "95% interval", "p"]} align={["l", "l", "l", "r", "r", "r", "r", "r"]}
              highlight={(i) => i === 0}
              rows={[
                Row("Change in concentration", "Primary", "+2 to +61", p),
                Row("Same, before 2021", "Stability", "+2 to +61", p.firstHalf),
                Row("Same, from 2021", "Stability", "+2 to +61", p.secondHalf),
                Row("Filing-day reaction", "Secondary", "0 to +1", r.secondary.filingDay),
                Row("One month", "Secondary", "+2 to +21", r.secondary.month1),
                Row("One year", "Secondary", "+2 to +250", r.secondary.year1),
                Row("Against small caps (IWM)", "Secondary", "+2 to +61", r.secondary.primaryVsIwm),
                Row("Level: most vs least concentrated third", "Secondary", "+2 to +250", r.secondary.levelTopVsBottom, "Top", "Bottom"),
              ]} />
            <Note>Group A is rising concentration (or the most concentrated third in the level row), group B falling (or least concentrated). Returns are log returns relative to the benchmark. Rows with fewer than 20 events per group get no spread.</Note>
          </Block>

          <Block num="03" title="Year by year" intro="Average three-month return against the S&P 500 by filing year. If a signal were real and stable, the rising bar would sit on the same side of the falling bar most years.">
            <div className={styles.years} role="table" aria-label="Average abnormal return by filing year">
              <div className={styles.yHead} role="row"><span role="columnheader">Year</span><span role="columnheader">Rising concentration</span><span role="columnheader">Falling concentration</span></div>
              {r.years.filter((y) => y.rise + y.fall > 0).map((y) => (
                <div key={y.year} className={styles.yRow} role="row">
                  <span role="cell" className={styles.yLabel}>{y.year}</span>
                  {[["rise", y.meanRise, y.rise], ["fall", y.meanFall, y.fall]].map(([k, v, n]) => (
                    <span role="cell" key={k as string} className={styles.yCell}>
                      <span className={styles.track}><i className={`${k === "rise" ? styles.barRise : styles.barFall} ${(v as number | null) !== null && (v as number) < 0 ? styles.neg : ""}`}
                        style={{ width: `${Math.min(50, (Math.abs((v as number | null) ?? 0) / maxAbs) * 50)}%` }} /></span>
                      <span className={styles.yVal}>{sp(v as number | null, 1)}<small>n {fmt(n as number)}</small></span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </Block>

          <Block num="04" title="Largest changes since 2024" intro="The filings with the biggest swings in customer concentration, with what the stock did against the S&P 500 in the following three months. Examples, not evidence: single stocks move for many reasons.">
            <Table head={["Company", "Filed", "Concentration", "Change", "Next 3 months vs S&P 500"]} align={["l", "l", "r", "r", "r"]}
              rows={r.largest.map((e) => [
                <a href={`/company/${e.ticker.toLowerCase()}`}>{e.ticker}</a>, e.filed, `${share(e.c0)} → ${share(e.c1)}`, pts(e.delta, 0), sp(e.arM3, 1),
              ])} />
          </Block>

          <Block num="05" title="Limitations" intro="What this test cannot rule out.">
            <ul className={styles.caveats}>{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            {r.changelog && r.changelog.length > 0 && (
              <>
                <h3 className={styles.h3}>Changelog</h3>
                <ul className={styles.log}>{r.changelog.map((c) => <li key={c.version}><code>{c.version}</code><span>{c.date}</span><p>{c.note}</p></li>)}</ul>
              </>
            )}
            <Note>Sample: {fmt(r.sample.filings)} annual filings, {fmt(r.sample.priced)} with prices ({fmt(r.sample.symbolsPriced)} of {fmt(r.sample.symbols)} tickers found), {fmt(r.sample.pennyExcluded)} excluded under $1; {fmt(r.sample.counts.steady)} steady and {fmt(r.sample.counts.unknown)} without a prior-year column. Prices: Yahoo Finance adjusted closes. Filings: SEC EDGAR XBRL. Run {day(r.generatedAt)}.</Note>
          </Block>

          {lq.data && <ConcentrationLevelBlock r={lq.data} />}

          <Block num={lq.data ? "07" : "06"} title="Check it yourself">
            <div className={styles.dl}>
              <a href="/_api/research/concentration_signal?format=csv" download>Every event as CSV<small>ticker, filing, both years, change, all return windows</small></a>
              <a href="/_api/research/concentration_signal" target="_blank" rel="noopener noreferrer">Change test as JSON<small>every number of the cc-v1.1 study</small></a>
              {lq.data && <a href="/_api/research/concentration_level" target="_blank" rel="noopener noreferrer">Level test as JSON<small>cc-v2, including the monthly long-short series</small></a>}
            </div>
          </Block>
        </>
      )}

      <NextLinks links={[
        { href: "/companies", label: "Company dependencies", desc: "Every company's 10% customers, year by year" },
        { href: "/research/methods", label: "Methods & limitations", desc: "How we test our own claims" },
        { href: "/terminal", label: "Intelligence", desc: "All tested hypotheses and their verdicts" },
      ]} />
    </>
  );
}
