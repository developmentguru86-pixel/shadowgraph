/**
 * Client-safe ranking for the company-dependency search (header search, /companies, company pages).
 * Matches a typed name or ticker against the company index: exact ticker, then name prefix, then word start,
 * then substring, with common former or brand names mapped to the filing name ("google" finds Alphabet).
 */
export type RankableCompany = { slug: string; name: string; ticker: string | null; customers: number; suppliers: number };

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// brand or former name -> words of the name used in SEC filings
const ALIASES: Record<string, string> = {
  google: "alphabet", facebook: "meta platforms", meta: "meta platforms", instagram: "meta platforms",
  "us government": "u s government", "u s government": "u s government", "united states government": "u s government",
  "us gov": "u s government", government: "government", pentagon: "department of defense", dod: "department of defense",
  "department of defence": "department of defense", nhs: "national health service", aws: "amazon", "amazon web services": "amazon",
  azure: "microsoft", xbox: "microsoft", iphone: "apple", walmart: "walmart", "wal mart": "walmart", tsmc: "taiwan semiconductor",
  vw: "volkswagen", gm: "general motors", "j and j": "johnson and johnson", jnj: "johnson and johnson", pg: "procter and gamble",
  "procter": "procter and gamble", costco: "costco", huawei: "huawei", samsung: "samsung", nvidia: "nvidia",
};

export function rankCompanies<T extends RankableCompany>(list: T[], raw: string, limit = 8): T[] {
  const q = norm(raw);
  if (!q) return [];
  const terms = [...new Set([q, ALIASES[q]].filter(Boolean) as string[])];
  const tick = raw.trim().toUpperCase();
  const scored: Array<{ c: T; s: number }> = [];
  for (const c of list) {
    const n = norm(c.name);
    let s = 0;
    if (c.ticker && c.ticker.toUpperCase() === tick) s = 100;
    for (const t of terms) {
      if (n === t) s = Math.max(s, 95);
      else if (n.startsWith(t)) s = Math.max(s, 80);
      else if ((` ${n}`).includes(` ${t}`)) s = Math.max(s, 60);
      else if (t.length >= 3 && n.replace(/ /g, "").includes(t.replace(/ /g, ""))) s = Math.max(s, 35);
    }
    if (s > 0) scored.push({ c, s: s + Math.min(12, Math.log2(1 + c.customers + c.suppliers) * 2) });
  }
  return scored.sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name)).slice(0, limit).map((x) => x.c);
}

/** One-line description of a company's dependency profile for search results. */
export function dependencyLine(c: RankableCompany & { top?: { name: string; share: number; role: "customer" | "supplier" } | null }): string {
  const parts: string[] = [];
  if (c.top) parts.push(c.top.role === "customer" ? `top customer ${c.top.name} ${Math.round(c.top.share * 100)}%` : `${c.top.name} gets ${Math.round(c.top.share * 100)}% of revenue from it`);
  if (c.customers) parts.push(`${c.customers} major customer${c.customers === 1 ? "" : "s"}`);
  if (c.suppliers) parts.push(`${c.suppliers} dependent supplier${c.suppliers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
