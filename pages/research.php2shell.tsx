import { Helmet } from "react-helmet";
import { PageIntro, PlainWords, Metrics, Block, Table, Note, NextLinks, Chip } from "../components/StudyKit";
import { STUDY, HOURLY, DAILY, NETWORK_INCIDENTS, FINGERPRINT, ROWS, ANALYSED, STILL_DOWN, UNLISTED, publicSector, toCsv } from "../helpers/php2shellStudy";
import styles from "./research.php2shell.module.css";

const t = (iso: string) => `${iso.slice(8, 10)} Oct ${iso.slice(11, 16)}`;
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
const pct = (k: number, n: number) => `${Math.round((k / n) * 100)}%`;

/** Case study: the outage wave after the PHP2Shell disclosure on 21 Oct 2026 (frozen snapshot, see helpers/php2shellStudy). */
export default function Php2ShellStudy() {
  const before = DAILY.slice(0, 7);
  const avgLong = before.reduce((a, d) => a + d.long, 0) / before.length;
  const avg2h = before.reduce((a, d) => a + d.over2h, 0) / before.length;
  const day = DAILY[DAILY.length - 1];
  const peak = HOURLY.reduce((a, b) => (b.day > a.day ? b : a));
  const max = Math.max(...HOURLY.map((h) => Math.max(h.day, h.base)));
  const f = FINGERPRINT;
  const stillDown = STILL_DOWN;
  const otherA = f.affected.by["PHP (session cookie)"] + f.affected.by["PHP (header)"];
  const otherC = f.comparison.by["PHP (session cookie)"] + f.comparison.by["PHP (header)"];
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv()], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `shadowgraph-${STUDY.id}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const title = "PHP2Shell: who went offline on 21 October 2026";
  const desc = `After two critical PHP vulnerabilities were disclosed, long outages on the ShadowGraph radar rose ${pct(day.long - avgLong, avgLong)} above the weekly average, peaked between 10:00 and 15:00 UTC, hit five research networks and affected sites that visibly run PHP twice as often as a comparison group.`;

  return (
    <>
      <Helmet>
        <title>{`${title} · ShadowGraph Research`}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        <link rel="canonical" href="https://shadowalpha.online/research/php2shell" />
      </Helmet>
      <PageIntro
        eyebrow="Research · Case study · frozen snapshot"
        title={<>PHP2Shell: who went <em>offline?</em></>}
        lede={<>On 21 October 2026 two critical PHP flaws ({STUDY.cves.join(", ")}, “PHP2Shell”) were disclosed: remote code execution on any PHP installation that serves web requests. National agencies advised taking systems that could not be patched immediately offline. This is what {STUDY.monitored.toLocaleString("en-US")} sites on our radar looked like that day.</>}
        meta={[["Event", "21 Oct 2026"], ["Sites monitored", STUDY.monitored.toLocaleString("en-US")], ["Outages analysed", String(ANALYSED)], ["Snapshot", "22 Oct 2026, 07:50 UTC"]]}
      />
      <PlainWords items={[
        <>Long outages (30 minutes or more) rose to <strong>{day.long}</strong> that day, against <strong>{Math.round(avgLong)}</strong> on an average day of the week before. Outages of two hours or more rose to <strong>{day.over2h}</strong> (average {Math.round(avg2h)}).</>,
        <>They clustered between <strong>10:00 and 15:00 UTC</strong>, mostly at European universities and public bodies. The radar opened incidents on five research networks on its own: SURF, DFN, Belnet, SWITCH and GARR.</>,
        <>Of the affected sites we could read the next morning, <strong>{pct(f.affected.php, f.affected.reachable)}</strong> visibly run PHP (TYPO3, WordPress, Drupal and others), against <strong>{pct(f.comparison.php, f.comparison.reachable)}</strong> of comparable sites without an outage. That fits emergency patching or taking sites offline; it does not prove it.</>,
      ]} />
      <Metrics items={[
        { label: "Long outages · 21 Oct", value: String(day.long), note: `+${pct(day.long - avgLong, avgLong)} vs the 7-day average of ${Math.round(avgLong)}`, tone: "warn" },
        { label: `Peak hour · ${String(peak.h).padStart(2, "0")}:00 UTC`, value: `${(peak.day / peak.base).toFixed(1)}×`, note: `${peak.day} new outages, usual ${peak.base.toFixed(1)}` },
        { label: "Visible PHP · affected / comparison", value: `${pct(f.affected.php, f.affected.reachable)} / ${pct(f.comparison.php, f.comparison.reachable)}`, note: `odds ratio ${f.oddsRatio.toFixed(1)}, one-sided Fisher p = ${f.pFisherOneSided.toExponential(1)}` },
        { label: "Still down next morning", value: String(stillDown), note: "affected sites that did not answer at 07:50 UTC on 22 Oct" },
      ]} />

      <Block num="01" title="When it happened" intro={<p>New outages of 30 minutes or more per hour (UTC) on 21 October, against the average hour of the seven days before.</p>}>
        <div className={styles.chart} role="img" aria-label={`Hourly new outages on 21 October, peaking at ${peak.day} at ${peak.h}:00 UTC against a usual ${peak.base.toFixed(1)}`}>
          {HOURLY.map((h) => (
            <div key={h.h} className={styles.col} title={`${String(h.h).padStart(2, "0")}:00 UTC · ${h.day} new outages · usual ${h.base.toFixed(1)}`}>
              <span className={styles.val}>{h.day >= 10 ? h.day : ""}</span>
              <div className={styles.track}>
                <i className={styles.bar} style={{ height: `${(h.day / max) * 100}%` }} />
                <i className={styles.base} style={{ bottom: `${(h.base / max) * 100}%` }} />
              </div>
              <span className={styles.hour}>{h.h % 3 === 0 ? String(h.h).padStart(2, "0") : ""}</span>
            </div>
          ))}
        </div>
        <p className={styles.legend}><span><i className={styles.lgBar} />21 October</span><span><i className={styles.lgBase} />average hour, 14–20 October</span></p>
        <Table head={["Day (UTC)", "Outages ≥ 30 min", "Outages ≥ 2 h"]} align={["l", "r", "r"]} highlight={(i) => i === DAILY.length - 1}
          rows={DAILY.map((d) => [d.d, String(d.long), String(d.over2h)])} />
        <Note>18 October also had many long outages, mostly on a few large consumer sites, so the daily count alone is not unusual. What stands out on 21 October is the hour pattern and who was affected.</Note>
      </Block>

      <Block num="02" title="Whole networks, not single sites" intro={<p>The radar opens a network incident only when several independent sites in one network fail in the same sweeps. These are the incidents it opened on 21 October without being told what to look for.</p>}>
        <Table head={["Network", "What it is", "Opened (UTC)", "Closed (UTC)", "Sites failing", "Sites at risk"]} align={["l", "l", "l", "l", "r", "r"]}
          rows={NETWORK_INCIDENTS.map((n) => [<b key={n.network}>{n.network}</b>, n.kind, t(n.start), n.end ? t(n.end) : "open", String(n.affected), String(n.atRisk)])} />
        <Note>Five of the seven are national research and education networks. Universities in Germany, the Netherlands, Belgium and Switzerland widely run PHP content management systems such as TYPO3 and Drupal.</Note>
      </Block>

      <Block num="03" title="Did the affected sites run PHP?" intro={<p>On the morning of 22 October we read the public homepage of every affected site and of a comparison group of {f.comparison.sites} sites from the same catalogue lists that had no outage. We looked for visible signs of PHP: CMS generator tags, WordPress paths, the PHPSESSID cookie and the X-Powered-By header. A site without a visible sign may still run PHP, so both shares are lower bounds.</p>}>
        <Table head={["Visible technology", "Affected sites", "Comparison group"]} align={["l", "r", "r"]}
          rows={[
            ["TYPO3", String(f.affected.by.TYPO3), String(f.comparison.by.TYPO3)],
            ["WordPress", String(f.affected.by.WordPress), String(f.comparison.by.WordPress)],
            ["Drupal", String(f.affected.by.Drupal), String(f.comparison.by.Drupal)],
            ["Joomla", String(f.affected.by.Joomla), String(f.comparison.by.Joomla)],
            ["Magento", String(f.affected.by.Magento), String(f.comparison.by.Magento)],
            ["Other PHP evidence (session cookie, header)", String(otherA), String(otherC)],
            [<b key="a">Any visible PHP</b>, <b key="b">{`${f.affected.php} of ${f.affected.reachable} · ${pct(f.affected.php, f.affected.reachable)}`}</b>, <b key="c">{`${f.comparison.php} of ${f.comparison.reachable} · ${pct(f.comparison.php, f.comparison.reachable)}`}</b>],
            ["95% interval (Wilson)", `${f.ci.affected[0]}–${f.ci.affected[1]}%`, `${f.ci.comparison[0]}–${f.ci.comparison[1]}%`],
            ["Not readable at the time of the check", String(f.affected.sites - f.affected.reachable), String(f.comparison.sites - f.comparison.reachable)],
          ]} />
        <p className={styles.verdict}><Chip tone="yes">Association found</Chip> Affected sites were about three times as likely to show PHP (odds ratio {f.oddsRatio.toFixed(1)}, one-sided Fisher exact test p = {f.pFisherOneSided.toExponential(1)}). TYPO3 stands out: {f.affected.by.TYPO3} affected sites against {f.comparison.by.TYPO3} in the comparison group.</p>
      </Block>

      <Block num="04" title="Universities and public bodies" intro={<p>{publicSector.length} of the {ANALYSED} affected sites belong to universities, research institutes or public authorities. “Unreachable” means the site still did not answer when we fingerprinted it the next morning.</p>}>
        <Table head={["Site", "Down from (UTC)", "Duration", "Error", "Visible technology"]} align={["l", "l", "r", "l", "l"]}
          rows={publicSector.map((r) => [r[0], t(r[2]), r[3] ? dur(r[4]) : `${dur(r[4])}+, still down`, r[5], r[6]])} />
      </Block>

      <Block num="05" title="What this does not show" intro={<p>The limits are part of the result.</p>}>
        <ul className={styles.limits}>
          <li><b>No proof of cause.</b> We see that sites stopped answering, not why. Patching, deliberate shutdowns, firewall rules and unrelated faults all look the same from outside.</li>
          <li><b>Sector confound.</b> Universities and public bodies use TYPO3 and Drupal more than the average site, so part of the PHP difference reflects who was affected rather than what they run.</li>
          <li><b>One vantage point.</b> Our checks run from AWS in North America. A European site that blocked traffic from outside Europe as a quick mitigation looks like an outage to us.</li>
          <li><b>Fingerprint after the fact.</b> The technology check ran on 22 October. {f.affected.sites - f.affected.reachable} affected sites were still not answering and could not be classified.</li>
          <li><b>Background noise.</b> Roughly 130 long outages happen on an ordinary day. The {ANALYSED} affected sites include ordinary ones, for example a short Bitbucket incident.</li>
        </ul>
      </Block>

      <Block num="06" title="Data" intro={<p>{ROWS.length} of the {ANALYSED} affected sites with start, recovery, duration, error and the technology fingerprint, as CSV. {UNLISTED.count} adult sites are counted in all figures but not listed by name. The numbers on this page are frozen and will not change.</p>}>
        <button type="button" className={styles.download} onClick={download}>Download the data (CSV)</button>
        <Note>Method: HTTPS reachability checks every five minutes; an outage is two or more consecutive failed checks, counted here when it lasted 30 minutes or more and started on 21 October (UTC). Vulnerability sources: CISA alert of 21 October 2026, Help Net Security, Sansec, Google Cloud.</Note>
      </Block>

      <NextLinks links={[
        { href: "/radar", label: "Outage radar", desc: "What is failing right now" },
        { href: "/research/radar-accuracy", label: "Radar accuracy", desc: "What the radar can and cannot see" },
        { href: "/research/methods", label: "Methods & limitations", desc: "Rules, vantage point, changelog" },
      ]} />
    </>
  );
}
