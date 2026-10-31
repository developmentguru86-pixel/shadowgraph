import { db } from "./db";

export type GlobalNewsSignal = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  theme: "digital" | "telecom" | "grid" | "banking" | "logistics" | "general";
  score: number;
};

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const clean = (value: string) => decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function readTag(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? clean(match[1]) : "";
}

function idOf(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function classify(title: string): Pick<GlobalNewsSignal, "theme" | "score"> {
  const text = title.toLowerCase();
  const candidates: Array<{ theme: GlobalNewsSignal["theme"]; rx: RegExp; base: number }> = [
    { theme: "digital", rx: /(artificial intelligence|\bai\b|semiconductor|chip|cloud|data center|datacenter|cyber|software|server)/i, base: 82 },
    { theme: "telecom", rx: /(telecom|fiber|fibre|5g|broadband|network equipment|connectivity)/i, base: 80 },
    { theme: "grid", rx: /(energy|electricity|power grid|transformer|battery|renewable|oil|gas|utility)/i, base: 80 },
    { theme: "banking", rx: /(bank|payment|fintech|credit|financial regulation|liquidity)/i, base: 76 },
    { theme: "logistics", rx: /(logistics|cargo|shipping|port|airport|rail|freight|supply chain)/i, base: 76 },
  ];
  for (const item of candidates) {
    if (item.rx.test(text)) return { theme: item.theme, score: item.base };
  }
  return { theme: "general", score: 55 };
}

export async function fetchGlobalNews(): Promise<GlobalNewsSignal[]> {
  const cacheKey = "cache:global-news:v1";
  const cached = await db
    .selectFrom("mppStore")
    .select(["value", "updatedAt"])
    .where("key", "=", cacheKey)
    .executeTakeFirst()
    .catch(() => undefined);
  const cacheAge = cached?.updatedAt
    ? Date.now() - new Date(cached.updatedAt as unknown as string | Date).getTime()
    : Number.POSITIVE_INFINITY;
  if (Array.isArray(cached?.value) && cacheAge < 240_000) {
    return cached.value as unknown as GlobalNewsSignal[];
  }

  const queries = [
    '"artificial intelligence" OR semiconductor OR "data center" OR cloud',
    'telecom OR fiber OR 5G OR cybersecurity',
    'energy OR "power grid" OR transformer OR battery',
    'bank OR fintech OR payments OR liquidity',
    'logistics OR shipping OR cargo OR "supply chain"',
  ];
  const feeds = await Promise.allSettled(queries.map(async (query) => {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", `(${query}) (investment OR contract OR capex OR regulation OR outage OR expansion OR acquisition) when:7d`);
    url.searchParams.set("hl", "en");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
    const response = await fetch(url, {
      headers: { "user-agent": "ShadowGraph-Global-News/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Google News ${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    return items.slice(0, 45).map((item) => {
      const title = readTag(item, "title");
      const articleUrl = readTag(item, "link");
      const classified = classify(title);
      return {
        id: `news:${idOf(articleUrl || title)}`,
        title,
        url: articleUrl,
        source: readTag(item, "source") || "Google News",
        publishedAt: readTag(item, "pubDate"),
        ...classified,
      } satisfies GlobalNewsSignal;
    }).filter((item) => item.title && item.url);
  }));

  const output = [...new Map(
    feeds
      .filter((x): x is PromiseFulfilledResult<GlobalNewsSignal[]> => x.status === "fulfilled")
      .flatMap((x) => x.value)
      .map((item) => [item.url, item]),
  ).values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 120);
  if (output.length) {
    await db
      .insertInto("mppStore")
      .values({ key: cacheKey, value: output as any, updatedAt: new Date() })
      .onConflict((oc) => oc.column("key").doUpdateSet({
        value: output as any,
        updatedAt: new Date(),
      }))
      .execute()
      .catch(() => undefined);
  }
  return output;
}
