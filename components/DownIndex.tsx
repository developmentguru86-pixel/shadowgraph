import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { DownCheck } from "./DownCheck";
import { getRadarStatus, type OutputType as Status } from "../endpoints/radar_status_GET.schema";
import { statusDirectory } from "../helpers/statusDirectory";
import { statusPath, indexPath, type Lang } from "../helpers/statusCopy";
import { AZNav } from "./StatusAZ";
import { SITE_URL } from "../helpers/site";
import styles from "./DownIndex.module.css";

const T = {
  en: {
    title: "Is it down? Live status of AWS, Cloudflare, Azure and 3,000+ services · ShadowGraph",
    desc: "Does it work right now? Independent live status for 3,000+ apps, websites, banks and APIs and the cloud providers underneath them. Measured every 5 minutes, not guessed from user reports.",
    eyebrow: "Live status · measured every 5 minutes",
    h1a: "Is it down?", h1b: "Ask the radar.",
    lead: (open: number, live: boolean) => `Type an app, website, bank or API and get a straight answer: is it down for everyone, since when, and why. ${open ? `${open} provider incident${open > 1 ? "s are" : " is"} active right now.` : live ? "No provider incident is active right now." : ""}`,
    providers: "Cloud and edge providers", kinds: { cloud: "Cloud", edge: "Edge / CDN", hosting: "Hosting", platform: "Platform" } as Record<string, string>,
    checking: "checking…", incident: "incident", withErrors: (n: number) => `${n} with errors`, operational: "operational", deps: (n: number) => `${n} dependent services`,
    popular: "Popular services", isDown: (n: string) => `Is ${n} down?`, loading: "Loading…",
    az: "All services A–Z",
    switchLabel: "Deutsch", switchHref: "/de/ist-es-down",
    examples: [["github-api", "GitHub"], ["chatgpt", "ChatGPT"], ["netflix", "Netflix"], ["stripe-api", "Stripe"], ["slack", "Slack"], ["youtube", "YouTube"], ["whatsapp-web", "WhatsApp Web"]],
  },
  de: {
    title: "Ist es down? Störungen & Live-Status von 3.000+ Diensten · ShadowGraph",
    desc: "Funktioniert es gerade nicht? Unabhängiger Live-Status für über 3.000 Apps, Websites, Banken und APIs und die Cloud-Anbieter dahinter. Alle 5 Minuten gemessen, nicht aus Nutzer-Meldungen geschätzt.",
    eyebrow: "Live-Status · alle 5 Minuten gemessen",
    h1a: "Ist es down?", h1b: "Frag das Radar.",
    lead: (open: number, live: boolean) => `App, Website, Bank oder Dienst eingeben und eine klare Antwort bekommen: Ist es überall down, seit wann und warum. ${open ? `Gerade ${open === 1 ? "ist eine Anbieter-Störung" : `sind ${open} Anbieter-Störungen`} aktiv.` : live ? "Gerade ist keine Anbieter-Störung aktiv." : ""}`,
    providers: "Cloud- und Edge-Anbieter", kinds: { cloud: "Cloud", edge: "Edge / CDN", hosting: "Hosting", platform: "Plattform" } as Record<string, string>,
    checking: "wird geprüft…", incident: "Störung", withErrors: (n: number) => `${n} mit Fehlern`, operational: "funktioniert", deps: (n: number) => `${n} abhängige Dienste`,
    popular: "Beliebte Dienste", isDown: (n: string) => `Ist ${n} down?`, loading: "Wird geladen…",
    az: "Alle Dienste von A bis Z",
    switchLabel: "English", switchHref: "/is-it-down",
    examples: [["erste-george-at", "George"], ["orf", "ORF"], ["a1-telekom", "A1"], ["magenta-at", "Magenta"], ["krone", "Krone"], ["whatsapp-web", "WhatsApp Web"], ["netflix", "Netflix"], ["chatgpt", "ChatGPT"]],
  },
};

/** "Is it down?" landing page, English (/is-it-down) or German (/de/ist-es-down): instant check first, then providers. */
export function DownIndex({ lang }: { lang: Lang }) {
  const t = T[lang];
  const [data, setData] = useState<Status | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getRadarStatus().then((d) => alive && setData(d)).catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const live = data?.status === "live" ? data : null;
  const services = live?.services ?? [];
  const open = live?.incidents.filter((i) => i.status === "open") ?? [];
  const popular = statusDirectory.popularServices(services, 80);

  return (
    <>
      <Helmet htmlAttributes={{ lang }}>
        <title>{t.title}</title>
        <meta name="description" content={t.desc} />
        <meta property="og:title" content={t.title.replace(/ · ShadowGraph$/, "")} />
        <meta property="og:description" content={t.desc} />
        <link rel="canonical" href={`${SITE_URL}${indexPath(lang)}`} />
        <link rel="alternate" hrefLang="en" href={`${SITE_URL}${indexPath("en")}`} />
        <link rel="alternate" hrefLang="de" href={`${SITE_URL}${indexPath("de")}`} />
        <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${indexPath("en")}`} />
      </Helmet>
      <SiteHeader active="status" />
      <main className={styles.page} lang={lang}>
        <div className={styles.top}>
          <span className={styles.eyebrow}>{t.eyebrow}</span>
          <a className={styles.lang} href={t.switchHref} hrefLang={lang === "de" ? "en" : "de"}>{t.switchLabel}</a>
        </div>
        <h1 className={styles.h1}>{t.h1a} <em>{t.h1b}</em></h1>
        <p className={styles.lead}>{t.lead(open.length, !!live)}</p>

        <DownCheck lang={lang} examples={t.examples.map(([slug, name]) => ({ slug, name }))} />

        <h2 className={styles.h2top}>{t.providers}</h2>
        <section className={styles.grid}>
          {statusDirectory.providers.map((p) => {
            const deps = statusDirectory.dependents(p, services);
            const bad = deps.filter((d) => d.service.state !== "up").length;
            const hot = open.some((i) => [p.hosting, p.cdn, p.dns].some((rx) => rx && rx.test(i.provider.replace(/ (us|eu|ap|sa|ca|me|af|europe|asia)-[a-z0-9-]+$/, ""))));
            const level = !live ? "idle" : hot ? "down" : bad >= 2 ? "partial" : "ok";
            return (
              <a key={p.slug} href={statusPath(lang, p.slug)} className={`${styles.card} ${styles[`c_${level}`]}`}>
                <span className={styles.kind}>{t.kinds[p.kind]}</span>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.state}><i />{!live ? t.checking : hot ? t.incident : bad ? t.withErrors(bad) : t.operational}</span>
                <span className={styles.meta}>{live ? t.deps(deps.length) : "—"}</span>
              </a>
            );
          })}
        </section>

        <section className={styles.block}>
          <h2 className={styles.h2}>{t.popular}</h2>
          <div className={styles.links}>
            {popular.map((s) => {
              const rows = statusDirectory.servicesFor(s.slug, services);
              const bad = rows.some((r) => r.state === "down");
              return <a key={s.slug} href={statusPath(lang, s.slug)} className={bad ? styles.linkBad : undefined}>{t.isDown(s.name)}</a>;
            })}
            {!live && <span className={styles.muted}>{t.loading}</span>}
          </div>
        </section>

        <section className={styles.block}>
          <h2 className={styles.h2}>{t.az}</h2>
          <AZNav lang={lang} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
