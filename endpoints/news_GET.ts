import superjson from "superjson";
import type { NewsEvent, OutputType } from "./news_GET.schema";
import { PUBLISH_NEWS_HEADLINES, WITHHELD } from "../helpers/licensing";

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const readTag = (item: string, tag: string) => {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decode(match[1]).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
};

const eventId = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
};

export async function handle() {
  if (!PUBLISH_NEWS_HEADLINES) {
    return new Response(superjson.stringify({ fetchedAt: new Date().toISOString(), events: [], source: "withheld", notice: WITHHELD.news }), { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set(
      "q",
      'Turkey (cyber OR telecom OR bank OR energy OR fiber OR fintech OR logistics OR datacenter OR "data center" OR cloud OR payment OR electricity OR investment)',
    );
    url.searchParams.set("hl", "en");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");

    const response = await fetch(url, {
      headers: { "user-agent": "ShadowGraph/2.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Google News ${response.status}`);
    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const events: NewsEvent[] = items.slice(0, 100).map((item) => {
      const title = readTag(item, "title");
      const articleUrl = readTag(item, "link");
      const source = readTag(item, "source") || "Google News";
      return {
        id: eventId(articleUrl || title),
        title,
        url: articleUrl,
        source,
        publishedAt: readTag(item, "pubDate"),
      };
    }).filter((item) => item.title && item.url);

    const output: OutputType = {
      fetchedAt: new Date().toISOString(),
      events,
      source: "Google News RSS",
    };
    return new Response(superjson.stringify(output), {
      headers: { "Cache-Control": "public, s-maxage=240, stale-while-revalidate=360" },
    });
  } catch (error) {
    return new Response(
      superjson.stringify({ error: error instanceof Error ? error.message : "News source unavailable" }),
      { status: 502 },
    );
  }
}