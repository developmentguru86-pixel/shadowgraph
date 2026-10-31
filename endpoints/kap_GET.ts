import superjson from "superjson";
import type { KapSignal, OutputType } from "./kap_GET.schema";
import { PUBLISH_KAP, WITHHELD } from "../helpers/licensing";

const companies = [
  { symbol: "TCELL", company: "TURKCELL İLETİŞİM HİZMETLERİ A.Ş." },
  { symbol: "TTKOM", company: "TÜRK TELEKOMÜNİKASYON A.Ş." },
  { symbol: "KAREL", company: "KAREL ELEKTRONİK SANAYİ VE TİCARET A.Ş." },
  { symbol: "ASTOR", company: "ASTOR ENERJİ A.Ş." },
  { symbol: "EUPWR", company: "EUROPOWER ENERJİ VE OTOMASYON TEKNOLOJİLERİ SANAYİ TİCARET A.Ş." },
  { symbol: "KONTR", company: "KONTROLMATİK TEKNOLOJİ ENERJİ VE MÜHENDİSLİK A.Ş." },
  { symbol: "MIATK", company: "MİA TEKNOLOJİ A.Ş." },
  { symbol: "LOGO", company: "LOGO YAZILIM SANAYİ VE TİCARET A.Ş." },
  { symbol: "AKBNK", company: "AKBANK T.A.Ş." },
  { symbol: "GARAN", company: "TÜRKİYE GARANTİ BANKASI A.Ş." },
  { symbol: "THYAO", company: "TÜRK HAVA YOLLARI A.O." },
  { symbol: "TAVHL", company: "TAV HAVALİMANLARI HOLDİNG A.Ş." },
];

const normalize = (value: string) => value.toLocaleLowerCase("tr-TR");

function classify(title: string) {
  const text = normalize(title);
  const groups: Array<{ category: KapSignal["category"]; keywords: string[]; score: number }> = [
    { category: "contract", keywords: ["sözleşme", "iş ilişkisi", "yeni iş", "sipariş", "ihale", "anlaşma", "satış sözleşmesi"], score: 92 },
    { category: "capex", keywords: ["yatırım", "kapasite", "tesis", "fabrika", "veri merkezi", "santral", "üretim hattı", "teşvik"], score: 88 },
    { category: "financing", keywords: ["kredi", "borçlanma", "tahvil", "finansman", "sermaye piyasası aracı"], score: 70 },
    { category: "corporate", keywords: ["sermaye", "pay alım", "pay satım", "iştirak", "bağlı ortaklık", "devralma", "birleşme"], score: 62 },
  ];
  for (const group of groups) {
    const hits = group.keywords.filter((keyword) => text.includes(keyword));
    if (hits.length) return { category: group.category, score: Math.min(100, group.score + (hits.length - 1) * 3) };
  }
  return { category: "other" as const, score: 35 };
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function companySignals(item: typeof companies[number]): Promise<KapSignal[]> {
  const url = `https://www.kap.org.tr/tr/search/${encodeURIComponent(item.symbol)}/1`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 ShadowGraph/2.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`KAP ${item.symbol} ${response.status}`);
  const html = decodeHtml(await response.text());
  const pattern = /href="\/tr\/Bildirim\/(\d+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1800}?Gönderim Tarihi[\s\S]{0,700}?>(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})</g;
  const signals: KapSignal[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && signals.length < 8) {
    const text = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!text.includes(item.company)) continue;
    const title = text.replace(item.company, "").trim();
    if (!title) continue;
    const classified = classify(title);
    signals.push({
      id: match[1],
      symbol: item.symbol,
      company: item.company,
      title,
      publishedAt: match[3],
      url: `https://www.kap.org.tr/tr/Bildirim/${match[1]}`,
      category: classified.category,
      score: classified.score,
    });
  }
  return signals;
}

export async function handle() {
  if (!PUBLISH_KAP) {
    return new Response(superjson.stringify({ fetchedAt: new Date().toISOString(), signals: [], source: "withheld", notice: WITHHELD.kap }), { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  const settled = await Promise.allSettled(companies.map(companySignals));
  const signals = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.publishedAt.localeCompare(a.publishedAt);
    })
    .slice(0, 60);

  if (!signals.length) {
    return new Response(superjson.stringify({ error: "KAP signals unavailable" }), { status: 502 });
  }

  const output: OutputType = {
    fetchedAt: new Date().toISOString(),
    signals,
    source: "KAP official search",
  };
  return new Response(superjson.stringify(output), {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}