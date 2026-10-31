/**
 * DORA major-incident classification and reporting deadlines (pure, client-safe).
 * Classification: Commission Delegated Regulation (EU) 2024/1772, Art. 6 (critical services), Art. 8 (major incident),
 * Art. 9 (materiality thresholds), Art. 2 (reputational impact). Deadlines: Commission Delegated Regulation (EU) 2025/301, Art. 5.
 * An incident is major when it affects critical services AND either a successful malicious unauthorised access that may
 * result in data losses occurred, or the thresholds of two or more other criteria are met.
 */
export type ClassInput = {
  gate: { criticalFunction: boolean; regulatedService: boolean; maliciousAccess: boolean };
  clients: { total?: number | null; affected?: number | null; counterpartsTotal?: number | null; counterpartsAffected?: number | null;
    txDailyCount?: number | null; txAffectedCount?: number | null; txDailyValue?: number | null; txAffectedValue?: number | null; relevantAffected: boolean };
  reputation: { media: boolean; complaints: boolean; regulatory: boolean; lossOfClients: boolean };
  durationHours?: number | null;
  downtimeHours?: number | null;
  memberStates?: number | null;
  data: { ciaImpact: boolean; maliciousDataLoss: boolean };
  costsEur?: number | null;
};
export type CriterionKey = "clients" | "reputation" | "duration" | "geography" | "data" | "economic";
export type ClassResult = {
  criticalServices: boolean;
  met: Record<CriterionKey, { met: boolean; why: string[] }>;
  metCount: number;
  maliciousPath: boolean;
  major: boolean;
};

const pct = (a?: number | null, b?: number | null) => (a != null && b != null && b > 0 ? a / b : null);

export function classify(i: ClassInput, de = false): ClassResult {
  const criticalServices = i.gate.criticalFunction || i.gate.regulatedService || i.gate.maliciousAccess;
  const c = i.clients;
  const cw: string[] = [];
  const cr = pct(c.affected, c.total), fr = pct(c.counterpartsAffected, c.counterpartsTotal), tn = pct(c.txAffectedCount, c.txDailyCount), tv = pct(c.txAffectedValue, c.txDailyValue);
  if (cr != null && cr > 0.1) cw.push(de ? `${(cr * 100).toFixed(1)} % der Kunden des Dienstes (> 10 %)` : `${(cr * 100).toFixed(1)}% of the service's clients (> 10%)`);
  if (c.affected != null && c.affected > 100_000) cw.push(de ? "über 100.000 betroffene Kunden" : "over 100,000 clients affected");
  if (fr != null && fr > 0.3) cw.push(de ? `${(fr * 100).toFixed(1)} % der Finanz-Gegenparteien (> 30 %)` : `${(fr * 100).toFixed(1)}% of financial counterparts (> 30%)`);
  if (tn != null && tn > 0.1) cw.push(de ? `${(tn * 100).toFixed(1)} % der täglichen Transaktionen (> 10 %)` : `${(tn * 100).toFixed(1)}% of daily transactions (> 10%)`);
  if (tv != null && tv > 0.1) cw.push(de ? `${(tv * 100).toFixed(1)} % des täglichen Transaktionswerts (> 10 %)` : `${(tv * 100).toFixed(1)}% of daily transaction value (> 10%)`);
  if (c.relevantAffected) cw.push(de ? "relevanter Kunde oder Gegenpartei betroffen" : "a relevant client or counterpart is affected");
  const r = i.reputation, rw: string[] = [];
  if (r.media) rw.push(de ? "Medienberichte" : "media coverage");
  if (r.complaints) rw.push(de ? "wiederholte Beschwerden mehrerer Kunden/Gegenparteien" : "repeated complaints from several clients/counterparts");
  if (r.regulatory) rw.push(de ? "regulatorische Anforderungen (voraussichtlich) nicht erfüllbar" : "regulatory requirements (likely) not met");
  if (r.lossOfClients) rw.push(de ? "(voraussichtlicher) Verlust von Kunden/Gegenparteien mit wesentlicher Wirkung" : "(likely) loss of clients/counterparts with material effect");
  const dw: string[] = [];
  if (i.durationHours != null && i.durationHours > 24) dw.push(de ? `Dauer ${i.durationHours} Std. (> 24 Std.)` : `duration ${i.durationHours} h (> 24 h)`);
  if (i.downtimeHours != null && i.downtimeHours > 2 && i.gate.criticalFunction) dw.push(de ? `Ausfallzeit ${i.downtimeHours} Std. bei kritischer/wichtiger Funktion (> 2 Std.)` : `downtime ${i.downtimeHours} h for a critical/important function (> 2 h)`);
  const gw: string[] = [];
  if (i.memberStates != null && i.memberStates >= 2) gw.push(de ? `Auswirkungen in ${i.memberStates} Mitgliedstaaten (≥ 2)` : `impact in ${i.memberStates} member states (≥ 2)`);
  const daw: string[] = [];
  if (i.data.ciaImpact) daw.push(de ? "Verfügbarkeit, Authentizität, Integrität oder Vertraulichkeit von Daten beeinträchtigt" : "availability, authenticity, integrity or confidentiality of data affected");
  if (i.data.maliciousDataLoss) daw.push(de ? "erfolgreicher, böswilliger, unbefugter Zugriff, der zu Datenverlust führen kann" : "successful malicious unauthorised access that may result in data losses");
  const ew: string[] = [];
  if (i.costsEur != null && i.costsEur > 100_000) ew.push(de ? `Kosten/Verluste ${i.costsEur.toLocaleString("de-AT")} € (> 100.000 €)` : `costs/losses €${i.costsEur.toLocaleString("en-GB")} (> €100,000)`);
  const met: ClassResult["met"] = {
    clients: { met: cw.length > 0, why: cw }, reputation: { met: rw.length > 0, why: rw }, duration: { met: dw.length > 0, why: dw },
    geography: { met: gw.length > 0, why: gw }, data: { met: daw.length > 0, why: daw }, economic: { met: ew.length > 0, why: ew },
  };
  const metCount = Object.values(met).filter((m) => m.met).length;
  const maliciousPath = i.data.maliciousDataLoss;
  return { criticalServices, met, metCount, maliciousPath, major: criticalServices && (maliciousPath || metCount >= 2) };
}

export type DeadlineInput = { awareAt: Date; classifiedAt: Date; noWeekendRelief: boolean; initialSentAt?: Date | null; intermediateSentAt?: Date | null };
export type Deadline = { key: "initial" | "intermediate" | "final"; due: Date; base: Date; shifted: boolean; note: string };

const H = 3600_000;
/** Saturday/Sunday → next working day 12:00 local time (public holidays are not known here). */
function weekendShift(d: Date): { due: Date; shifted: boolean } {
  const day = d.getDay();
  if (day !== 0 && day !== 6) return { due: d, shifted: false };
  const n = new Date(d);
  n.setDate(n.getDate() + (day === 6 ? 2 : 1));
  n.setHours(12, 0, 0, 0);
  return { due: n, shifted: true };
}
function addMonth(d: Date) { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; }

export function deadlines(i: DeadlineInput, de = false): Deadline[] {
  const late = i.classifiedAt.getTime() > i.awareAt.getTime() + 24 * H;
  const initialBase = late ? new Date(i.classifiedAt.getTime() + 4 * H) : new Date(Math.min(i.classifiedAt.getTime() + 4 * H, i.awareAt.getTime() + 24 * H));
  const ini = i.noWeekendRelief ? { due: initialBase, shifted: false } : weekendShift(initialBase);
  const interBase = new Date((i.initialSentAt ?? ini.due).getTime() + 72 * H);
  const inter = i.noWeekendRelief ? { due: interBase, shifted: false } : weekendShift(interBase);
  const finalBase = addMonth(i.intermediateSentAt ?? inter.due);
  const fin = weekendShift(finalBase); // the weekend rule is never excluded for the final report
  return [
    { key: "initial", due: ini.due, base: initialBase, shifted: ini.shifted, note: late
      ? (de ? "Einstufung erst nach über 24 Std.: 4 Std. ab Einstufung (Art. 5 Abs. 2)." : "Classified more than 24 h after awareness: 4 h from classification (Art. 5(2)).")
      : (de ? "4 Std. ab Einstufung als schwerwiegend, spätestens 24 Std. ab Kenntnis." : "4 h from classification as major, at the latest 24 h from awareness.") },
    { key: "intermediate", due: inter.due, base: interBase, shifted: inter.shifted, note: i.initialSentAt
      ? (de ? "72 Std. ab tatsächlicher Erstmeldung; bei Wiederherstellung des Regelbetriebs früher aktualisieren." : "72 h from the actual initial notification; update earlier once regular activities are recovered.")
      : (de ? "72 Std. ab Erstmeldung (hier ab Fälligkeit der Erstmeldung gerechnet)." : "72 h from the initial notification (counted here from its due time).") },
    { key: "final", due: fin.due, base: finalBase, shifted: fin.shifted, note: de ? "1 Monat ab der letzten (aktualisierten) Zwischenmeldung." : "1 month from the latest (updated) intermediate report." },
  ];
}
