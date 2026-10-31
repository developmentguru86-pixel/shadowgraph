import { ExternalLink } from "lucide-react";
import type { PublicEvent } from "../helpers/upstreamJob";
import { LAYER_LABEL, odds, shortDate, shortTime } from "../helpers/researchFormat";
import { Chip } from "./StudyKit";
import styles from "./SignalCard.module.css";

const TIER: Record<PublicEvent["tier"], { label: string; tone: "live" | "info" | "few"; help: string }> = {
  confirmed: { label: "Confirmed by provider", tone: "live", help: "The provider's own status page or health feed reported an incident that started at the same time." },
  named: { label: "Named by companies", tone: "info", help: "At least one affected company names this provider in its own incident title." },
  statistical: { label: "Statistical only", tone: "few", help: "Unlikely to be coincidence, but nobody has named or confirmed the provider." },
};

/** One upstream signal: which provider, which companies said what, and how strong the evidence is. */
export function SignalCard({ e, mode, className }: { e: PublicEvent; mode: "live" | "retrospective"; className?: string }) {
  const [top, ...rest] = e.candidates;
  const tier = TIER[e.tier];
  const companies = [...new Map(e.companies.map((c) => [c.org, c])).values()];
  return (
    <article className={`${styles.card} ${className ?? ""}`}>
      <header className={styles.head}>
        <div className={styles.when}>
          <b>{shortDate(e.firedAt)}</b>
          <span>{shortTime(e.firedAt)} · {mode === "live" ? "detected live" : "retrospective test"}</span>
        </div>
        <Chip tone={tier.tone}>{tier.label}</Chip>
      </header>
      <div className={styles.provider}>
        <span className={styles.k}>Likely upstream</span>
        <strong>{top?.provider ?? "—"}</strong>
        <span className={styles.sub}>{top ? LAYER_LABEL[top.layer] : ""}{rest.length ? ` · also shared: ${rest.map((c) => c.provider).join(", ")}` : ""}</span>
      </div>
      <ul className={styles.companies}>
        {companies.map((c) => (
          <li key={c.org}>
            <span className={styles.company}>{c.name}<small>{shortTime(c.at)}</small></span>
            {c.link ? <a href={c.link} target="_blank" rel="noopener">“{c.title}” <ExternalLink size={12} /></a> : <span>“{c.title}”</span>}
          </li>
        ))}
      </ul>
      <footer className={styles.foot}>
        <span title="Probability that this many of the provider's companies declare incidents within one hour by coincidence">Chance of coincidence <b>{odds(e.p)}</b></span>
        {e.providerIncident ? (
          <span>
            Provider: {e.providerIncident.link ? <a href={e.providerIncident.link} target="_blank" rel="noopener">{e.providerIncident.title}</a> : e.providerIncident.title}
            {e.minutesVsProvider !== null && <b className={e.minutesVsProvider < 0 ? styles.ahead : undefined}> · {e.minutesVsProvider < 0 ? `${Math.abs(e.minutesVsProvider)} min before the provider` : `${e.minutesVsProvider} min after the provider`}</b>}
          </span>
        ) : (
          <span className={styles.muted}>{tier.help}</span>
        )}
      </footer>
    </article>
  );
}
