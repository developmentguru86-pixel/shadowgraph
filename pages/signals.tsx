import { Helmet } from "react-helmet";
import { Radio, Layers, Scale } from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { SignalCard } from "../components/SignalCard";
import { PageIntro, Metrics, Block, NextLinks, DataState, Note } from "../components/StudyKit";
import { useUpstreamSignals } from "../helpers/useResearchData";
import { ago, fmt, pct, shortDate } from "../helpers/researchFormat";
import styles from "./signals.module.css";

export default function SignalsPage() {
  const q = useUpstreamSignals();
  const d = q.data;
  const bt = d?.backtest;
  const liveIds = new Set(d?.events.map((e) => e.id) ?? []);
  const retro = (bt?.recent ?? []).filter((e) => !liveIds.has(e.id));
  const active = d?.active ?? [];
  const confirmedLead = bt?.vsProvider.median;

  return (
    <>
      <Helmet>
        <title>Upstream Signals: provider problems seen through their customers · ShadowGraph</title>
        <meta name="description" content="When several companies on the same cloud, CDN or DNS provider report incidents within an hour, ShadowGraph flags the shared provider, often before the provider says anything." />
        <meta property="og:title" content="Upstream Signals: provider problems seen through their customers" />
        <meta property="og:description" content="When several companies on the same cloud, CDN or DNS provider report incidents within an hour, ShadowGraph flags the shared provider, often before the provider says anything." />
      </Helmet>
      <SiteHeader active="signals" />
      <main className={styles.page}>
        <PageIntro
          eyebrow="Monitoring · Upstream signals"
          title={<>When several companies on one provider report trouble at once, <em>the provider is the story.</em></>}
          lede={<>We read the official status pages of {fmt(bt?.companies ?? null)} companies every ten minutes and know which cloud, CDN and DNS provider each one runs on.
            When companies that share a provider declare incidents within the same hour, and that is very unlikely to be coincidence, we raise a signal, even if the provider has said nothing.</>}
          meta={[
            ["Last check", ago(d?.lastIngest?.at)],
            ["Status pages read", d?.lastIngest ? `${fmt(d.lastIngest.ok)} of ${fmt(d.lastIngest.pages)}` : "—"],
            ["Shared-provider groups", fmt(bt?.groups ?? null)],
            ["Rule", d?.rule ?? "—"],
          ]}
        />
        <DataState loading={q.isLoading} error={q.error} />

        <section className={styles.now} aria-live="polite">
          <div className={styles.nowHead}>
            <span className={`${styles.dot} ${active.length ? styles.dotHot : ""}`} />
            <h2>{active.length ? `${active.length} active upstream signal${active.length > 1 ? "s" : ""}` : "No active upstream signal"}</h2>
          </div>
          <p>{active.length
            ? "Companies that share the provider below have declared incidents within the last three hours."
            : `No group of companies that share a provider is declaring incidents together right now. Checked ${ago(d?.lastIngest?.at)}.`}</p>
          {active.length > 0 && <div className={styles.list}>{active.map((e) => <SignalCard key={e.id} e={e} mode="live" />)}</div>}
        </section>

        <Block num="01" title="How a signal is raised" intro="Three steps, every ten minutes. The rule is fixed and versioned; changing it means a new version and a public changelog entry.">
          <ol className={styles.steps}>
            <li><Radio size={18} /><b>Read what companies say</b><span>Official incident declarations from {fmt(d?.lastIngest?.pages ?? null)} machine-readable status pages: GitHub, Vercel, Twilio, OpenAI, Datadog and many more.</span></li>
            <li><Layers size={18} /><b>Group them by shared provider</b><span>Our dependency map knows each company's cloud region, hosting provider, CDN and DNS provider. Companies that share one form a group.</span></li>
            <li><Scale size={18} /><b>Ask: could this be chance?</b><span>Each company has its own normal incident rate. If at least two companies of a group declare within one hour and the chance of that by coincidence is below 1 in 1,000, we raise a signal.</span></li>
          </ol>
        </Block>

        <Block num="02" title="Track record" intro={<>Measured over the last {fmt(bt?.days ?? null)} days by running the same rule over the full public history. Evidence is checked against the providers' own records (AWS Health Dashboard, Google Cloud, Cloudflare, Akamai, Vercel) and the companies' own words.</>}>
          <Metrics items={[
            { label: "Signals per week", value: fmt(bt?.perWeek ?? null, 2), note: `${fmt(bt?.events ?? null)} signals in ${fmt(bt?.days ?? null)} days. Rare by design.` },
            { label: "Backed by evidence", value: pct(bt?.supported.p ?? null), note: bt ? `${bt.supported.k} of ${bt.supported.n} named or confirmed (95% CI ${pct(bt.supported.lo)}–${pct(bt.supported.hi)})` : "—" },
            { label: "Confirmed by provider", value: fmt(bt?.tiers.confirmed ?? null), note: confirmedLead === null || confirmedLead === undefined ? "Providers often say nothing." : `Median ${Math.abs(confirmedLead)} min ${confirmedLead < 0 ? "before" : "after"} the provider` },
            { label: "Provider incidents caught", value: bt ? `${bt.recall.visible.k}/${bt.recall.visible.n}` : "—", note: "Of provider incidents where at least two of our companies declared too." },
          ]} />
          <Note>Honest reading: signals are rare and usually right about the provider, but most provider incidents do not show up as simultaneous declarations of the companies we follow. Full method, sensitivity analysis and every signal: <a href="/research/upstream-signals">Signal track record</a>.</Note>
        </Block>

        <Block num="03" title="Recent signals" intro={d?.liveSince ? `Live detection since ${shortDate(d.liveSince)}. Older signals come from the retrospective test and are labelled as such.` : undefined}>
          <div className={styles.list}>
            {d?.events.filter((e) => !active.some((a) => a.id === e.id)).map((e) => <SignalCard key={e.id} e={e} mode="live" />)}
            {retro.slice(0, 8).map((e) => <SignalCard key={e.id} e={e} mode="retrospective" />)}
            {d && d.events.length === 0 && retro.length === 0 && <p className={styles.empty}>No signals in the observation window.</p>}
          </div>
        </Block>

        <section className={styles.cta}>
          <div>
            <h2>Get the signal for your own vendors</h2>
            <p>Stack Alerts sends provider incidents, early warnings and upstream signals for the services you depend on to email, Slack or Teams.</p>
          </div>
          <a href="/alerts" className={styles.ctaBtn}>Start the 14-day trial</a>
        </section>

        <NextLinks links={[
          { href: "/research/upstream-signals", label: "Signal track record", desc: "Every signal, sensitivity, recall" },
          { href: "/radar", label: "Live radar", desc: "Reachability of 900 services" },
          { href: "/research/shared-fate", label: "Shared fate study", desc: "Do shared providers fail together?" },
        ]} />
      </main>
      <SiteFooter />
    </>
  );
}
