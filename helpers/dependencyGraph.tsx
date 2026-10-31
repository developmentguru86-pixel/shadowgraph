import { db } from "./db";
import type { GraphEdge, GraphNode } from "./relationshipGraphEngine";

/**
 * Company -> company dependency edges from customer_concentration_facts.
 * Only the filer's LATEST annual filing and, inside it, only the LATEST fiscal period are used,
 * so a customer that dropped below 10% (no longer disclosed) does not linger in the graph.
 * Edge direction: customer -> supplier (a shock to the customer transmits to the supplier's revenue).
 * weight = customer's share of the supplier's revenue.
 *
 * Counterparty gate: an edge is created only when the customer is an identifiable ENTITY —
 * resolved to a ticker, a known government counterparty, or a name carrying a legal-entity suffix.
 * Market segments ("Residential New Construction"), payer programs ("Medicaid") and buyer classes
 * ("Group Purchasing Organizations") stay in the fact table but never become company edges.
 */
const LEGAL_ENTITY = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|ag|se|sa|s\.a|nv|n\.v|bv|gmbh|group|holdings?|kk|ab|asa|oyj|spa|pte|pty|bhd|lp)\.?$/i;
const GOVERNMENT = /^(u\.?s\.?|united states) government$/i;
const NOT_A_COUNTERPARTY = /(medicare|medicaid|program|agencies|purchasing organization|construction|residential|segment|market|payors?|retailers|wholesalers|distributors|correlated|government agencies)/i;

function isEntity(name: string, ticker: string | null) {
  if (NOT_A_COUNTERPARTY.test(name)) return false;
  return Boolean(ticker) || GOVERNMENT.test(name.trim()) || LEGAL_ENTITY.test(name.trim());
}

/** One CIK can list several tickers (common, warrants, units). Prefer the plain common-share symbol. */
function canonicalTicker(tickers: string[]) {
  return [...new Set(tickers)].sort((a, b) => {
    const pa = /(W|WS|U|R)$/.test(a) && a.length > 3 ? 1 : 0;
    const pb = /(W|WS|U|R)$/.test(b) && b.length > 3 ? 1 : 0;
    return pa - pb || a.length - b.length || a.localeCompare(b);
  })[0];
}

export type DependencyRow = {
  customer: string; customerTicker: string | null; supplier: string; supplierTicker: string; supplierCik: string;
  revenueShare: number; fiscalPeriodEnd: string; form: string; filedAt: string;
  attribution: "official" | "inferred"; sourceUrl: string; evidence: string;
};

export async function dependencyGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; rows: DependencyRow[] }> {
  const rows = await db
    .selectFrom("customerConcentrationFacts as f")
    .selectAll("f")
    .where("f.benchmark", "=", "revenue")
    .where("f.nameSource", "!=", "anonymous")
    // entry_kind / customer_display are set by a database trigger (sg_customer_fill): channels, anonymised and
    // intra-group entries are not counterparties; spelling variants ("Pfizer Inc." / "Pfizer") share one display name
    .where("f.entryKind", "=", "customer")
    // Only the filer's ACTUAL latest annual filing (as tracked by the rolling scan). With historical facts in the
    // table, "latest filing that has facts" would resurrect customers that fell below 10% in the newest report.
    .where(({ eb, selectFrom }) =>
      eb("f.accession", "in", selectFrom("concentrationFilerScans as s")
        .select("s.lastAccession")
        .whereRef("s.filerCik", "=", "f.filerCik")
        .where("s.lastAccession", "is not", null)))
    .where(({ eb, selectFrom }) =>
      eb("f.periodEnd", "=", selectFrom("customerConcentrationFacts as p")
        .select(({ fn }) => fn.max("p.periodEnd").as("m"))
        .whereRef("p.accession", "=", "f.accession")
        .where("p.benchmark", "=", "revenue")))
    .execute();

  const tickersByCik = new Map<string, string[]>();
  for (const r of rows) tickersByCik.set(r.filerCik, [...(tickersByCik.get(r.filerCik) ?? []), r.filerTicker]);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const rowMeta = new Map<string, Omit<DependencyRow, "revenueShare" | "attribution" | "sourceUrl">>();
  for (const r of rows) {
    if (!r.customerName || !isEntity(r.customerName, r.customerTicker)) continue;
    const customerName = r.customerDisplay ?? r.customerName;
    const filerTicker = canonicalTicker(tickersByCik.get(r.filerCik) ?? [r.filerTicker]);
    const supplierId = `company:${filerTicker}`;
    const customerId = r.customerTicker
      ? `company:${r.customerTicker}`
      : `customer:${customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (customerId === supplierId) continue;
    nodes.set(supplierId, nodes.get(supplierId) ?? {
      id: supplierId, kind: "company", name: r.filerName,
      metadata: { symbol: filerTicker, cik: r.filerCik, source: "SEC EDGAR" },
    });
    nodes.set(customerId, nodes.get(customerId) ?? {
      id: customerId, kind: "company", name: customerName,
      metadata: r.customerTicker ? { symbol: r.customerTicker } : { listed: false },
    });
    const pct = Math.round(r.share * 1000) / 10;
    const periodEnd = new Date(r.periodEnd).toISOString().slice(0, 10);
    const filedAt = new Date(r.filedAt).toISOString().slice(0, 10);
    const official = r.nameSource === "xbrl_member";
    const id = `${customerId}|major_customer_of|${supplierId}`;
    const prev = edges.get(id);
    if (prev && (prev.weight ?? 0) >= r.share) continue;
    rowMeta.set(id, {
      customer: customerName, customerTicker: r.customerTicker, supplier: r.filerName, supplierTicker: filerTicker,
      supplierCik: r.filerCik, fiscalPeriodEnd: periodEnd, form: r.form, filedAt,
      evidence: official ? `XBRL member ${r.xbrlMember}` : (r.nameEvidence ?? ""),
    });
    edges.set(id, {
      id,
      source: customerId,
      target: supplierId,
      relation: "major_customer_of",
      confidence: official ? 0.98 : 0.85,
      inferred: !official,
      weight: r.share,
      evidence: [{
        sourceType: "SEC XBRL",
        title: `${customerName} = ${pct}% of ${r.filerName} revenue (fiscal period ending ${periodEnd}; ${r.form} filed ${filedAt})`,
        url: r.docUrl,
        note: official
          ? `Percentage and customer both XBRL-tagged (${r.xbrlMember}).`
          : `Percentage is XBRL-tagged; the filer tagged the customer anonymously, name taken from the same filing's text: "${r.nameEvidence ?? ""}"`,
      }],
    });
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    rows: [...edges.values()].map((e) => {
      const meta = rowMeta.get(e.id)!;
      return { ...meta, revenueShare: e.weight ?? 0, attribution: e.inferred ? "inferred" as const : "official" as const, sourceUrl: e.evidence[0]?.url ?? "" };
    }).sort((a, b) => b.revenueShare - a.revenueShare),
  };
}
