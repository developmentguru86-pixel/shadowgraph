import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { RadarMapView } from "../components/RadarMapView";
import { buildRadarNodes } from "../helpers/radarNodes";
import { DependencyExplorer, type ExplorerFocus } from "../components/DependencyExplorer";
import { getRadarStatus, type OutputType as Status, type RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { postDoraScan } from "../endpoints/dora_scan_POST.schema";
import { postRadarWaitlist } from "../endpoints/radar_waitlist_POST.schema";
import { stackAnalysis, GRADE_RULES, type StackItem } from "../helpers/stackAnalysis";
import styles from "./check.module.css";

const PRESETS: Record<string, string[]> = {
  "SaaS startup": ["Stripe API", "GitHub API", "Vercel API", "Slack API", "Notion API", "Linear API", "SendGrid API", "Sentry", "Datadog US", "Google accounts", "OpenAI API", "Intercom API"],
  "Online shop": ["Shopify", "Stripe API", "PayPal API", "Klarna", "Mailchimp", "Zendesk", "Facebook", "Shippo API", "Algolia", "Google APIs"],
  "Fintech": ["Stripe API", "Plaid API", "Onfido API", "Sumsub API", "Twilio API", "Salesforce login", "Microsoft Graph", "Datadog EU", "Slack API", "AWS Console"],
  "AI product": ["OpenAI API", "Anthropic API", "Pinecone API", "Supabase", "Vercel API", "Stripe API", "GitHub API", "Hugging Face", "Resend API", "PostHog"],
};
const STATUS_SLUG: Record<string, string> = { AWS: "aws", Cloudflare: "cloudflare", "Google Cloud": "google-cloud", "Microsoft Azure": "azure", Akamai: "akamai", Fastly: "fastly", Oracle: "oracle-cloud", Hetzner: "hetzner", OVHcloud: "ovhcloud", DigitalOcean: "digitalocean", Vercel: "vercel", Netlify: "netlify", Imperva: "imperva" };
const pct = (v: number) => `${Math.round(v * 100)}%`;

function toItem(s: RadarServiceRow): StackItem {
  return { id: s.id, name: s.name, category: s.category, hostingProvider: s.hostingProvider, hostingRegion: s.hostingRegion, cdn: s.cdn, dnsProvider: s.dnsProvider, emailProvider: s.emailProvider };
}

export default function CheckPage() {
  const [data, setData] = useState<Status | null>(null);
  const [tab, setTab] = useState<"stack" | "whatif">("stack");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [own, setOwn] = useState<RadarServiceRow | null>(null);
  const [ownState, setOwnState] = useState<"idle" | "scanning" | "error">("idle");
  const [ran, setRan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<ExplorerFocus>(null);
  const [target, setTarget] = useState<{ name: string; kind: "provider" | "region" } | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState<"idle" | "sending" | "done" | "error">("idle");

  useEffect(() => {
    getRadarStatus().then(setData).catch(() => undefined);
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search);
      const s = q.get("s"); const d = q.get("d"); const w = q.get("w");
      if (s) { setPicked(s.split(",").filter(Boolean).slice(0, 30)); setRan(true); }
      if (d) { setDomain(d); setRan(true); }
      if (w) { setTab("whatif"); setTarget({ name: w, kind: q.get("k") === "region" ? "region" : "provider" }); }
    }
  }, []);

  const live = data?.status === "live" ? data : null;
  const all = useMemo(() => (live?.services ?? []).filter((s) => s.category !== "Cloud region canary"), [live]);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const chosen = picked.map((id) => byId.get(id)).filter((s): s is RadarServiceRow => !!s);
  const stackRows = own ? [own, ...chosen] : chosen;
  const result = ran && stackRows.length ? stackAnalysis.analyze(stackRows.map((s) => ({ ...toItem(s), own: s.id === "own-domain" }))) : null;
  const suggestions = query.trim().length >= 2 ? all.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) && !picked.includes(s.id)).slice(0, 8) : [];

  const runDomain = async () => {
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
      setOwnState("idle");
    } catch {
      setOwnState("error");
    }
  };
  const analyze = async () => {
    await runDomain();
    setRan(true); setFocus(null);
    const q = new URLSearchParams(); if (picked.length) q.set("s", picked.join(",")); if (domain.trim()) q.set("d", domain.trim());
    window.history.replaceState(null, "", `/check?${q.toString()}`);
  };
  // shared links with ?d= : scan the domain once the radar data is in
  useEffect(() => { if (ran && domain && !own && ownState === "idle" && live) runDomain(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = () => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // what-if
  const items = useMemo(() => all.map(toItem), [all]);
  const targets = useMemo(() => stackAnalysis.targets(items), [items]);
  const sim = target && items.length ? stackAnalysis.whatIf(target.name, target.kind, items) : null;
  const mapNodes = useMemo(() => buildRadarNodes(all), [all]);
  const hitNames = new Set(sim?.examples ?? []);
  const hotKeys = new Set(mapNodes.filter((n) => n.services.some((s) => hitNames.has(s.name))).map((n) => n.key));
  const pickTarget = (name: string, kind: "provider" | "region") => {
    setTarget({ name, kind });
    window.history.replaceState(null, "", `/check?w=${encodeURIComponent(name)}&k=${kind}`);
  };

  const join = async () => {
    setJoined("sending");
    try { const r = await postRadarWaitlist({ email, services: stackRows.map((s) => s.name).join(", ").slice(0, 990), channel: "check-stack" }); setJoined("ok" in r ? "done" : "error"); }
    catch { setJoined("error"); }
  };
  const count = picked.length + (domain.trim() ? 1 : 0);

  return (
    <>
      <Helmet>
        <title>Check your stack: find the outage you haven't planned for · ShadowGraph</title>
        <meta name="description" content="Pick the tools your business runs on and see which single provider could take most of them down at once. Free, instant, based on live infrastructure mapping of 3,000+ services." />
        <meta property="og:title" content="Check your stack: find the outage you haven't planned for" />
        <meta property="og:description" content="Pick the tools your business runs on and see which single provider could take most of them down at once. Free, instant, based on live infrastructure mapping of 3,000+ services." />
      </Helmet>
      <SiteHeader active="check" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Free tools · live data from {all.length || "—"} mapped services</span>
          <h1 className={styles.h1}>Find the outage <em>you haven't planned for.</em></h1>
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={tab === "stack"} className={tab === "stack" ? styles.tabOn : ""} onClick={() => setTab("stack")}>Check your stack</button>
            <button role="tab" aria-selected={tab === "whatif"} className={tab === "whatif" ? styles.tabOn : ""} onClick={() => setTab("whatif")}>What if… goes down?</button>
          </div>
        </header>

        {tab === "stack" && (
          <>
            <section className={styles.builder}>
              <div className={styles.pickCol}>
                <label className={styles.label} htmlFor="tool">1 · The tools your business runs on</label>
                <div className={styles.searchBox}>
                  <input id="tool" placeholder={live ? "Type a tool: Stripe, Slack, GitHub, Shopify…" : "Loading the radar…"} value={query} onChange={(e) => setQuery(e.target.value)} disabled={!live} />
                  {suggestions.length > 0 && <ul className={styles.sugg}>{suggestions.map((s) => (
                    <li key={s.id}><button onClick={() => { setPicked((p) => [...p, s.id]); setQuery(""); }}>{s.name}<small>{s.category}</small></button></li>
                  ))}</ul>}
                </div>
                <div className={styles.presets}>
                  <span>Or start from</span>
                  {Object.entries(PRESETS).map(([name, list]) => (
                    <button key={name} disabled={!live} onClick={() => setPicked(list.map((n) => all.find((s) => s.name === n)?.id).filter((x): x is string => !!x))}>{name}</button>
                  ))}
                </div>
                <div className={styles.chips}>
                  {chosen.map((s) => <span key={s.id}>{s.name}<button onClick={() => setPicked((p) => p.filter((x) => x !== s.id))} aria-label={`Remove ${s.name}`}>×</button></span>)}
                  {!chosen.length && <span className={styles.empty}>No tools yet</span>}
                </div>
              </div>
              <div className={styles.domainCol}>
                <label className={styles.label} htmlFor="dom">2 · Your own domain <small>(optional)</small></label>
                <input id="dom" className={styles.input} placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                <p className={styles.hint}>We read public DNS only: hosting network, CDN, DNS and mail provider.</p>
                <button className={styles.primary} disabled={!live || !count || ownState === "scanning"} onClick={analyze}>
                  {ownState === "scanning" ? "Scanning…" : `Analyze ${count || ""} ${count === 1 ? "item" : "items"}`}
                </button>
                {ownState === "error" && <p className={styles.warn}>We could not resolve that domain.</p>}
                <p className={styles.hint}>Have a vendor list for DORA or NIS2? <a href="/vendors">Scan up to 300 ICT third parties at once →</a></p>
              </div>
            </section>

            {result && (
              <section className={styles.result}>
                <div className={styles.headline}>
                  <div className={`${styles.grade} ${styles[`g_${result.grade}`]}`}>{result.grade}</div>
                  <div>
                    <p className={styles.kicker}>Concentration grade</p>
                    <h2 className={styles.h2}>{result.top ? <>{result.top.count} of your {result.n} {result.n === 1 ? "tool depends" : "tools depend"} on <em>{result.top.name}</em>.</> : "We could not map enough of this stack."}</h2>
                    <p className={styles.sub}>{result.top ? `${pct(result.top.share)} of your stack can fail in a single ${result.top.name} incident. ` : ""}Grade by largest single-provider share: {GRADE_RULES.map(([t, g]) => `${g} under ${Math.round(Math.min(t, 1) * 100)}%`).join(" · ")}.</p>
                  </div>
                  <button className={styles.ghost} onClick={share}>{copied ? "Link copied" : "Share result"}</button>
                </div>

                <div className={styles.scenarios}>
                  {result.scenarios.map((s) => (
                    <article key={s.name}>
                      <p className={styles.kicker}>If {s.name} fails</p>
                      <b>{s.items.length}<small>/{result.n}</small></b>
                      <p>{s.items.map((i) => i.name).join(", ")}</p>
                      {STATUS_SLUG[s.name] && <a href={`/status/${STATUS_SLUG[s.name]}`}>Live {s.name} status →</a>}
                    </article>
                  ))}
                </div>

                {result.recommendations.length > 0 && (
                  <div className={styles.recs}>
                    <p className={styles.kicker}>What to do about it</p>
                    <ol>{result.recommendations.map((r) => <li key={r}>{r}</li>)}</ol>
                  </div>
                )}

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Tool</th><th>Hosting</th><th>CDN / edge</th><th>DNS</th><th>Email</th><th>Now</th></tr></thead>
                    <tbody>{stackRows.map((s) => (
                      <tr key={s.id} className={s.id === "own-domain" ? styles.ownRow : undefined}>
                        <td><b>{s.name}</b><small>{s.analyzedHost ?? s.category}</small></td>
                        <td>{s.hostingProvider ?? (s.cdn ? <span className={styles.muted}>hidden</span> : "—")}{s.hostingRegion && s.hostingRegion !== "global" && <span className={styles.region}>{s.hostingRegion}</span>}</td>
                        <td>{s.cdn ?? "—"}</td><td>{s.dnsProvider ?? "—"}</td><td>{s.emailProvider ?? "—"}</td>
                        <td>{s.id === "own-domain" ? "—" : <span className={s.state === "up" ? styles.up : styles.down}>{s.state}</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>

                {stackRows.length >= 2 && (
                  <div className={styles.graph}>
                    <p className={styles.kicker}>Your stack as a dependency graph</p>
                    <DependencyExplorer services={stackRows} focus={focus} onFocus={setFocus} stack />
                  </div>
                )}

                <div className={styles.cta}>
                  <div><h3>Get alerted when this stack is hit</h3><p className={styles.muted}>Slack, Teams, webhook or email alerts when any of these tools, or the provider underneath them, starts failing. Early warnings, certificate and domain risk included. Free for a limited time.</p></div>
                  <div className={styles.join}>
                    <a className={styles.monitor} href={`/alerts?s=${encodeURIComponent(chosen.map((s) => s.id).join(","))}`}>Monitor my stack · free</a>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {tab === "whatif" && (
          <section className={styles.whatif}>
            <div className={styles.targets}>
              <p className={styles.label}>Pick a provider</p>
              <div className={styles.tchips}>{targets.providers.map((t) => <button key={t.name} className={target?.name === t.name ? styles.tOn : ""} onClick={() => pickTarget(t.name, "provider")}>{t.name}<small>{t.count}</small></button>)}</div>
              <p className={styles.label}>…or a single cloud region</p>
              <div className={styles.tchips}>{targets.regions.map((t) => <button key={t.name} className={target?.name === t.name ? styles.tOn : ""} onClick={() => pickTarget(t.name, "region")}>{t.name}<small>{t.count}</small></button>)}</div>
              {!live && <p className={styles.muted}>Loading the radar…</p>}
            </div>
            {live && <div className={styles.mapCard}><RadarMapView nodes={mapNodes} hotKeys={hotKeys} selected={selNode} onSelect={setSelNode} /></div>}
            {sim && (
              <div className={styles.simResult}>
                <div>
                  <p className={styles.kicker}>If {sim.target} went down right now</p>
                  <p className={styles.big}>{sim.affected}<small> of {sim.total} services</small></p>
                  <p className={styles.sub}>{pct(sim.share)} of everything on our radar would lose {sim.isRegion ? "its hosting region" : `a layer: ${[sim.via.hosting && `hosting ${sim.via.hosting}`, sim.via.cdn && `CDN ${sim.via.cdn}`, sim.via.dns && `DNS ${sim.via.dns}`].filter(Boolean).join(" · ")}`}.</p>
                  <button className={styles.ghost} onClick={share}>{copied ? "Link copied" : "Share this scenario"}</button>
                </div>
                <div>
                  <p className={styles.kicker}>Hardest-hit sectors</p>
                  {sim.categories.slice(0, 7).map((c) => (
                    <div key={c.category} className={styles.bar}><span>{c.category}</span><span className={styles.track}><i style={{ width: pct(c.share) }} /></span><b>{pct(c.share)}</b></div>
                  ))}
                </div>
                <div className={styles.examples}>
                  <p className={styles.kicker}>Affected services include</p>
                  <p>{sim.examples.slice(0, 40).join(" · ")}{sim.examples.length > 40 ? ` · and ${sim.examples.length - 40} more` : ""}</p>
                  {!sim.isRegion && STATUS_SLUG[sim.target] && <a href={`/status/${STATUS_SLUG[sim.target]}`}>Is {sim.target} down right now? →</a>}
                </div>
              </div>
            )}
            {!sim && live && <p className={styles.muted}>Pick a provider or region to simulate its failure across the radar.</p>}
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
