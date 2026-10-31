import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getRadarStatus, type OutputType as RadarStatus } from "../endpoints/radar_status_GET.schema";
import { getDatasetSample, type OutputType as DatasetSample } from "../endpoints/dataset_sample_GET.schema";
import { postRadarWaitlist } from "../endpoints/radar_waitlist_POST.schema";
import { useScrollReveal } from "../helpers/useScrollReveal";
import { StackLab } from "../components/StackLab";
import { RadarGlobe } from "../components/RadarGlobe";
import { DownCheck } from "../components/DownCheck";
import { IntroVideo } from "../components/IntroVideo";
import { NewsPopup } from "../components/NewsPopup";
import { buildRadarNodes, radarHotKeys } from "../helpers/radarNodes";
import { getRadarGlobal, type OutputType as GlobalView } from "../endpoints/radar/global_GET.schema";
import { STAGES } from "../helpers/productMap";
import { DORA_REPORT_PRICE_LABEL } from "../helpers/promo";
import styles from "./_index.module.css";

type Live = Extract<RadarStatus, { status: "live" }>;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
const pct = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
};


export default function Home() {
  const [radar, setRadar] = useState<RadarStatus | null>(null);
  const [data, setData] = useState<DatasetSample | null>(null);
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState<"idle" | "sending" | "done" | "error">("idle");
  const r1 = useScrollReveal(), r2 = useScrollReveal(), r3 = useScrollReveal(), r4 = useScrollReveal(), r5 = useScrollReveal(), r6 = useScrollReveal(), r7 = useScrollReveal();

  useEffect(() => {
    let alive = true;
    const load = () => getRadarStatus().then((d) => alive && setRadar(d)).catch(() => undefined);
    load();
    getDatasetSample().then((d) => alive && setData(d)).catch(() => undefined);
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const live = radar?.status === "live" ? radar : null;
  const labServices = useMemo(() => (live?.services ?? []).filter((s) => s.category !== "Cloud region canary"), [live]);
  const open = live?.incidents.filter((i) => i.status === "open") ?? [];
  const [globeSel, setGlobeSel] = useState<string | null>(null);
  const [global, setGlobal] = useState<GlobalView | null>(null);
  useEffect(() => { getRadarGlobal().then(setGlobal).catch(() => undefined); }, []);
  const probes = useMemo(() => [
    { lat: 38.9, lon: -77.4, label: "N. Virginia · every 5 min", ok: true },
    ...(global?.probes ?? []).map((p) => ({ lat: p.lat, lon: p.lon, label: `${p.city ?? "?"} · ${p.continent}`, ok: p.ok === p.total })),
  ], [global]);
  const continentsOk = global?.continents.filter((c) => c.total > 0 && c.reachable === c.total).length ?? null;
  const globeNodes = useMemo(() => buildRadarNodes(live?.services ?? []), [live]);
  const globeHot = useMemo(() => radarHotKeys(globeNodes, live?.incidents ?? []), [globeNodes, live]);
  const errorsNow = live ? live.services.filter((s) => s.state === "down" || s.state === "degraded").length : 0;
  const hostingNetworks = live ? new Set(live.services.map((s) => s.hostingProvider).filter(Boolean)).size : null;
  const regions = live ? new Set(live.services.map((s) => s.hostingRegion).filter(Boolean)).size : null;
  const canaries = live ? live.services.filter((s) => s.category === "Cloud region canary").length : null;
  const top = (rows: Array<{ provider: string; share: number }> | undefined) => rows?.[0];
  const dnsTop = top(live?.concentration.dns), cdnTop = top(live?.concentration.cdn), hostTop = top(live?.concentration.hosting);

  const join = async () => {
    setJoined("sending");
    try { const r = await postRadarWaitlist({ email, channel: "homepage" }); setJoined("ok" in r ? "done" : "error"); }
    catch { setJoined("error"); }
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>ShadowGraph · Outage alerts for the services your business runs on</title>
        <meta name="description" content="Get a Slack, Teams or email alert when Stripe, AWS, Slack or any of 3,000+ services you depend on goes down, and see which other vendors fail with it. Free for a limited time." />
        <meta property="og:title" content="ShadowGraph · Outage alerts for the services your business runs on" />
        <meta property="og:description" content="Get a Slack, Teams or email alert when Stripe, AWS, Slack or any of 3,000+ services you depend on goes down, and see which other vendors fail with it. Free for a limited time." />
      </Helmet>
      <SiteHeader />

      <section className={styles.intro} aria-label="Live internet outage radar">
        <div className={styles.introInner}>
          <div className={styles.introHead}>
            <span className={styles.eyebrow}><i className={open.length ? styles.dotWarn : styles.dot} /> Internet Outage Radar · live</span>
            <h1 className={styles.introH1}>Know the moment a service you rely on goes down. <em>And which others go down with it.</em></h1>
            <p className={styles.introValue}>Stripe, AWS, Slack, your payment provider: we check {live ? fmt(live.run.total) : "3,000+"} services every 5 minutes and alert you in Slack, Teams or by email, without waiting for their own status page.</p>
            <p className={styles.introStatus} aria-live="polite">
              {live ? (open.length ? `${open.length} provider incident${open.length > 1 ? "s" : ""} detected right now.` : "All monitored providers operational right now.") : "Connecting to the radar…"}
              <span className={styles.introLead}> For each one we also map the cloud, region, CDN and DNS underneath, so you see what fails together.</span>
            </p>
          </div>
          <div className={styles.introCtas}>
            <div className={styles.ctaRow}>
              <a href="/alerts" className={styles.btnPrimary}>Get free alerts</a>
              <a href="#check" className={styles.btnGhost}>Is something down? Check now</a>
            </div>
            <p className={styles.ctaNote}>Free for a limited time (normally $29 a month) · no credit card · free status check, no sign-up · <a href="/vendors">Bank or fintech? DORA vendor report →</a></p>
          </div>
          <div className={styles.introKpis}>
            <div><b>{live ? fmt(live.run.total) : "—"}</b><span>services probed</span></div>
            <div><b>{live ? fmt(live.run.up) : "—"}</b><span>reachable</span></div>
            <div><b className={errorsNow ? styles.warnNum : ""}>{live ? errorsNow : "—"}</b><span>with errors</span></div>
            <div><b>{fmt(hostingNetworks)}</b><span>hosting networks</span></div>
            <div><b>{live?.run.medianLatencyMs != null ? `${live.run.medianLatencyMs} ms` : "—"}</b><span>median latency</span></div>
            <div><b>{live ? ago(live.run.at) : "—"}</b><span>last sweep<span className={styles.kpiExtra}> · every 5 min</span></span></div>
          </div>
          <div className={styles.introGlobe}>
            {live ? <RadarGlobe nodes={globeNodes} hotKeys={globeHot} selected={globeSel} onSelect={setGlobeSel} probes={probes} agentLayer /> : <div className={styles.globeSkeleton} />}
            <div className={styles.globeLegend}>
              <span><i className={styles.lgUp} />cloud region</span><span><i className={styles.lgCountry} />server location</span>
              <span><i className={styles.lgWarn} />errors</span><span><i className={styles.lgDown} />incident</span>
              <span><i className={styles.lgProbe} />measurement point{continentsOk != null ? ` · ${continentsOk}/6 continents clear` : ""}</span>
              <a href="/radar">Open the full radar →</a>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.videoSection}`} aria-labelledby="video-h">
        <span className={styles.eyebrow} id="video-h">ShadowGraph in 27 seconds</span>
        <IntroVideo />
        <p className={styles.checkNote}>Illustrative scenario, no sound. <a href="/alerts">Get free alerts →</a></p>
      </section>

      <section id="check" className={`${styles.section} ${styles.checkSection}`} aria-label="Does it work right now?">
        <DownCheck lang="en" examples={[{ slug: "github-api", name: "GitHub" }, { slug: "chatgpt", name: "ChatGPT" }, { slug: "netflix", name: "Netflix" }, { slug: "stripe-api", name: "Stripe" }, { slug: "slack", name: "Slack" }]} />
        <p className={styles.checkNote}>Live status pages for every service: <a href="/is-it-down">Is it down?</a> · <a href="/de/ist-es-down" hrefLang="de">Auf Deutsch: Ist es down?</a></p>
      </section>

      <section className={styles.section} aria-labelledby="chain-h">
        <span className={styles.eyebrow}>One product, four steps</span>
        <h2 className={styles.h2} id="chain-h">Every outage starts as a dependency. <em>Follow it all the way to the cost.</em></h2>
        <ol className={styles.chain}>
          {STAGES.map((s) => (
            <li key={s.key}>
              <a href={s.landing} className={styles.chainHead}><span>{s.n}</span><h3>{s.name}</h3></a>
              <p className={styles.chainQ}>{s.question}</p>
              <p className={styles.chainText}>{s.summary}</p>
              <ul className={styles.chainLinks}>
                {s.links.slice(0, 4).map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="offers">
        <span className={styles.eyebrow}>What you get</span>
        <h2 className={styles.h2} id="offers">Pick what you need. <em>Start free.</em></h2>
        <div className={styles.products}>
          <a href="/alerts" className={styles.product}>
            <span className={styles.pTag}><i className={styles.dot} />02 Monitoring · teams on SaaS</span>
            <h3>Stack Alerts</h3>
            <p className={styles.pPrice}><b>Free</b> for a limited time · normally $29 a month</p>
            <p>Up to 25 services you depend on plus 10 of your own URLs. Alerts in Slack, Teams, a webhook or email when one fails, when the cloud or CDN underneath fails, or when a certificate or domain is about to expire.</p>
            <span className={styles.pLink}>Get free alerts →</span>
          </a>
          <a href="/boards" className={styles.product}>
            <span className={styles.pTag}>02 Monitoring + 03 Evidence · IT teams</span>
            <h3>Team &amp; Status Boards</h3>
            <p className={styles.pPrice}><b>$99</b> per month · 14 days free</p>
            <p>Everything in Stack Alerts for 100 services, plus five branded live boards with SLA budget, outages we saw before the vendor posted them, and a downloadable SLA evidence file.</p>
            <span className={styles.pLink}>See example boards →</span>
          </a>
          <a href="/vendors" className={styles.product}>
            <span className={styles.pTag}>01 Dependencies + 03 Evidence · finance</span>
            <h3>DORA Assessment</h3>
            <p className={styles.pPrice}><b>{DORA_REPORT_PRICE_LABEL}</b> one-time · scan free</p>
            <p>Upload up to 300 ICT vendors. Get a report for your DORA file: where vendors share cloud, DNS or CDN, which critical functions fail together, and a register annex. Invoice included.</p>
            <span className={styles.pLink}>Scan your vendors free →</span>
          </a>
          <a href="/docs" className={styles.product}>
            <span className={styles.pTag}>All steps · developers &amp; agents</span>
            <h3>API and data</h3>
            <p className={styles.pPrice}><b>Free</b> status API · paid calls from $0.50</p>
            <p>Live status of every service as JSON, an MCP server for AI assistants, and customer–supplier dependencies from SEC filings for the impact step ($99 a month).</p>
            <span className={styles.pLink}>Read the docs →</span>
          </a>
        </div>
      </section>

      <section id="stack" className={`${styles.section} ${styles.labSection}`} aria-labelledby="stack-h">
        <span className={styles.eyebrow}>Free · live data from {fmt(labServices.length || null)} mapped services</span>
        <h2 className={styles.h2} id="stack-h">Find the outage <em>you haven't planned for.</em></h2>
        <StackLab services={labServices} />
      </section>

      <section className={styles.metrics} aria-label="Live coverage">
        <div><b>{fmt(live?.run.total)}</b><span>services monitored</span></div>
        <div><b>{fmt(regions)}</b><span>cloud regions mapped</span></div>
        <div><b>{fmt(canaries)}</b><span>regional canaries</span></div>
        <div><b>288</b><span>sweeps per day</span></div>
        <div><b>{fmt(data?.stats.relationships)}</b><span>verified revenue dependencies</span></div>
      </section>

      <section className={styles.section} aria-labelledby="diff">
        <span className={styles.eyebrow}>Why ShadowGraph</span>
        <h2 className={styles.h2} id="diff">Other tools tell you a vendor is down. <em>We tell you which ones go down together.</em></h2>
        <div className={styles.compare} role="table" aria-label="Comparison with typical tools">
          <div className={styles.cmpHead} role="row"><span role="columnheader" /><span role="columnheader">Typical status-page aggregator</span><span role="columnheader">Typical uptime monitor</span><span role="columnheader" className={styles.cmpUs}>ShadowGraph</span></div>
          {([
            ["Tells you when a vendor is down", true, true, true],
            ["Checks your own endpoints every 5 minutes", false, true, true],
            ["Shows which vendors share the same cloud, region, CDN or DNS", false, false, true],
            ["Names the tools that fail next when a provider breaks (blast radius)", false, false, true],
            ["Grades how concentrated your stack is, with a fix list", false, false, true],
            ["Warns before an outage is declared, with a published hit rate", false, false, true],
          ] as Array<[string, boolean, boolean, boolean]>).map(([label, a, b, c]) => (
            <div className={styles.cmpRow} role="row" key={label}>
              <span role="cell">{label}</span>
              <span role="cell" className={a ? styles.yes : styles.no}>{a ? "Yes" : "—"}</span>
              <span role="cell" className={b ? styles.yes : styles.no}>{b ? "Yes" : "—"}</span>
              <span role="cell" className={`${styles.cmpUs} ${c ? styles.yes : styles.no}`}>{c ? "Yes" : "—"}</span>
            </div>
          ))}
        </div>
        <p className={styles.footnote}>Early warnings run under a new rule since 2026-10-09; its hit rate is still being collected and is published on the <a href="/outlook" className={styles.inlineLink}>Risk outlook</a> page, together with the first rule we retired.</p>
      </section>

      <section ref={r1} className={`${styles.section} ${styles.reveal}`}>
        <span className={styles.eyebrow}>The problem</span>
        <h2 className={styles.h2}>Your vendors look independent.<br /><em>Their infrastructure is not.</em></h2>
        <div className={styles.stats3}>
          <article><b>{pct(dnsTop?.share)}</b><p>of monitored services resolve their DNS through <strong>{dnsTop?.provider ?? "—"}</strong>.</p></article>
          <article><b>{pct(cdnTop?.share)}</b><p>sit behind a single edge network: <strong>{cdnTop?.provider ?? "—"}</strong>.</p></article>
          <article><b>{pct(hostTop?.share)}</b><p>run their service endpoint on <strong>{hostTop?.provider ?? "—"}</strong>.</p></article>
        </div>
        <p className={styles.footnote}>Live shares across the {fmt(live?.run.total)} services on our radar, recomputed every five minutes. One provider incident can take dozens of "independent" services down at once. <a href="/report" className={styles.inlineLink}>Read the full report: Who runs the internet? →</a></p>
      </section>

      <section ref={r4} className={`${styles.section} ${styles.split} ${styles.reveal}`}>
        <div>
          <span className={styles.eyebrow}>Evidence over noise</span>
          <h2 className={styles.h2}>We publish what we can prove. <em>Including what didn't work.</em></h2>
        </div>
        <ul className={styles.principles}>
          <li><b>Every finding carries its source.</b> Filings link to the SEC document; infrastructure findings list the host, IPs and network owner used.</li>
          <li><b>Incidents need independent confirmation.</b> One service failing is never a provider outage. Unreachable targets are pruned, not counted.</li>
          <li><b>Negative results are published.</b> Our customer-momentum event study found no tradable drift, so we sell exposure data, not alpha. <a href="/_api/research/customer_momentum">Read the backtest</a>.</li>
        </ul>
      </section>

      <section ref={r5} id="developers" className={`${styles.section} ${styles.split} ${styles.reveal}`}>
        <div>
          <span className={styles.eyebrow}>Developers & agents</span>
          <h2 className={styles.h2}>Ask the radar directly.</h2>
          <p className={styles.body}>Free JSON for humans and agents. Plug the MCP server into your assistant and ask "is AWS down right now, and who is affected?".</p>
          <div className={styles.devLinks}>
            <a href="/docs">API docs</a><a href="/openapi.json">OpenAPI</a><a href="/server.json">MCP manifest</a><a href="/.well-known/agent-card.json">A2A card</a>
          </div>
        </div>
        <pre className={styles.code}><code>{`# live state of ${live ? fmt(live.run.total) : "3,000+"} services
curl https://shadowalpha.online/_api/radar/status

# MCP endpoint for agents
https://shadowalpha.online/_api/mcp

# verified customer → supplier revenue links
curl https://shadowalpha.online/_api/dataset/sample`}</code></pre>
      </section>

      <section ref={r6} className={`${styles.final} ${styles.reveal}`}>
        <h2 className={styles.h2}>Know before your vendors' status pages do.</h2>
        <p className={styles.body}>Alerts for the services you depend on and for your own endpoints, in Slack, Teams, a webhook or email. Free for a limited time, no credit card.</p>
        <div className={styles.ctas}>
          <a href="/alerts" className={styles.btnPrimary}>Get free alerts</a>
          <a href="/pricing" className={styles.btnGhost}>See all plans</a>
        </div>
      </section>

      <div ref={r7} className={styles.reveal}><SiteFooter /></div>
      <NewsPopup />
    </div>
  );
}
