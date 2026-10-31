/**
 * DORA incident file: for every outage of a vendor endpoint in a paid report, a ready-to-use incident record —
 * timeline, affected function, pre-check against the classification criteria of Delegated Regulation (EU) 2024/1772,
 * reporting deadlines, SLA effect for the month and a pre-filled draft of the initial notification.
 * Sources: the report's private 5-minute monitors (from unlock) and, before that, the public radar.
 * The pre-check never classifies an incident as major on its own: criteria that only the financial entity can assess
 * (clients affected, economic impact, reputation, data) stay "to check".
 */
import { sendEmail } from "@runtime/email";
import { createHash } from "crypto";
import { db } from "./db";
import { mppStore } from "./mppStore";
import { getVendorScan } from "./vendorBulkScan";
import { observedOutages } from "./radarEvidence";
import { alertUnsubscribeUrl, reportSubscriptionId } from "./reportMonitoring";
import { SITE_URL } from "./site";
import type { ReportLang } from "./doraReportText";

export type Criterion = { key: string; label: string; status: "met" | "not_met" | "check"; note: string };
export type IncidentFile = {
  id: string;
  vendor: string;
  fn: string | null;
  critical: boolean;
  host: string;
  hosting: string | null;
  source: "monitor" | "radar";
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  error: string | null;
  sharedWith: string[];
  verdict: "check_now" | "below";
  verdictText: string;
  criteria: Criterion[];
  deadlines: Array<{ label: string; due: string | null; note: string }>;
  sla: { month: string; downtimeMinutes: number; monthMinutes: number; availability: number; allowed999: number; allowed995: number };
  draft: string;
};

type Ep = { vendor: string; host: string; start: number; end: number | null; error: string | null; shared: string[]; source: "monitor" | "radar"; dns?: string[] };

const MIN = 60_000;
const TZ = "Europe/Vienna";

/** Outages from the private monitors: 2+ consecutive failed checks; ongoing ones are included from the second failure on. */
async function monitorEpisodes(scanId: string, sinceMs: number): Promise<Ep[]> {
  const mons = await db.selectFrom("customMonitors").select(["id", "url", "name", "expect"]).where("subscriptionId", "=", reportSubscriptionId(scanId)).execute();
  if (!mons.length) return [];
  const checks = await db.selectFrom("customChecks").select(["monitorId", "ok", "checkedAt", "error"]).where("monitorId", "in", mons.map((m) => m.id))
    .where("checkedAt", ">", new Date(sinceMs)).orderBy("checkedAt").execute();
  const out: Ep[] = [];
  for (const m of mons) {
    const host = new URL(m.url).hostname;
    const dns = m.expect.startsWith("dns:") ? m.expect.slice(4).split(",") : undefined;
    // an endpoint that never answered our probe (blocked or wrong target) is not measurable: no incident before a first success
    let start: number | null = null, fails = 0, err: string | null = null, seenOk = false;
    for (const c of checks.filter((x) => x.monitorId === m.id)) {
      const t = new Date(c.checkedAt).getTime();
      if (!c.ok) { if (!seenOk) continue; if (start === null) { start = t; err = c.error; } fails++; }
      else { if (start !== null && fails >= 2) out.push({ vendor: m.name, host, start, end: t, error: err, shared: [], source: "monitor", dns }); start = null; fails = 0; seenOk = true; }
    }
    if (start !== null && fails >= 2) out.push({ vendor: m.name, host, start, end: null, error: err, shared: [], source: "monitor", dns });
  }
  return out;
}

function fmt(ms: number, de: boolean) {
  return new Date(ms).toLocaleString(de ? "de-AT" : "en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const dur = (m: number, de: boolean) => (de ? `${Math.floor(m / 60)} Std. ${Math.round(m % 60)} Min.` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

export async function incidentFiles(scanId: string, lang: ReportLang = "de", days = 35): Promise<IncidentFile[]> {
  const de = lang === "de";
  const scan = await getVendorScan(scanId);
  if (!scan) return [];
  const rows = scan.rows.filter((r) => r.status === "ok");
  type RowLike = { name: string; fn: string | null; critical: boolean; hosting: string | null };
  const byName = new Map<string, RowLike>(rows.map((r) => [r.name, r]));
  const now = Date.now();
  const sinceMs = now - days * 86_400_000;

  const mon = await monitorEpisodes(scanId, sinceMs);
  // DNS checks are not a vendor row: they stand for every critical endpoint of the zone
  const zoneOf = (h: string) => h.toLowerCase().split(".").slice(-2).join(".");
  for (const e of mon) {
    if (!e.dns || byName.has(e.vendor)) continue;
    const affected = rows.filter((r) => r.critical && r.host && zoneOf(r.host) === zoneOf(e.host)).map((r) => r.fn ?? r.name);
    byName.set(e.vendor, {
      name: e.vendor, critical: true, hosting: null,
      fn: de ? `Namensauflösung ${zoneOf(e.host)} (betrifft: ${affected.join(", ") || e.host})` : `Name resolution ${zoneOf(e.host)} (affects: ${affected.join(", ") || e.host})`,
    });
  }
  const radar: Ep[] = (await observedOutages(scan.rows, days).catch(() => [])).flatMap((o) =>
    o.episodes.map((e) => ({ vendor: o.vendor, host: o.measuredOn, start: new Date(e.start).getTime(), end: e.end ? new Date(e.end).getTime() : null, error: null, shared: e.shared, source: "radar" as const })));
  // monitor data wins where both cover the same vendor and time
  const eps = [...mon, ...radar.filter((r) => !mon.some((m) => m.vendor === r.vendor && m.start <= (r.end ?? now) && (m.end ?? now) >= r.start))]
    .filter((e) => byName.has(e.vendor))
    .sort((a, b) => b.start - a.start);

  return eps.map((e) => {
    const r = byName.get(e.vendor)!;
    const end = e.end ?? now;
    const minutes = Math.round((end - e.start) / MIN);
    const ongoing = e.end === null;
    const down2h = minutes > 120, long24 = minutes > 24 * 60;
    const durationMet = (r.critical && down2h) || long24;
    const criteria: Criterion[] = [
      { key: "critical", label: de ? "Kritische Dienste betroffen (Hauptkriterium)" : "Critical services affected (primary criterion)", status: r.critical ? "met" : "not_met",
        note: r.critical ? (de ? `${r.fn ?? r.name} ist als kritisch/wichtig markiert.` : `${r.fn ?? r.name} is marked critical/important.`) : (de ? "Dienstleister ist nicht als kritisch markiert." : "Vendor is not marked critical.") },
      { key: "duration", label: de ? "Dauer und Ausfallzeit" : "Duration and service downtime", status: durationMet ? "met" : "not_met",
        note: durationMet
          ? (de ? `Ausfallzeit ${dur(minutes, true)}: über 2 Std. bei einem Dienst für eine kritische Funktion${long24 ? ", Dauer über 24 Std." : ""}.` : `Downtime ${dur(minutes, false)}: over 2 h for a service supporting a critical function${long24 ? ", duration over 24 h" : ""}.`)
          : ongoing && r.critical ? (de ? `Noch nicht; die 2-Stunden-Schwelle wird um ${fmt(e.start + 120 * MIN, true)} erreicht, wenn der Ausfall andauert.` : `Not yet; the 2-hour threshold is reached at ${fmt(e.start + 120 * MIN, false)} if the outage continues.`)
          : (de ? "Unter den Schwellen (2 Std. bei kritischer Funktion bzw. 24 Std.)." : "Below the thresholds (2 h for a critical function, 24 h overall).") },
      { key: "clients", label: de ? "Betroffene Kunden / Gegenparteien / Transaktionen" : "Clients, counterparts and transactions affected", status: "check",
        note: de ? "Vom Institut zu bewerten, u. a. über 10 % der Kunden des Dienstes oder über 100.000 Kunden; Schwellen für Gegenparteien und Transaktionen laut Verordnung." : "For the entity to assess, e.g. over 10% of the service's clients or over 100,000 clients; thresholds for counterparts and transactions as in the regulation." },
      { key: "geo", label: de ? "Geografische Ausbreitung" : "Geographical spread", status: "check",
        note: de ? "Erfüllt bei erheblichen Auswirkungen in mindestens 2 Mitgliedstaaten." : "Met with significant impact in at least 2 member states." },
      { key: "economic", label: de ? "Wirtschaftliche Auswirkungen" : "Economic impact", status: "check",
        note: de ? "Erfüllt ab direkten und indirekten Kosten/Verlusten über 100.000 €." : "Met at direct and indirect costs/losses above €100,000." },
      { key: "reputation", label: de ? "Reputationsschaden" : "Reputational impact", status: "check",
        note: de ? "Z. B. Medienberichte, Kundenbeschwerden, Folgen für die Aufsicht." : "E.g. media coverage, client complaints, regulatory consequences." },
      { key: "data", label: de ? "Datenverluste" : "Data losses", status: "check",
        note: de ? "Verfügbarkeit, Integrität oder Vertraulichkeit von Daten beeinträchtigt? Von außen nicht erkennbar." : "Availability, integrity or confidentiality of data affected? Not visible from outside." },
    ];
    const checkNow = r.critical && (durationMet || ongoing);
    const verdictText = checkNow
      ? (de ? `Hauptkriterium${durationMet ? " und Kriterium Ausfallzeit erfüllt" : " erfüllt, Ausfall läuft"}. Schwerwiegend ist der Vorfall, sobald insgesamt mindestens zwei weitere Kriterien erfüllt sind. Kunden und wirtschaftliche Auswirkungen jetzt bewerten.`
        : `Primary criterion${durationMet ? " and downtime criterion met" : " met, outage ongoing"}. The incident is major once at least two further criteria are met in total. Assess clients and economic impact now.`)
      : (de ? "Nach der Außensicht unter den Schwellen. Dokumentieren, keine Meldung zu erwarten." : "Below the thresholds in the outside-in view. Document it; no notification expected.");
    const deadlines = checkNow ? [
      { label: de ? "Erstmeldung an die FMA" : "Initial notification", due: new Date(e.start + 24 * 60 * MIN).toISOString(),
        note: de ? "4 Std. nach Einstufung als schwerwiegend, spätestens 24 Std. nach Kenntnis. Hier ab Beginn des Ausfalls gerechnet." : "4 h after classification as major, at the latest 24 h after becoming aware. Counted here from the start of the outage." },
      { label: de ? "Zwischenmeldung" : "Intermediate report", due: null, note: de ? "Spätestens 72 Std. nach der Erstmeldung." : "At the latest 72 h after the initial notification." },
      { label: de ? "Abschlussbericht" : "Final report", due: null, note: de ? "Spätestens 1 Monat nach der letzten Zwischenmeldung." : "At the latest 1 month after the last intermediate report." },
    ] : [];

    // SLA effect in the calendar month of the outage (Vienna time)
    const d = new Date(e.start);
    const mStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), mEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const monthMinutes = Math.round((mEnd - mStart) / MIN);
    const downtime = eps.filter((x) => x.vendor === e.vendor).reduce((a, x) => a + Math.max(0, Math.min(x.end ?? now, mEnd) - Math.max(x.start, mStart)) / MIN, 0);
    const sla = {
      month: new Date(mStart).toLocaleDateString(de ? "de-AT" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      downtimeMinutes: Math.round(downtime), monthMinutes, availability: Math.round((1 - downtime / monthMinutes) * 10000) / 100,
      allowed999: Math.round(monthMinutes * 0.001), allowed995: Math.round(monthMinutes * 0.005),
    };

    const met = criteria.filter((c) => c.status === "met").map((c) => c.label);
    const open = criteria.filter((c) => c.status === "check").map((c) => c.label);
    // the other organisations on the same hoster are counted, never named, in a customer's file
    const shared = e.shared.length
      ? (de ? (e.shared.length === 1 ? "ein weiterer überwachter Dienst" : `${e.shared.length} weitere überwachte Dienste`) : (e.shared.length === 1 ? "another monitored service" : `${e.shared.length} other monitored services`))
      : null;
    const draft = de ? [
      "ERSTMELDUNG SCHWERWIEGENDER IKT-BEZOGENER VORFALL – ENTWURF",
      "Vorbefüllt aus externer Messung (ShadowGraph). Vom Finanzunternehmen zu prüfen, zu ergänzen und in das Meldeformular der FMA zu übertragen.",
      "",
      "1. Finanzunternehmen: [Name, LEI]",
      `2. Erkennung: ${fmt(e.start, true)} durch externe Erreichbarkeitsmessung, Prüfintervall 5 Minuten`,
      `3. Beginn: ${fmt(e.start, true)} · Status: ${ongoing ? "andauernd" : `behoben am ${fmt(end, true)}`} · Dauer: ${dur(minutes, true)}`,
      `4. Betroffener Dienst / Funktion: ${r.fn ?? r.name} (${e.host}) · kritisch/wichtig: ${r.critical ? "ja" : "nein"}`,
      `5. Betroffener IKT-Drittdienstleister: ${r.name}${r.hosting ? ` · Hosting: ${r.hosting}` : ""}`,
      `6. Beschreibung: ${e.dns ? `${e.host} wurde von den zuständigen Nameservern (${e.dns.join(", ")}) nicht aufgelöst; alle Dienste dieser Zone waren damit für Kunden nicht erreichbar` : `${e.host} war von außen nicht erreichbar`}${e.error ? ` (${e.error})` : ""}.${shared ? ` Zeitgleich fielen beim selben Hoster aus: ${shared}.` : ""}`,
      `7. Klassifizierung (Del. VO (EU) 2024/1772): erfüllt: ${met.join("; ") || "–"} · zu prüfen: ${open.join("; ")}`,
      `8. Auswirkungen auf andere Finanzunternehmen / Drittdienstleister: ${shared ? `wahrscheinlich, gemeinsamer Hoster (${shared})` : "keine bekannt"}`,
      "9. Ergriffene Maßnahmen und Wiederherstellung: [zu ergänzen]",
      "10. Ansprechpartner: [Name, Funktion, Telefon, E-Mail]",
    ].join("\n") : [
      "INITIAL NOTIFICATION OF A MAJOR ICT-RELATED INCIDENT – DRAFT",
      "Pre-filled from external measurement (ShadowGraph). To be checked and completed by the financial entity and transferred to the supervisor's reporting template.",
      "",
      "1. Financial entity: [name, LEI]",
      `2. Detection: ${fmt(e.start, false)} by external reachability monitoring, 5-minute interval`,
      `3. Start: ${fmt(e.start, false)} · Status: ${ongoing ? "ongoing" : `resolved ${fmt(end, false)}`} · Duration: ${dur(minutes, false)}`,
      `4. Affected service / function: ${r.fn ?? r.name} (${e.host}) · critical/important: ${r.critical ? "yes" : "no"}`,
      `5. ICT third-party provider: ${r.name}${r.hosting ? ` · hosting: ${r.hosting}` : ""}`,
      `6. Description: ${e.dns ? `${e.host} was not resolved by its authoritative name servers (${e.dns.join(", ")}), so every service in this zone was unreachable for clients` : `${e.host} was unreachable from outside`}${e.error ? ` (${e.error})` : ""}.${shared ? ` Failing at the same time on the same hoster: ${shared}.` : ""}`,
      `7. Classification (Del. Reg. (EU) 2024/1772): met: ${met.join("; ") || "–"} · to check: ${open.join("; ")}`,
      `8. Impact on other financial entities / providers: ${shared ? `likely, shared hoster (${shared})` : "none known"}`,
      "9. Actions taken and recovery: [to complete]",
      "10. Contact: [name, role, phone, email]",
    ].join("\n");

    return {
      id: createHash("sha256").update(`${scanId}|${e.vendor}|${e.start}`).digest("hex").slice(0, 12),
      vendor: e.vendor, fn: r.fn, critical: r.critical, host: e.host, hosting: r.hosting, source: e.source,
      startedAt: new Date(e.start).toISOString(), endedAt: e.end ? new Date(e.end).toISOString() : null, minutes, error: e.error, sharedWith: shared ? [shared] : [],
      verdict: checkNow ? "check_now" : "below", verdictText, criteria, deadlines, sla, draft,
    };
  });
}

/**
 * After every radar sweep: email the report owner when a critical endpoint goes down, when the outage passes 2 hours
 * (downtime criterion), and when it recovers. Only for paid reports with a buyer email; each event is sent once.
 */
export async function dispatchIncidentAlerts() {
  const from = (await mppStore.get("config:alerts:emailFrom")) as string | null;
  if (!from) return { sent: 0 };
  const subs = await db.selectFrom("alertSubscriptions").select(["id", "email"]).where("plan", "=", "dora-report").where("status", "=", "active").where("email", "!=", "").execute();
  let sent = 0;
  for (const s of subs) {
    const scanId = s.id.replace(/^dora_/, "");
    const unsub = await alertUnsubscribeUrl(scanId);
    const mons = await db.selectFrom("customMonitors").select(["id", "name", "url", "downSince"]).where("subscriptionId", "=", s.id).where("active", "=", true).execute();
    for (const m of mons) {
      const host = new URL(m.url).hostname;
      const everOk = await db.selectFrom("customChecks").select("id").where("monitorId", "=", m.id).where("ok", "=", true).limit(1).executeTakeFirst();
      if (!everOk) continue; // never answered our probe: not measurable, no alerts
      const link = `${SITE_URL}/vendors/report?id=${scanId}&lang=de#vorfaelle`;
      const events: Array<{ key: string; subject: string; lines: string[] }> = [];
      if (m.downSince) {
        const since = new Date(m.downSince).getTime();
        const k = `dora:${m.id}:${since}`;
        events.push({ key: `${k}:start`, subject: `Ausfall: ${m.name} (${host}) nicht erreichbar`, lines: [
          `Seit ${fmt(since, true)} ist ${host} von außen nicht erreichbar (zwei aufeinanderfolgende Prüfungen).`,
          "Die Vorfallakte mit Zeitlinie, Klassifizierungs-Vorprüfung und Meldeentwurf ist im Bericht abrufbar.",
        ] });
        if (Date.now() - since > 120 * MIN) events.push({ key: `${k}:2h`, subject: `DORA-Schwelle: ${m.name} seit über 2 Stunden nicht erreichbar`, lines: [
          `${host} ist seit ${fmt(since, true)} nicht erreichbar. Das Kriterium „Ausfallzeit über 2 Std. bei kritischer Funktion“ ist erfüllt.`,
          `Bitte jetzt prüfen, ob weitere Kriterien erfüllt sind. Erstmeldung spätestens 24 Std. nach Kenntnis: ${fmt(since + 24 * 60 * MIN, true)}.`,
        ] });
      }
      const rec = (await mppStore.get(`cm:recovered:${m.id}`)) as { downSince: string; at: string } | null;
      if (rec && Date.now() - new Date(rec.at).getTime() < 3 * 3600_000) {
        const since = new Date(rec.downSince).getTime(), at = new Date(rec.at).getTime();
        events.push({ key: `dora:${m.id}:${since}:resolved`, subject: `Behoben: ${m.name} (${host}) wieder erreichbar`, lines: [
          `${host} ist seit ${fmt(at, true)} wieder erreichbar. Dauer des Ausfalls: ${dur(Math.round((at - since) / MIN), true)}.`,
          "Die Vorfallakte im Bericht ist aktualisiert (Dauer, SLA-Auswirkung, Meldeentwurf).",
        ] });
      }
      for (const ev of events) {
        const ins = await db.insertInto("alertDeliveries").values({ subscriptionId: s.id, dedupeKey: ev.key, kind: "dora-incident", title: ev.subject, payload: JSON.stringify({ host, lines: ev.lines }) as never, channels: JSON.stringify(["email"]) as never })
          .onConflict((oc) => oc.columns(["subscriptionId", "dedupeKey"]).doNothing()).returning("id").executeTakeFirst();
        if (!ins) continue; // already sent
        const r = await sendEmail({ from, to: s.email, subject: ev.subject, headers: [{ name: "List-Unsubscribe", value: `<${unsub}>` }],
          text: `${ev.lines.join("\n")}\n\n${link}\n\nAbbestellen: ${unsub}`,
          html: `${ev.lines.map((l) => `<p>${l.replace(/[<>&]/g, "")}</p>`).join("")}<p><a href="${link}">Vorfallakte öffnen</a></p><p style="font-size:12px;color:#888"><a href="${unsub}">Benachrichtigungen abbestellen</a></p>` });
        if (r.ok) sent++;
      }
    }
  }
  return { sent };
}
