import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { FreeAlertForm } from "./FreeAlertForm";
import { getStatusPage, type OutputType as Data } from "../endpoints/status/page_GET.schema";
import { ogStatusImageUrl } from "../endpoints/og/status_GET.schema";
import { statusDirectory } from "../helpers/statusDirectory";
import { SITE_URL } from "../helpers/site";
import { notAffiliated } from "../helpers/licensing";
import { worldMap } from "../helpers/worldMap";
import { statusCopy, verdictFor, ago, duration, statusPath, indexPath, type Lang, type Verdict } from "../helpers/statusCopy";
import styles from "./StatusView.module.css";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v >= 0.9995 ? 0 : 2)}%`);
const median = (xs: number[]) => { const l = [...xs].sort((a, b) => a - b); return l.length ? l[Math.floor(l.length / 2)] : null; };

/** One public "Is X down?" page (provider, single service or brand), in English (/status/x) or German (/de/status/x). */
export function StatusView({ slug, lang }: { slug: string; lang: Lang }) {
  const c = statusCopy(lang);
  const q = useQuery({ queryKey: ["status-page", slug], queryFn: () => getStatusPage(slug), refetchInterval: 60_000 });
  // provider pages arrive trimmed (failing rows + first 100); the full list loads only when asked for
  const [showAll, setShowAll] = useState(false);
  const full = useQuery({ queryKey: ["status-page-full", slug], queryFn: () => getStatusPage(slug, { full: true }), enabled: showAll, refetchInterval: 60_000 });
  const d: Data | null = (showAll && full.data) || q.data || null;
  const name = d?.name ?? statusDirectory.provider(slug)?.name ?? statusDirectory.brandName(slug) ?? slug.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  const isProvider = d?.kind === "provider";
  const rows = (d?.rows ?? []).filter((r) => isProvider || r.category !== "Cloud region canary");
  const total = d?.rowsTotal ?? rows.length;
  const hidden = total - rows.length;
  const verdict: Verdict = d ? verdictFor(lang, d) : { level: "unknown", headline: c.checking, detail: c.loading };
  const latency = d?.summary ? d.summary.latencyMedian : median(rows.map((r) => r.latencyMs).filter((x): x is number => x !== null));
  const upNow = d?.summary ? d.summary.up : rows.filter((r) => r.state === "up").length;
  const regions = (d?.regionStats ?? []).map((g) => ({ ...g, label: worldMap.regions[g.region]?.[2] ?? "" }));
  const others = [...statusDirectory.providers.filter((p) => p.slug !== slug).map((p) => ({ slug: p.slug, name: p.name })), ...(d?.related ?? [])];
  const one = d?.kind === "service" && total === 1 ? rows[0] ?? null : null;
  const alertIds = d?.alertIds ?? rows.filter((r) => r.category !== "Cloud region canary").slice(0, 25).map((r) => r.id);
  const fmt = (iso: string) => new Date(iso).toLocaleString(c.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

  // "Other (nih.gov)" is an internal bucket label; in snippets show the plain network name, once
  const clean = (p: string | null | undefined) => (p ? p.replace(/^Other \((.+)\)$/, "$1") : "");
  const infra = one ? [...new Set([clean(one.hostingProvider), clean(one.cdn), clean(one.dnsProvider)].filter(Boolean))].join(", ") : "";
  const description = one ? c.descOne(name, infra || "—") : c.descMany(name);
  const faq = c.faq(name, verdict);
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "FAQPage", inLanguage: lang, mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "ShadowGraph", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: c.crumbIndex, item: `${SITE_URL}${indexPath(lang)}` },
      { "@type": "ListItem", position: 3, name, item: `${SITE_URL}${statusPath(lang, slug)}` },
    ] },
  ];
  const other: Lang = lang === "de" ? "en" : "de";

  return (
    <>
      <Helmet htmlAttributes={{ lang }}>
        <title>{c.title(name)}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={c.h1(name)} />
        <meta property="og:description" content={description} />
        <meta property="og:locale" content={lang === "de" ? "de_AT" : "en_GB"} />
        {d?.kind !== "unknown" && <meta property="og:image" content={`${SITE_URL}${ogStatusImageUrl(slug, lang)}`} />}
        {d?.kind !== "unknown" && <meta name="twitter:image" content={`${SITE_URL}${ogStatusImageUrl(slug, lang)}`} />}
        {d?.kind !== "unknown" && <meta property="og:image:alt" content={c.h1(name)} />}
        <link rel="canonical" href={`${SITE_URL}${statusPath(lang, slug)}`} />
        <link rel="alternate" hrefLang="en" href={`${SITE_URL}${statusPath("en", slug)}`} />
        <link rel="alternate" hrefLang="de" href={`${SITE_URL}${statusPath("de", slug)}`} />
        <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${statusPath("en", slug)}`} />
        {d && (d.kind === "unknown" || (lang === "de" ? d.indexable?.de : d.indexable?.en) === false) && <meta name="robots" content="noindex, follow" />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <SiteHeader active="status" />
      <main className={styles.page} lang={lang}>
        <div className={styles.topRow}>
          <nav className={styles.crumbs}><a href={indexPath(lang)}>{c.crumbIndex}</a><span>/</span>{d?.category && <><span>{d.category}</span><span>/</span></>}<span>{name}</span></nav>
          <a className={styles.lang} href={statusPath(other, slug)} hrefLang={other} title={c.switchTitle}>{c.switchLabel}</a>
        </div>
        <h1 className={styles.h1}>{c.h1(name)}</h1>

        <section className={`${styles.verdict} ${styles[`v_${verdict.level}`]}`} aria-live="polite">
          <i className={styles.vdot} />
          <div>
            <p className={styles.vHead}>{verdict.headline}</p>
            <p className={styles.vDetail}>{verdict.detail} {d?.checkedAt && <span className={styles.mono}>{c.checked(ago(lang, d.checkedAt))}</span>}</p>
            {d && !isProvider && d.kind !== "unknown" && (
              <p className={styles.history}>{d.lastIssue ? c.lastIssue(d.lastIssue.name, ago(lang, d.lastIssue.startedAt), duration(lang, d.lastIssue.startedAt, d.lastIssue.recoveredAt), d.issues30d) : c.noIssue}</p>
            )}
          </div>
        </section>
        {q.isError && <p className={styles.warn}>{c.unavailable}</p>}

        <section className={styles.kpis}>
          <div><b>{d ? total : "—"}</b><span>{isProvider ? c.kMonitoredProvider : total === 1 ? c.kOne : c.kMany}</span></div>
          <div><b>{d ? upNow : "—"}</b><span>{c.kUp}</span></div>
          <div><b>{d ? pct(one ? one.uptime24h : d.summary ? d.summary.uptimeAvg : rows.length ? rows.reduce((s, r) => s + (r.uptime24h ?? 0), 0) / rows.length : null) : "—"}</b><span>{c.kAvail}</span></div>
          <div><b>{latency !== null ? `${latency} ms` : "—"}</b><span>{c.kLatency}</span></div>
        </section>

        {isProvider && d?.blurb && <p className={styles.lead}>{c.providerLead(d.blurb, name)}</p>}

        <div id="alert">
          <FreeAlertForm serviceIds={alertIds} name={name} source={`${lang === "de" ? "de:" : ""}status-${slug}`} lang={lang} />
        </div>

        {!isProvider && d && d.infrastructure.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.h2}>{c.runsOn(name)}</h2>
            <p className={styles.muted}>{c.runsOnSub(name)}</p>
            <div className={styles.infra}>
              {d.infrastructure.map((i) => (
                <div key={`${i.layer}${i.name}`} className={styles.infraCard}>
                  <span className={styles.mono}>{c.via[i.layer]}</span>
                  {i.slug ? <a href={statusPath(lang, i.slug)}>{i.name}</a> : <b>{i.name}</b>}
                  {!one && <span className={styles.sub}>{c.ofEndpoints(i.services, rows.length)}</span>}
                </div>
              ))}
              {one?.hostingRegion && one.hostingRegion !== "global" && <div className={styles.infraCard}><span className={styles.mono}>{c.region}</span><b>{one.hostingRegion}</b><span className={styles.sub}>{worldMap.regions[one.hostingRegion]?.[2] ?? ""}</span></div>}
              {one?.hostingCity && <div className={styles.infraCard}><span className={styles.mono}>{c.location}</span><b>{one.hostingCity}{one.geoCountry ? `, ${one.geoCountry}` : ""}</b><span className={styles.sub}>{c.approx}</span></div>}
            </div>
          </section>
        )}

        {regions.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.h2}>{c.regions(name)}</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>{c.thRegion}</th><th>{c.thLocation}</th><th className={styles.num}>{c.thServices}</th><th>{c.thCanary}</th><th>{c.thStatus}</th></tr></thead>
                <tbody>{regions.map((g) => (
                  <tr key={g.region}>
                    <td className={styles.mono}>{g.region}</td><td>{g.label}</td><td className={styles.num}>{g.n}</td>
                    <td>{g.canary ? <span className={g.canary === "up" ? styles.bUp : styles.bDown}>{c.state[g.canary] ?? g.canary}</span> : <span className={styles.muted}>—</span>}</td>
                    <td>{g.bad ? <span className={styles.bWarn}>{c.withErrors(g.bad)}</span> : <span className={styles.bUp}>{c.operational}</span>}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={styles.block}>
          <h2 className={styles.h2}>{isProvider ? c.listProvider(name) : one ? c.listOne(name) : c.listMany(name)}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>{c.thService}</th>{isProvider && <th>{c.thVia}</th>}<th>{c.thStatus}</th><th className={styles.num}>{c.thLatency}</th><th className={styles.num}>{c.thUptime}</th></tr></thead>
              <tbody>
                {!d && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={5}><span className={styles.skeleton} /></td></tr>)}
                {[...rows].sort((a, b) => (a.state === "up" ? 1 : 0) - (b.state === "up" ? 1 : 0) || a.name.localeCompare(b.name)).map((s) => (
                  <tr key={s.id}>
                    <td>{isProvider && s.category !== "Cloud region canary" ? <a className={styles.name} href={statusPath(lang, s.slug)}>{s.name}</a> : <span className={styles.name}>{s.name}</span>}
                      <span className={styles.sub}>{s.analyzedHost ?? s.category}{s.hostingRegion && s.hostingRegion !== "global" ? ` · ${s.hostingRegion}` : ""}{s.since ? ` · ${ago(lang, s.since)}` : ""}</span></td>
                    {isProvider && <td>{s.via.map((v) => <span key={v} className={styles.via}>{c.via[v]}</span>)}</td>}
                    <td><span className={s.state === "up" ? styles.bUp : s.state === "down" ? styles.bDown : styles.bWarn}>{c.state[s.state] ?? s.state}</span></td>
                    <td className={styles.num}>{s.latencyMs !== null ? `${s.latencyMs} ms` : "—"}</td>
                    <td className={styles.num}>{pct(s.uptime24h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <button type="button" className={styles.showAll} onClick={() => setShowAll(true)} disabled={showAll}>
              {showAll ? c.loadingAll : c.showAll(total)}
            </button>
          )}
        </section>

        <section className={styles.block}>
          <h2 className={styles.h2}>{c.incidents}</h2>
          {!d?.incidents.length ? <p className={styles.muted}>{c.noIncidents(name)}</p> : d.incidents.map((i) => (
            <p key={i.id} className={styles.incident}><span className={i.status === "open" ? styles.bDown : styles.bIdle}>{c.state[i.status] ?? i.status}</span> {c.incidentLine(i.provider, i.affected, fmt(i.startedAt))}</p>
          ))}
        </section>

        {d && d.sharedWith.length > 0 && (
          <section className={styles.block}>
            <h2 className={styles.h2}>{c.shared(name)}</h2>
            <p className={styles.muted}>{c.sharedSub(name)}</p>
            {(["region", "edge", "provider"] as const).map((g) => {
              const list = d.sharedWith.filter((s) => (s.strength ?? "provider") === g);
              if (!list.length) return null;
              const more = (d.sharedTotals?.[g] ?? list.length) - list.length;
              return (
                <div key={g} className={styles.sharedGroup}>
                  <h3 className={styles.sharedH}>{c.sharedGroup[g].h}</h3>
                  <p className={styles.muted}>{c.sharedGroup[g].p}</p>
                  <div className={styles.links}>
                    {list.map((s) => <a key={s.slug} href={statusPath(lang, s.slug)} title={s.via}>{s.name}<small>{s.via}</small></a>)}
                    {more > 0 && <span className={styles.sharedMore}>{c.sharedMore(more)}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <section className={styles.faq}>
          <h2 className={styles.h2}>{c.how(name)}</h2>
          <div>
            {faq.slice(1).map((f) => <div key={f.q}><h3>{f.q}</h3><p>{f.a}</p></div>)}
            <h3>{c.whyOthers}</h3>
            <p>{c.whyOthersA(name)}</p>
          </div>
        </section>

        <section className={styles.cta}>
          <div><h2 className={styles.h2}>{c.ctaH}</h2><p className={styles.muted}>{c.ctaSub}</p></div>
          <div className={styles.join}>
            <a className={styles.trialLink} href={`/alerts?s=${encodeURIComponent(alertIds.join(","))}`}>{c.ctaBtn}</a>
          </div>
        </section>

        <section className={styles.block}>
          <h2 className={styles.h2}>{c.more(d?.category ?? null)}</h2>
          <div className={styles.links}>{others.map((o) => <a key={o.slug} href={statusPath(lang, o.slug)}>{c.isDown(o.name)}</a>)}</div>
        </section>
        {d?.kind !== "unknown" && (
          <p className={styles.history}>
            {lang === "de"
              ? `Unabhängige Messung durch ShadowGraph. Nicht mit ${name} verbunden und nicht von ${name} unterstützt. Alle Marken gehören ihren Inhabern.`
              : notAffiliated(name)}
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
