import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { getStatusDirectory, type OutputType as Dir } from "../endpoints/status/directory_GET.schema";
import { DIRECTORY_LETTERS, letterLabel, type DirectoryLetter } from "../helpers/statusLetters";
import { statusPath, indexPath, directoryPath, type Lang } from "../helpers/statusCopy";
import { SITE_URL } from "../helpers/site";
import styles from "./StatusAZ.module.css";

const T = {
  en: {
    crumb: "Is it down?", eyebrow: "All status pages · A–Z",
    h1: (l: string) => (l === "0–9" ? "Services starting with a number" : `Services starting with ${l}`),
    title: (l: string) => (l === "0–9" ? "Is it down? Services starting with a number · ShadowGraph" : `Is it down? Services starting with ${l} · ShadowGraph`),
    desc: (l: string, n: number, ex: string) => `Live status for ${n} ${n === 1 ? "service" : "services"} starting with ${l}${ex ? `: ${ex} and more` : ""}. Independent checks every 5 minutes, outage history and the cloud, CDN and DNS behind each one.`,
    lead: (n: number, total: number) => `${n} of ${total.toLocaleString("en-GB")} services on our radar. Each page answers: is it down for everyone, since when, and why.`,
    empty: "No services under this letter yet.", back: "Back to the live check", other: "Deutsch",
  },
  de: {
    crumb: "Ist es down?", eyebrow: "Alle Statusseiten · A–Z",
    h1: (l: string) => (l === "0–9" ? "Dienste, die mit einer Zahl beginnen" : `Dienste mit ${l}`),
    title: (l: string) => (l === "0–9" ? "Ist es down? Dienste mit Zahlen · ShadowGraph" : `Ist es down? Dienste mit ${l} · ShadowGraph`),
    desc: (l: string, n: number, ex: string) => `Live-Status für ${n} ${n === 1 ? "Dienst" : "Dienste"} mit ${l}${ex ? `: ${ex} und mehr` : ""}. Alle 5 Minuten unabhängig geprüft, mit Störungsverlauf und dem Cloud-, CDN- und DNS-Anbieter dahinter.`,
    lead: (n: number, total: number) => `${n} von ${total.toLocaleString("de-AT")} Diensten auf unserem Radar. Jede Seite beantwortet: Ist es für alle down, seit wann und warum.`,
    empty: "Unter diesem Buchstaben gibt es noch keine Dienste.", back: "Zurück zum Live-Check", other: "English",
  },
};

/** Server-rendered A–Z hub of the status pages: one crawlable list per letter, so every page is reachable by links. */
export function StatusAZ({ lang, letter }: { lang: Lang; letter: DirectoryLetter }) {
  const t = T[lang];
  const q = useQuery({ queryKey: ["status-directory", letter], queryFn: () => getStatusDirectory(letter), staleTime: 3600_000 });
  const d: Dir | null = q.data ?? null;
  const L = letterLabel(letter);
  const entries = d?.entries ?? [];
  const desc = t.desc(L, entries.length, entries.slice(0, 4).map((e) => e.name).join(", "));
  const url = `${SITE_URL}${directoryPath(lang, letter)}`;
  const other: Lang = lang === "de" ? "en" : "de";
  const counts = new Map((d?.letters ?? []).map((x) => [x.letter, x.n]));
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "ShadowGraph", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name: t.crumb, item: `${SITE_URL}${indexPath(lang)}` },
    { "@type": "ListItem", position: 3, name: L, item: url },
  ] };

  return (
    <>
      <Helmet htmlAttributes={{ lang }}>
        <title>{t.title(L)}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={t.title(L).replace(/ · ShadowGraph$/, "")} />
        <meta property="og:description" content={desc} />
        <link rel="canonical" href={url} />
        <link rel="alternate" hrefLang="en" href={`${SITE_URL}${directoryPath("en", letter)}`} />
        <link rel="alternate" hrefLang="de" href={`${SITE_URL}${directoryPath("de", letter)}`} />
        <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${directoryPath("en", letter)}`} />
        {d && !entries.length && <meta name="robots" content="noindex" />}
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>
      <SiteHeader active="status" />
      <main className={styles.page} lang={lang}>
        <div className={styles.top}>
          <nav className={styles.crumbs}><a href={indexPath(lang)}>{t.crumb}</a><span>/</span><span>{L}</span></nav>
          <a className={styles.lang} href={directoryPath(other, letter)} hrefLang={other}>{t.other}</a>
        </div>
        <span className={styles.eyebrow}>{t.eyebrow}</span>
        <h1 className={styles.h1}>{t.h1(L)}</h1>
        {d && <p className={styles.lead}>{t.lead(entries.length, d.total)}</p>}

        <AZNav lang={lang} current={letter} counts={counts} />

        {d && !entries.length && <p className={styles.muted}>{t.empty}</p>}
        <ul className={styles.list}>
          {entries.map((e) => <li key={e.slug}><a href={statusPath(lang, e.slug)}>{e.name}</a></li>)}
        </ul>
        <p className={styles.back}><a href={indexPath(lang)}>← {t.back}</a></p>
      </main>
      <SiteFooter />
    </>
  );
}

/** Letter navigation, also used on the "Is it down?" landing pages (static links, no data needed). */
export function AZNav({ lang, current, counts }: { lang: Lang; current?: DirectoryLetter; counts?: Map<string, number> }) {
  return (
    <nav className={styles.az} aria-label="A–Z">
      {DIRECTORY_LETTERS.map((l) => (
        <a key={l} href={directoryPath(lang, l)} aria-current={l === current ? "page" : undefined}
          className={`${l === current ? styles.azOn : ""} ${counts && !counts.get(l) ? styles.azEmpty : ""}`}>{letterLabel(l)}</a>
      ))}
    </nav>
  );
}