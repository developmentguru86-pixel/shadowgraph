import { Helmet } from "react-helmet";
import { PageIntro, PlainWords, Metrics, Block, Table, Note, NextLinks, DataState } from "../components/StudyKit";
import { useResearchOverview } from "../helpers/useResearchData";
import { ago, ci, fmt, pct, when } from "../helpers/researchFormat";

export default function RadarAccuracyPage() {
  const q = useResearchOverview();
  const r = q.data, v = r?.validation;
  const t = v?.timeliness;
  return (
    <>
      <Helmet>
        <title>Radar accuracy against official status pages · ShadowGraph Research</title>
        <meta name="description" content="How many officially declared incidents ShadowGraph's five-minute reachability probes actually see, with recall by impact, precision and 95% confidence intervals." />
        <meta property="og:title" content="Radar accuracy against official status pages" />
        <meta property="og:description" content="How many officially declared incidents ShadowGraph's five-minute reachability probes actually see, with recall by impact, precision and 95% confidence intervals." />
      </Helmet>
      <PageIntro
        eyebrow={`Research · Radar accuracy · rule ${r?.versions.validation ?? "val-v1"}`}
        title={<>Does our radar see what companies <em>declare?</em></>}
        lede={<>We compare the radar's outage detections with the incidents that companies declare on their own status pages. A product that measures others should measure itself first.</>}
        meta={[["Window", v ? `${fmt(v.window.hours, 0)} hours` : "—"], ["Sweeps", fmt(v?.window.sweeps ?? null)], ["Services", fmt(v?.coverage.services ?? null)], ["Updated", ago(r?.computedAt)]]}
      />
      <DataState loading={q.isLoading} error={q.error} />

      <PlainWords items={[
        <>The radar checks every five minutes whether a service's public endpoint answers. It caught <strong>{v ? `${v.recall.severe.k} of ${v.recall.severe.n}` : "—"}</strong> severe incidents declared by the companies it covers.</>,
        <>Most declared incidents are <strong>partial</strong>: one feature, one region, slow queues, logged-in users only. A public endpoint keeps answering, so a reachability probe cannot see them.</>,
        <>That is why <a href="/signals">Upstream Signals</a>, which reads the companies' own declarations, now runs next to the radar as a second detection channel.</>,
      ]} />

      <Metrics items={[
        { label: "Recall · critical + major", value: v ? pct(v.recall.severe.p) : "—", note: ci(v?.recall.severe), tone: "warn" },
        { label: "Precision · DOWN episodes", value: v?.precision.all.n ? pct(v.precision.all.p) : "—", note: v?.precision.all.n ? ci(v.precision.all) : "No covered service had an outage episode." },
        { label: "Median lead vs declaration", value: t?.median === null || t?.median === undefined ? "—" : `${fmt(t.median)} min`, note: t?.n ? `n = ${t.n}; negative = radar first` : "Needs matched incidents." },
      ]} />

      <Block num="01" title="Definitions" intro={<p>Rule <code>{r?.versions.validation ?? "val-v1"}</code>. Ground truth: incidents from {fmt(r?.groundTruth?.ok ?? null)} machine-readable status pages, re-read every ten minutes.</p>}>
        <Table head={["Term", "Definition"]} rows={[
          ["DOWN episode", "Two or more consecutive failed five-minute sweeps of a service. Sweeps in which more than half of all probes fail are excluded (our own network)."],
          ["Detected", "An official incident counts as detected if any monitored service of that company had a DOWN episode between 30 minutes before the incident started and 30 minutes after it was resolved."],
          ["Precision", "Share of DOWN episodes of covered services that overlap an official incident of the same company."],
          ["Covered service", "Reachable in at least half of all sweeps (bot walls and geo blocks are not outages) and run by a company with a status page."],
        ]} />
      </Block>

      <Block num="02" title="Recall by official impact" intro={`Window ${when(v?.window.from)} to ${when(v?.window.to)}.`}>
        <Table head={["Official impact", "Detected / declared", "Recall", "95% CI"]} align={["l", "r", "r", "r"]}
          rows={(["critical", "major", "minor", "none"] as const).map((k) => {
            const x = v?.recall.byImpact[k];
            return [k, x ? `${x.k} / ${x.n}` : "—", x?.n ? pct(x.p) : "—", x?.n ? `${pct(x.lo)}–${pct(x.hi)}` : "—"];
          })} />
        <Note>Wilson score intervals. A recall of 0 with a small sample is still informative: the upper bound says how good the radar could plausibly be.</Note>
      </Block>

      <Block num="03" title="Severe incidents the radar missed" intro="Listed, not hidden. Each links to the company's own incident page.">
        <Table head={["Declared", "Company", "Impact", "Incident"]}
          rows={(v?.misses ?? []).map((m) => [when(m.declaredAt), m.organisation, m.impact, m.link ? <a href={m.link} target="_blank" rel="noopener">{m.incident}</a> : m.incident])}
          empty="No severe incidents in the window." />
      </Block>

      {v && v.radarOnly.length > 0 && (
        <Block num="04" title="Outages only the radar saw" intro="DOWN episodes of covered services without any official incident. Either the company did not declare, or the problem was on our side.">
          <Table head={["Started", "Service", "Minutes", "Reason"]} align={["l", "l", "r", "l"]}
            rows={v.radarOnly.map((x) => [when(x.startedAt), x.service, fmt(x.minutes), x.reason])} />
        </Block>
      )}

      <NextLinks links={[
        { href: "/signals", label: "Upstream Signals", desc: "The second detection channel" },
        { href: "/research/upstream-signals", label: "Signal track record", desc: "How often signals are right" },
        { href: "/research/methods", label: "Methods & limitations", desc: "One vantage point, and other caveats" },
      ]} />
    </>
  );
}
