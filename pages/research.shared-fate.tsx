import { Helmet } from "react-helmet";
import { PageIntro, PlainWords, Metrics, Block, FateTable, Note, NextLinks, DataState, type FateRow } from "../components/StudyKit";
import { useResearchOverview } from "../helpers/useResearchData";
import { day, fmt, lift, pv, verdict, when, ago } from "../helpers/researchFormat";
import styles from "./research.shared-fate.module.css";

export default function SharedFatePage() {
  const q = useResearchOverview();
  const r = q.data, sf = r?.sharedFate;
  const L = (name: string) => sf?.layers.find((l) => l.layer === name) as FateRow | undefined;
  const cdn = L("CDN"), dns = L("DNS provider"), hosting = L("Hosting provider"), region = L("Cloud region");
  const neg = sf?.layers.find((l) => /Negative/.test(l.layer)) as FateRow | undefined;
  const pos = sf?.layers.find((l) => /Positive/.test(l.layer)) as FateRow | undefined;
  const controlsPass = !!neg && !!pos && neg.p >= 0.05 && pos.p < 0.05;
  const says = (l?: FateRow) => (!l ? "—" : verdict(l).key === "yes" ? "more often than chance" : "about as often as chance");

  return (
    <>
      <Helmet>
        <title>Shared fate: do companies on the same infrastructure fail together? · ShadowGraph Research</title>
        <meta name="description" content="A permutation study of official incident declarations: do companies on the same CDN, DNS provider, cloud provider or region declare incidents together more often than chance?" />
        <meta property="og:title" content="Shared fate: do companies on the same infrastructure fail together?" />
        <meta property="og:description" content="A permutation study of official incident declarations: do companies on the same CDN, DNS provider, cloud provider or region declare incidents together more often than chance?" />
      </Helmet>
      <PageIntro
        eyebrow={`Research · Shared fate · rule ${r?.versions.sharedFate ?? "sf-v1"}`}
        title={<>Do companies on the same infrastructure <em>fail together?</em></>}
        lede={<>Dependency maps only matter if shared infrastructure becomes shared failure. We test that with {fmt(sf?.incidents ?? null)} official incident
          declarations by {fmt(sf?.organisations ?? null)} companies over {fmt(sf?.days ?? null)} days.</>}
        meta={[["Window", sf ? `${day(sf.from)} → ${day(sf.to)}` : "—"], ["Updated", ago(r?.computedAt)], ["Controls", controlsPass ? "passed" : r ? "not passed" : "—"], ["Permutations", "1,000"]]}
      />
      <DataState loading={q.isLoading} error={q.error} />

      <PlainWords items={[
        <>Companies that share a <strong>CDN</strong> report incidents within the same hour {says(cdn)} ({lift(cdn?.lift)}).</>,
        <>Companies that share a <strong>DNS provider</strong> do so {says(dns)} ({lift(dns?.lift)}).</>,
        <>For a shared <strong>cloud provider</strong> the effect is {says(hosting)} ({lift(hosting?.lift)}): big provider failures happen, but most incidents are a company's own.</>,
        controlsPass
          ? <>Both safety checks passed: random groups show no effect, and planted fake events are found. The method can tell signal from noise.</>
          : <>The safety checks did not both pass in this run, so the results above should not be read as findings yet.</>,
      ]} />

      <Metrics items={[
        { label: "Same CDN", value: lift(cdn?.lift), note: `p ${pv(cdn?.p)}`, tone: cdn && verdict(cdn).key === "yes" ? "good" : undefined },
        { label: "Same DNS provider", value: lift(dns?.lift), note: `p ${pv(dns?.p)}`, tone: dns && verdict(dns).key === "yes" ? "good" : undefined },
        { label: "Same cloud provider", value: lift(hosting?.lift), note: `p ${pv(hosting?.p)}`, tone: hosting && verdict(hosting).key === "yes" ? "good" : undefined },
        { label: "Same cloud region", value: lift(region?.lift), note: `p ${pv(region?.p)}`, tone: region && verdict(region).key === "yes" ? "good" : undefined },
      ]} />

      <Block num="01" title="How the test works" intro="Three ideas, each chosen so the test cannot flatter us.">
        <ol className={styles.how}>
          <li><span>1</span><div><b>Count close pairs.</b> For every group of companies that share a provider, count pairs of incidents from two <em>different</em> companies declared within {fmt(sf?.toleranceMinutes ?? null)} minutes of each other.</div></li>
          <li><span>2</span><div><b>Build a fair &ldquo;chance&rdquo; world.</b> Shift each company's whole incident history by a random number of <em>whole weeks</em>. Every company keeps its own incident rate and the working-hours rhythm; only the alignment between companies is destroyed. Repeat 1,000 times.</div></li>
          <li><span>3</span><div><b>Compare.</b> Lift = real pairs ÷ average pairs in the chance worlds. The p-value is the share of chance worlds with at least as many pairs as reality.</div></li>
        </ol>
        <svg className={styles.diagram} viewBox="0 0 720 150" role="img" aria-label="Two companies on the same provider declaring incidents within one hour form a close pair">
          <line x1="20" y1="50" x2="700" y2="50" stroke="var(--border-strong)" />
          <line x1="20" y1="110" x2="700" y2="110" stroke="var(--border-strong)" />
          <text x="20" y="36" fill="var(--muted-foreground)" fontSize="12" fontFamily="var(--font-family-monospace)">Company A · CDN X</text>
          <text x="20" y="96" fill="var(--muted-foreground)" fontSize="12" fontFamily="var(--font-family-monospace)">Company B · CDN X</text>
          <rect x="300" y="38" width="120" height="84" rx="6" fill="color-mix(in srgb, var(--primary) 8%, transparent)" stroke="color-mix(in srgb, var(--primary) 40%, transparent)" strokeDasharray="4 4" />
          <text x="360" y="142" textAnchor="middle" fill="var(--primary)" fontSize="11" fontFamily="var(--font-family-monospace)">within 60 min = close pair</text>
          {[120, 330, 560].map((x) => <circle key={`a${x}`} cx={x} cy="50" r="6" fill="var(--foreground)" />)}
          {[220, 395, 640].map((x) => <circle key={`b${x}`} cx={x} cy="110" r="6" fill="var(--foreground)" />)}
        </svg>
      </Block>

      <Block num="02" title="Results by layer" intro={<>Shaded rows are the controls. Random groups of the same sizes must show <em>no</em> excess; four synthetic shared events planted across ten random companies must be <em>found</em>.</>}>
        {sf && <FateTable rows={sf.layers as FateRow[]} />}
        <Note>Unit: one company. Only status pages whose public history covers the full window are used ({fmt(sf?.completePages ?? null)} pages); pages mirrored for one company count once. Impact minor or worse.</Note>
      </Block>

      <Block num="03" title="Provider by provider" intro="Every provider with at least five companies in the sample, tested separately. With many tests some will look significant by luck, so p-values are corrected (Holm–Bonferroni).">
        {sf && <FateTable rows={sf.perProvider as FateRow[]} perProvider />}
      </Block>

      <Block num="04" title="In the companies' own words" intro={`Incident titles that name the same upstream provider within six hours on at least two independent status pages. ${fmt(sf?.namedUpstreamCount ?? null)} such events in the window.`}>
        <div className={styles.events}>
          {sf?.namedUpstreamEvents.map((e) => (
            <article key={`${e.upstream}${e.from}`}>
              <span className={styles.k}>{when(e.from)}</span>
              <strong>{e.upstream}</strong>
              <span className={styles.orgs}>{e.organisations.join(" · ")}</span>
              <ul>{e.titles.map((t) => <li key={t}>“{t}”</li>)}</ul>
            </article>
          ))}
        </div>
      </Block>

      {r?.sharedFateRadar && (
        <Block num="05" title="The same test on our own probes" intro={<>Rule <code>{r.versions.sharedFateRadar}</code>: co-failures in our five-minute sweeps ({fmt(r.sharedFateRadar.sweeps)} sweeps since {day(r.sharedFateRadar.from)}). Only {fmt(r.sharedFateRadar.organisationsWithFailures)} of {fmt(r.sharedFateRadar.organisations)} organisations failed at all, so this study is still underpowered.</>}>
          <FateTable rows={r.sharedFateRadar.layers as FateRow[]} counts={false} />
          <Note>Rows with fewer than 10 pairs observed or expected get no verdict: at that size a lift is noise.</Note>
        </Block>
      )}

      <NextLinks links={[
        { href: "/research/upstream-signals", label: "Signal track record", desc: "Turning shared fate into live signals" },
        { href: "/research/concentration", label: "Concentration", desc: "How much of the internet each provider reaches" },
        { href: "/research/methods", label: "Methods & limitations", desc: "What these numbers can and cannot say" },
      ]} />
    </>
  );
}
