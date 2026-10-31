import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { DependencyExplorer, type ExplorerFocus } from "../components/DependencyExplorer";
import { getSearch, type OutputType } from "../endpoints/search_GET.schema";
import { getRadarStatus, type RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import styles from "./search.module.css";

type Candidate = { focus: ExplorerFocus; label: string; kind: string };

/** What the graph can centre on for this search: the domain looked up live, services, providers, regions. */
function candidatesOf(r: OutputType, all: RadarServiceRow[]): Candidate[] {
  const out: Candidate[] = [];
  const q = r.q.toLowerCase();
  const LAYER_KEY: Record<string, string> = { hosting: "hosting", cdn: "cdn", dns: "dns", email: "email" };
  const provs: Candidate[] = r.providers.flatMap((p) => p.layers.map((l) => ({ focus: { kind: "entity" as const, key: `${LAYER_KEY[l]}:${p.name}` }, label: p.name, kind: l === "cdn" ? "CDN" : l === "dns" ? "DNS" : l })));
  const svcs: Candidate[] = r.services.slice(0, 6).map((s) => ({ focus: { kind: "service" as const, key: s.id }, label: s.name, kind: "service" }));
  const regs: Candidate[] = r.regions.flatMap((g) => {
    const s = all.find((x) => x.hostingRegion === g.region && x.hostingProvider);
    return s ? [{ focus: { kind: "entity" as const, key: `region:${s.hostingProvider}|${g.region}` }, label: `${g.label} (${g.region})`, kind: "region" }] : [];
  });
  if (r.domain) out.push({ focus: { kind: "service", key: "search-domain" }, label: r.domain.domain, kind: "live lookup" });
  // a provider whose name starts with the query beats services that merely mention it ("Cloudflare" vs "Cloudflare API")
  const provFirst = provs.some((p) => p.label.toLowerCase().startsWith(q)) && !r.services.some((s) => s.name.toLowerCase() === q);
  out.push(...(provFirst ? [...provs, ...svcs] : [...svcs, ...provs]), ...regs);
  // only nodes the graph can actually draw
  const keys = new Set<string>(["search-domain", ...all.map((s) => s.id)]);
  for (const s of all) {
    if (s.hostingProvider) keys.add(`hosting:${s.hostingProvider}`);
    if (s.hostingProvider && s.hostingRegion) keys.add(`region:${s.hostingProvider}|${s.hostingRegion}`);
    if (s.cdn) keys.add(`cdn:${s.cdn}`);
    if (s.dnsProvider) keys.add(`dns:${s.dnsProvider}`);
    if (s.emailProvider) keys.add(`email:${s.emailProvider}`);
  }
  return out.filter((c, i, a) => c.focus && keys.has(c.focus.key) && a.findIndex((x) => x.focus?.key === c.focus?.key) === i).slice(0, 10);
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(x > 0.999 ? 0 : 1)}%`);
const STATE: Record<string, [string, string]> = { up: ["up", "sUp"], degraded: ["errors", "sWarn"], down: ["down", "sDown"], unknown: ["—", "sNone"] };
const EXAMPLES = ["Cloudflare", "Stripe", "eu-central-1", "Frankfurt", "Amazon", "unzer.com"];

export default function SearchPage() {
  const [q, setQ] = useState<string | null>(null);
  const [res, setRes] = useState<OutputType | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [radar, setRadar] = useState<RadarServiceRow[] | null>(null);
  const [focus, setFocus] = useState<ExplorerFocus>(null);

  useEffect(() => { setQ(new URLSearchParams(window.location.search).get("q")?.trim() ?? ""); }, []);
  useEffect(() => {
    if (q == null || q.length < 2) return;
    setRes(null); setErr(null);
    getSearch(q).then(setRes).catch((e) => setErr(e instanceof Error ? e.message : "Search failed"));
    getRadarStatus().then((d) => { if (d.status === "live") setRadar(d.services); }).catch(() => undefined);
  }, [q]);

  // graph: every monitored service, plus the domain looked up live as its own node
  const graphServices = useMemo(() => {
    if (!radar) return null;
    const d = res?.domain;
    if (!d) return radar;
    const own = {
      id: "search-domain", name: `${d.domain} (looked up)`, category: "Live lookup", hostingProvider: d.hosting?.provider ?? null, hostingRegion: d.hosting?.region ?? null,
      hostingCountry: d.hosting?.country ?? null, cdn: d.cdn, dnsProvider: d.dns, emailProvider: d.email, analyzedHost: d.analyzedHost, state: "up", httpStatus: null,
      latencyMs: null, error: null, uptime24h: null, samples24h: 0,
    } as unknown as RadarServiceRow;
    return [own, ...radar];
  }, [radar, res]);
  const candidates = useMemo(() => (res && radar ? candidatesOf(res, radar) : []), [res, radar]);
  useEffect(() => { setFocus(candidates[0]?.focus ?? null); }, [candidates]);

  const r = res;
  const empty = r && !r.servicesTotal && !r.providers.length && !r.regions.length && !r.incidents.length && !r.companiesTotal && !r.companyPages?.length && !r.agents.total && !r.domain;
  const nav: Array<[string, string, number]> = r ? ([
    ["company-pages", "Company dependencies", r.companyPages?.length ?? 0],
    ["graph", "Graph", candidates.length ? 1 : 0], ["domain", "Live lookup", r.domain ? 1 : 0], ["services", "Services", r.servicesTotal], ["providers", "Providers", r.providers.length], ["regions", "Cloud regions", r.regions.length],
    ["incidents", "Incidents", r.incidents.length], ["companies", "Revenue dependencies", r.companiesTotal], ["agents", "AI agents", r.agents.total],
  ] as Array<[string, string, number]>).filter(([, , n]) => n > 0) : [];

  return (
    <>
      <Helmet>
        <title>{q ? `${q} · Search · ShadowGraph` : "Search · ShadowGraph"}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <SiteHeader />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Search across ShadowGraph</span>
          <h1 className={styles.h1}>{q ? <>Everything on <em>{q}</em></> : "Search"}</h1>
          {!q && <p className={styles.lead}>Type a company, a provider (hosting, CDN, DNS, email), a cloud region or a domain in the search box at the top. Try: {EXAMPLES.map((e, i) => <span key={e}>{i ? ", " : ""}<a href={`/search?q=${encodeURIComponent(e)}`}>{e}</a></span>)}.</p>}
          {r && nav.length > 0 && (
            <nav className={styles.jump} aria-label="Result sections">
              {nav.map(([id, label, n]) => <a key={id} href={`#${id}`}>{label} <b>{n}</b></a>)}
            </nav>
          )}
        </header>

        {q && !r && !err && <div className={styles.loading}><i />Searching services, providers, regions, incidents, filings and agents…</div>}
        {err && <p className={styles.err}>{err}</p>}
        {empty && <section className={styles.card}><p className={styles.muted}>No match for “{q}”. Try a company name (e.g. Stripe), a provider (Cloudflare, AWS, Hetzner), a region (eu-central-1, Frankfurt) or a full domain (example.com) for a live lookup.</p></section>}

        {r && (r.companyPages?.length ?? 0) > 0 && (
          <section className={styles.card} id="company-pages">
            <div className={styles.secHead}><h2 className={styles.h2}>Company dependencies · SEC filings</h2><a href="/companies">All companies →</a></div>
            <ul className={styles.provs}>
              {r.companyPages.map((c) => (
                <li key={c.slug}>
                  <div className={styles.provHead}>
                    <a href={`/company/${c.slug}`}><b>{c.name}</b></a>
                    {c.ticker && /^[A-Z.]{1,6}$/.test(c.ticker) && <span className={styles.tag}>{c.ticker}</span>}
                    <span className={styles.num}>{[c.customers ? `${c.customers} major customer${c.customers === 1 ? "" : "s"}` : null, c.suppliers ? `${c.suppliers} dependent supplier${c.suppliers === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                  </div>
                  {c.top && <p>{c.top.role === "customer" ? `Largest customer: ${c.top.name}, ${Math.round(c.top.share * 100)}% of revenue.` : `Most dependent supplier: ${c.top.name}, ${Math.round(c.top.share * 100)}% of its revenue comes from ${c.name}.`}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {r && candidates.length > 0 && graphServices && (
          <section className={styles.card} id="graph">
            <div className={styles.secHead}><h2 className={styles.h2}>Dependency graph</h2><span className={styles.fine}>click any node to follow the path</span></div>
            {candidates.length > 1 && (
              <div className={styles.focusChips} role="tablist" aria-label="Centre the graph on">
                {candidates.map((c) => (
                  <button key={c.focus!.key} role="tab" aria-selected={focus?.key === c.focus!.key} className={focus?.key === c.focus!.key ? styles.chipOn : styles.chip} onClick={() => setFocus(c.focus)}>
                    {c.label}<small>{c.kind}</small>
                  </button>
                ))}
              </div>
            )}
            <DependencyExplorer services={graphServices} focus={focus} onFocus={setFocus} />
          </section>
        )}
        {r && candidates.length > 0 && !graphServices && <div className={styles.loading}><i />Loading the dependency graph…</div>}

        {r?.domain && (
          <section className={styles.card} id="domain">
            <div className={styles.secHead}><h2 className={styles.h2}>Live infrastructure lookup · {r.domain.domain}</h2><a href={`/check?d=${encodeURIComponent(r.domain.domain)}`}>Open in stack check →</a></div>
            <dl className={styles.infra}>
              <div><dt>Analysed host</dt><dd>{r.domain.analyzedHost ?? "—"}</dd></div>
              <div><dt>Hosting</dt><dd>{r.domain.hosting?.provider ?? (r.domain.originHidden ? "hidden behind CDN" : "—")}{r.domain.hosting?.region ? <small>{r.domain.hosting.region}</small> : null}</dd></div>
              <div><dt>CDN / edge</dt><dd>{r.domain.cdn ?? "—"}</dd></div>
              <div><dt>DNS</dt><dd>{r.domain.dns ?? "—"}</dd></div>
              <div><dt>Email</dt><dd>{r.domain.email ?? "—"}</dd></div>
            </dl>
            <p className={styles.fine}>Evidence: {[r.domain.evidence.ips.join(", "), r.domain.evidence.asnName, r.domain.evidence.ns.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}. Read from public DNS and network data at {fmt(r.domain.scannedAt)}.</p>
          </section>
        )}
        {r?.domainNote && !r.domain && <p className={styles.muted}>{r.domainNote}</p>}

        {r && r.services.length > 0 && (
          <section className={styles.card} id="services">
            <div className={styles.secHead}><h2 className={styles.h2}>Monitored services · {r.servicesTotal}</h2><span className={styles.fine}>checked every 5 minutes</span></div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Service</th><th>Now</th><th>24 h</th><th>Hosting</th><th>CDN</th><th>DNS</th><th>Email</th></tr></thead>
                <tbody>
                  {r.services.map((s) => (
                    <tr key={s.slug}>
                      <td><a href={`/status/${s.slug}`}><b>{s.name}</b></a><small>{s.category} · {s.domain}</small></td>
                      <td><span className={styles.state}><i className={styles[STATE[s.state]?.[1] ?? "sNone"]} />{STATE[s.state]?.[0] ?? s.state}</span></td>
                      <td>{pct(s.uptime24h)}</td>
                      <td>{s.hosting ?? "—"}{s.region && s.region !== "global" ? <small>{s.region}</small> : null}</td>
                      <td>{s.cdn ?? "—"}</td><td>{s.dns ?? "—"}</td><td>{s.email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.servicesTotal > r.services.length && <p className={styles.fine}>Showing {r.services.length} of {r.servicesTotal}. Refine the search for the rest.</p>}
          </section>
        )}

        {r && r.providers.length > 0 && (
          <section className={styles.card} id="providers">
            <h2 className={styles.h2}>Providers</h2>
            <ul className={styles.provs}>
              {r.providers.map((p) => (
                <li key={p.name}>
                  <div className={styles.provHead}>
                    {p.slug ? <a href={`/status/${p.slug}`}><b>{p.name}</b></a> : <b>{p.name}</b>}
                    {p.layers.map((l) => <span key={l} className={styles.tag}>{l}</span>)}
                    <span className={styles.num}>{p.services} services depend on it</span>
                  </div>
                  <p>{p.sample.join(", ")}{p.services > p.sample.length ? ", …" : ""}</p>
                  {p.lastIncident && <small>{p.incidents90d} incidents on its status page in 90 days · latest {fmt(p.lastIncident.at)}: {p.lastIncident.title}</small>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {r && r.regions.length > 0 && (
          <section className={styles.card} id="regions">
            <h2 className={styles.h2}>Cloud regions</h2>
            <ul className={styles.provs}>
              {r.regions.map((g) => (
                <li key={g.region}><div className={styles.provHead}><b>{g.label}</b><span className={styles.tag}>{g.region}</span><span className={styles.num}>{g.services} services hosted here</span></div><p>{g.sample.join(", ")}{g.services > g.sample.length ? ", …" : ""}</p></li>
              ))}
            </ul>
            <p className={styles.fine}>Region from the providers' official IP ranges. <a href="/radar">See them on the globe →</a></p>
          </section>
        )}

        {r && r.incidents.length > 0 && (
          <section className={styles.card} id="incidents">
            <h2 className={styles.h2}>Incidents · last 90 days</h2>
            <ul className={styles.incs}>
              {r.incidents.map((i, k) => (
                <li key={k}>
                  <span className={styles.date}>{fmt(i.at)}</span>
                  <span><b>{i.who}</b> {i.link ? <a href={i.link} target="_blank" rel="noopener noreferrer">{i.title}</a> : i.title}</span>
                  <span className={i.resolved ? styles.ok : styles.open}>{i.resolved ? "resolved" : "open"}{i.severe ? " · major" : ""}</span>
                </li>
              ))}
            </ul>
            <p className={styles.fine}>From the providers' and services' own status pages.</p>
          </section>
        )}

        {r && r.companies.length > 0 && (
          <section className={styles.card} id="companies">
            <div className={styles.secHead}><h2 className={styles.h2}>Revenue dependencies · SEC filings · {r.companiesTotal}</h2><a href="/companies">All companies →</a></div>
            <p className={styles.fine}>The company on the left earns this share of its revenue from the customer on the right, as disclosed in its own SEC annual report.</p>
            <ul className={styles.deps}>
              <li className={styles.depsHead} aria-hidden="true"><span>Company (filer)</span><span>Major customer</span><span>Share of revenue</span><span>Fiscal year end</span><span>Source</span></li>
              {r.companies.map((c) => (
                <li key={`${c.ticker}-${c.customer}`} className={styles.dep}>
                  <span className={styles.depFiler}><a href={`/company/${c.ticker.toLowerCase()}`}><b>{c.ticker}</b></a><small>{c.filer}</small></span>
                  <span className={styles.depCustomer}><a href={`/company/${c.customerSlug}`}>{c.customer}</a></span>
                  <span className={styles.depShare}><b>{(c.share * 100).toFixed(1)}%</b><small> of revenue</small></span>
                  <span className={styles.depPeriod}>{c.periodEnd}</span>
                  <a className={styles.depSrc} href={c.docUrl} target="_blank" rel="noopener noreferrer">Filing</a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r && r.agents.total > 0 && (
          <section className={styles.card} id="agents">
            <div className={styles.secHead}><h2 className={styles.h2}>Public AI agents · {r.agents.total}</h2><a href="/radar">Agents on the globe →</a></div>
            <ul className={styles.incs}>
              {r.agents.sample.map((a) => <li key={a.host + a.name}><span className={styles.date}>{a.protocol.toUpperCase()}</span><span><b>{a.name}</b> <small>{a.host}</small></span><span className={styles.muted}>{a.where ?? "—"}</span></li>)}
            </ul>
            <p className={styles.fine}>From the official MCP Registry and the A2A Registry.</p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
