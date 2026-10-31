/**
 * Register-of-information extract (DORA Art. 28(3), templates of Implementing Regulation (EU) 2024/2956) built from a paid
 * vendor scan. It pre-fills what can be observed or looked up: the ICT third-party providers (B_05.01), their infrastructure
 * sub-contractors at supply-chain rank 2 (B_05.02), LEI candidates from the public GLEIF index (CC0), endpoint location and
 * provider headquarters. Contract fields stay empty for the customer to complete. An LEI is never asserted: every value is a
 * candidate with its match quality, to be verified before submission.
 */
import { mppStore } from "./mppStore";
import { ctppEntity, providerHq } from "./doraReportText";
import type { DoraReport } from "./doraReport";

type Lei = { lei: string; legalName: string; country: string | null; status: string | null; match: "exact" | "candidate" | "group" } | null;

// legal forms only: "Group", "Holding", "Europe" or "(Hong Kong)" mark a different entity and must not make a match exact
const LEGAL_FORMS = /\b(gmbh|ag|se|sa|sas|sarl|bv|nv|ltd|limited|plc|inc|incorporated|llc|corp|corporation|co|kg|og|eg|ab|as|oy|spa|srl|kft|zrt|aktiengesellschaft)\b/g;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[.,'"]/g, " ").replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
const normQuery = (s: string) => norm(s.replace(/\(.*?\)/g, " "));

/**
 * One GLEIF lookup, cached 30 days (also negative results). A record counts as "exact" only when its legal name equals the
 * query after removing legal forms; otherwise the shortest legal name starting with the query is offered as a "candidate".
 */
async function gleif(query: string, exactLegalName = false): Promise<Lei> {
  const q = normQuery(query);
  if (q.length < 2) return null;
  const key = `gleif:v3:${exactLegalName ? "x:" : ""}${q}`;
  const cached = (await mppStore.get(key).catch(() => null)) as { at: number; v: Lei } | null;
  if (cached && Date.now() - cached.at < 30 * 86_400_000) return cached.v;
  const param = exactLegalName ? `filter[entity.legalName]=${encodeURIComponent(query)}` : `filter[fulltext]=${encodeURIComponent(query.replace(/\(.*?\)/g, " ").trim())}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`https://api.gleif.org/api/v1/lei-records?${param}&page[size]=10`, { headers: { Accept: "application/vnd.api+json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`GLEIF ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string; attributes: { entity: { legalName: { name: string }; legalAddress?: { country?: string }; status?: string } } }> };
    const recs = (body.data ?? []).filter((d) => d.attributes.entity.status !== "INACTIVE");
    const name = (d: (typeof recs)[number]) => norm(d.attributes.entity.legalName.name);
    const exact = recs.find((d) => name(d) === q);
    const pick = exact ?? (exactLegalName ? undefined : recs.filter((d) => q.length >= 6 && name(d).startsWith(`${q} `)).sort((a, b) => name(a).length - name(b).length)[0]);
    const v: Lei = pick ? {
      lei: pick.id, legalName: pick.attributes.entity.legalName.name, country: pick.attributes.entity.legalAddress?.country ?? null,
      status: pick.attributes.entity.status ?? null, match: exact ? "exact" : "candidate",
    } : null;
    await mppStore.put(key, { at: Date.now(), v }).catch(() => {});
    return v;
  } finally { clearTimeout(timer); }
}

/** Infrastructure provider: its own name first; else the group entity on the ESA CTPP list (labelled as group entity). */
async function providerLei(p: string): Promise<Lei> {
  if (/\./.test(p)) return null; // only a domain is known ("Other (x)")
  const own = await gleif(p);
  if (own) return own;
  const group = ctppEntity(p);
  if (!group) return null;
  const g = await gleif(group, true);
  return g ? { ...g, match: "group" } : null;
}

const LAYERS = [["hosting", "Hosting / cloud"], ["cdn", "CDN / edge"], ["dns", "DNS"], ["email", "Email"]] as const;
const SELF = /^(Self-hosted|Selbst betrieben) \(/;
const OTHER = /^(Other|Sonstige) \((.+)\)$/;

export async function buildRegisterExtract(r: DoraReport, budgetMs = 20_000): Promise<string> {
  const ok = r.register.filter((v) => v.status === "ok" || v.status === "no_dns");
  const juris = new Map(r.jurisdiction.rows.map((j) => [j.name, j]));

  // names to look up: each vendor (trade name, or the domain stem) and each distinct infrastructure provider
  // "Accenture TiGital (ARZ) - Online-Banking" → "Accenture TiGital": a description after a dash is not part of the company name
  const vendorQuery = (v: (typeof ok)[number]) => (v.name && v.name !== v.domain ? v.name.split(/\s+[-–]\s+/)[0] : v.domain.split(".").slice(-2, -1)[0] ?? v.domain);
  const subs = new Map<string, { layer: string; vendors: string[] }[]>();
  const subList: Array<{ vendor: (typeof ok)[number]; provider: string; layer: string }> = [];
  for (const v of ok) {
    for (const [key, label] of LAYERS) {
      const raw = v[key];
      if (!raw || SELF.test(raw)) continue;
      const provider = OTHER.exec(raw)?.[2] ?? raw;
      if (provider.toLowerCase() === v.domain.toLowerCase()) continue;
      // the vendor's own infrastructure (Microsoft 365 on Microsoft Azure, SIX Group on Six Group Services) is not a sub-contractor
      const first = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/)[0] ?? "";
      if (first(provider) === first(v.name) || (ctppEntity(provider) && ctppEntity(provider) === ctppEntity(v.name))) continue;
      subList.push({ vendor: v, provider, layer: label });
      subs.set(provider, [...(subs.get(provider) ?? []), { layer: label, vendors: [v.name] }]);
    }
  }
  const lookups = new Map<string, Lei | "pending">();
  const queue: Array<[string, () => Promise<Lei>]> = [
    ...[...subs.keys()].map((p) => [`p:${p}`, () => providerLei(p)] as [string, () => Promise<Lei>]),
    ...ok.map((v) => [`v:${v.domain}`, () => providerLei(vendorQuery(v))] as [string, () => Promise<Lei>]),
  ];
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < queue.length; i += 4) {
    if (Date.now() > deadline) { for (const [k] of queue.slice(i)) lookups.set(k, "pending"); break; }
    await Promise.all(queue.slice(i, i + 4).map(async ([k, fn]) => { try { lookups.set(k, await fn()); } catch { lookups.set(k, "pending"); } }));
  }

  const leiCols = (l: Lei | "pending" | undefined) => l === "pending" || l === undefined
    ? ["", "", "", "", "lookup pending: download again"]
    : l ? [l.lei, l.legalName, l.country ?? "", l.status ?? "", l.match === "exact" ? "exact legal name: verify" : l.match === "group" ? "ESA-designated group entity: verify your contracting entity" : "candidate: verify"] : ["", "", "", "", "no match in GLEIF"];
  const snapshot = r.scannedAt.slice(0, 10);
  const head = [
    "record_type", "rov_template", "provider_name", "provider_domain", "parent_provider", "supply_chain_rank", "infrastructure_layer",
    "function_supported", "supports_critical_or_important_function",
    "lei_candidate", "lei_legal_name", "lei_country", "lei_status", "lei_match",
    "service_endpoint_country", "infrastructure_hq_country", "esa_designated_ctpp",
    "contract_reference", "ict_service_type_code", "criticality_assessment", "substitutability", "exit_plan", "annual_expense_eur", "notice_period_days",
    "source",
  ];
  const rows: string[][] = [];
  for (const v of ok) {
    const j = juris.get(v.name);
    rows.push([
      "ict_third_party_provider", "B_05.01", v.name, v.domain, "", "1", "", v.fn ?? "", v.critical ? "yes" : "no",
      ...leiCols(lookups.get(`v:${v.domain}`)),
      j?.endpoint ?? "", j?.hq ?? "", "",
      "", "", "", "", "", "", "",
      `ShadowGraph scan ${snapshot}, report ${r.doc.id}`,
    ]);
  }
  for (const s of subList) {
    rows.push([
      "subcontractor", "B_05.02", s.provider, "", s.vendor.name, "2", s.layer, s.vendor.fn ?? "", s.vendor.critical ? "yes" : "no",
      ...leiCols(lookups.get(`p:${s.provider}`)),
      "", providerHq(s.provider) ?? "", ctppEntity(s.provider) ?? "",
      "", "", "", "", "", "", "",
      `observed in public DNS/IP data of ${s.vendor.domain}, ${snapshot}`,
    ]);
  }
  const cell = (x: string) => { const s = /^[=+\-@\t\r]/.test(x) ? `'${x}` : x; return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [head, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
