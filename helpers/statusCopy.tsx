import type { StatusPageData } from "./statusPage";
import type { Dependency } from "./statusDirectory";

/**
 * Copy for the public consumer status pages ("Is X down?"), in English and German.
 * German is the second language for these pages only (owner decision 2026-10-14): people search
 * "George funktioniert nicht" in German. Everything else on the site stays English.
 */
export type Lang = "en" | "de";
export type VerdictLevel = "ok" | "partial" | "down" | "unknown";
export type Verdict = { level: VerdictLevel; headline: string; detail: string };

export const statusPath = (lang: Lang, slug: string) => (lang === "de" ? `/de/status/${slug}` : `/status/${slug}`);
export const indexPath = (lang: Lang) => (lang === "de" ? "/de/ist-es-down" : "/is-it-down");
export const directoryPath = (lang: Lang, letter: string) => `${indexPath(lang)}/${letter}`;

export function ago(lang: Lang, iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (lang === "de") return s < 90 ? `vor ${s} Sekunden` : s < 5400 ? `vor ${Math.round(s / 60)} Minuten` : s < 48 * 3600 ? `vor ${Math.round(s / 3600)} Stunden` : `vor ${Math.round(s / 86400)} Tagen`;
  return s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 48 * 3600 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`;
}

export function duration(lang: Lang, fromIso: string, toIso: string) {
  const m = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  if (m < 90) return lang === "de" ? `${m} Min.` : `${m} min`;
  const h = Math.round(m / 60);
  return lang === "de" ? `${h} Std.` : `${h} h`;
}

/** One plain-language answer to "is it down?" — the same rules everywhere (status page, search answer card). */
export function verdictFor(lang: Lang, d: StatusPageData): Verdict {
  const de = lang === "de";
  const name = d.name, rows = d.rows.filter((r) => r.category !== "Cloud region canary" || d.kind === "provider");
  if (d.kind === "unknown" || !rows.length) return de
    ? { level: "unknown", headline: `${name} überwachen wir noch nicht`, detail: "Für diesen Namen haben wir keine Messpunkte." }
    : { level: "unknown", headline: `We don't monitor ${name} yet`, detail: "No endpoints for this name are on our radar." };
  const open = d.incidents.find((i) => i.status === "open");
  const down = rows.filter((r) => r.state === "down").length;
  const degraded = rows.filter((r) => r.state === "degraded").length;
  // provider pages ship a trimmed row list (every failing row is kept); counts refer to all rows
  const total = d.rowsTotal ?? rows.length;
  const one = total === 1;
  const since = rows.map((r) => r.since).filter((x): x is string => !!x).sort()[0];
  const nowIso = new Date().toISOString();
  const sinceTxt = since ? (de ? ` Ausfall seit ${duration(lang, since, nowIso)}.` : ` Failing for ${duration(lang, since, nowIso)}.`) : "";
  if (open) return de
    ? { level: "down", headline: `Ja. ${name} ist von einer aktuellen Störung betroffen.`, detail: `${open.affected} Dienste bei ${open.provider} fallen seit ${duration(lang, open.startedAt, nowIso)} gleichzeitig aus. Die Ursache liegt beim Anbieter, nicht bei dir.` }
    : { level: "down", headline: `Yes. ${name} is affected by an active incident.`, detail: `${open.affected} services on ${open.provider} have been failing together for ${duration(lang, open.startedAt, nowIso)}. The cause is the provider, not your device.` };
  if (one && down) return de
    ? { level: "partial", headline: `${name} antwortet gerade nicht.`, detail: `Zwei Prüfungen hintereinander sind fehlgeschlagen.${sinceTxt} Beim Anbieter darunter ist keine größere Störung offen, das Problem liegt also sehr wahrscheinlich bei ${name} selbst.` }
    : { level: "partial", headline: `${name} is not answering right now.`, detail: `It failed two checks in a row.${sinceTxt} No wider incident is open at the provider underneath, so the problem is most likely with ${name} itself.` };
  if (down >= 2) return de
    ? { level: "partial", headline: `Teilweise. ${down} von ${total} Messpunkten fallen aus.`, detail: `Mehrere Teile antworten wiederholt nicht.${sinceTxt} Für einen Ausfall des ganzen Anbieters reicht es nicht.` }
    : { level: "partial", headline: `Partially. ${down} of ${total} endpoints are failing.`, detail: `Several parts fail repeatedly.${sinceTxt} Not enough independent services to call a provider-wide outage.` };
  if (down === 1 || degraded) return de
    ? { level: "partial", headline: one ? `${name} hat einmal mit einem Fehler geantwortet.` : `Größtenteils ok. ${down + degraded} von ${total} Messpunkten melden Fehler.`, detail: "Einzelner Fehler, meist ein kurzer Aussetzer. Wir prüfen alle 5 Minuten erneut." }
    : { level: "partial", headline: one ? `${name} answered with an error once.` : `Mostly up. ${down + degraded} of ${total} endpoints report errors.`, detail: "An isolated error, usually a short blip. We check again every 5 minutes." };
  return de
    ? { level: "ok", headline: `Nein. ${name} funktioniert.`, detail: `${one ? "Bei unserer letzten Prüfung hat es normal geantwortet." : `Alle ${total} überwachten Messpunkte haben normal geantwortet.`} Geht es bei dir trotzdem nicht, liegt es eher an Gerät, App oder Netz, oder die Störung betrifft nur einzelne Regionen oder Funktionen.` }
    : { level: "ok", headline: `No. ${name} is working.`, detail: `${one ? "It answered our last check normally." : `All ${total} monitored endpoints answered normally.`} If it still fails for you, the cause is more likely your device, app or network, or a problem limited to some regions or features.` };
}

const EN = {
  locale: "en-GB",
  crumbIndex: "Is it down?",
  h1: (n: string) => `Is ${n} down right now?`,
  title: (n: string) => `Is ${n} down right now? Live status & outages · ShadowGraph`,
  descOne: (n: string, infra: string) => `Is ${n} down or is it just you? Live check every 5 minutes from independent probes, 24 h uptime and recent outages. ${n} runs on ${infra}.`,
  descMany: (n: string) => `Is ${n} down or is it just you? Live check every 5 minutes from independent probes, 24 h uptime, recent outages and which services depend on ${n}.`,
  checking: "Checking…", loading: "Loading the latest check.",
  checked: (a: string) => `Checked ${a} · re-checked every 5 minutes`,
  unavailable: "Live data unavailable right now.",
  kMonitoredProvider: "dependent services monitored", kOne: "endpoint monitored", kMany: "endpoints monitored",
  kUp: "reachable now", kAvail: "24 h availability", kLatency: "median response",
  lastIssue: (who: string, when: string, dur: string, n: number) => `Last outage: ${who}, ${when}, lasted ${dur}. ${n} outage${n === 1 ? "" : "s"} in the last 30 days.`,
  noIssue: "No outage in the last 30 days.",
  providerLead: (blurb: string, n: string) => `${blurb} This page tracks every service on our radar that depends on ${n} for hosting, CDN or DNS, so you can see the blast radius of a ${n} problem, not just ${n}'s own status page.`,
  runsOn: (n: string) => `What ${n} runs on`,
  runsOnSub: (n: string) => `Mapped from public DNS, network ownership and published cloud IP ranges. When one of these providers has an outage, ${n} is exposed.`,
  region: "Cloud region", location: "Server location", approx: "approximate, by IP", ofEndpoints: (a: number, b: number) => `${a} of ${b} endpoints`,
  regions: (n: string) => `${n} regions`,
  thRegion: "Region", thLocation: "Location", thServices: "Services", thCanary: "Regional canary", thStatus: "Status", thService: "Service", thVia: "Depends via", thLatency: "Latency", thUptime: "24h uptime",
  withErrors: (k: number) => `${k} with errors`, operational: "operational",
  listProvider: (n: string) => `Services that depend on ${n}`, listOne: (n: string) => `${n} endpoint`, listMany: (n: string) => `${n} endpoints we monitor`,
  showAll: (k: number) => `Show all ${k.toLocaleString("en-GB")} services`, loadingAll: "Loading all services…",
  state: { up: "up", down: "down", degraded: "error", unknown: "unknown", open: "open", resolved: "resolved" } as Record<string, string>,
  incidents: "Recent incidents", noIncidents: (n: string) => `No ${n}-related provider incident detected in the last 7 days.`,
  incidentLine: (p: string, k: number, since: string) => `${p} · ${k} services · since ${since}`,
  shared: (n: string) => `Services on the same providers as ${n}`,
  sharedSub: (n: string) => `These services do not depend on ${n}, and a problem at ${n} itself does not affect them. They use the same provider underneath, so an outage of that provider can hit them and ${n} at the same time. If several of them are down together with ${n}, the shared provider is the likely cause.`,
  sharedGroup: {
    region: { h: "Same cloud region", p: "Same provider and the same data-centre region. A regional outage hits all of these together." },
    edge: { h: "Same DNS provider or CDN", p: "Same name servers or content delivery network. An outage there makes all of these hard to reach at once." },
    provider: { h: "Same cloud provider, region unknown", p: "Same cloud company, but we could not confirm the same region. They are only hit together if that provider fails broadly, which is rare." },
  } as Record<"region" | "edge" | "provider", { h: string; p: string }>,
  sharedMore: (k: number) => `and ${k.toLocaleString("en-GB")} more`,
  how: (n: string) => `How we check ${n}`,
  faq: (n: string, v: Verdict) => [
    { q: `Is ${n} down right now?`, a: `${v.headline} ${v.detail}` },
    { q: `Is this ${n}'s official status page?`, a: "No. It is an independent, outside-in view. Official status pages often confirm incidents late; we probe real service endpoints every five minutes and publish what we see." },
    { q: `When do you say ${n} is down?`, a: "A single failing request is reported as an error, never as an outage. A service is down after two consecutive failed checks, and we declare a provider incident only when several independent services that share the same provider fail together." },
  ],
  whyOthers: "Why do other services appear here?",
  whyOthersA: (n: string) => `Because they use the same hosting, DNS or CDN provider as ${n}. They do not depend on ${n}. When that shared provider has problems, these services can be affected at the same time as ${n}, even if their own status pages still say everything is fine.`,
  ctaH: "Watch your whole stack, not one service",
  ctaSub: "Slack, Teams, webhook or email alerts for up to 25 services and the providers underneath them, early warnings, certificate and domain expiry. Free for a limited time, no credit card.",
  ctaBtn: "Get free alerts",
  more: (c: string | null) => (c ? `More live status pages · ${c}` : "Other live status pages"),
  isDown: (n: string) => `Is ${n} down?`,
  via: { hosting: "Hosting", cdn: "CDN / edge", dns: "DNS" } as Record<Dependency, string>,
  switchLabel: "Deutsch", switchTitle: "Diese Seite auf Deutsch",
  notFoundRobots: "noindex",
};
type Copy = typeof EN;

const DE: Copy = {
  locale: "de-AT",
  crumbIndex: "Ist es down?",
  h1: (n) => `Ist ${n} gerade down?`,
  title: (n) => `Ist ${n} down? Aktuelle Störungen & Live-Status · ShadowGraph`,
  descOne: (n, infra) => `${n} geht nicht? Prüfe, ob ${n} gerade gestört ist oder nur bei dir: Live-Check alle 5 Minuten, Verfügbarkeit der letzten 24 Std. und letzte Ausfälle. ${n} läuft auf ${infra}.`,
  descMany: (n) => `${n} geht nicht? Prüfe, ob ${n} gerade gestört ist oder nur bei dir: Live-Check alle 5 Minuten, Verfügbarkeit der letzten 24 Std., letzte Ausfälle und abhängige Dienste.`,
  checking: "Wird geprüft…", loading: "Die letzte Prüfung wird geladen.",
  checked: (a) => `Geprüft ${a} · alle 5 Minuten neu`,
  unavailable: "Live-Daten sind gerade nicht verfügbar.",
  kMonitoredProvider: "abhängige Dienste überwacht", kOne: "Messpunkt überwacht", kMany: "Messpunkte überwacht",
  kUp: "gerade erreichbar", kAvail: "Verfügbarkeit 24 Std.", kLatency: "mittlere Antwortzeit",
  lastIssue: (who, when, dur, n) => `Letzte Störung: ${who}, ${when}, Dauer ${dur}. ${n} ${n === 1 ? "Störung" : "Störungen"} in den letzten 30 Tagen.`,
  noIssue: "Keine Störung in den letzten 30 Tagen.",
  providerLead: (blurb, n) => `${blurb} Diese Seite zeigt jeden Dienst auf unserem Radar, der für Hosting, CDN oder DNS von ${n} abhängt. So siehst du, wie weit eine Störung bei ${n} reicht, nicht nur die offizielle Statusseite von ${n}.`,
  runsOn: (n) => `Worauf ${n} läuft`,
  runsOnSub: (n) => `Ermittelt aus öffentlichem DNS, Netzbetreibern und den veröffentlichten IP-Bereichen der Clouds. Fällt einer dieser Anbieter aus, ist ${n} betroffen.`,
  region: "Cloud-Region", location: "Server-Standort", approx: "ungefähr, per IP", ofEndpoints: (a, b) => `${a} von ${b} Messpunkten`,
  regions: (n) => `Regionen von ${n}`,
  thRegion: "Region", thLocation: "Ort", thServices: "Dienste", thCanary: "Regionaler Testpunkt", thStatus: "Status", thService: "Dienst", thVia: "Abhängig über", thLatency: "Antwortzeit", thUptime: "Verfügbarkeit 24 Std.",
  withErrors: (k) => `${k} mit Fehlern`, operational: "funktioniert",
  listProvider: (n) => `Dienste, die von ${n} abhängen`, listOne: (n) => `Messpunkt von ${n}`, listMany: (n) => `Messpunkte von ${n}, die wir überwachen`,
  showAll: (k) => `Alle ${k.toLocaleString("de-AT")} Dienste anzeigen`, loadingAll: "Alle Dienste werden geladen…",
  state: { up: "ok", down: "ausgefallen", degraded: "Fehler", unknown: "unbekannt", open: "aktiv", resolved: "behoben" },
  incidents: "Letzte Störungen", noIncidents: (n) => `Keine Anbieter-Störung rund um ${n} in den letzten 7 Tagen.`,
  incidentLine: (p, k, since) => `${p} · ${k} Dienste · seit ${since}`,
  shared: (n) => `Dienste auf denselben Anbietern wie ${n}`,
  sharedSub: (n) => `Diese Dienste hängen nicht von ${n} ab, und ein Problem bei ${n} selbst betrifft sie nicht. Sie nutzen aber denselben Anbieter darunter. Fällt dieser Anbieter aus, kann es sie und ${n} gleichzeitig treffen. Sind mehrere davon zusammen mit ${n} down, liegt die Ursache wahrscheinlich beim gemeinsamen Anbieter.`,
  sharedGroup: {
    region: { h: "Gleiche Cloud-Region", p: "Gleicher Anbieter und gleiche Rechenzentrums-Region. Eine regionale Störung trifft alle diese gemeinsam." },
    edge: { h: "Gleicher DNS-Anbieter oder CDN", p: "Gleiche Nameserver oder gleiches Content-Delivery-Netz. Eine Störung dort macht alle diese gleichzeitig schwer erreichbar." },
    provider: { h: "Gleicher Cloud-Anbieter, Region unbekannt", p: "Gleiches Cloud-Unternehmen, aber die gleiche Region ist nicht bestätigt. Gemeinsam betroffen nur bei einer breiten Störung des Anbieters, und die ist selten." },
  },
  sharedMore: (k) => `und ${k.toLocaleString("de-AT")} weitere`,
  how: (n) => `So prüfen wir ${n}`,
  faq: (n, v) => [
    { q: `Ist ${n} gerade down?`, a: `${v.headline} ${v.detail}` },
    { q: `Ist das die offizielle Statusseite von ${n}?`, a: "Nein. Das ist eine unabhängige Sicht von außen. Offizielle Statusseiten bestätigen Störungen oft spät; wir prüfen echte Endpunkte alle fünf Minuten und veröffentlichen, was wir sehen." },
    { q: `Wann gilt ${n} bei euch als down?`, a: "Ein einzelner Fehler wird als Fehler angezeigt, nie als Ausfall. Als ausgefallen gilt ein Dienst erst nach zwei fehlgeschlagenen Prüfungen hintereinander, und eine Anbieter-Störung melden wir nur, wenn mehrere unabhängige Dienste beim selben Anbieter gleichzeitig ausfallen." },
  ],
  whyOthers: "Warum stehen hier andere Dienste?",
  whyOthersA: (n) => `Weil sie denselben Hosting-, DNS- oder CDN-Anbieter nutzen wie ${n}. Sie hängen nicht von ${n} ab. Hat dieser gemeinsame Anbieter Probleme, können sie gleichzeitig mit ${n} betroffen sein, auch wenn ihre eigenen Statusseiten noch alles grün zeigen.`,
  ctaH: "Den ganzen Stack überwachen, nicht nur einen Dienst",
  ctaSub: "Benachrichtigung per Slack, Teams, Webhook oder E-Mail für bis zu 25 Dienste und die Anbieter darunter, Frühwarnungen, Ablauf von Zertifikaten und Domains. Für kurze Zeit kostenlos, ohne Kreditkarte.",
  ctaBtn: "Gratis aktivieren",
  more: (c) => (c ? `Weitere Statusseiten · ${c}` : "Weitere Statusseiten"),
  isDown: (n) => `Ist ${n} down?`,
  via: { hosting: "Hosting", cdn: "CDN / Edge", dns: "DNS" },
  switchLabel: "English", switchTitle: "This page in English",
  notFoundRobots: "noindex",
};

export const statusCopy = (lang: Lang): Copy => (lang === "de" ? DE : EN);
