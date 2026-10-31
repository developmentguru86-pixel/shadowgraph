import Stripe from "stripe";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { db } from "./db";
import { getVendorScan, type VendorScanView } from "./vendorBulkScan";
import { companyOf, mailSetupOf, type Layer } from "./vendorList";
import { publicIncidentsFor } from "./publicIncidents";
import { mppStore } from "./mppStore";
import { DORA_REPORT_FREE, DORA_REPORT_PRICE_LABEL, FREE_SESSION } from "./promo";
import { observedOutages, type ObservedOutage } from "./radarEvidence";
import { ensureReportMonitors } from "./reportMonitoring";
import { OWN_NS } from "./vendorScan";
import {
  CTPP_LIST_DATE, CTPP_SOURCE, EU_EEA, METHOD_CHANGES, METHOD_VERSION, REGION_COUNTRY, countryName, ctppEntity, fmtDate, layerLabel, providerHq,
  type ReportLang,
} from "./doraReportText";

/**
 * Paid ICT concentration risk assessment for one vendor scan (DORA Art. 28–29 / NIS2 supply-chain evidence).
 * The scan itself stays free on /vendors; the paid product is the finished, filed-ready document built from it:
 * concentration per infrastructure layer (HHI), single points of failure for critical functions, outage scenarios,
 * provider incident history, expiry risks and the register annex. One-time Stripe Checkout payment per scan.
 */
export const REPORT_PRICE_CENTS = 5000;
export const REPORT_PRICE_CURRENCY = "usd";
export const REPORT_PRICE_LABEL = DORA_REPORT_PRICE_LABEL;
const PRODUCT_TAG = "dora-report";
const PAID_RETENTION_DAYS = 365;

function stripe() {
  const key = (Reflect.get(process.env, "STRIPE_LIVE_SECRET_KEY_V2") as string | undefined)?.trim();
  if (!key) throw new Error("Stripe is not configured");
  return new Stripe(key);
}

const SCAN_ID = /^[A-Za-z0-9_-]{16,40}$/;

export type ConcentrationRating = "high" | "moderate" | "low";
export type LayerConcentration = {
  layer: Layer;
  hhi: number;
  rating: ConcentrationRating;
  /** false when fewer than MIN_FOR_HHI vendors have a known provider at this layer: the index is then an artefact (n = 1 always gives 10,000) */
  meaningful: boolean;
  resolved: number;
  top: Array<{ provider: string; vendors: number; critical: number; share: number }>;
  criticalTop: { provider: string; critical: number; share: number } | null;
};
export type ReportFinding = { severity: ConcentrationRating; title: string; detail: string };
export type ReportAction = { priority: ConcentrationRating; action: string; ref: string };
/** Legal identity of the issuer (Impressum), stored in mpp_store "config:legal". */
export type ReportIssuer = { name: string; address: string; email: string; vatId: string | null; register: string | null };
export type JurisdictionRow = { name: string; critical: boolean; endpoint: string | null; endpointBasis: "region" | "network" | null; hq: string | null };
/** One row of the decision sheet: what the outside-in view shows for a critical vendor, what has to be decided, what is missing. */
export type DecisionRow = { vendor: string; priority: ConcentrationRating; signals: string[]; decision: string; ref: string; open: string };

export type DoraReport = {
  id: string;
  lang: ReportLang;
  company: string | null;
  scannedAt: string;
  generatedAt: string;
  paid: boolean;
  scope: { vendors: number; resolved: number; unresolved: number; critical: number; hiddenOrigins: number; companies?: number };
  overall: ConcentrationRating;
  keyFigures: Array<{ value: string; label: string }>;
  findings: ReportFinding[];
  actions: ReportAction[];
  layers: LayerConcentration[];
  scenarios: Array<{ provider: string; layer: Layer; vendors: number; critical: number; share: number; names: string[]; criticalNames: string[] }>;
  singlePoints: Array<{ provider: string; layer: Layer; criticalNames: string[] }>;
  jurisdiction: {
    endpoint: { eu: number; third: number; unknown: number; byCountry: Array<{ code: string; name: string; eu: boolean; vendors: number; critical: number }> };
    hq: { eu: number; third: number; unknown: number; byCountry: Array<{ code: string; name: string; eu: boolean; vendors: number; critical: number }> };
    rows: JurisdictionRow[];
  };
  ctpp: { listDate: string; source: string; exposures: Array<{ entity: string; seenAs: string[]; vendors: string[]; critical: string[] }> };
  incidents: VendorScanView["providerIncidents"];
  expiring: { certs: Array<{ name: string; domain: string; days: number; date: string }>; domains: Array<{ name: string; domain: string; days: number; date: string }> };
  register: VendorScanView["rows"];
  observed: ObservedOutage[];
  /** press-documented provider incidents for providers that run listed services (quoted, not measured) */
  publicIncidents: Array<{ id: string; provider: string; start: string; end: string; title: string; detail: string; sources: Array<{ label: string; url: string }>; vendors: string[]; reported: string[]; providerOnly: string[] }>;
  /** one block per concrete need for action: evidence, what the institution has to establish internally, what to ask the vendor */
  actionPlan: Array<{ title: string; evidence: string; internal: string[]; vendor: string[]; ref: string }>;
  decisions: DecisionRow[];
  doc: { id: string; version: string; method: string; hash: string; issuer: ReportIssuer | null; history?: Array<{ version: string; date: string; note: string }> };
};

/** Conventional Herfindahl-Hirschman bands (as used in competition analysis): > 2,500 high, 1,500–2,500 moderate. */
const rate = (hhi: number): ConcentrationRating => (hhi > 2500 ? "high" : hhi >= 1500 ? "moderate" : "low");
const MIN_FOR_HHI = 3;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const DOC_VERSION = "1.0";

type VendorOk = VendorScanView["rows"][number];

/** Where the public endpoint is served from: a visible cloud region, else the network registration of a non-global hoster. */
function endpointCountry(v: VendorOk): { code: string; basis: "region" | "network" } | null {
  if (v.region && v.region !== "global" && REGION_COUNTRY[v.region]) return { code: REGION_COUNTRY[v.region], basis: "region" };
  const globalNetwork = v.hostingCategory === "cloud" || v.hostingCategory === "cdn" || v.originHidden || (!v.hosting && !!v.cdn);
  if (!globalNetwork && v.country && /^[A-Z]{2}$/.test(v.country)) return { code: v.country, basis: "network" };
  return null;
}

export function buildReport(scan: VendorScanView, paid: boolean, lang: ReportLang = "en", issuer: ReportIssuer | null = null, observed: ObservedOutage[] = []): DoraReport {
  const de = lang === "de";
  // other organisations that failed on the same hoster are evidence, but their names are not ours to hand to a customer:
  // the report says how many failed together, never who
  const anon = (k: number) => (de ? (k === 1 ? "ein weiterer überwachter Dienst" : `${k} weitere überwachte Dienste`) : (k === 1 ? "another monitored service" : `${k} other monitored services`));
  observed = observed.map((o) => ({
    ...o,
    sharedWith: o.sharedWith.length ? [anon(o.sharedWith.length)] : [],
    episodes: o.episodes.map((e) => ({ ...e, shared: e.shared.length ? [anon(e.shared.length)] : [] })),
  }));
  const L = (l: Layer) => layerLabel(l, lang);
  const l1 = (l: Layer) => (de ? L(l) : L(l).toLowerCase().replace("dns", "DNS").replace("cdn", "CDN"));
  // "Other (open.ch)" from the scanner: when the name servers / mail exchangers sit on the domain of a listed vendor, that vendor
  // runs them (for its own row: it runs them itself). Name it instead of calling it "self-hosted".
  const vendorByDomain = new Map<string, string>();
  for (const r of scan.rows) {
    const d = (r.domain ?? "").toLowerCase().split(".").slice(-2).join(".");
    if (d && !vendorByDomain.has(d)) vendorByDomain.set(d, r.name.split(" - ")[0].trim());
  }
  const relabel = <T extends string | null | undefined>(p: T): T => {
    if (typeof p !== "string") return p;
    return p.split(" + ").map((part) => {
      if (part === OWN_NS) return de ? "eigene Nameserver" : part;
      const m = /^Other \((.+)\)$/.exec(part);
      if (!m) return part;
      const v = vendorByDomain.get(m[1].toLowerCase());
      return v ? `${v} (${m[1]})` : (de ? `Sonstige (${m[1]})` : `Other (${m[1]})`);
    }).join(" + ") as T;
  };
  const sRaw = scan.summary;
  const s = sRaw ? { ...sRaw, layers: sRaw.layers.map((l) => ({ ...l, providers: l.providers.map((p) => ({ ...p, provider: relabel(p.provider) })) })),
    scenarios: sRaw.scenarios.map((sc) => ({ ...sc, provider: relabel(sc.provider) })) } : sRaw;
  const rows = scan.rows.map((r) => ({ ...r, dns: relabel(r.dns), email: relabel(r.email) }));
  const ok = rows.filter((r) => r.status === "ok");
  const critical = ok.filter((r) => r.critical);
  // rows are services; several can belong to one company ("Internex - Website", "Internex - Kundenbereich")
  const companies = new Set(ok.map((r) => companyOf(r.name, r.domain))).size;
  const companyOfName = (nm: string) => companyOf(nm, ok.find((r) => r.name === nm)?.domain);
  const layers: LayerConcentration[] = (s?.layers ?? []).map((l) => {
    const known = l.providers.reduce((a, p) => a + p.vendors, 0);
    const hhi = Math.round(l.providers.reduce((a, p) => a + Math.pow((p.vendors / Math.max(1, known)) * 100, 2), 0));
    const crit = l.providers.filter((p) => p.critical > 0).sort((a, b) => b.critical - a.critical)[0];
    const meaningful = known >= MIN_FOR_HHI;
    return {
      layer: l.layer, hhi, rating: meaningful ? rate(hhi) : "low", meaningful, resolved: known,
      top: l.providers.slice(0, 5).map((p) => ({ provider: p.provider, vendors: p.vendors, critical: p.critical, share: p.share })),
      criticalTop: crit && critical.length ? { provider: crit.provider, critical: crit.critical, share: crit.critical / critical.length } : null,
    };
  });
  const byName = new Map(ok.map((r) => [r.name, r]));
  // a provider is not its own dependency: "A1 Telekom Austria - DNS" does not count as a vendor that depends on A1's DNS
  const first = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöü ]/g, " ").trim().split(/\s+/)[0] ?? "";
  // …nor is "AWS" (amazon.com) a vendor that depends on Amazon Web Services: compare the provider with the row's name and domain
  const isSelf = (n: string, provider: string) => {
    const p = first(provider);
    if (first(n) === p) return true;
    const stem = (byName.get(n)?.domain ?? "").toLowerCase().split(".").slice(-2)[0] ?? "";
    return p.length >= 4 && stem.length >= 4 && (stem.startsWith(p) || p.startsWith(stem));
  };
  const scenarios = (s?.scenarios ?? []).map((sc) => ({ ...sc, criticalNames: sc.names.filter((n) => byName.get(n)?.critical && !isSelf(n, sc.provider)) }));
  // a zone served by several independent DNS operators ("A + B") keeps resolving when one fails: not a single point of failure
  // email is per organisation: api.ubs.com and ebanking-ch.ubs.com behind the same mail exchangers are one mail dependency, not two
  const zones = (names: string[], layer: Layer) => (layer === "email"
    ? new Set(names.map((nm) => { const r = byName.get(nm); return r ? mailSetupOf(r) : nm; })).size : names.length);
  // email is excluded: a vendor's corporate mail provider says how to reach the vendor in a crisis, not whether its service runs
  const singlePoints = scenarios.filter((sc) => sc.layer !== "email" && zones(sc.criticalNames, sc.layer) >= 2 && !sc.provider.includes(" + ")).map((sc) => ({ provider: sc.provider, layer: sc.layer, criticalNames: sc.criticalNames }));

  const findings: ReportFinding[] = [];
  // only layers known for at least half of the resolved vendors (a region is visible for few vendors, its HHI says little)
  const worst = [...layers].filter((l) => l.meaningful && l.layer !== "certificate authority" && l.layer !== "email" && l.resolved >= Math.max(MIN_FOR_HHI, companies / 2)).sort((a, b) => b.hhi - a.hhi)[0];
  if (worst) findings.push({
    severity: worst.rating,
    title: de
      ? `${L(worst.layer)} ist unter den Betriebsebenen (Hosting, Cloud-Region, CDN, DNS) am stärksten konzentriert (HHI ${worst.hhi.toLocaleString("de-AT")})`
      : `${L(worst.layer)} is the most concentrated of the operating layers (hosting, cloud region, CDN, DNS) (HHI ${worst.hhi.toLocaleString("en-GB")})`,
    detail: worst.top[0]
      ? (de
        ? `${worst.top[0].provider} versorgt ${worst.top[0].vendors} von ${worst.resolved} Unternehmen mit bekanntem Anbieter auf dieser Ebene (${pct(worst.top[0].vendors / worst.resolved)}).`
        : `${worst.top[0].provider} serves ${worst.top[0].vendors} of the ${worst.resolved} companies with a known ${l1(worst.layer)} provider (${pct(worst.top[0].vendors / worst.resolved)}).`)
      : (de ? "Ein Anbieter versorgt die meisten Dienstleister auf dieser Ebene." : "One provider serves most vendors at this layer."),
  });
  for (const sp of singlePoints.slice(0, 3)) findings.push({
    severity: sp.criticalNames.length >= 3 ? "high" : "moderate",
    title: de
      ? `${sp.provider} ist ein gemeinsamer Ausfallpunkt für ${sp.criticalNames.length} kritische Dienste (${L(sp.layer)})`
      : `${sp.provider} is a shared point of failure for ${sp.criticalNames.length} critical services (${l1(sp.layer)})`,
    detail: de
      ? `Eine Störung bei ${sp.provider} würde ${sp.criticalNames.join(", ")} gleichzeitig treffen (${new Set(sp.criticalNames.map(companyOfName)).size === 1 ? "Dienste eines Unternehmens" : `Dienste von ${new Set(sp.criticalNames.map(companyOfName)).size} Unternehmen`}). Abgeleitet aus der öffentlichen Infrastruktur; ob der Betrieb des Instituts davon abhängt, ist mit dem Dienstleister zu klären.`
      : `An outage at ${sp.provider} would affect ${sp.criticalNames.join(", ")} at the same time (${new Set(sp.criticalNames.map(companyOfName)).size === 1 ? "services of one company" : `services of ${new Set(sp.criticalNames.map(companyOfName)).size} companies`}). Derived from public infrastructure; whether your operations depend on it has to be confirmed with the vendor.`,
  });
  // an input gap, not a risk: listed as a note so it never raises the overall rating
  if (!critical.length) findings.push(de
    ? { severity: "low", title: "Hinweis: Kein Dienstleister ist als kritisch markiert", detail: "Markieren Sie die Dienstleister, die kritische oder wichtige Funktionen unterstützen; erst dann zeigt der Bericht, wo sich diese Funktionen konzentrieren." }
    : { severity: "low", title: "Note: no vendor is marked critical", detail: "Mark the vendors that support critical or important functions; only then can the report show where those functions concentrate." });
  if (ok.length > 0 && ok.length < MIN_FOR_HHI) findings.push(de
    ? { severity: "low", title: `Hinweis: Nur ${ok.length} Dienstleister im Umfang`, detail: "Konzentration entsteht erst über mehrere Dienstleister. Für eine belastbare Bewertung nach DORA Art. 29 den vollständigen Dienstleister-Bestand scannen (bis zu 300)." }
    : { severity: "low", title: `Note: only ${ok.length} vendor${ok.length === 1 ? "" : "s"} in scope`, detail: "Concentration only shows across several vendors. For a meaningful DORA Art. 29 assessment, scan the full vendor portfolio (up to 300)." });

  // jurisdiction: endpoint location and provider headquarters
  const jRows: JurisdictionRow[] = ok.map((v) => {
    const ep = endpointCountry(v);
    return { name: v.name, critical: v.critical, endpoint: ep?.code ?? null, endpointBasis: ep?.basis ?? null, hq: providerHq(v.hosting ?? (v.originHidden ? v.cdn : null)) };
  });
  const tally = (pick: (r: JurisdictionRow) => string | null) => {
    const by = new Map<string, { vendors: number; critical: number }>();
    let eu = 0, third = 0, unknown = 0;
    for (const r of jRows) {
      const c = pick(r);
      if (!c) { unknown++; continue; }
      if (EU_EEA.has(c)) eu++; else third++;
      const cur = by.get(c) ?? { vendors: 0, critical: 0 };
      cur.vendors++; if (r.critical) cur.critical++;
      by.set(c, cur);
    }
    return { eu, third, unknown, byCountry: [...by.entries()].map(([code, v]) => ({ code, name: countryName(code, lang), eu: EU_EEA.has(code), ...v })).sort((a, b) => b.vendors - a.vendors) };
  };
  const jurisdiction = { endpoint: tally((r) => r.endpoint), hq: tally((r) => r.hq), rows: jRows };
  const n = ok.length;
  // measured outages (own radar): a critical vendor that was down for hours is the strongest finding the report can make
  const hrs = (m: number) => (m / 60).toLocaleString(de ? "de-AT" : "en-GB", { maximumFractionDigits: 1 });
  const dt = (iso: string) => new Date(iso).toLocaleString(de ? "de-AT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
  // measurement window: 30 days, or since the first check when the endpoint has been monitored for less
  const per = (o: ObservedOutage) => o.since && Date.now() - new Date(o.since).getTime() < 29 * 86_400_000
    ? (de ? `seit ${new Date(o.since).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}` : `since ${new Date(o.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`)
    : (de ? "in den letzten 30 Tagen" : "in the last 30 days");
  // one measurement can stand for several vendors (a second endpoint on the same hoster): report it once, never add it up twice
  const sameMeasurement = (o: ObservedOutage) => `${o.measuredOn}|${o.episodes.map((e) => e.start).join(",")}`;
  const measurements = new Map<string, ObservedOutage[]>();
  for (const o of observed) measurements.set(sameMeasurement(o), [...(measurements.get(sameMeasurement(o)) ?? []), o]);
  const distinctObserved = [...measurements.values()].map((g) => [...g].sort((a, b) => Number(a.basis === "same-hoster") - Number(b.basis === "same-hoster") || Number(b.critical) - Number(a.critical))[0]);
  const alsoOn = (o: ObservedOutage) => (measurements.get(sameMeasurement(o)) ?? []).filter((x) => x.vendor !== o.vendor).map((x) => x.vendor);
  // rows that were not measured themselves carry the measuring row's name, so no table ever shows a derived figure as measured
  const repOf = new Map([...measurements.values()].map((g, i) => [sameMeasurement(g[0]), distinctObserved[i]]));
  observed = observed.map((o) => {
    const rep = repOf.get(sameMeasurement(o));
    return rep && rep.vendor !== o.vendor && o.basis === "same-hoster" ? { ...o, inferredFrom: rep.vendor } : { ...o, inferredFrom: null };
  });
  for (const o of [...distinctObserved].filter((x) => x.totalMinutes >= 240).sort((a, b) => Number(b.critical) - Number(a.critical) || b.totalMinutes - a.totalMinutes).slice(0, 3)) {
    const shared = o.sharedWith.length ? (de ? ` Zur selben Zeit fiel${o.sharedWith[0].startsWith("ein ") ? "" : "en"} ${o.sharedWith[0]} beim selben Hoster aus: Hinweis auf eine Störung beim Hoster.` : ` ${o.sharedWith[0][0].toUpperCase()}${o.sharedWith[0].slice(1)} on the same hoster failed at the same time, which points at the hoster.`) : "";
    const also = alsoOn(o).length ? (de ? ` Beim selben Hoster und daher vermutlich ebenfalls betroffen (nicht separat gemessen): ${alsoOn(o).join(", ")}.` : ` On the same hoster and therefore probably affected as well (not measured separately): ${alsoOn(o).join(", ")}.`) : "";
    const cf = o.confirm;
    const world = cf ? (de
      ? ` Weltweite Gegenprüfung während des Ausfalls (${cf.rounds} ${cf.rounds === 1 ? "Prüfrunde" : "Prüfrunden"}): ${cf.failed} von ${cf.checked} unabhängigen Messpunkten fanden die Seite ebenfalls nicht erreichbar${cf.countries.length ? ` (${cf.countries.map((c) => countryName(c, lang)).join(", ")})` : ""}.`
      : ` Worldwide cross-check during the outage (${cf.rounds} ${cf.rounds === 1 ? "round" : "rounds"}): ${cf.failed} of ${cf.checked} independent probe locations also found it unreachable${cf.countries.length ? ` (${cf.countries.map((c) => countryName(c, lang)).join(", ")})` : ""}.`) : "";
    // how far the independent evidence goes: a few rounds confirm the outage at those moments, not its whole duration
    const reach = !cf
      ? (de ? " Keine unabhängige Gegenprüfung in diesem Zeitraum: Dauer und Ausfall beruhen allein auf der eigenen Messung (ein Messstandort)." : " No independent cross-check in this period: outage and duration rest on our own checks alone (one probe location).")
      : cf.rounds < Math.max(4, Math.floor(o.longestMinutes / 120))
        ? (de ? ` Die Gegenprüfung bestätigt den Ausfall zu ${cf.rounds === 1 ? "diesem Zeitpunkt" : "diesen Zeitpunkten"}, nicht die gesamte Dauer; die Dauer stammt aus der eigenen Messung (ein Messstandort).` : ` The cross-check confirms the outage at ${cf.rounds === 1 ? "that moment" : "those moments"}, not its whole duration; the duration comes from our own checks (one probe location).`)
        : (de ? ` Die Gegenprüfungen verteilen sich über die Dauer des Ausfalls.` : ` The cross-checks are spread over the outage.`);
    const scopeNote = de
      ? " Die Messung gilt nur für diesen Endpunkt; Dienste mit eigenem Host (z. B. Online-Banking, Kundenportal oder App) können erreichbar gewesen sein. Messprotokoll: Abschnitt 8 (CSV, Link im Bericht)."
      : " The measurement covers this endpoint only; services on their own host (e.g. online banking, customer portal or app) may have been reachable. Measurement log: section 8 (CSV, link in the report).";
    findings.push({
      severity: o.critical ? "high" : "moderate",
      title: de ? `${o.vendor} war ${per(o)} ${hrs(o.totalMinutes)} Std. nicht erreichbar` : `${o.vendor} was unreachable for ${hrs(o.totalMinutes)} h ${per(o)}`,
      detail: de
        ? `${o.outages} ${o.outages === 1 ? "Ausfall" : "Ausfälle"} ab 30 Minuten, der längste ${hrs(o.longestMinutes)} Std. ab ${o.longestStart ? dt(o.longestStart) : "—"}. Eigene Messung alle 5 Minuten an ${o.measuredOn}${o.basis === "same-hoster" ? " (gleicher Hoster)" : ""}.${world}${reach}${shared}${also}${scopeNote}`
        : `${o.outages} outage${o.outages === 1 ? "" : "s"} of 30 minutes or more, the longest ${hrs(o.longestMinutes)} h from ${o.longestStart ? dt(o.longestStart) : "—"}. Own 5-minute checks on ${o.measuredOn}${o.basis === "same-hoster" ? " (same hoster)" : ""}.${world}${reach}${shared}${also}${scopeNote}`,
    });
  }
  // publicly documented provider incidents (press, official statements) for providers that run listed services
  const vendorsCritical = (names: string[]) => names.some((nm) => byName.get(nm)?.critical);
  const publicIncidents = publicIncidentsFor(ok, new Date(scan.createdAt).getTime() - 90 * 86_400_000).map(({ incident, vendors, reported }) => ({
    id: incident.id, provider: incident.provider, start: incident.start, end: incident.end,
    title: de ? incident.de.title : incident.en.title, detail: de ? incident.de.detail : incident.en.detail, sources: incident.sources, vendors,
    reported, providerOnly: vendors.filter((v) => !reported.includes(v)),
  }));
  for (const p of publicIncidents) findings.push({
    severity: vendorsCritical(p.reported) ? "high" : "moderate",
    title: p.title,
    detail: `${p.detail}${p.reported.length ? (de ? ` Laut den Berichten betroffene Funktion in dieser Liste: ${p.reported.join(", ")}.` : ` Function reported as affected, in this list: ${p.reported.join(", ")}.`) : ""}${p.providerOnly.length ? (de ? ` Beim selben Anbieter, Betroffenheit nicht belegt: ${p.providerOnly.join(", ")}.` : ` Same provider, not shown to be affected: ${p.providerOnly.join(", ")}.`) : ""} ${de ? "Quellen" : "Sources"}: ${p.sources.map((x) => x.label).join("; ")}.`,
  });
  if (n && jurisdiction.hq.third / n > 0.5) findings.push({
    severity: "moderate",
    title: de
      ? `${jurisdiction.hq.third} von ${n} Dienstleistern laufen bei Anbietern mit Sitz außerhalb von EU/EWR`
      : `${jurisdiction.hq.third} of ${n} vendors run on providers headquartered outside the EU/EEA`,
    detail: de
      ? `Am häufigsten: ${jurisdiction.hq.byCountry.filter((c) => !c.eu).slice(0, 2).map((c) => `${c.name} (${c.vendors})`).join(", ")}. Verarbeitungsorte und Zugriffsregeln vertraglich prüfen (DORA Art. 30 Abs. 2 lit. b).`
      : `Most often: ${jurisdiction.hq.byCountry.filter((c) => !c.eu).slice(0, 2).map((c) => `${c.name} (${c.vendors})`).join(", ")}. Check processing locations and access terms in the contracts (DORA Art. 30(2)(b)).`,
  });

  // designated CTPPs (ESA list): every infrastructure layer of every resolved vendor
  const ctppBy = new Map<string, { seenAs: Set<string>; vendors: Set<string>; critical: Set<string> }>();
  for (const v of ok) {
    for (const p of [v.hosting, v.cdn, v.dns, v.email]) {
      const e = ctppEntity(p);
      if (!e || !p) continue;
      const cur = ctppBy.get(e) ?? { seenAs: new Set(), vendors: new Set(), critical: new Set() };
      cur.seenAs.add(p); cur.vendors.add(v.name); if (v.critical) cur.critical.add(v.name);
      ctppBy.set(e, cur);
    }
  }
  const ctpp = {
    listDate: CTPP_LIST_DATE, source: CTPP_SOURCE,
    exposures: [...ctppBy.entries()].map(([entity, x]) => ({ entity, seenAs: [...x.seenAs], vendors: [...x.vendors].sort(), critical: [...x.critical].sort() }))
      .sort((a, b) => b.critical.length - a.critical.length || b.vendors.length - a.vendors.length),
  };
  const ctppVendors = new Set(ctpp.exposures.flatMap((e) => e.vendors));
  const ctppCritical = new Set(ctpp.exposures.flatMap((e) => e.critical));
  if (ctppVendors.size) findings.push({
    severity: "low",
    title: de
      ? `${ctppVendors.size} Dienstleister ${ctppVendors.size === 1 ? "nutzt eine Anbietergruppe" : "nutzen Anbietergruppen"} mit einem benannten CTPP${ctppCritical.size ? `, davon ${ctppCritical.size} kritische` : ""}`
      : `${ctppVendors.size} ${ctppVendors.size === 1 ? "vendor uses a provider group" : "vendors use provider groups"} with a designated CTPP${ctppCritical.size ? `, ${ctppCritical.size} of them critical` : ""}`,
    detail: de
      ? `${ctpp.exposures.slice(0, 3).map((e) => e.entity).join(", ")}. Die Aufsicht der ESAs über diese Anbieter ersetzt nicht Ihr eigenes Risikomanagement (DORA Art. 28 Abs. 1).`
      : `${ctpp.exposures.slice(0, 3).map((e) => e.entity).join(", ")}. Oversight of these providers by the ESAs does not replace your own risk management (DORA Art. 28(1)).`,
  });

  const expSoon = (s?.domainsExpiring.length ?? 0) + (s?.certsExpiring.filter((c) => c.days < 14).length ?? 0);
  if (expSoon) findings.push(de
    ? { severity: "moderate", title: `${expSoon} Ablauftermine von Zertifikaten oder Domains stehen an`, detail: "In Abschnitt 9 aufgelistet; die meisten Zertifikate erneuern sich automatisch, Domain-Registrierungen nicht." }
    : { severity: "moderate", title: `${expSoon} certificate or domain expiries coming due`, detail: "Listed in section 9; most certificates renew automatically, domain registrations do not." });
  if (s && s.unresolved) findings.push(de
    ? { severity: "low", title: `${s.unresolved} Dienstleister-Domain${s.unresolved === 1 ? "" : "s"} nicht auflösbar`, detail: "Bitte die Domains im Register (Anhang A) prüfen; sie fließen nicht in die Konzentrationswerte ein." }
    : { severity: "low", title: `${s.unresolved} vendor domain${s.unresolved === 1 ? "" : "s"} could not be resolved`, detail: "Check the domains in the register annex; they are excluded from the concentration figures." });
  const rank = { high: 0, moderate: 1, low: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const overall: ConcentrationRating = findings.some((f) => f.severity === "high") ? "high" : findings.some((f) => f.severity === "moderate") ? "moderate" : "low";

  // decision sheet: one row per critical vendor (or every vendor if none is marked)
  const obsBy = new Map(observed.map((o) => [o.vendor, o]));
  const openFields = de ? "Vertragsreferenz, Kritikalitätsbewertung, Ersetzbarkeit, Exit-Plan, Kosten, Kündigungsfrist" : "Contract reference, criticality assessment, substitutability, exit plan, cost, notice period";
  const decisions: DecisionRow[] = (critical.length ? critical : ok).map((v) => {
    const o = obsBy.get(v.name);
    const sig: string[] = [];
    if (o?.inferredFrom && o.outages) sig.push(de
      ? `Nicht separat gemessen. Beim selben Hoster war ${o.measuredOn} (${o.inferredFrom}) ${per(o)} ${hrs(o.totalMinutes)} Std. nicht erreichbar; Betroffenheit mit dem Dienstleister klären`
      : `Not measured separately. On the same hoster, ${o.measuredOn} (${o.inferredFrom}) was unreachable for ${hrs(o.totalMinutes)} h ${per(o)}; confirm with the vendor whether this service was affected`);
    else if (o && o.outages) sig.push(de
      ? `Gemessen ${per(o)}: ${o.outages} ${o.outages === 1 ? "Ausfall" : "Ausfälle"}, zusammen ${hrs(o.totalMinutes)} Std.${o.uptimePct != null ? `, Verfügbarkeit ${o.uptimePct.toLocaleString("de-AT")} %` : ""}`
      : `Measured ${per(o)}: ${o.outages} outage${o.outages === 1 ? "" : "s"}, ${hrs(o.totalMinutes)} h in total${o.uptimePct != null ? `, availability ${o.uptimePct}%` : ""}`);
    else if (o && !o.inferredFrom) sig.push(de ? `Gemessen ${per(o)}: kein Ausfall ab 30 Min.${o.uptimePct != null ? `, Verfügbarkeit ${o.uptimePct.toLocaleString("de-AT")} %` : ""}` : `Measured ${per(o)}: no outage of 30 min or more${o.uptimePct != null ? `, availability ${o.uptimePct}%` : ""}`);
    if (o?.sharedWith.length) sig.push(de ? `Zeitgleich ausgefallen beim selben Hoster: ${o.sharedWith[0]}` : `Failed together with ${o.sharedWith[0]} on the same hoster`);
    const pubs = publicIncidents.filter((p) => p.reported.includes(v.name));
    for (const p of pubs) sig.push(de ? `Dokumentierter Ausfall dieser Funktion beim Anbieter: ${p.title.replace(/^Dokumentierter Ausfall bei /, "")} (Presse)` : `Documented outage of this function at the provider: ${p.title.replace(/^Documented outage at /, "")} (press)`);
    for (const p of publicIncidents.filter((x) => x.providerOnly.includes(v.name))) sig.push(de
      ? `Anbieter hatte einen dokumentierten Ausfall (${p.title.replace(/^Dokumentierter Ausfall bei /, "")}); ob dieser Dienst betroffen war, ist nicht belegt`
      : `The provider had a documented outage (${p.title.replace(/^Documented outage at /, "")}); whether this service was affected is not shown`);
    const sps = singlePoints.filter((sp) => sp.criticalNames.includes(v.name));
    for (const sp of sps) sig.push(de
      ? `${L(sp.layer)} bei ${sp.provider}, gemeinsam mit ${sp.criticalNames.length - 1} weiteren kritischen Dienst${sp.criticalNames.length - 1 === 1 ? "" : "en"}`
      : `${L(sp.layer)} at ${sp.provider}, shared with ${sp.criticalNames.length - 1} other critical service${sp.criticalNames.length - 1 === 1 ? "" : "s"}`);
    const j = jRows.find((r) => r.name === v.name);
    const third = !!(j?.hq && !EU_EEA.has(j.hq));
    if (third) sig.push(de ? `Infrastruktur-Anbieter mit Sitz in ${countryName(j!.hq!, lang)}` : `Infrastructure provider headquartered in ${countryName(j!.hq!, lang)}`);
    const ce = ctppEntity(v.hosting);
    if (ce) sig.push(de ? `Hosting bei ESA-benannter CTPP-Gruppe (${ce})` : `Hosted by an ESA-designated CTPP group (${ce})`);
    if (!sig.length) sig.push(de ? "Keine Auffälligkeit in der Außensicht" : "No signal in the outside-in view");
    const measuredBad = !!o && !o.inferredFrom && (o.totalMinutes >= 240 || o.longestMinutes >= 120);
    const priority: ConcentrationRating = measuredBad || pubs.length ? "high" : sps.length || third || (o?.inferredFrom && o.outages) ? "moderate" : "low";
    const decision = priority === "high"
      ? (de ? "Ausfall mit dem Dienstleister aufarbeiten: Ursache, Wiederanlaufzeit und Einhaltung der Service-Levels schriftlich anfordern. Entscheiden, ob ein Ausweich-Setup (zweiter Standort oder Hoster) Bedingung für die Vertragsverlängerung wird."
        : "Review the outage with the vendor: request root cause, recovery time and service-level compliance in writing. Decide whether a fallback (second site or hoster) becomes a condition for renewal.")
      : priority === "moderate"
        ? (de ? "Ersetzbarkeit bewerten und Exit-Plan dokumentieren. Entscheiden, ob die Abhängigkeit als Konzentrationsrisiko akzeptiert oder reduziert wird; Datenstandort vertraglich bestätigen lassen."
          : "Assess substitutability and document the exit plan. Decide whether to accept or reduce the dependency as a concentration risk; have the data location confirmed in the contract.")
        : (de ? "Einstufung bestätigen und Registerangaben vervollständigen." : "Confirm the classification and complete the register entries.");
    const ref = priority === "high" ? (de ? "DORA Art. 28 Abs. 8, Art. 30 Abs. 3, Art. 11" : "DORA Art. 28(8), Art. 30(3), Art. 11")
      : priority === "moderate" ? (de ? "DORA Art. 28 Abs. 8, Art. 29, Art. 30 Abs. 2 lit. b" : "DORA Art. 28(8), Art. 29, Art. 30(2)(b)") : (de ? "DORA Art. 28 Abs. 3" : "DORA Art. 28(3)");
    return { vendor: v.name, priority, signals: sig, decision, ref, open: openFields };
  }).sort((a, b) => rank[a.priority] - rank[b.priority]);

  // concrete need for action: each block ties a proven finding to what only the institution itself can establish
  const actionPlan: DoraReport["actionPlan"] = [];
  for (const p of publicIncidents.filter((x) => x.reported.length)) actionPlan.push(de ? {
    title: `Ausfall bei ${p.provider} am ${new Date(p.start).toLocaleDateString("de-AT", { day: "numeric", month: "long" })} aufarbeiten`,
    evidence: `Presseberichte (${p.sources.map((s) => s.label).join("; ")}); betroffene Funktion in dieser Liste: ${p.reported.join(", ")}.`,
    internal: ["Welche kritischen oder wichtigen Funktionen fielen aus, von wann bis wann (eigene Protokolle)?", "Wurde der Vorfall nach Del. VO (EU) 2024/1772 eingestuft und, falls schwerwiegend, fristgerecht gemeldet?", "Welche RTO/RPO gelten für diese Funktionen, und wurden sie eingehalten?", "Gibt es eine getestete Ausweichlösung (zweites Rechenzentrum, Notbetrieb für Karten und Bargeld)?"],
    vendor: ["Ursachenbericht mit Zeitlinie", "Nachweis der Redundanz von Rechenzentrum und Stromversorgung", "Ergebnis und Datum des letzten Umschalttests"],
    ref: "DORA Art. 11, Art. 17–19, Art. 28 Abs. 8, Art. 30 Abs. 3",
  } : {
    title: `Review the outage at ${p.provider} on ${new Date(p.start).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`,
    evidence: `Press reports (${p.sources.map((s) => s.label).join("; ")}); function affected, in this list: ${p.reported.join(", ")}.`,
    internal: ["Which critical or important functions failed, from when to when (own logs)?", "Was the incident classified under Del. Reg. (EU) 2024/1772 and, if major, reported in time?", "Which RTO/RPO apply to these functions, and were they met?", "Is there a tested fallback (second data centre, emergency mode for cards and cash)?"],
    vendor: ["Root-cause report with timeline", "Evidence of data-centre and power redundancy", "Result and date of the last failover test"],
    ref: "DORA Art. 11, Art. 17–19, Art. 28(8), Art. 30(3)",
  });
  for (const o of distinctObserved.filter((x) => x.critical && x.totalMinutes >= 240).slice(0, 2)) actionPlan.push(de ? {
    title: `Ausfall von ${o.measuredOn} (${hrs(o.totalMinutes)} Std.) klären`,
    evidence: `Eigene Messung alle 5 Minuten${o.confirm ? `, weltweit gegengeprüft (${o.confirm.failed}/${o.confirm.checked} Messpunkte, ${o.confirm.rounds} ${o.confirm.rounds === 1 ? "Runde" : "Runden"})` : ""}; Messprotokoll in Abschnitt 8.`,
    internal: ["War nur dieser Endpunkt betroffen oder auch die eigentliche Kundenanwendung (Online-Banking, Portal, App)?", "Wurde der Ausfall intern erkannt, und wann?", "Einstufung nach Del. VO (EU) 2024/1772 dokumentieren, auch wenn der Vorfall nicht schwerwiegend war"],
    vendor: ["Ursache und Wiederanlaufzeit schriftlich", "Einhaltung der Service-Levels im betroffenen Monat", "Waren weitere Kunden desselben Hosters betroffen (gemeinsame Ursache)?"],
    ref: "DORA Art. 17, Art. 28 Abs. 8, Art. 30 Abs. 2 lit. e",
  } : {
    title: `Clarify the outage of ${o.measuredOn} (${hrs(o.totalMinutes)} h)`,
    evidence: `Own 5-minute checks${o.confirm ? `, cross-checked worldwide (${o.confirm.failed}/${o.confirm.checked} locations, ${o.confirm.rounds} ${o.confirm.rounds === 1 ? "round" : "rounds"})` : ""}; measurement log in section 8.`,
    internal: ["Was only this endpoint affected, or the customer application itself (online banking, portal, app)?", "Was the outage detected internally, and when?", "Document the classification under Del. Reg. (EU) 2024/1772, even if the incident was not major"],
    vendor: ["Root cause and recovery time in writing", "Service-level compliance in the month concerned", "Were other customers of the same hoster affected (common cause)?"],
    ref: "DORA Art. 17, Art. 28(8), Art. 30(2)(e)",
  });
  const sp0 = singlePoints[0];
  if (sp0) actionPlan.push(de ? {
    title: `Gemeinsamen Ausfallpunkt ${sp0.provider} (${L(sp0.layer)}) bewerten`,
    evidence: `Öffentliche Infrastruktur: ${sp0.criticalNames.join(", ")} hängen an ${sp0.provider}.`,
    internal: ["Welche Geschäftsfunktionen hängen an diesen Diensten?", `Ist ein Ausfall von ${sp0.provider} als Szenario im Notfallplan enthalten und getestet?`, "Welche RTO/RPO gelten für die betroffenen Funktionen?"],
    vendor: [`Gibt es einen zweiten, unabhängigen Anbieter für ${L(sp0.layer)}?`, "Nachweis des letzten Ausfalltests"],
    ref: "DORA Art. 11, Art. 28 Abs. 4, Art. 29",
  } : {
    title: `Assess the shared point of failure ${sp0.provider} (${l1(sp0.layer)})`,
    evidence: `Public infrastructure: ${sp0.criticalNames.join(", ")} depend on ${sp0.provider}.`,
    internal: ["Which business functions depend on these services?", `Is an outage of ${sp0.provider} a tested scenario in the business continuity plan?`, "Which RTO/RPO apply to the functions concerned?"],
    vendor: [`Is there a second, independent provider for ${l1(sp0.layer)}?`, "Evidence of the last failover test"],
    ref: "DORA Art. 11, Art. 28(4), Art. 29",
  });

  // recommended actions, each tied to the provision it supports
  const actions: ReportAction[] = [];
  if (worst && worst.rating !== "low" && worst.top[0]) actions.push({
    priority: worst.rating,
    action: de
      ? `Ersetzbarkeit von ${worst.top[0].provider} auf der Ebene ${L(worst.layer)} bewerten (Alternativen, Wechselaufwand, Abhängigkeit der kritischen Funktionen) und in der Bewertung des Konzentrationsrisikos dokumentieren.`
      : `Assess how substitutable ${worst.top[0].provider} is at the ${l1(worst.layer)} layer (alternatives, switching effort, dependence of critical functions) and document it in the concentration risk assessment.`,
    ref: de ? "DORA Art. 29 Abs. 1" : "DORA Art. 29(1)",
  });
  for (const sp of singlePoints.slice(0, 3)) actions.push({
    priority: sp.criticalNames.length >= 3 ? "high" : "moderate",
    action: de
      ? `Von ${sp.criticalNames.join(", ")} Nachweise zu Ausweich-Setup und Wiederanlauf bei einem Ausfall von ${sp.provider} anfordern; Ergebnis in die Ausstiegsstrategie und die Szenario-Tests der Notfallplanung übernehmen.`
      : `Ask ${sp.criticalNames.join(", ")} for evidence of their failover and recovery if ${sp.provider} becomes unavailable; take the result into the exit strategy and the scenario tests of your business continuity plan.`,
    ref: de ? "DORA Art. 28 Abs. 8, Art. 11" : "DORA Art. 28(8), Art. 11",
  });
  const unclear = jRows.filter((r) => r.critical && (!r.endpoint || !EU_EEA.has(r.endpoint))).map((r) => r.name);
  if (unclear.length) actions.push({
    priority: "moderate",
    action: de
      ? `Für ${unclear.slice(0, 6).join(", ")}${unclear.length > 6 ? ` und ${unclear.length - 6} weitere` : ""} die Orte der Leistungserbringung und Datenverarbeitung vertraglich bestätigen lassen (Standort von außen nicht bestimmbar oder außerhalb von EU/EWR).`
      : `Have ${unclear.slice(0, 6).join(", ")}${unclear.length > 6 ? ` and ${unclear.length - 6} more` : ""} confirm the locations of service provision and data processing in the contract (not determinable from outside, or outside the EU/EEA).`,
    ref: de ? "DORA Art. 30 Abs. 2 lit. b" : "DORA Art. 30(2)(b)",
  });
  if (ctppVendors.size) actions.push({
    priority: "low",
    action: de
      ? "Im Informationsregister vermerken, welche Dienste auf benannten CTPP-Gruppen laufen, und bei den Dienstleistern klären, ob der genutzte Dienst unter die Benennung fällt."
      : "Record in the register of information which services run on designated CTPP groups, and confirm with the vendors whether the service used falls under the designation.",
    ref: de ? "DORA Art. 28 Abs. 1 und 3, Art. 31" : "DORA Art. 28(1) and (3), Art. 31",
  });
  if (!critical.length) actions.push({
    priority: "moderate",
    action: de ? "Festlegen, welche Dienstleister kritische oder wichtige Funktionen unterstützen, und den Scan mit dieser Markierung wiederholen." : "Determine which vendors support critical or important functions and rerun the scan with that marking.",
    ref: de ? "DORA Art. 8 Abs. 1, Art. 28 Abs. 3" : "DORA Art. 8(1), Art. 28(3)",
  });
  if (expSoon) actions.push({
    priority: "low",
    action: de ? "Die betroffenen Dienstleister auf die anstehenden Ablauftermine (Abschnitt 9) hinweisen." : "Notify the vendors concerned about the upcoming expiries (section 9).",
    ref: de ? "Operative Nachverfolgung" : "Operational follow-up",
  });
  actions.push({
    priority: "low",
    action: de ? "Diese Bewertung mindestens jährlich und bei jeder Änderung im Dienstleister-Bestand wiederholen." : "Repeat this assessment at least once a year and whenever the vendor portfolio changes.",
    ref: de ? "DORA Art. 6 Abs. 5, Art. 28 Abs. 3" : "DORA Art. 6(5), Art. 28(3)",
  });
  actions.sort((a, b) => rank[a.priority] - rank[b.priority]);

  // key figures for the executive summary
  const topCrit = critical.length ? singlePoints.filter((x) => x.criticalNames.length).sort((a, b) => b.criticalNames.length - a.criticalNames.length)[0] : undefined;
  const keyFigures: DoraReport["keyFigures"] = [
    { value: `${ok.length}`, label: de ? `Einträge (Dienste) von ${companies} Unternehmen analysiert, ${critical.length} davon kritisch` : `entries (services) of ${companies} ${companies === 1 ? "company" : "companies"} analysed, ${critical.length} of them critical` },
    ...(observed.some((o) => o.critical && o.totalMinutes >= 30) ? [{
      value: `${hrs([...measurements.values()].filter((g) => g.some((o) => o.critical)).reduce((a, g) => a + g[0].totalMinutes, 0))} ${de ? "Std." : "h"}`,
      label: de ? "gemessene Ausfallzeit kritischer Dienste (eigene Messung, max. 30 Tage)" : "measured downtime of critical services (own checks, up to 30 days)",
    }] : []),
    ...(topCrit ? [{ value: `${topCrit.criticalNames.length}/${critical.length}`, label: de ? `kritische Dienste hängen an ${topCrit.provider} (${L(topCrit.layer)})` : `critical services depend on ${topCrit.provider} (${l1(topCrit.layer)})` }] : []),
    { value: `${jurisdiction.hq.third}/${n}`, label: de ? "auf Anbietern mit Sitz außerhalb von EU/EWR" : "on providers headquartered outside the EU/EEA" },
    { value: `${jurisdiction.endpoint.eu}/${n}`, label: de ? "mit Endpunkt nachweislich in EU/EWR" : "with an endpoint verifiably in the EU/EEA" },
    { value: `${ctppVendors.size}/${n}`, label: de ? "auf Gruppen mit benanntem CTPP" : "on groups with a designated CTPP" },
  ];

  const content = {
    id: scan.id, lang, company: scan.company, scannedAt: scan.createdAt, paid,
    scope: { vendors: s?.vendors ?? scan.rows.length, resolved: s?.scanned ?? ok.length, unresolved: s?.unresolved ?? 0, critical: s?.critical ?? 0, hiddenOrigins: s?.hiddenOrigins ?? 0, companies },
    overall, keyFigures, findings, actions, layers, scenarios, singlePoints, jurisdiction, ctpp, incidents: scan.providerIncidents, publicIncidents, actionPlan,
    expiring: { certs: s?.certsExpiring ?? [], domains: s?.domainsExpiring ?? [] },
    register: rows,
    observed, decisions,
  };
  // integrity: hash over the report content (not the generation time), so a filed copy can be checked against a re-issue
  const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const full: DoraReport = {
    ...content, generatedAt: new Date().toISOString(),
    doc: { id: `SG-${scan.id.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, version: DOC_VERSION, method: METHOD_VERSION, hash, issuer },
  };
  if (paid) return full;
  // preview: scope and the first finding; the rest is shown as locked
  return {
    ...full, findings: findings.slice(0, 1), actions: [], keyFigures: keyFigures.slice(0, 2), layers: [], scenarios: [], singlePoints: [],
    jurisdiction: { endpoint: { eu: 0, third: 0, unknown: 0, byCountry: [] }, hq: { eu: 0, third: 0, unknown: 0, byCountry: [] }, rows: [] },
    ctpp: { ...ctpp, exposures: [] }, incidents: [], expiring: { certs: [], domains: [] }, register: [],
    observed: [], decisions: [], publicIncidents: [], actionPlan: [],
    doc: { ...full.doc, hash: "" },
  };
}

/**
 * Document versioning: the document ID stays, the version rises whenever the material content changes (rating, findings,
 * key figures, single points of failure, cited incidents, method). Language-neutral, so switching DE/EN never bumps it.
 */
type VersionEntry = { v: string; at: string; h: string; method: string };
const METHOD_13_FROM = "2026-10-26T16:10:00Z";
async function withVersion(report: DoraReport, lang: ReportLang): Promise<DoraReport> {
  const material = createHash("sha256").update(JSON.stringify({
    m: report.doc.method, o: report.overall,
    f: report.findings.map((f) => f.severity),
    k: report.keyFigures.map((k) => k.value.replace(/[^0-9/]/g, "")),
    s: report.singlePoints.map((sp) => `${sp.provider}|${sp.layer}|${sp.criticalNames.length}`),
    p: report.publicIncidents.map((p) => `${p.id}|${p.reported.length}`),
  })).digest("hex").slice(0, 16);
  const now = new Date().toISOString();
  const bump = (v: string) => { const [a, b] = v.split(".").map(Number); return `${a}.${(b || 0) + 1}`; };
  const list = await mppStore.update<VersionEntry[]>(`dora:docver:${report.id}`, (cur) => {
    const prev = (Array.isArray(cur) ? cur : []) as VersionEntry[];
    if (!prev.length) {
      // reports issued before method 1.3 were version 1.0 with the old method
      const seed: VersionEntry[] = report.scannedAt < METHOD_13_FROM
        ? [{ v: "1.0", at: report.scannedAt, h: "", method: "SG-ICTCR 1.2" }, { v: "1.1", at: now, h: material, method: report.doc.method }]
        : [{ v: "1.0", at: now, h: material, method: report.doc.method }];
      return { op: "set", value: seed, result: seed };
    }
    const last = prev[prev.length - 1];
    if (last.h === material) return { op: "noop", result: prev };
    const next = [...prev, { v: bump(last.v), at: now, h: material, method: report.doc.method }];
    return { op: "set", value: next, result: next };
  });
  const de = lang === "de";
  const history = list.map((e, i) => {
    const change = i > 0 && list[i - 1].method !== e.method ? METHOD_CHANGES.find((c) => c.method === e.method) : undefined;
    const note = i === 0 ? (de ? "Erstausgabe" : "First issue") : change ? (de ? change.de : change.en) : (de ? "Aktualisierte Messdaten und Befunde" : "Updated measurements and findings");
    return { version: e.v, date: e.at, note };
  });
  return { ...report, doc: { ...report.doc, version: list[list.length - 1].v, history } };
}

export async function reportIssuer(): Promise<ReportIssuer | null> {
  const v = (await mppStore.get("config:legal").catch(() => null)) as Partial<ReportIssuer> | null;
  return v && v.name && v.address && v.email ? { name: v.name, address: v.address, email: v.email, vatId: v.vatId ?? null, register: v.register ?? null } : null;
}

export const doraReport = {
  async get(id: string, lang: ReportLang = "en"): Promise<DoraReport | null> {
    if (!SCAN_ID.test(id)) return null;
    const row = await db.selectFrom("vendorScans").select(["reportPaidAt", "reportEmail"]).where("id", "=", id).executeTakeFirst();
    if (!row) return null;
    const scan = await getVendorScan(id);
    if (!scan || scan.status === "queued" || scan.status === "running") return null;
    if (row.reportPaidAt) await ensureReportMonitors(id, scan.rows, row.reportEmail ?? null).catch(() => undefined);
    const observed = row.reportPaidAt ? await observedOutages(scan.rows, 30, id).catch(() => []) : [];
    const report = buildReport(scan, !!row.reportPaidAt, lang, await reportIssuer(), observed);
    return report.paid ? withVersion(report, lang).catch(() => report) : report;
  },

  async createCheckout(id: string, origin: string) {
    if (!SCAN_ID.test(id)) throw new Error("not_found");
    const scan = await db.selectFrom("vendorScans").select(["id", "company", "total", "status", "reportPaidAt"]).where("id", "=", id).executeTakeFirst();
    if (!scan) throw new Error("not_found");
    if (scan.reportPaidAt) return `${origin}/vendors/report?id=${id}`;
    if (DORA_REPORT_FREE) {
      // temporary free unlock: no Stripe session, marked so it never counts as a sale
      await db.updateTable("vendorScans")
        .set({ reportPaidAt: sql`coalesce(report_paid_at, now())`, reportSessionId: sql`coalesce(report_session_id, ${FREE_SESSION})` })
        .where("id", "=", id).execute();
      return `${origin}/vendors/report?id=${id}`;
    }
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: REPORT_PRICE_CURRENCY,
          unit_amount: REPORT_PRICE_CENTS,
          product_data: {
            name: "ICT Concentration Risk Assessment",
            description: `Assessment report for ${scan.company ? `${scan.company}, ` : ""}${scan.total} ICT third-party providers: concentration per layer, single points of failure, outage scenarios, register annex.`,
          },
        },
      }],
      metadata: { product: PRODUCT_TAG, scan_id: id },
      payment_intent_data: { metadata: { product: PRODUCT_TAG, scan_id: id } },
      invoice_creation: { enabled: true, invoice_data: { metadata: { product: PRODUCT_TAG, scan_id: id } } },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      allow_promotion_codes: true,
      success_url: `${origin}/vendors/report?id=${id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/vendors/report?id=${id}`,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return session.url;
  },

  /** Marks the scan's report as paid after a completed Checkout session for exactly this scan. Idempotent. */
  async claim(id: string, sessionId: string): Promise<"paid" | "not_paid" | "not_found"> {
    if (!SCAN_ID.test(id) || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return "not_found";
    let session: Stripe.Checkout.Session;
    try { session = await stripe().checkout.sessions.retrieve(sessionId); } catch { return "not_found"; }
    if (session.metadata?.product !== PRODUCT_TAG || session.metadata?.scan_id !== id) return "not_found";
    if (session.status !== "complete" || session.payment_status !== "paid") return "not_paid";
    await db.updateTable("vendorScans")
      .set({ reportPaidAt: sql`coalesce(report_paid_at, now())`, reportSessionId: session.id, reportEmail: session.customer_details?.email ?? null })
      .where("id", "=", id).execute();
    return "paid";
  },

  paidRetentionDays: PAID_RETENTION_DAYS,
};