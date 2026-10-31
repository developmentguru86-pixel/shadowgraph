/**
 * Publicly documented provider incidents (press, official statements) that the DORA report cites when a vendor row runs on
 * the affected provider. Curated by hand: each entry names what was reported, by whom, and is quoted as reported, never as
 * our own measurement.
 */
export type PublicIncident = {
  id: string;
  provider: string;
  /** a vendor row matches when its hosting, DNS or domain matches */
  match: RegExp;
  /** functions the reports explicitly name as affected; a matching row counts as "reported affected", any other row of the provider only as "provider affected" */
  functions: RegExp;
  start: string;
  end: string;
  de: { title: string; detail: string };
  en: { title: string; detail: string };
  sources: Array<{ label: string; url: string }>;
};

export const PUBLIC_INCIDENTS: PublicIncident[] = [
  {
    id: "accenture-tigital-2026-10-06",
    provider: "Accenture TiGital (ARZ)",
    match: /accenture tigital|(^|\W)arz(\W|$)|arz\.at/i,
    functions: /online.?banking|mobile.?banking|banking|karte|card|bankomat|geldautomat|atm|zahlungsverkehr|payment/i,
    start: "2026-10-06T10:00:00Z",
    end: "2026-10-06T18:00:00Z",
    de: {
      title: "Dokumentierter Ausfall bei Accenture TiGital (ARZ) am 6. Okt. 2026, ca. 12–20 Uhr",
      detail: "Laut Accenture TiGital ein Fehler in der Stromversorgung eines Rechenzentrums. Betroffen waren laut Medienberichten rund 30 Banken (Hypo- und Volksbanken-Sektor, bank99, Teile der Grawe-Gruppe): Online- und Mobile-Banking, Kartenzahlungen und Bargeldbehebung. Die Websites der Banken blieben laut oe24 erreichbar, da sie in einem anderen Rechenzentrum liegen. Kein Cyberangriff. Diese Angaben stammen aus Presseberichten, nicht aus eigener Messung.",
    },
    en: {
      title: "Documented outage at Accenture TiGital (ARZ) on 6 Oct 2026, approx. 12:00–20:00 CEST",
      detail: "According to Accenture TiGital, a fault in the power supply of a data centre. Press reports name about 30 banks (Hypo and Volksbank sector, bank99, parts of the Grawe group): online and mobile banking, card payments and cash withdrawals were disrupted. Per oe24 the banks' websites stayed online because they run in a different data centre. Not a cyberattack. These details come from press reports, not from our own measurement.",
    },
    sources: [
      { label: "ORF Vorarlberg, 7 Oct 2026", url: "https://vorarlberg.orf.at/stories/3374222/" },
      { label: "oe24, 7 Oct 2026", url: "https://www.oe24.at/a/erst-strom-weg-dann-30-banken-offline-das-war-los-900121851" },
    ],
  },
];

export function publicIncidentsFor(rows: Array<{ name: string; domain: string; hosting: string | null; dns: string | null; fn?: string | null }>, sinceMs: number) {
  return PUBLIC_INCIDENTS.filter((p) => new Date(p.end).getTime() >= sinceMs).map((p) => ({
    incident: p,
    // only services the provider runs (hosting, or the row names it): the 6 Oct outage hit ARZ-run banking, not zones that merely use ARZ DNS
    vendors: rows.filter((r) => p.match.test(r.hosting ?? "") || p.match.test(r.name.split(" - ")[0])).map((r) => r.name),
  })).filter((x) => x.vendors.length).map((x) => ({
    ...x,
    // "reported": the press names this function as affected; otherwise only the provider is documented as affected
    reported: x.vendors.filter((nm) => {
      const service = nm.split(" - ").slice(1).join(" - ");
      if (/^(dns|e-?mail)/i.test(service)) return false; // infrastructure rows (DNS, mail) are not a reported banking function
      return x.incident.functions.test(`${service} ${rows.find((y) => y.name === nm)?.fn ?? ""}`);
    }),
  }));
}
