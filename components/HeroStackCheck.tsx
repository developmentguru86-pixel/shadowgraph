import { useMemo, useState } from "react";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { stackAnalysis } from "../helpers/stackAnalysis";
import styles from "./HeroStackCheck.module.css";

// [label, radar service name]
const PICKS: Array<[string, string]> = [
  ["Stripe", "Stripe API"], ["Slack", "Slack API"], ["GitHub", "GitHub API"], ["Shopify", "Shopify"], ["Google Workspace", "Google accounts"],
  ["Microsoft 365", "Microsoft Graph"], ["Vercel", "Vercel API"], ["OpenAI", "OpenAI API"], ["Twilio", "Twilio API"], ["Zendesk", "Zendesk"],
  ["HubSpot", "HubSpot API"], ["Notion", "Notion API"], ["Atlassian", "Atlassian API"], ["Zoom", "Zoom API"], ["Datadog", "Datadog US"], ["PayPal", "PayPal API"],
];
const DEFAULT = ["Stripe", "Slack", "GitHub", "Shopify", "Google Workspace"];

/** Instant, in-hero stack check: tap the tools you use, see the shared single point of failure. */
export function HeroStackCheck({ services }: { services: RadarServiceRow[] }) {
  const [picked, setPicked] = useState<string[]>(DEFAULT);
  const byName = useMemo(() => new Map(services.map((s) => [s.name, s])), [services]);
  const available = PICKS.filter(([, n]) => byName.has(n));
  const rows = picked.map((label) => byName.get(PICKS.find(([l]) => l === label)?.[1] ?? "")).filter((s): s is RadarServiceRow => !!s);
  const labelOf = (name: string) => PICKS.find(([, n]) => n === name)?.[0] ?? name;
  const result = rows.length >= 2 ? stackAnalysis.analyze(rows.map((s) => ({ id: s.id, name: s.name, category: s.category, hostingProvider: s.hostingProvider, hostingRegion: s.hostingRegion, cdn: s.cdn, dnsProvider: s.dnsProvider, emailProvider: s.emailProvider }))) : null;
  const toggle = (l: string) => setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const href = `/check?s=${encodeURIComponent(rows.map((r) => r.id).join(","))}`;

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.kicker}>Try it · tap the tools you use</span>
        <div className={styles.chips}>
          {!services.length && <span className={styles.loading}>Loading 900 mapped services…</span>}
          {available.map(([label]) => (
            <button key={label} className={picked.includes(label) ? styles.on : ""} onClick={() => toggle(label)} aria-pressed={picked.includes(label)}>{label}</button>
          ))}
        </div>
      </div>
      <div className={styles.result} aria-live="polite">
        {!result && services.length > 0 && <p className={styles.hint}>Pick at least two tools.</p>}
        {result && (
          <>
            <div className={styles.headline}>
              <span className={`${styles.grade} ${styles[`g_${result.grade}`]}`}>{result.grade}</span>
              <p>{result.top ? <><b>{result.top.count} of your {result.n} tools</b> fail together if <b>{result.top.name}</b> has an outage.</> : "No shared provider found in these tools."}</p>
            </div>
            <ul className={styles.list}>
              {result.families.slice(0, 3).map((f) => (
                <li key={f.name}><span className={styles.fam}>{f.name}</span><span className={styles.bar}><i style={{ width: `${Math.round(f.share * 100)}%` }} /></span><span className={styles.who}>{f.items.map((i) => labelOf(i.name)).join(", ")}</span></li>
              ))}
            </ul>
            <div className={styles.actions}>
              <a className={styles.primary} href={href}>See what to do about it</a>
              <a className={styles.ghost} href="/alerts">Get alerted · free</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}