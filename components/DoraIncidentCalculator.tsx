import { useMemo, useState } from "react";
import { classify, deadlines, type ClassInput, type CriterionKey } from "../helpers/doraClassification";
import styles from "./DoraIncidentCalculator.module.css";

type Lang = "en" | "de";
const T = {
  en: {
    s1: "Does the incident touch critical services?", s1sub: "Art. 6 of Regulation (EU) 2024/1772. One of these is enough.",
    g1: "It affects ICT services or systems that support critical or important functions",
    g2: "It affects financial services that need authorisation, registration or supervision",
    g3: "There was a successful, malicious, unauthorised access to network and information systems",
    s2: "Which thresholds are met?", s2sub: "Art. 9. Estimates are allowed when exact figures are not known yet. Leave a field empty if it does not apply.",
    clients: "Clients, counterparts and transactions", cTotal: "Clients using the service", cAff: "Clients affected", fTotal: "Financial counterparts", fAff: "Counterparts affected",
    tTotal: "Transactions per average day", tAff: "Transactions affected", vTotal: "Average daily transaction value (€)", vAff: "Transaction value affected (€)",
    relevant: "A relevant client or counterpart is affected (Art. 1(3))",
    rep: "Reputation", r1: "Media have reported on it", r2: "Several clients or counterparts have complained repeatedly", r3: "We cannot meet, or will likely not meet, regulatory requirements", r4: "We have lost, or will likely lose, clients or counterparts with a material effect",
    dur: "Duration and downtime", dH: "Incident duration so far (hours)", dD: "Service downtime (hours)",
    geo: "Geography", ms: "EU member states with impact (incl. home state)",
    data: "Data", d1: "Availability, authenticity, integrity or confidentiality of data is affected with an adverse effect", d2: "The malicious access may result in data losses",
    eco: "Economic impact", cost: "Direct and indirect costs and losses (€)",
    s3: "When is what due?", s3sub: "Regulation (EU) 2025/301, Art. 5. Times are in your browser's time zone.",
    aware: "Became aware of the incident", classified: "Classified as major", entity: "Your entity",
    eNo: "Credit institution, CCP, trading venue operator or NIS2 essential/important entity", eYes: "Other financial entity",
    sent: "Initial notification actually sent (optional)",
    verdictMajor: "Major ICT-related incident", verdictNot: "Not major on these inputs", verdictGate: "No critical service affected",
    whyMajorMal: "Critical services are affected and a successful malicious access may cause data losses. That alone makes it major.",
    whyMajor: (n: number) => `Critical services are affected and ${n} of 6 criteria meet their threshold. Two are needed.`,
    whyNot: (n: number) => `Critical services are affected, but only ${n} of 6 criteria meet their threshold. Two are needed. Keep reassessing as figures come in.`,
    whyGate: "Without an effect on critical services the incident is not major, whatever the thresholds say. Record it in your incident log anyway.",
    crit: { clients: "Clients, counterparts, transactions", reputation: "Reputational impact", duration: "Duration and downtime", geography: "Geographical spread", data: "Data losses", economic: "Economic impact" } as Record<CriterionKey, string>,
    met: "met", notMet: "not met",
    dl: { initial: "Initial notification", intermediate: "Intermediate report", final: "Final report" },
    shifted: "Moved from a weekend to noon of the next working day. Public holidays are not taken into account.",
    deadlineHint: "Enter when you became aware and when you classified the incident.",
    recurring: "Same root cause twice in six months? Recurring incidents that are each not major can be major together (Art. 8(2)).",
    where: "In Austria, reports go to the FMA through its Incoming Platform, using the ESA templates.",
    copy: "Copy summary", copied: "Copied", disclaimer: "A pre-assessment, not legal advice. The classification and the deadlines are your institution's responsibility.",
    locale: "en-GB", yes: "yes", no: "no",
  },
  de: {
    s1: "Betrifft der Vorfall kritische Dienste?", s1sub: "Art. 6 der Verordnung (EU) 2024/1772. Eine Bedingung genügt.",
    g1: "Er betrifft IKT-Dienste oder -Systeme, die kritische oder wichtige Funktionen unterstützen",
    g2: "Er betrifft Finanzdienstleistungen, die eine Zulassung, Registrierung oder Aufsicht erfordern",
    g3: "Es gab einen erfolgreichen, böswilligen, unbefugten Zugriff auf Netzwerk- und Informationssysteme",
    s2: "Welche Schwellenwerte sind erreicht?", s2sub: "Art. 9. Schätzungen sind zulässig, solange genaue Zahlen fehlen. Felder, die nicht zutreffen, leer lassen.",
    clients: "Kunden, Gegenparteien und Transaktionen", cTotal: "Kunden, die den Dienst nutzen", cAff: "Betroffene Kunden", fTotal: "Finanzielle Gegenparteien", fAff: "Betroffene Gegenparteien",
    tTotal: "Transaktionen an einem durchschnittlichen Tag", tAff: "Betroffene Transaktionen", vTotal: "Durchschnittlicher Tageswert der Transaktionen (€)", vAff: "Betroffener Transaktionswert (€)",
    relevant: "Ein relevanter Kunde oder eine relevante Gegenpartei ist betroffen (Art. 1 Abs. 3)",
    rep: "Reputation", r1: "Medien haben berichtet", r2: "Mehrere Kunden oder Gegenparteien haben sich wiederholt beschwert", r3: "Regulatorische Anforderungen können wir nicht oder voraussichtlich nicht erfüllen", r4: "Wir haben Kunden oder Gegenparteien mit wesentlicher Wirkung verloren oder werden sie voraussichtlich verlieren",
    dur: "Dauer und Ausfallzeit", dH: "Bisherige Dauer des Vorfalls (Stunden)", dD: "Ausfallzeit des Dienstes (Stunden)",
    geo: "Geografie", ms: "Betroffene EU-Mitgliedstaaten (inkl. Herkunftsstaat)",
    data: "Daten", d1: "Verfügbarkeit, Authentizität, Integrität oder Vertraulichkeit von Daten ist mit nachteiliger Wirkung beeinträchtigt", d2: "Der böswillige Zugriff kann zu Datenverlust führen",
    eco: "Wirtschaftliche Auswirkungen", cost: "Direkte und indirekte Kosten und Verluste (€)",
    s3: "Was ist wann fällig?", s3sub: "Verordnung (EU) 2025/301, Art. 5. Zeiten in der Zeitzone Ihres Browsers.",
    aware: "Kenntnis vom Vorfall", classified: "Als schwerwiegend eingestuft", entity: "Ihr Unternehmen",
    eNo: "Kreditinstitut, CCP, Betreiber eines Handelsplatzes oder wesentliche/wichtige Einrichtung nach NIS2", eYes: "Anderes Finanzunternehmen",
    sent: "Erstmeldung tatsächlich gesendet (optional)",
    verdictMajor: "Schwerwiegender IKT-bezogener Vorfall", verdictNot: "Nach diesen Angaben nicht schwerwiegend", verdictGate: "Kein kritischer Dienst betroffen",
    whyMajorMal: "Kritische Dienste sind betroffen und ein erfolgreicher, böswilliger Zugriff kann zu Datenverlust führen. Das allein macht ihn schwerwiegend.",
    whyMajor: (n: number) => `Kritische Dienste sind betroffen und ${n} von 6 Kriterien erreichen ihren Schwellenwert. Zwei sind nötig.`,
    whyNot: (n: number) => `Kritische Dienste sind betroffen, aber nur ${n} von 6 Kriterien erreichen ihren Schwellenwert. Zwei sind nötig. Neu bewerten, sobald Zahlen nachkommen.`,
    whyGate: "Ohne Auswirkung auf kritische Dienste ist der Vorfall nicht schwerwiegend, egal was die Schwellenwerte sagen. Im Vorfallregister trotzdem erfassen.",
    crit: { clients: "Kunden, Gegenparteien, Transaktionen", reputation: "Reputation", duration: "Dauer und Ausfallzeit", geography: "Geografische Ausbreitung", data: "Datenverluste", economic: "Wirtschaftliche Auswirkungen" } as Record<CriterionKey, string>,
    met: "erreicht", notMet: "nicht erreicht",
    dl: { initial: "Erstmeldung", intermediate: "Zwischenmeldung", final: "Abschlussmeldung" },
    shifted: "Vom Wochenende auf 12 Uhr des nächsten Arbeitstags verschoben. Feiertage sind nicht berücksichtigt.",
    deadlineHint: "Tragen Sie ein, wann Sie Kenntnis erlangt und wann Sie eingestuft haben.",
    recurring: "Zweimal dieselbe Ursache in sechs Monaten? Wiederkehrende Vorfälle, die einzeln nicht schwerwiegend sind, können es zusammen sein (Art. 8 Abs. 2).",
    where: "In Österreich gehen die Meldungen über die Incoming Platform an die FMA, mit den Vorlagen der ESAs.",
    copy: "Zusammenfassung kopieren", copied: "Kopiert", disclaimer: "Eine Vorprüfung, keine Rechtsberatung. Einstufung und Fristen verantwortet Ihr Institut.",
    locale: "de-AT", yes: "ja", no: "nein",
  },
};

/** Accepts 1000000, 1.000.000, 1,000,000, 1 000 000, 12,5 and 12.5. */
const num = (raw: string) => {
  const s = raw.replace(/[\s'’€%]/g, "");
  if (!s) return null;
  const v = Number(/^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, "") : s.replace(",", "."));
  return isFinite(v) ? v : null;
};
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function Check({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className={styles.check}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span>{label}</span></label>;
}
function Num({ label, v, set }: { label: string; v: string; set: (v: string) => void }) {
  return <label className={styles.field}><span>{label}</span><input inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} /></label>;
}

export function DoraIncidentCalculator({ lang = "en" }: { lang?: Lang }) {
  const t = T[lang], de = lang === "de";
  const [g, setG] = useState({ criticalFunction: false, regulatedService: false, maliciousAccess: false });
  const [n, setN] = useState<Record<string, string>>({});
  const [rep, setRep] = useState({ media: false, complaints: false, regulatory: false, lossOfClients: false });
  const [relevant, setRelevant] = useState(false);
  const [dat, setDat] = useState({ ciaImpact: false, maliciousDataLoss: false });
  const [aware, setAware] = useState(""); const [cls, setCls] = useState(""); const [sent, setSent] = useState("");
  const [strict, setStrict] = useState(true);
  const [copied, setCopied] = useState(false);
  const f = (k: string) => n[k] ?? "";
  const sf = (k: string) => (v: string) => setN((o) => ({ ...o, [k]: v }));

  const input: ClassInput = {
    gate: g,
    clients: { total: num(f("cT")), affected: num(f("cA")), counterpartsTotal: num(f("fT")), counterpartsAffected: num(f("fA")), txDailyCount: num(f("tT")), txAffectedCount: num(f("tA")), txDailyValue: num(f("vT")), txAffectedValue: num(f("vA")), relevantAffected: relevant },
    reputation: rep, durationHours: num(f("dH")), downtimeHours: num(f("dD")), memberStates: num(f("ms")), data: dat, costsEur: num(f("cost")),
  };
  const r = classify(input, de);
  const dls = useMemo(() => (aware && cls ? deadlines({ awareAt: new Date(aware), classifiedAt: new Date(cls), noWeekendRelief: strict, initialSentAt: sent ? new Date(sent) : null }, de) : null), [aware, cls, sent, strict, de]);
  const fmt = (d: Date) => d.toLocaleString(t.locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const verdict = !r.criticalServices ? "gate" : r.major ? "major" : "not";
  const why = verdict === "gate" ? t.whyGate : verdict === "major" ? (r.maliciousPath ? t.whyMajorMal : t.whyMajor(r.metCount)) : t.whyNot(r.metCount);
  const now = Date.now();

  const copy = () => {
    const lines = [
      `${verdict === "major" ? t.verdictMajor : verdict === "not" ? t.verdictNot : t.verdictGate}`, why, "",
      ...(Object.keys(r.met) as CriterionKey[]).map((k) => `${t.crit[k]}: ${r.met[k].met ? t.met : t.notMet}${r.met[k].why.length ? ` (${r.met[k].why.join("; ")})` : ""}`),
      ...(dls && verdict === "major" ? ["", ...dls.map((d) => `${t.dl[d.key]}: ${fmt(d.due)}`)] : []),
      "", t.disclaimer, typeof window !== "undefined" ? window.location.href : "",
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.form}>
        <fieldset className={styles.step}>
          <legend><b>1</b>{t.s1}</legend>
          <p className={styles.sub}>{t.s1sub}</p>
          <Check label={t.g1} on={g.criticalFunction} set={(v) => setG({ ...g, criticalFunction: v })} />
          <Check label={t.g2} on={g.regulatedService} set={(v) => setG({ ...g, regulatedService: v })} />
          <Check label={t.g3} on={g.maliciousAccess} set={(v) => { setG({ ...g, maliciousAccess: v }); if (!v) setDat({ ...dat, maliciousDataLoss: false }); }} />
        </fieldset>

        <fieldset className={styles.step}>
          <legend><b>2</b>{t.s2}</legend>
          <p className={styles.sub}>{t.s2sub}</p>
          <div className={styles.group}>
            <h4>{t.clients}<Tick on={r.met.clients.met} /></h4>
            <div className={styles.pairs}>
              <Num label={t.cTotal} v={f("cT")} set={sf("cT")} /><Num label={t.cAff} v={f("cA")} set={sf("cA")} />
              <Num label={t.fTotal} v={f("fT")} set={sf("fT")} /><Num label={t.fAff} v={f("fA")} set={sf("fA")} />
              <Num label={t.tTotal} v={f("tT")} set={sf("tT")} /><Num label={t.tAff} v={f("tA")} set={sf("tA")} />
              <Num label={t.vTotal} v={f("vT")} set={sf("vT")} /><Num label={t.vAff} v={f("vA")} set={sf("vA")} />
            </div>
            <Check label={t.relevant} on={relevant} set={setRelevant} />
          </div>
          <div className={styles.group}>
            <h4>{t.rep}<Tick on={r.met.reputation.met} /></h4>
            <Check label={t.r1} on={rep.media} set={(v) => setRep({ ...rep, media: v })} />
            <Check label={t.r2} on={rep.complaints} set={(v) => setRep({ ...rep, complaints: v })} />
            <Check label={t.r3} on={rep.regulatory} set={(v) => setRep({ ...rep, regulatory: v })} />
            <Check label={t.r4} on={rep.lossOfClients} set={(v) => setRep({ ...rep, lossOfClients: v })} />
          </div>
          <div className={styles.group}>
            <h4>{t.dur}<Tick on={r.met.duration.met} /></h4>
            <div className={styles.pairs}><Num label={t.dH} v={f("dH")} set={sf("dH")} /><Num label={t.dD} v={f("dD")} set={sf("dD")} /></div>
          </div>
          <div className={styles.pairs}>
            <div className={styles.group}><h4>{t.geo}<Tick on={r.met.geography.met} /></h4><Num label={t.ms} v={f("ms")} set={sf("ms")} /></div>
            <div className={styles.group}><h4>{t.eco}<Tick on={r.met.economic.met} /></h4><Num label={t.cost} v={f("cost")} set={sf("cost")} /></div>
          </div>
          <div className={styles.group}>
            <h4>{t.data}<Tick on={r.met.data.met} /></h4>
            <Check label={t.d1} on={dat.ciaImpact} set={(v) => setDat({ ...dat, ciaImpact: v })} />
            {g.maliciousAccess && <Check label={t.d2} on={dat.maliciousDataLoss} set={(v) => setDat({ ...dat, maliciousDataLoss: v })} />}
          </div>
        </fieldset>

        <fieldset className={styles.step}>
          <legend><b>3</b>{t.s3}</legend>
          <p className={styles.sub}>{t.s3sub}</p>
          <div className={styles.pairs}>
            <label className={styles.field}><span>{t.aware}</span><span className={styles.dt}><input type="datetime-local" value={aware} onChange={(e) => setAware(e.target.value)} /><button type="button" onClick={() => setAware(nowLocal())}>{de ? "jetzt" : "now"}</button></span></label>
            <label className={styles.field}><span>{t.classified}</span><span className={styles.dt}><input type="datetime-local" value={cls} onChange={(e) => setCls(e.target.value)} /><button type="button" onClick={() => setCls(nowLocal())}>{de ? "jetzt" : "now"}</button></span></label>
          </div>
          <div className={styles.radio} role="radiogroup" aria-label={t.entity}>
            <span>{t.entity}</span>
            <label><input type="radio" checked={strict} onChange={() => setStrict(true)} />{t.eNo}</label>
            <label><input type="radio" checked={!strict} onChange={() => setStrict(false)} />{t.eYes}</label>
          </div>
          <label className={styles.field}><span>{t.sent}</span><input type="datetime-local" value={sent} onChange={(e) => setSent(e.target.value)} /></label>
        </fieldset>
      </div>

      <aside className={styles.result} aria-live="polite">
        <div className={`${styles.verdict} ${styles[verdict]}`}>
          <p className={styles.vLabel}>{verdict === "major" ? t.verdictMajor : verdict === "not" ? t.verdictNot : t.verdictGate}</p>
          <p className={styles.vWhy}>{why}</p>
        </div>
        <ul className={styles.crits}>
          {(Object.keys(r.met) as CriterionKey[]).map((k) => (
            <li key={k} className={r.met[k].met ? styles.on : ""}>
              <span>{t.crit[k]}</span><em>{r.met[k].met ? t.met : t.notMet}</em>
              {r.met[k].why.length > 0 && <small>{r.met[k].why.join(" · ")}</small>}
            </li>
          ))}
        </ul>
        {verdict === "major" && (
          <div className={styles.deadlines}>
            {!dls && <p className={styles.sub}>{t.deadlineHint}</p>}
            {dls?.map((d) => (
              <div key={d.key} className={`${styles.dl} ${d.due.getTime() < now ? styles.past : ""}`}>
                <span>{t.dl[d.key]}</span>
                <b>{fmt(d.due)}</b>
                <small>{d.note}{d.shifted ? ` ${t.shifted}` : ""}</small>
              </div>
            ))}
          </div>
        )}
        <p className={styles.note}>{t.recurring}</p>
        <p className={styles.note}>{t.where}</p>
        <button type="button" className={styles.copy} onClick={copy}>{copied ? t.copied : t.copy}</button>
        <p className={styles.disc}>{t.disclaimer}</p>
      </aside>
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return <i className={on ? styles.tickOn : styles.tick} aria-hidden="true" />;
}
