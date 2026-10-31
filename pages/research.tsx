import { Helmet } from "react-helmet";
import { ArrowRight } from "lucide-react";
import { PageIntro, Block, Chip, DataState } from "../components/StudyKit";
import { useResearchOverview, useUpstreamSignals } from "../helpers/useResearchData";
import { useQuery } from "@tanstack/react-query";
import { getConcentrationSignal } from "../endpoints/research/concentration_signal_GET.schema";
import { fmt, lift, pct, pv, ago, verdict } from "../helpers/researchFormat";
import styles from "./research.module.css";

type Card = { href: string; rule: string; label: string; value: string; claim: string; status: { tone: "yes" | "no" | "few" | "info"; text: string } };

export default function ResearchHub() {
  const r = useResearchOverview();
  const u = useUpstreamSignals();
  const cs = useQuery({ queryKey: ["concentration-signal"], queryFn: getConcentrationSignal, staleTime: 600_000, retry: 1 });
  const csp = cs.data?.primary;
  const sf = r.data?.sharedFate, v = r.data?.validation, conc = r.data?.concentration, bt = u.data?.backtest;
  const L = (name: string) => sf?.layers.find((l) => l.layer === name);
  const cdn = L("CDN"), dns = L("DNS provider"), hosting = L("Hosting provider");
  const top = conc?.blastRadius[0];

  const cards: Card[] = [
    {
      href: "/research/php2shell", rule: "case 2026-10-21", label: "Case study · PHP2Shell",
      value: "+31%", claim: "long outages on 21 October, when two critical PHP flaws were disclosed. Five research networks failed; affected sites ran PHP twice as often as comparable ones.",
      status: { tone: "info", text: "New · frozen snapshot" },
    },
    {
      href: "/research/shared-fate", rule: r.data?.versions.sharedFate ?? "sf-v1", label: "Shared fate",
      value: lift(cdn?.lift), claim: `Companies on the same CDN declare incidents together ${lift(cdn?.lift)} as often as chance predicts; same DNS ${lift(dns?.lift)}, same cloud provider ${lift(hosting?.lift)}.`,
      status: cdn && verdict(cdn).key === "yes" ? { tone: "yes", text: "Edge layers: supported" } : { tone: "no", text: "Not supported" },
    },
    {
      href: "/research/upstream-signals", rule: bt?.rule ?? "cs-v1", label: "Upstream signals",
      value: bt ? pct(bt.supported.p) : "—", claim: bt ? `of ${bt.events} signals in ${bt.days} days were named by the affected companies or confirmed by the provider itself.` : "Signal track record over 84 days.",
      status: { tone: "info", text: bt ? `${fmt(bt.perWeek, 2)} per week` : "Live" },
    },
    {
      href: "/research/radar-accuracy", rule: r.data?.versions.validation ?? "val-v1", label: "Radar accuracy",
      value: v ? `${v.recall.severe.k}/${v.recall.severe.n}` : "—", claim: "severe official incidents seen by our front-door reachability probes. Most declared incidents are partial and invisible to them.",
      status: { tone: "no", text: "Known limitation" },
    },
    {
      href: "/research/concentration", rule: r.data?.versions.concentration ?? "conc-v1", label: "Concentration",
      value: pct(top?.share), claim: `of ${fmt(conc?.organisations)} organisations can be reached by a single ${top?.provider ?? "provider"} incident. ${fmt(conc?.systemicProviders)} providers each reach at least 10%.`,
      status: { tone: "info", text: "Structural exposure" },
    },
    {
      href: "/research/concentration-signal", rule: cs.data?.version ?? "cc-v1", label: "Customer signal",
      value: csp?.spread != null ? `${csp.spread >= 0 ? "+" : "−"}${Math.abs(csp.spread * 100).toFixed(1)} pts` : "—",
      claim: `three-month return of stocks whose customer concentration rose, minus those where it fell, across ${fmt(csp ? csp.nA + csp.nB : null)} SEC annual reports (p ${csp?.p != null ? csp.p.toFixed(2) : "—"}).`,
      status: cs.data ? (cs.data.verdict === "supported" ? { tone: "yes", text: "Signal" } : { tone: "no", text: "No signal" }) : { tone: "few", text: "Pending" },
    },
  ];

  return (
    <>
      <Helmet>
        <title>ShadowGraph Research: our claims about the internet, tested in public</title>
        <meta name="description" content="Pre-specified, reproducible studies of internet dependencies: shared fate in official incident records, upstream signal track record, radar accuracy and provider concentration. Open data under CC BY 4.0." />
        <meta property="og:title" content="ShadowGraph Research: our claims about the internet, tested in public" />
        <meta property="og:description" content="Pre-specified, reproducible studies of internet dependencies: shared fate in official incident records, upstream signal track record, radar accuracy and provider concentration. Open data under CC BY 4.0." />
      </Helmet>
      <PageIntro
        eyebrow="ShadowGraph Research"
        title={<>Our product makes claims about the internet. <em>Here we test them.</em></>}
        lede="Every number in this section is recomputed on a fixed schedule (hourly for the infrastructure studies, weekly for the market tests) from public sources, with rules fixed before the results are read. Results stay public whether they support the product or not, and every table can be downloaded."
        meta={[
          ["Updated", ago(r.data?.computedAt)],
          ["Companies observed", fmt(sf?.organisations ?? null)],
          ["Official incidents", fmt(sf?.incidents ?? null)],
          ["Status pages", fmt(r.data?.groundTruth?.ok ?? null)],
        ]}
      />
      <DataState loading={r.isLoading} error={r.error} />

      <section className={styles.cards} aria-label="Current findings">
        {cards.map((c) => (
          <a key={c.href} href={c.href} className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>{c.label}</span>
              <code>{c.rule}</code>
            </div>
            <b className={styles.cardValue}>{c.value}</b>
            <p>{c.claim}</p>
            <div className={styles.cardFoot}>
              <Chip tone={c.status.tone}>{c.status.text}</Chip>
              <span className={styles.read}>Read the study <ArrowRight size={14} /></span>
            </div>
          </a>
        ))}
      </section>

      <Block num="01" title="What we have learned so far">
        <div className={styles.learned}>
          <div>
            <h3>Shared infrastructure does turn into shared failure, at the edge.</h3>
            <p>Over {fmt(sf?.days ?? null)} days, companies sharing a CDN or DNS provider declared incidents within the same hour more often than chance
              ({lift(cdn?.lift)}, p {pv(cdn?.p)}; {lift(dns?.lift)}, p {pv(dns?.p)}). For cloud providers the excess ({lift(hosting?.lift)}) is not distinguishable from chance:
              provider-wide failures happen, but they are rare next to company-specific ones.</p>
          </div>
          <div>
            <h3>The customers often speak before the provider.</h3>
            <p>When several companies on one provider declare incidents together, the provider is usually named or confirmed ({bt ? `${bt.supported.k} of ${bt.supported.n}` : "—"}).
              On 9 October 2026 five companies on AWS declared problems within an hour, two of them naming us-east-1, while AWS posted nothing publicly.</p>
          </div>
          <div>
            <h3>Checking a front door is not enough.</h3>
            <p>Our reachability probes saw {v ? `${v.recall.severe.k} of ${v.recall.severe.n}` : "—"} severe incidents that covered companies declared. That is why Upstream Signals,
              built on the companies' own declarations, is now a second detection channel next to the radar.</p>
          </div>
        </div>
      </Block>

      <Block num="02" title="How we work">
        <ul className={styles.principles}>
          <li><b>Rules before results</b><span>Each study has a versioned rule. Changing it creates a new version and a public changelog entry.</span></li>
          <li><b>Controls must pass</b><span>A negative control must show nothing and a planted positive control must be found, or the result is not interpreted.</span></li>
          <li><b>Negative results stay</b><span>Retired rules and failed ideas remain published with their numbers.</span></li>
          <li><b>Reproducible</b><span>Fixed random seeds, open CSV tables and a JSON copy of every number on these pages.</span></li>
        </ul>
        <div className={styles.links}>
          <a href="/research/methods">Methods, limitations and changelog <ArrowRight size={14} /></a>
          <a href="/research/data">Open data and citation <ArrowRight size={14} /></a>
        </div>
      </Block>
    </>
  );
}
