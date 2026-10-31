import { Helmet } from "react-helmet";
import { Download } from "lucide-react";
import { PageIntro, Block, Table, Note, NextLinks } from "../components/StudyKit";
import { datasetUrl, type DatasetTable } from "../endpoints/research/dataset_GET.schema";
import { useResearchOverview } from "../helpers/useResearchData";
import { SITE_URL } from "../helpers/site";
import styles from "./research.data.module.css";

const TABLES: Array<{ id: DatasetTable; title: string; row: string; days?: number; columns: Array<[string, string]> }> = [
  { id: "services", title: "Services", row: "one monitored service", columns: [["service_id", "Stable id"], ["name, category, probe_url", "What is probed"], ["organisation", "Registrable domain of the operator"], ["hosting_provider, hosting_region, hosting_country", "Inferred from IP ownership and published cloud ranges"], ["cdn, dns_provider, email_provider", "Inferred from DNS"], ["mapped_at", "Last infrastructure mapping"]] },
  { id: "status_incidents", title: "Official incidents", row: "one incident from a company status page", columns: [["organisation, status_page, incident_id", "Who declared it and where"], ["title, impact, status", "As published"], ["created_at, started_at, resolved_at", "UTC timestamps"], ["components, link", "Affected components; link to the incident"]] },
  { id: "provider_incidents", title: "Provider incidents", row: "one incident published by an infrastructure provider", columns: [["source, incident_id", "AWS Health, Google Cloud, Cloudflare, Akamai, Vercel"], ["provider, region", "Normalised provider name; region if published"], ["title, severe", "As published; severe = significant / major or worse"], ["started_at, declared_at, resolved_at, link", "UTC timestamps and source link"]] },
  { id: "upstream_signals", title: "Upstream signals", row: "one live signal (rule cs-v1)", columns: [["signal_id, rule", "Stable id and rule version"], ["opened_at, fired_at, last_at", "First declaration, moment the rule fired, last joining declaration"], ["likely_provider, layer, companies", "Top candidate and the companies involved"], ["p_value, evidence, minutes_vs_provider", "Chance probability, evidence tier, timing vs provider"]] },
  { id: "sweeps", title: "Radar sweeps", row: "one five-minute sweep", days: 31, columns: [["run_id, at", "Sweep id and time"], ["probes, failed", "Counts"], ["vantage_suspect", "More than 50% failed: excluded from analysis"], ["failing_service_ids", "Semicolon-separated"]] },
  { id: "episodes", title: "Outage episodes", row: "two or more consecutive failed sweeps of a service", columns: [["service_id", "Service"], ["started_at, last_failed_at, recovered_at", "UTC timestamps"], ["failed_sweeps, reason", "Length and most common error"]] },
  { id: "hourly", title: "Hourly reachability", row: "one service-hour", days: 7, columns: [["service_id, hour", "Service and UTC hour"], ["probes, reachable", "Counts"], ["p50_ms, p95_ms", "Latency of successful probes"]] },
];

// schema.org Dataset markup so the tables can appear in Google Dataset Search.
const abs = (u: string) => (u.startsWith("http") ? u : `${SITE_URL}${u}`);
const DATASET_LD = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "ShadowGraph Open Measurement Dataset",
  description: "Rolling measurements of about 3,200 internet services (APIs, SaaS, banks, top websites, cloud region canaries) probed every five minutes: the infrastructure each service runs on (hosting provider, cloud region, CDN, DNS and email provider), five-minute reachability sweeps, outage episodes, hourly reachability and latency, official incidents from company and infrastructure provider status pages, and statistically flagged shared-provider signals. Every row carries UTC timestamps.",
  url: `${SITE_URL}/research/data`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true,
  creator: { "@type": "Organization", name: "ShadowGraph", url: SITE_URL },
  keywords: ["internet outages", "cloud outages", "service availability", "infrastructure dependencies", "CDN", "DNS", "cloud regions", "status pages", "concentration risk"],
  spatialCoverage: "Worldwide",
  measurementTechnique: "HTTPS probes every 5 minutes from AWS us-east-1; DNS, IP ownership and published cloud IP ranges for infrastructure mapping",
  distribution: TABLES.map((t) => ({ "@type": "DataDownload", name: t.title, encodingFormat: "text/csv", contentUrl: abs(datasetUrl(t.id, t.days)) })),
};

export default function OpenDataPage() {
  const r = useResearchOverview().data;
  const year = (r?.computedAt ?? "2026").slice(0, 4);
  return (
    <>
      <Helmet>
        <title>Open data: ShadowGraph measurement dataset (CC BY 4.0) · ShadowGraph Research</title>
        <meta name="description" content="Download ShadowGraph's open measurement dataset: monitored services and their infrastructure, official company and provider incidents, upstream signals, radar sweeps and outage episodes. CSV, CC BY 4.0." />
        <meta property="og:title" content="Open data: ShadowGraph measurement dataset (CC BY 4.0)" />
        <meta property="og:description" content="Download ShadowGraph's open measurement dataset: monitored services and their infrastructure, official company and provider incidents, upstream signals, radar sweeps and outage episodes. CSV, CC BY 4.0." />
        <script type="application/ld+json">{JSON.stringify(DATASET_LD)}</script>
      </Helmet>
      <PageIntro
        eyebrow="Research · Open data"
        title={<>Everything behind the numbers, <em>free to download.</em></>}
        lede="Seven rolling tables as CSV under Creative Commons Attribution 4.0. Every row carries its own timestamps, so a download is a citable snapshot. Use them, check our work, publish your own analysis."
        meta={[["Format", "CSV, UTF-8"], ["Licence", "CC BY 4.0"], ["Refresh", "10 min to hourly"]]}
      />

      <div className={styles.grid}>
        {TABLES.map((t) => (
          <article key={t.id} className={styles.card}>
            <header>
              <div><h2>{t.title}</h2><span>One row per {t.row}</span></div>
              <a href={datasetUrl(t.id, t.days)} className={styles.dl} download><Download size={14} /> CSV{t.days ? ` · ${t.days} days` : ""}</a>
            </header>
            <dl>{t.columns.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </article>
        ))}
      </div>

      <Block num="01" title="Machine access" intro="No key needed. Please cache responses; tables change at most every ten minutes.">
        <Table head={["What", "Request"]} rows={[
          ["Any table as CSV", <code className={styles.code}>GET /_api/research/dataset?table=&lt;name&gt;[&amp;days=1..31]</code>],
          ["Every research number (JSON)", <code className={styles.code}>GET /_api/research/overview</code>],
          ["Upstream signals and track record (JSON)", <code className={styles.code}>GET /_api/upstream/signals</code>],
          ["Live radar status (JSON)", <code className={styles.code}>GET /_api/radar/status</code>],
        ]} />
      </Block>

      <Block num="02" title="Cite this work">
        <div className={styles.cite}>
          <p>ShadowGraph ({year}). <em>Do companies on the same infrastructure fail together? Shared fate and upstream signals in official incident records.</em> ShadowGraph Research, rules sf-v1, cs-v1, val-v1, conc-v1. https://shadowalpha.online/research</p>
          <pre>{`@techreport{shadowgraph${year}research,
  title  = {Do companies on the same infrastructure fail together?},
  author = {{ShadowGraph}},
  year   = {${year}},
  note   = {Rules sf-v1, cs-v1, val-v1, conc-v1; data CC BY 4.0},
  url    = {https://shadowalpha.online/research}
}`}</pre>
        </div>
        <Note>Official incident titles are quoted from the companies' and providers' public status pages and remain theirs; every row links to its source.</Note>
      </Block>

      <NextLinks links={[
        { href: "/research/methods", label: "Methods & limitations", desc: "Read before you analyse" },
        { href: "/research/shared-fate", label: "Shared fate", desc: "Our analysis of these tables" },
        { href: "/data", label: "Dependency Data (commercial)", desc: "SEC customer-concentration dataset" },
      ]} />
    </>
  );
}
