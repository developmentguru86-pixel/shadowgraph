/**
 * What third-party content we may PUBLISH (pages, public API, agent and paid outputs). Owner decision 2026-10-19.
 *
 * Collection is unaffected: Yahoo prices and Google News headlines are still fetched and stored for internal research
 * (weekly studies, paper ledger, journal), so no history is lost. Only raw prices and headline text are withheld from
 * anything we show or sell, because neither source licenses commercial display or redistribution.
 * Switch a flag back to true once a licensed source (market-data vendor with redistribution rights, licensed news feed)
 * replaces it.
 */
export const PUBLISH_MARKET_QUOTES = false; // Yahoo Finance chart endpoint: no commercial licence
export const PUBLISH_NEWS_HEADLINES = false; // Google News RSS: no commercial use
export const PUBLISH_KAP = false; // kap.org.tr search pages: terms unclear

export const WITHHELD = {
  quotes: "Live prices are withheld until a licensed market-data source is connected. Research results computed from prices remain published.",
  news: "Third-party headlines are withheld until a licensed news source is connected.",
  kap: "KAP disclosures are withheld until their terms of use are confirmed.",
} as const;

/** Independent-monitoring notice for pages and boards that name a vendor. */
export const notAffiliated = (vendor: string) =>
  `Independent monitoring by ShadowGraph. Not affiliated with or endorsed by ${vendor}. All trademarks belong to their owners.`;

/** DB-IP City Lite licence (CC BY 4.0) requires attribution and a link wherever its results are shown. */
export const GEO_ATTRIBUTION = { text: "IP Geolocation by DB-IP", url: "https://db-ip.com", licence: "CC BY 4.0" } as const;

/** Drop headline-derived items (kind "news") from mixed evidence lists before they leave the system. */
export function withoutNews<T>(items: T[]): T[] {
  if (PUBLISH_NEWS_HEADLINES) return items;
  return items.filter((i) => (i as { kind?: string } | null)?.kind !== "news");
}
