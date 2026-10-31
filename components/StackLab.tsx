import { useMemo, useState } from "react";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { postDoraScan } from "../endpoints/dora_scan_POST.schema";
import { RadarMapView } from "./RadarMapView";
import { DependencyExplorer, type ExplorerFocus } from "./DependencyExplorer";
import { stackAnalysis, type StackItem } from "../helpers/stackAnalysis";
import { buildRadarNodes } from "../helpers/radarNodes";
import styles from "./StackLab.module.css";

const PRESETS: Record<string, string[]> = {
  "SaaS startup": ["Stripe API", "GitHub API", "Vercel API", "Slack API", "Notion API", "Linear API", "SendGrid API", "Sentry", "Datadog US", "Google accounts", "OpenAI API", "Intercom API"],
  "Online shop": ["Shopify", "Stripe API", "PayPal API", "Klarna", "Mailchimp", "Zendesk", "Facebook", "Shippo API", "Algolia", "Google APIs"],
  "Fintech": ["Stripe API", "Plaid API", "Onfido API", "Sumsub API", "Twilio API", "Salesforce login", "Microsoft Graph", "Datadog EU", "Slack API", "AWS Console"],
  "AI product": ["OpenAI API", "Anthropic API", "Pinecone API", "Supabase", "Vercel API", "Stripe API", "GitHub API", "Hugging Face", "Resend API", "PostHog"],
};
const DEFAULT = ["Stripe API", "Slack API", "GitHub API", "Shopify", "Google accounts"];
const STATUS_SLUG: Record<string, string> = { AWS: "aws", Cloudflare: "cloudflare", "Google Cloud": "google-cloud", "Microsoft Azure": "azure", Akamai: "akamai", Fastly: "fastly", Oracle: "oracle-cloud", Hetzner: "hetzner", OVHcloud: "ovhcloud", DigitalOcean: "digitalocean", Vercel: "vercel", Netlify: "netlify", Imperva: "imperva" };
const pct = (v: number) => `${Math.round(v * 100)}%`;

const toItem = (s: RadarServiceRow): StackItem => ({ id: s.id, name: s.name, category: s.category, hostingProvider: s.hostingProvider, hostingRegion: s.hostingRegion, cdn: s.cdn, dnsProvider: s.dnsProvider, emailProvider: s.emailProvider });


/**
 * Homepage version of /check: pick tools (graph updates instantly), optional own domain,
 * and a what-if simulation of one provider or region failing across the whole radar.
 */
export function StackLab({ services }: { services: RadarServiceRow[] }) {
  const ready = services.length > 0;
  const [tab, setTab] = useState<"stack" | "whatif">("stack");
  const [picked, setPicked] = useState<string[] | null>(null); // null = defaults, resolved once data is in
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [own, setOwn] = useState<RadarServiceRow | null>(null);
  const [ownState, setOwnState] = useState<"idle" | "scanning" | "error">("idle");
  const [focus, setFocus] = useState<ExplorerFocus>(null);
  const [target, setTarget] = useState<{ name: string; kind: "provider" | "region" } | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const ids = picked ?? DEFAULT.map((n) => services.find((s) => s.name === n)?.id).filter((x): x is string => !!x);
  const chosen = ids.map((id) => byId.get(id)).filter((s): s is RadarServiceRow => !!s);
  const rows = own ? [own, ...chosen] : chosen;
  const result = rows.length >= 2 ? stackAnalysis.analyze(rows.map((s) => ({ ...toItem(s), own: s.id === "own-domain" }))) : null;
  const suggestions = query.trim().length >= 2 ? services.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) && !ids.includes(s.id)).slice(0, 8) : [];
  const setIds = (next: string[]) => { setPicked(next); setFocus(null); };

  const scanDomain = async () => {
    if (!domain.trim()) { setOwn(null); return; }
    setOwnState("scanning");
    try {
      const r = await postDoraScan({ domains: [domain.trim()] });
      if ("error" in r || !r.findings[0] || r.findings[0].status !== "ok") { setOwnState("error"); setOwn(null); return; }
      const f = r.findings[0];
      setOwn({
        id: "own-domain", name: `${f.domain} (yours)`, category: "Your domain", hostingProvider: f.hosting?.provider ?? null, hostingRegion: f.hosting?.region ?? null,
        hostingCountry: f.hosting?.country ?? null, cdn: f.cdn, dnsProvider: f.dns, emailProvider: f.email, analyzedHost: f.analyzedHost, state: "up", httpStatus: null,
        latencyMs: null, error: null, uptime24h: null, samples24h: 0,
      });
      setOwnState("idle"); setFocus(null);
    } catch { setOwnState("error"); }
  };

  const q = new URLSearchParams(); if (chosen.length) q.set("s", chosen.map((s) => s.id).join(",")); if (domain.trim()) q.set("d", domain.trim());
  const fullHref = `/check?${q.toString()}`;

  // what-if
  const items = useMemo(() => services.map(toItem), [services]);
  const targets = useMemo(() => stackAnalysis.targets(items), [items]);
  const sim = target && items.length ? stackAnalysis.whatIf(target.name, target.kind, items) : null;
  const mapNodes = useMemo(() => buildRadarNodes(services), [services]);
  const hitNames = new Set(sim?.examples ?? []);
  const hotKeys = new Set(mapNodes.filter((n) => n.services.some((s) => hitNames.has(s.name))).map((n) => n.key));

  return (
    <div className={styles.lab}>
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "stack"} className={tab === "stack" ? styles.tabOn : ""} onClick={() => setTab("stack")}>Check your stack</button>
        <button role="tab" aria-selected={tab === "whatif"} className={tab === "whatif" ? styles.tabOn : ""} onClick={() => setTab("whatif")}>What if… goes down?</button>
      </div>

      {tab === "stack" && (
        <>
          <div className={styles.builder}>
            <div className={styles.pickCol}>
              <label className={styles.label} htmlFor="lab-tool">1 · The tools your business runs on</label>
              <div className={styles.searchBox}>
                <input id="lab-tool" placeholder={ready ? "Type a tool: Stripe, Slack, GitHub, Shopify…" : "Loading the radar…"} value={query} onChange={(e) => setQuery(e.target.value)} disabled={!ready} autoComplete="off" />
                {suggestions.length > 0 && <ul className={styles.sugg}>{suggestions.map((s) => (
                  <li key={s.id}><button onClick={() => { setIds([...ids, s.id]); setQuery(""); }}>{s.name}<small>{s.category}</small></button></li>
                ))}</ul>}
              </div>
              <div className={styles.presets}>
                <span>Or start from</span>
                {Object.entries(PRESETS).map(([name, list]) => (
                  <button key={name} disabled={!ready} onClick={() => setIds(list.map((n) => services.find((s) => s.name === n)?.id).filter((x): x is string => !!x))}>{name}</button>
                ))}
              </div>
              <div className={styles.chips}>
                {chosen.map((s) => <span key={s.id}>{s.name}<button onClick={() => setIds(ids.filter((x) => x !== s.id))} aria-label={`Remove ${s.name}`}>×</button></span>)}
                {!chosen.length && <span className={styles.empty}>{ready ? "No tools yet" : "Loading mapped services…"}</span>}
              </div>
            </div>
            <div className={styles.domainCol}>
              <label className={styles.label} htmlFor="lab-dom">2 · Your own domain <small>(optional)</small></label>
              <div className={styles.domainRow}>
                <input id="lab-dom" className={styles.input} placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scanDomain()} />
                <button className={styles.ghost} disabled={!ready || !domain.trim() || ownState === "scanning"} onClick={scanDomain}>{ownState === "scanning" ? "Scanning…" : "Add"}</button>
              </div>
              <p className={styles.hint}>We read public DNS only: hosting network, CDN, DNS and mail provider.</p>
              {ownState === "error" && <p className={styles.warn}>We could not resolve that domain.</p>}
              {result && (
                <div className={styles.verdict} aria-live="polite">
                  <span className={`${styles.grade} ${styles[`g_${result.grade}`]}`}>{result.grade}</span>
                  <p>{result.top ? <><b>{result.top.count} of your {result.n} tools</b> fail together if <b>{result.top.name}</b> has an outage ({pct(result.top.share)}).</> : "No shared provider found in these tools."}</p>
                </div>
              )}
              <div className={styles.actions}>
                <a className={styles.primary} href={fullHref} aria-disabled={!chosen.length}>Full analysis and fix list</a>
                <a className={styles.ghostLink} href={`/alerts?s=${encodeURIComponent(chosen.map((s) => s.id).join(","))}`}>Monitor this stack · free</a>
              </div>
            </div>
          </div>

          <div className={styles.graph}>
            <p className={styles.label}>Your stack as a dependency graph</p>
            {rows.length >= 1
              ? <DependencyExplorer services={rows} focus={focus} onFocus={setFocus} stack />
              : <div className={styles.placeholder}>{ready ? "Pick a tool to draw its dependency graph." : "Loading the radar…"}</div>}
          </div>
        </>
      )}

      {tab === "whatif" && (
        <div className={styles.whatif}>
          <div className={styles.targets}>
            <p className={styles.label}>Pick a provider</p>
            <div className={styles.tchips}>{targets.providers.map((t) => <button key={t.name} className={target?.name === t.name ? styles.tOn : ""} onClick={() => setTarget({ name: t.name, kind: "provider" })}>{t.name}<small>{t.count}</small></button>)}</div>
            <p className={styles.label}>…or a single cloud region</p>
            <div className={styles.tchips}>{targets.regions.map((t) => <button key={t.name} className={target?.name === t.name ? styles.tOn : ""} onClick={() => setTarget({ name: t.name, kind: "region" })}>{t.name}<small>{t.count}</small></button>)}</div>
            {!ready && <p className={styles.muted}>Loading the radar…</p>}
          </div>
          {ready && <div className={styles.mapCard}><RadarMapView nodes={mapNodes} hotKeys={hotKeys} selected={selNode} onSelect={setSelNode} /></div>}
          {sim && (
            <div className={styles.simResult}>
              <div>
                <p className={styles.label}>If {sim.target} went down right now</p>
                <p className={styles.big}>{sim.affected}<small> of {sim.total} services</small></p>
                <p className={styles.sub}>{pct(sim.share)} of everything on our radar would lose {sim.isRegion ? "its hosting region" : `a layer: ${[sim.via.hosting && `hosting ${sim.via.hosting}`, sim.via.cdn && `CDN ${sim.via.cdn}`, sim.via.dns && `DNS ${sim.via.dns}`].filter(Boolean).join(" · ")}`}.</p>
                <a className={styles.ghostLink} href={`/check?w=${encodeURIComponent(sim.target)}&k=${target?.kind ?? "provider"}`}>Open the full scenario →</a>
              </div>
              <div>
                <p className={styles.label}>Hardest-hit sectors</p>
                {sim.categories.slice(0, 6).map((c) => (
                  <div key={c.category} className={styles.bar}><span>{c.category}</span><span className={styles.track}><i style={{ width: pct(c.share) }} /></span><b>{pct(c.share)}</b></div>
                ))}
                {!sim.isRegion && STATUS_SLUG[sim.target] && <a className={styles.statusLink} href={`/status/${STATUS_SLUG[sim.target]}`}>Is {sim.target} down right now? →</a>}
              </div>
            </div>
          )}
          {!sim && ready && <p className={styles.muted}>Pick a provider or region to simulate its failure across the radar.</p>}
        </div>
      )}
    </div>
  );
}
