import superjson from "superjson";
import type { TenderSignal, OutputType } from "./tenders_GET.schema";
import { PUBLISH_NEWS_HEADLINES, WITHHELD } from "../helpers/licensing";

const themes = [
  { name: "Telekom & Fiber", words: ["telekom", "fiber", "internet", "haberleşme", "network", "ağ altyapısı", "5g"], base: 82 },
  { name: "Data Center & IT", words: ["veri merkezi", "sunucu", "yazılım", "bulut", "siber", "bilgi işlem", "lisans"], base: 84 },
  { name: "Energy & Grid", words: ["enerji", "elektrik", "trafo", "şebeke", "güneş", "ges", "batarya"], base: 86 },
  { name: "Logistics", words: ["lojistik", "taşıma", "kargo", "liman", "ulaşım", "havaalanı", "demiryolu"], base: 74 },
];

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const clean = (value: string) => decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const readTag = (item: string, tag: string) => {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? clean(match[1]) : "";
};

const idOf = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
};

function classify(title: string) {
  const text = title.toLocaleLowerCase("tr-TR");
  let best = { theme: "Public Procurement", score: 55 };
  for (const theme of themes) {
    const hits = theme.words.filter((word) => text.includes(word)).length;
    if (hits) {
      const score = Math.min(100, theme.base + (hits - 1) * 4);
      if (score > best.score) best = { theme: theme.name, score };
    }
  }
  return best;
}

export async function handle() {
  if (!PUBLISH_NEWS_HEADLINES) {
    return new Response(superjson.stringify({ fetchedAt: new Date().toISOString(), tenders: [], source: "withheld", verificationUrl: "https://ekapv2.kik.gov.tr/ekap/search", notice: WITHHELD.news }), { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set(
      "q",
      'site:gov.tr (ihale OR "satın alma" OR "mal alımı" OR "hizmet alımı") (telekom OR fiber OR "veri merkezi" OR yazılım OR siber OR enerji OR trafo OR lojistik) when:14d',
    );
    url.searchParams.set("hl", "tr");
    url.searchParams.set("gl", "TR");
    url.searchParams.set("ceid", "TR:tr");

    const response = await fetch(url, {
      headers: { "user-agent": "ShadowGraph/2.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Tender feed ${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const tenders: TenderSignal[] = items.slice(0, 100).map((item) => {
      const title = readTag(item, "title");
      const articleUrl = readTag(item, "link");
      const source = readTag(item, "source") || "gov.tr";
      const classified = classify(title);
      return {
        id: idOf(articleUrl || title),
        title,
        source,
        publishedAt: readTag(item, "pubDate"),
        url: articleUrl,
        theme: classified.theme,
        score: classified.score,
      };
    }).filter((item) => item.title && item.url);

    const output: OutputType = {
      fetchedAt: new Date().toISOString(),
      tenders,
      source: "Official gov.tr procurement notices indexed by Google News",
      verificationUrl: "https://ekapv2.kik.gov.tr/ekap/search",
    };
    return new Response(superjson.stringify(output), {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  } catch (error) {
    return new Response(
      superjson.stringify({ error: error instanceof Error ? error.message : "Tender signals unavailable" }),
      { status: 502 },
    );
  }
}