import { Helmet } from "react-helmet";
import { PageIntro, Block, Table, Chip, NextLinks } from "../components/StudyKit";
import styles from "./research.methods.module.css";

const RULES: Array<[string, string, string, "live" | "no" | "info", string]> = [
  ["cs-v1", "Upstream signals", "Companies sharing a provider declare incidents within 60 min; chance below 1 in 1,000 (Poisson-binomial on own rates, hour-of-week adjusted).", "live", "2026-10-10"],
  ["sf-v1", "Shared fate", "Close pairs of incident declarations within shared-provider groups vs. whole-week rotation null; negative and injection controls; Holm per provider.", "live", "2026-10-10"],
  ["sf-radar-v1", "Shared fate (own probes)", "Same test on five-minute reachability sweeps; verdict only with at least 10 pairs observed or expected.", "info", "2026-10-10"],
  ["val-v1", "Radar accuracy", "DOWN episodes (two failed sweeps) matched to official incidents ±30 min; Wilson intervals; bootstrap for lead time.", "live", "2026-10-10"],
  ["conc-v1", "Concentration", "HHI per layer over organisations (registrable domains); blast radius over hosting, CDN and DNS.", "live", "2026-10-10"],
  ["ew-v2", "Early warning", "Per-organisation latency degradation in shared groups, confirmed by re-probe and two consecutive sweeps.", "info", "2026-10-09"],
  ["ew-v1", "Early warning (retired)", "Retired after 0 of 10 warnings were confirmed; the record stays public.", "no", "2026-10-09"],
  ["outage-v1", "Outage trading rule (retired)", "Retired after a pre-registered event study found no tradable stock reaction to provider outages.", "no", "2026-10-09"],
];

export default function MethodsPage() {
  return (
    <>
      <Helmet>
        <title>Methods, limitations and changelog · ShadowGraph Research</title>
        <meta name="description" content="How ShadowGraph Research works: principles, the registry of versioned rules, known limitations and every method change." />
        <meta property="og:title" content="ShadowGraph Research: methods, limitations and changelog" />
        <meta property="og:description" content="How ShadowGraph Research works: principles, the registry of versioned rules, known limitations and every method change." />
      </Helmet>
      <PageIntro
        eyebrow="Research · Methods"
        title={<>How we make sure the numbers <em>mean something.</em></>}
        lede="Principles, every rule with its version and status, the limits of our data, and a log of every method change, including the ones that made us look worse."
      />

      <Block num="01" title="Principles">
        <div className={styles.principles}>
          <div><b>Rules before results</b><p>A study's rule is written and versioned before its numbers are read. Any change creates a new version; old versions keep their results.</p></div>
          <div><b>Controls must pass</b><p>Statistical tests include a negative control that must show nothing and a planted positive control that must be found. If either fails, the result is not interpreted.</p></div>
          <div><b>Honest denominators</b><p>Rates come with their counts and 95% intervals. Missing values show as a dash, never as zero. Too-small samples get no verdict.</p></div>
          <div><b>Negative results stay public</b><p>Retired rules, failed ideas and misses are listed with the same prominence as successes.</p></div>
          <div><b>Reproducible</b><p>Fixed random seeds, open CSV tables under CC BY 4.0, and a JSON copy of every number shown.</p></div>
          <div><b>Sources you can check</b><p>Every official incident links to the company's or provider's own page.</p></div>
        </div>
      </Block>

      <Block num="02" title="Rule registry">
        <Table head={["Rule", "Study", "Definition", "Status", "Since"]}
          rows={RULES.map(([id, study, def, tone, since]) => [<code className={styles.code}>{id}</code>, study, <span className={styles.def}>{def}</span>,
            <Chip tone={tone}>{tone === "live" ? "Active" : tone === "no" ? "Retired" : "Supporting"}</Chip>, since])} />
      </Block>

      <Block num="03" title="Data sources">
        <Table head={["Source", "What we take", "Refresh"]} rows={[
          ["182 company status pages (Statuspage / incident.io API)", "Incident title, impact, declared / started / resolved times, link", "Every 10 minutes"],
          ["AWS Health Dashboard public history", "Significant AWS events by service and region", "Every 10 minutes"],
          ["Google Cloud status (incidents.json)", "Significant Google Cloud incidents", "Every 10 minutes"],
          ["Cloudflare, Akamai, Vercel status pages", "Provider incidents with impact", "Every 10 minutes"],
          ["ShadowGraph radar", "HTTP reachability and latency of ~900 services from one cloud location", "Every 5 minutes"],
          ["Public DNS, IP ownership (ASN), published cloud IP ranges", "Hosting provider, cloud region, CDN, DNS and email provider per service", "Weekly re-mapping"],
        ]} />
      </Block>

      <Block num="04" title="Known limitations">
        <ul className={styles.limits}>
          <li><b>Self-reported ground truth.</b> Status pages are written by the companies. Some under-report, some over-report, and declaration times lag the real start.</li>
          <li><b>Selection.</b> Companies with machine-readable status pages are mostly developer and SaaS businesses; banks, retailers and media are under-represented.</li>
          <li><b>Inferred infrastructure.</b> A CDN hides the origin, so hosting is observable for fewer organisations; multi-cloud set-ups are reduced to the most common provider.</li>
          <li><b>One vantage point.</b> All probes run from one cloud location. Regional outages elsewhere can be missed and our own network can fail; sweeps with more than 50% failures are excluded.</li>
          <li><b>Short probe history.</b> Raw probes are kept three days; sweeps, hourly aggregates and outage episodes are kept permanently since 8 October 2026.</li>
          <li><b>Correlation, not mechanism.</b> A lift says companies on a shared layer declare incidents together more often than chance. It does not prove which component failed.</li>
        </ul>
      </Block>

      <Block num="05" title="Changelog">
        <ol className={styles.log}>
          <li><time>2026-10-10</time><div><b>cs-v1 introduced.</b> Upstream signals become a second detection channel. Before launch two attribution rules were tightened: an incident that names another provider no longer counts for this one, and a provider confirmation must start within two hours of the signal (a long-running minor incident elsewhere had counted as confirmation).</div></li>
          <li><time>2026-10-10</time><div><b>sf-v1 revised before publication.</b> The first draft rotated incident histories by arbitrary offsets. Its negative control failed (random groups showed ×2.1) because incidents cluster in working hours. The null now rotates by whole weeks; the negative control passes.</div></li>
          <li><time>2026-10-10</time><div><b>val-v1 introduced.</b> First validation of radar outage detection against official status pages.</div></li>
          <li><time>2026-10-09</time><div><b>ew-v1 retired, ew-v2 introduced.</b> 0 of 10 early warnings were confirmed; the same three hosts per region gained latency together, a measurement-origin artefact.</div></li>
          <li><time>2026-10-09</time><div><b>Outage trading rule retired.</b> A pre-registered event study of 26 outages found no tradable stock reaction (day-0 −0.34%, t −0.55).</div></li>
        </ol>
      </Block>

      <NextLinks links={[
        { href: "/research/data", label: "Open data", desc: "Download every table" },
        { href: "/research/shared-fate", label: "Shared fate", desc: "The main study" },
        { href: "/research", label: "Research overview", desc: "Findings at a glance" },
      ]} />
    </>
  );
}
