import { Helmet } from "react-helmet";
import { PageIntro, PlainWords, Metrics, Block, Table, Note, NextLinks, DataState } from "../components/StudyKit";
import { useResearchOverview } from "../helpers/useResearchData";
import { ago, fmt, pct } from "../helpers/researchFormat";
import styles from "./research.concentration.module.css";

export default function ConcentrationPage() {
  const q = useResearchOverview();
  const r = q.data, c = r?.concentration;
  const layers = c ? Object.entries(c.layers) : [];
  const most = [...layers].sort((a, b) => b[1].hhi - a[1].hhi)[0];
  const max = Math.max(...(c?.blastRadius.map((b) => b.share) ?? [0.01]), 0.01);
  const top = c?.blastRadius[0];
  return (
    <>
      <Helmet>
        <title>How concentrated is the internet? Provider concentration and blast radius · ShadowGraph Research</title>
        <meta name="description" content="Herfindahl-Hirschman concentration of hosting, cloud region, CDN, DNS and email providers across monitored organisations, and the share of organisations each provider can reach." />
        <meta property="og:title" content="How concentrated is the internet? Provider concentration and blast radius" />
        <meta property="og:description" content="Herfindahl-Hirschman concentration of hosting, cloud region, CDN, DNS and email providers across monitored organisations, and the share of organisations each provider can reach." />
      </Helmet>
      <PageIntro
        eyebrow={`Research · Concentration · rule ${r?.versions.concentration ?? "conc-v1"}`}
        title={<>How much of the internet does <em>one provider</em> reach?</>}
        lede={<>Concentration is structural exposure: how many organisations a single provider failure could touch. It does not say how often that happens; the <a href="/research/shared-fate">shared fate study</a> measures that.</>}
        meta={[["Organisations", fmt(c?.organisations ?? null)], ["Services", fmt(c?.services ?? null)], ["Updated", ago(r?.computedAt)]]}
      />
      <DataState loading={q.isLoading} error={q.error} />

      <PlainWords items={[
        <><strong>{top?.provider ?? "—"}</strong> alone can reach {pct(top?.share)} of the organisations we monitor through hosting, CDN or DNS.</>,
        <><strong>{fmt(c?.systemicProviders ?? null)} providers</strong> each reach at least one in ten organisations.</>,
        <>{layers.filter(([, l]) => l.hhi > 1800).length} of {layers.length} layers we measure are <strong>highly concentrated</strong> by the yardstick competition authorities use; the most concentrated is {most?.[0] ?? "—"}.</>,
      ]} />

      <Metrics items={layers.slice(0, 4).map(([name, l]) => ({ label: name, value: fmt(l.hhi), note: `HHI · ${l.top[0]?.provider ?? "—"} ${pct(l.top[0]?.share)}`, tone: l.hhi > 1800 ? "warn" as const : undefined }))} />

      <Block num="01" title="Blast radius" intro="Share of monitored organisations that depend on a provider in any layer (hosting, CDN or DNS).">
        <div className={styles.bars}>
          {c?.blastRadius.map((b) => (
            <div key={b.provider} className={styles.row}>
              <span className={styles.name}>{b.provider}</span>
              <span className={styles.track}><i style={{ width: `${(b.share / max) * 100}%` }} /></span>
              <span className={styles.val}>{pct(b.share, 1)}<small>{fmt(b.organisations)}</small></span>
            </div>
          ))}
        </div>
      </Block>

      <Block num="02" title="Concentration by layer" intro={<p>The Herfindahl–Hirschman index (HHI) is the sum of squared market shares, from 0 (fragmented) to 10,000 (one provider). The 2023 US Merger Guidelines treat markets above 1,800 as highly concentrated. Unit: one organisation (registrable domain); shares are computed where the layer is observable.</p>}>
        <Table head={["Layer", "Observable", "HHI", "Largest providers"]} align={["l", "r", "r", "l"]}
          rows={layers.map(([name, l]) => [name, `${fmt(l.known)} / ${fmt(l.total)}`, <span className={l.hhi > 1800 ? styles.warn : undefined}>{fmt(l.hhi)}</span>,
            l.top.slice(0, 4).map((t) => `${t.provider} ${pct(t.share)}`).join(" · ")])} />
        <Note>Hosting is hidden behind a CDN for many organisations, so hosting shares describe the observable part only. Multi-provider set-ups are reduced to the most common provider per layer.</Note>
      </Block>

      <NextLinks links={[
        { href: "/research/shared-fate", label: "Shared fate", desc: "Does exposure become failure?" },
        { href: "/report", label: "Report: Who runs the internet?", desc: "Sector view, single-vendor stacks" },
        { href: "/check", label: "Check your stack", desc: "Your own concentration in seconds" },
      ]} />
    </>
  );
}
