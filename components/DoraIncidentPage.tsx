import { Helmet } from "react-helmet";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { DoraIncidentCalculator } from "./DoraIncidentCalculator";
import { SITE_URL } from "../helpers/site";
import styles from "./DoraIncidentPage.module.css";

export const DORA_INCIDENT_PATH = { en: "/dora/incident-classification", de: "/de/dora/vorfall-klassifizierung" } as const;

const C = {
  en: {
    title: "DORA Incident Classification & Reporting Deadline Calculator | ShadowGraph",
    desc: "Is your ICT incident major under DORA? Free check against the thresholds of Regulation (EU) 2024/1772, with the initial, intermediate and final report deadlines. No sign-up.",
    h1: "Is this incident major under DORA?",
    lead: "Answer three questions and get the classification with its legal basis, plus the exact times your initial, intermediate and final reports are due. Nothing you enter leaves your browser.",
    other: "Auf Deutsch", howH: "How the classification works",
    how: [
      "An ICT-related incident is major when it affects critical services and either a successful malicious unauthorised access may lead to data losses, or the thresholds of at least two other criteria are met (Art. 8 of Delegated Regulation (EU) 2024/1772).",
      "Critical services are affected when the incident touches ICT services that support critical or important functions, financial services that need authorisation, registration or supervision, or when a successful malicious unauthorised access happened (Art. 6).",
      "The six criteria and their thresholds are set in Art. 9: clients, financial counterparts and transactions (more than 10% of clients, more than 100,000 clients, more than 30% of counterparts, more than 10% of daily transactions by number or value, or any relevant client), reputation, duration (more than 24 hours, or more than 2 hours of downtime for critical or important functions), two or more member states, data losses, and economic impact above €100,000.",
    ],
    dlH: "Reporting deadlines",
    dlRows: [["Initial notification", "Within 4 hours of classifying the incident as major, and no later than 24 hours after becoming aware of it. If classification happens later than that, 4 hours after classification."], ["Intermediate report", "Within 72 hours of the initial notification. Update it without undue delay once regular activities are recovered."], ["Final report", "Within 1 month of the latest updated intermediate report."]],
    dlNote: "Deadlines that fall on a weekend or public holiday may move to noon of the next working day. This does not apply to the initial notification and intermediate report of credit institutions, central counterparties, trading venue operators and entities that are essential or important under NIS2 (Art. 5 of Delegated Regulation (EU) 2025/301).",
    faqH: "Questions",
    faq: [
      ["What is a major ICT-related incident under DORA?", "One that affects critical services and either involves a successful malicious unauthorised access that may result in data losses, or meets the thresholds of at least two of the six criteria in Art. 9 of Delegated Regulation (EU) 2024/1772."],
      ["When do I have to send the initial notification?", "Within 4 hours of classifying the incident as major and at the latest 24 hours after becoming aware of it. If you classify it later than 24 hours after becoming aware, the 4 hours run from classification."],
      ["Can I use estimates?", "Yes. Where the actual figures are not known yet, the regulation allows estimates based on other available data. Reassess as the figures firm up."],
      ["What about recurring incidents?", "Incidents that are not major on their own but share the same apparent root cause, occur at least twice within 6 months and together meet the criteria are classified as one major incident (Art. 8(2))."],
      ["Where do Austrian entities report?", "To the FMA, through its Incoming Platform, using the reporting templates published by the European Supervisory Authorities."],
    ],
    ctaH: "Know about a vendor outage before your clients do",
    cta: "Upload your ICT vendor list. We map each vendor's hosting, DNS and CDN, check the critical endpoints every five minutes and open an incident file with timestamps, criteria and a draft notification as soon as something fails.",
    ctaBtn: "Scan my vendor list", sources: "Sources",
    breadcrumb: "DORA incident classification",
  },
  de: {
    title: "DORA Vorfall-Klassifizierung & Meldefristen-Rechner | ShadowGraph",
    desc: "Ist Ihr IKT-Vorfall nach DORA schwerwiegend? Kostenlose Prüfung nach den Schwellenwerten der Verordnung (EU) 2024/1772, mit den Fristen für Erst-, Zwischen- und Abschlussmeldung. Ohne Anmeldung.",
    h1: "Ist dieser Vorfall nach DORA schwerwiegend?",
    lead: "Drei Fragen beantworten, und Sie bekommen die Einstufung mit Rechtsgrundlage sowie die genauen Zeitpunkte für Erst-, Zwischen- und Abschlussmeldung. Ihre Eingaben verlassen Ihren Browser nicht.",
    other: "In English", howH: "So funktioniert die Einstufung",
    how: [
      "Ein IKT-bezogener Vorfall ist schwerwiegend, wenn er kritische Dienste betrifft und entweder ein erfolgreicher, böswilliger, unbefugter Zugriff zu Datenverlust führen kann oder die Schwellenwerte von mindestens zwei weiteren Kriterien erreicht sind (Art. 8 der Delegierten Verordnung (EU) 2024/1772).",
      "Kritische Dienste sind betroffen, wenn der Vorfall IKT-Dienste berührt, die kritische oder wichtige Funktionen unterstützen, Finanzdienstleistungen mit Zulassungs-, Registrierungs- oder Aufsichtspflicht, oder wenn ein erfolgreicher, böswilliger, unbefugter Zugriff stattgefunden hat (Art. 6).",
      "Die sechs Kriterien und ihre Schwellenwerte stehen in Art. 9: Kunden, finanzielle Gegenparteien und Transaktionen (mehr als 10 % der Kunden, mehr als 100.000 Kunden, mehr als 30 % der Gegenparteien, mehr als 10 % der täglichen Transaktionen nach Anzahl oder Wert, oder ein relevanter Kunde), Reputation, Dauer (mehr als 24 Stunden oder mehr als 2 Stunden Ausfallzeit bei kritischen oder wichtigen Funktionen), zwei oder mehr Mitgliedstaaten, Datenverluste und wirtschaftliche Auswirkungen über 100.000 €.",
    ],
    dlH: "Meldefristen",
    dlRows: [["Erstmeldung", "Innerhalb von 4 Stunden nach der Einstufung als schwerwiegend, spätestens 24 Stunden nach Kenntnis. Erfolgt die Einstufung später, 4 Stunden nach der Einstufung."], ["Zwischenmeldung", "Innerhalb von 72 Stunden nach der Erstmeldung. Sobald der Regelbetrieb wiederhergestellt ist, unverzüglich aktualisieren."], ["Abschlussmeldung", "Innerhalb von 1 Monat nach der letzten aktualisierten Zwischenmeldung."]],
    dlNote: "Fällt eine Frist auf ein Wochenende oder einen Feiertag, darf bis 12 Uhr des nächsten Arbeitstags gemeldet werden. Das gilt nicht für Erst- und Zwischenmeldungen von Kreditinstituten, zentralen Gegenparteien, Betreibern von Handelsplätzen und wesentlichen oder wichtigen Einrichtungen nach NIS2 (Art. 5 der Delegierten Verordnung (EU) 2025/301).",
    faqH: "Fragen",
    faq: [
      ["Was ist ein schwerwiegender IKT-bezogener Vorfall nach DORA?", "Einer, der kritische Dienste betrifft und entweder einen erfolgreichen, böswilligen, unbefugten Zugriff mit möglichem Datenverlust umfasst oder die Schwellenwerte von mindestens zwei der sechs Kriterien in Art. 9 der Delegierten Verordnung (EU) 2024/1772 erreicht."],
      ["Wann muss die Erstmeldung erfolgen?", "Innerhalb von 4 Stunden nach der Einstufung als schwerwiegend und spätestens 24 Stunden nach Kenntnis. Erfolgt die Einstufung später als 24 Stunden nach Kenntnis, laufen die 4 Stunden ab der Einstufung."],
      ["Darf ich schätzen?", "Ja. Solange die tatsächlichen Zahlen fehlen, erlaubt die Verordnung Schätzungen auf Basis anderer verfügbarer Daten. Bewerten Sie neu, sobald die Zahlen feststehen."],
      ["Was gilt für wiederkehrende Vorfälle?", "Vorfälle, die einzeln nicht schwerwiegend sind, aber dieselbe offensichtliche Ursache haben, mindestens zweimal in 6 Monaten auftreten und zusammen die Kriterien erfüllen, gelten als ein schwerwiegender Vorfall (Art. 8 Abs. 2)."],
      ["Wohin melden österreichische Finanzunternehmen?", "An die FMA, über deren Incoming Platform, mit den Meldevorlagen der Europäischen Aufsichtsbehörden."],
    ],
    ctaH: "Vom Ausfall eines Dienstleisters erfahren, bevor es Ihre Kunden tun",
    cta: "Laden Sie Ihre IKT-Dienstleisterliste hoch. Wir ermitteln Hosting, DNS und CDN jedes Anbieters, prüfen die kritischen Endpunkte alle fünf Minuten und legen bei einem Ausfall sofort eine Vorfallakte an: mit Zeitstempeln, Kriterien und einem Meldungsentwurf.",
    ctaBtn: "Dienstleisterliste prüfen", sources: "Quellen",
    breadcrumb: "DORA Vorfall-Klassifizierung",
  },
};

const SOURCES = [
  ["Delegated Regulation (EU) 2024/1772 (classification)", "https://eur-lex.europa.eu/eli/reg_del/2024/1772/oj"],
  ["Delegated Regulation (EU) 2025/301 (content and time limits)", "https://eur-lex.europa.eu/eli/reg_del/2025/301/oj"],
  ["Regulation (EU) 2022/2554 (DORA)", "https://eur-lex.europa.eu/eli/reg/2022/2554/oj"],
];

export function DoraIncidentPage({ lang }: { lang: "en" | "de" }) {
  const c = C[lang];
  const url = `${SITE_URL}${DORA_INCIDENT_PATH[lang]}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebApplication", name: c.breadcrumb, url, applicationCategory: "BusinessApplication", operatingSystem: "Any", inLanguage: lang, isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, description: c.desc },
    { "@context": "https://schema.org", "@type": "FAQPage", inLanguage: lang, mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  return (
    <>
      <Helmet htmlAttributes={{ lang }}>
        <title>{c.title}</title>
        <meta name="description" content={c.desc} />
        <link rel="canonical" href={url} />
        <link rel="alternate" hrefLang="en" href={`${SITE_URL}${DORA_INCIDENT_PATH.en}`} />
        <link rel="alternate" hrefLang="de" href={`${SITE_URL}${DORA_INCIDENT_PATH.de}`} />
        <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${DORA_INCIDENT_PATH.en}`} />
        <meta property="og:title" content={c.title.replace(" | ShadowGraph", "")} />
        <meta property="og:description" content={c.desc} />
        <meta property="og:url" content={url} />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>
      <SiteHeader />
      <main className={styles.page} lang={lang}>
        <header className={styles.hero}>
          <a className={styles.other} href={DORA_INCIDENT_PATH[lang === "en" ? "de" : "en"]} hrefLang={lang === "en" ? "de" : "en"}>{c.other}</a>
          <h1 className={styles.h1}>{c.h1}</h1>
          <p className={styles.lead}>{c.lead}</p>
        </header>
        <DoraIncidentCalculator lang={lang} />

        <section className={styles.cta}>
          <div><h2>{c.ctaH}</h2><p>{c.cta}</p></div>
          <a className={styles.btn} href="/vendors">{c.ctaBtn}</a>
        </section>

        <div className={styles.cols}>
          <section className={styles.text}>
            <h2>{c.howH}</h2>
            {c.how.map((p) => <p key={p.slice(0, 20)}>{p}</p>)}
            <h2>{c.dlH}</h2>
            <dl className={styles.dls}>{c.dlRows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            <p>{c.dlNote}</p>
          </section>
          <section className={styles.text}>
            <h2>{c.faqH}</h2>
            {c.faq.map(([q, a]) => <details key={q} className={styles.faq}><summary>{q}</summary><p>{a}</p></details>)}
            <h2>{c.sources}</h2>
            <ul className={styles.sources}>{SOURCES.map(([l, h]) => <li key={h}><a href={h} target="_blank" rel="noopener noreferrer">{l}</a></li>)}</ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
