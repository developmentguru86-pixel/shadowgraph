import { Helmet } from "react-helmet";
import { PageIntro, PlainWords, Metrics, Block, Table, Chip, Note, NextLinks, DataState } from "../components/StudyKit";
import { useUpstreamSignals } from "../helpers/useResearchData";
import { ago, ci, fmt, odds, pct, shortDate, LAYER_LABEL } from "../helpers/researchFormat";

const TIER = { confirmed: { tone: "live" as const, label: "Confirmed" }, named: { tone: "info" as const, label: "Named" }, statistical: { tone: "few" as const, label: "Statistical" } };

export default function SignalTrackRecord() {
  const q = useUpstreamSignals();
  const d = q.data, bt = d?.backtest;
  const vs = bt?.vsProvider;
  return (
    <>
      <Helmet>
        <title>Upstream Signals track record · ShadowGraph Research</title>
        <meta name="description" content="How often ShadowGraph's upstream signals (rule cs-v1) were right: evidence tiers, sensitivity to the threshold, recall against the providers' own incident records." />
        <meta property="og:title" content="ShadowGraph Upstream Signals track record" />
        <meta property="og:description" content="How often ShadowGraph's upstream signals (rule cs-v1) were right: evidence tiers, sensitivity to the threshold, recall against the providers' own incident records." />
      </Helmet>
      <PageIntro
        eyebrow={`Research · Signal track record · rule ${bt?.rule ?? "cs-v1"}`}
        title={<>How often is an upstream signal <em>right?</em></>}
        lede={<>An upstream signal says: several companies that share a provider declared incidents within the same hour, and that is very unlikely to be coincidence.
          Here we run the exact live rule over the last {fmt(bt?.days ?? null)} days and check each signal against the providers' own records and the companies' own words.</>}
        meta={[["Updated", ago(bt?.computedAt)], ["Companies", fmt(bt?.companies ?? null)], ["Incidents", fmt(bt?.incidents ?? null)], ["Threshold", bt ? `p < ${bt.alpha}` : "—"]]}
      />
      <DataState loading={q.isLoading} error={q.error} />

      <PlainWords items={[
        <>Signals are <strong>rare</strong>: {fmt(bt?.events ?? null)} in {fmt(bt?.days ?? null)} days, about {fmt(bt?.perWeek ?? null, 1)} per week.</>,
        <>When a signal fires, the provider is usually <strong>named by the affected companies or confirmed by the provider</strong> ({bt ? `${bt.supported.k} of ${bt.supported.n}` : "—"}).</>,
        vs?.n ? <>Where the provider confirmed, our signal came a median of <strong>{Math.abs(vs.median ?? 0)} minutes {(vs.median ?? 0) < 0 ? "before" : "after"}</strong> the provider's own declaration (n = {vs.n}).</>
          : <>No provider confirmation with a timestamp yet, so no lead time can be measured.</>,
        <>Most provider incidents do <strong>not</strong> produce a signal: often too few of the companies we follow are affected, or they do not declare at the same time.</>,
      ]} />

      <Metrics items={[
        { label: "Signals per week", value: fmt(bt?.perWeek ?? null, 2), note: `${fmt(bt?.events ?? null)} in ${fmt(bt?.days ?? null)} days` },
        { label: "Named or confirmed", value: pct(bt?.supported.p ?? null), note: ci(bt?.supported) },
        { label: "Lead vs provider", value: vs?.median === null || vs?.median === undefined ? "—" : `${vs.median} min`, note: vs?.n ? `n = ${vs.n}; negative = before the provider` : "needs confirmed signals" },
        { label: "Provider incidents caught", value: pct(bt?.recall.visible.p ?? null), note: ci(bt?.recall.visible) },
      ]} />

      <Block num="01" title="The rule, exactly" intro={<p>Rule <code>{bt?.rule ?? "cs-v1"}</code>, fixed before this evaluation.</p>}>
        <Table head={["Step", "Definition"]} rows={[
          ["Input", "Official incidents of minor impact or worse from machine-readable status pages, read every 10 minutes; mirrored pages count once."],
          ["Groups", "Companies sharing a cloud region, hosting provider, CDN or DNS provider (most common value across their monitored services). Groups need at least two companies."],
          ["Window", `At least two different companies of a group declare within ${fmt(bt?.windowMinutes ?? null)} minutes.`],
          ["Chance model", "Each company's own incident rate over 84 days, scaled by the hour-of-week rhythm of all declarations; probability that at least that many companies declare by chance (Poisson-binomial)."],
          ["Threshold", `Signal when that probability is below ${bt?.alpha ?? 0.001} (1 in 1,000).`],
          ["Attribution", "An incident whose title blames a different provider is not counted for this one. Overlapping signals whose company sets nest are merged and keep every shared provider, most surprising first."],
          ["Evidence", "Confirmed: the provider's own record reports an incident that started within two hours. Named: an affected company names the provider or region. Otherwise statistical."],
        ]} />
      </Block>

      <Block num="02" title="Every signal in the window" intro="Retrospective run of the live rule. The odds are the chance of seeing this many simultaneous declarations by coincidence.">
        <Table head={["Date", "Likely upstream", "Layer", "Companies", "Evidence", "Odds"]} align={["l", "l", "l", "l", "l", "r"]}
          rows={(bt?.recent ?? []).map((e) => [
            shortDate(e.firedAt), e.candidates[0]?.provider ?? "—", LAYER_LABEL[e.candidates[0]?.layer ?? ""] ?? "—",
            [...new Set(e.companies.map((c) => c.name))].join(", "), <Chip tone={TIER[e.tier].tone}>{TIER[e.tier].label}</Chip>, odds(e.p),
          ])} empty="No signals in the window." />
        <Note>See each signal with the companies' incident titles and links on the <a href="/signals">Upstream Signals</a> page.</Note>
      </Block>

      <Block num="03" title="Sensitivity to the threshold" intro="The threshold was fixed at 1 in 1,000 in advance. Looser thresholds produce many more signals that are much less often backed by evidence, which is why we did not choose them.">
        <Table head={["Threshold", "Signals", "Per week", "Named or confirmed", "Confirmed by provider"]} align={["l", "r", "r", "r", "r"]}
          rows={(bt?.sensitivity ?? []).map((s) => [`p < ${s.alpha}`, fmt(s.events), fmt(s.perWeek, 2), `${pct(s.supported.p)} (${s.supported.k}/${s.supported.n})`, fmt(s.confirmed)])} />
      </Block>

      <Block num="04" title="Against the providers' own records" intro={<>Significant incidents published by AWS (Health Dashboard), Google Cloud, Cloudflare, Akamai and Vercel. &ldquo;Declaring&rdquo; counts companies on that provider that declared an incident around the same time; with fewer than two, no signal is possible by design.</>}>
        <Table head={["Started", "Provider", "Provider's title", "Declaring", "Signal"]} align={["l", "l", "l", "r", "l"]}
          rows={(bt?.recall.providerIncidents ?? []).map((p) => [
            shortDate(p.startedAt), `${p.provider}${p.region ? ` ${p.region}` : ""}`,
            p.link ? <a href={p.link} target="_blank" rel="noopener">{p.title}</a> : p.title,
            fmt(p.dependentsDeclaring), <Chip tone={p.detected ? "yes" : "no"}>{p.detected ? "Signal" : "None"}</Chip>,
          ])} />
        <Note>All {fmt(bt?.recall.all.n ?? null)} provider incidents: {ci(bt?.recall.all)} caught. Incidents where at least two followed companies declared: {ci(bt?.recall.visible)}.</Note>
      </Block>

      <Block num="05" title="Limitations">
        <Table head={["Limitation", "What it means"]} rows={[
          ["Rates are estimated in-sample", "Company incident rates come from the same 84 days the test runs on, which slightly favours the rule. The live detector uses the trailing 84 days."],
          ["Coverage", "Only companies with machine-readable status pages and a mapped infrastructure take part, mostly developer and SaaS companies."],
          ["Provider records are incomplete", "AWS and Google publish only significant events, so 'statistical' signals may be real provider problems that were never posted."],
          ["Declarations lag", "Companies declare minutes to hours after problems start; a signal cannot be earlier than the second company's declaration."],
        ]} />
      </Block>

      <NextLinks links={[
        { href: "/signals", label: "Live Upstream Signals", desc: "What is happening right now" },
        { href: "/research/shared-fate", label: "Shared fate", desc: "The statistical basis for signals" },
        { href: "/research/data", label: "Open data", desc: "Download incidents and services" },
      ]} />
    </>
  );
}
