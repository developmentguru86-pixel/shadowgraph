import superjson from "superjson";
import type { InfraNode, LiveEvent, OutputType } from "./live_GET.schema";
import { PUBLISH_NEWS_HEADLINES, WITHHELD } from "../helpers/licensing";

const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s/g, " ")
    .trim();

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const eventId = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) { // was `i = 1`: an endless loop that held every request until the platform timeout
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
};

const sectorKeywords = [
  "cyber", "siber", "hack", "outage", "kesinti", "telecom", "telekom",
  "data center", "datacenter", "veri merkezi", "payment", "ödeme", "fintech",
  "bank", "banka", "fiber", "fibre", "energy", "enerji", "electric",
  "elektrik", "logistics", "lojistik", "rail", "port", "liman", "cloud",
  "bulut", "borsa", "fund", "fon", "investment", "yatırım",
];

async function fetchGoogleNews(): Promise<LiveEvent[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set(
    "q",
    "Turkey (cyber OR telecom OR bank OR energy OR fiber OR fintech OR logistics OR datacenter)",
  );
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const response = await fetch(url, {
    headers: { "user-agent": "ShadowGraph/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Google News ${response.status}`);
  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
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
    return match ? decode(match[1]).trim() : "";
  };
  return items.slice(0, 80).map((item) => {
    const title = clean(readTag(item, "title"));
    const articleUrl = readTag(item, "link");
    const source = clean(readTag(item, "source"));
    return {
      id: eventId(articleUrl || title),
      title,
      url: articleUrl,
      domain: source || domainOf(articleUrl) || "Google News",
      seen: readTag(item, "pubDate"),
      language: "English",
      sourceCountry: "",
    };
  }).filter((item) => item.title && item.url);
}

async function fetchGdelt(): Promise<LiveEvent[]> {
  if (!PUBLISH_NEWS_HEADLINES) return [];
  const primary = await fetchGoogleNews();
  return primary
    .map((event) => {
      const haystack = `${event.title} ${event.domain}`.toLocaleLowerCase("tr-TR");
      const priority = sectorKeywords.reduce(
        (score, keyword) => score + (haystack.includes(keyword) ? 1 : 0),
        0,
      );
      return { ...event, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 80)
    .map(({ priority: _priority, ...event }) => event);
}

async function fetchPeeringDb(): Promise<{
  facilities: InfraNode[];
  exchanges: InfraNode[];
}> {
  const fetchList = async (path: string) => {
    const response = await fetch(`https://www.peeringdb.com/api/${path}`, {
      headers: {
        accept: "application/json",
        "user-agent": "ShadowGraph/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`PeeringDB ${response.status}`);
    return response.json();
  };

  const [facilityData, exchangeData] = await Promise.all([
    fetchList("fac?country=TR&limit=250"),
    fetchList("ix?country=TR&limit=250"),
  ]);

  const facilities: InfraNode[] = (facilityData?.data ?? [])
    .map((item: any) => ({
      id: `fac-${item.id}`,
      type: "facility" as const,
      name: String(item.name ?? "Unknown facility"),
      city: String(item.city ?? "Türkiye"),
      website: item.website ? String(item.website) : null,
    }))
    .sort((a: InfraNode, b: InfraNode) =>
      a.name.localeCompare(b.name, "tr"),
    );

  const exchanges: InfraNode[] = (exchangeData?.data ?? [])
    .map((item: any) => ({
      id: `ix-${item.id}`,
      type: "exchange" as const,
      name: String(item.name ?? "Unknown exchange"),
      city: String(item.city ?? "Türkiye"),
      website: item.website ? String(item.website) : null,
    }))
    .sort((a: InfraNode, b: InfraNode) =>
      a.name.localeCompare(b.name, "tr"),
    );

  return { facilities, exchanges };
}

export async function handle() {
  const warnings: string[] = [];
  const [gdelt, peering] = await Promise.allSettled([
    fetchGdelt(),
    fetchPeeringDb(),
  ]);

  if (gdelt.status === "rejected") {
    warnings.push("The news source did not respond.");
  }
  if (peering.status === "rejected") {
    warnings.push("PeeringDB did not respond.");
  }

  if (gdelt.status === "rejected" && peering.status === "rejected") {
    return new Response(
      superjson.stringify({
        error: "Live data sources are unreachable right now.",
      }),
      { status: 503 },
    );
  }

  const infra =
    peering.status === "fulfilled"
      ? peering.value
      : { facilities: [], exchanges: [] };

  const output: OutputType = {
    fetchedAt: new Date().toISOString(),
    events: gdelt.status === "fulfilled" ? gdelt.value : [],
    facilities: infra.facilities,
    exchanges: infra.exchanges,
    sourceHealth: {
      gdelt: gdelt.status === "fulfilled" ? "ok" : "degraded",
      peeringdb: peering.status === "fulfilled" ? "ok" : "degraded",
    },
    warnings: PUBLISH_NEWS_HEADLINES ? warnings : [...warnings, WITHHELD.news],
  };

  return new Response(superjson.stringify(output), {
    headers: {
      "Cache-Control": "public, s-maxage=240, stale-while-revalidate=360",
    },
  });
}