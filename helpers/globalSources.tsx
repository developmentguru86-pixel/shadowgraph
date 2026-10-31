import { db } from "./db";

export type GlobalDisclosure = {
  id: string;
  region: "US";
  source: "SEC EDGAR";
  symbol: string;
  company: string;
  form: string;
  filedAt: string;
  title: string;
  url: string;
  theme: string;
  score: number;
};

export type GlobalProcurement = {
  id: string;
  region: "EU";
  source: "TED";
  buyer: string;
  buyerCountry: string;
  title: string;
  publishedAt: string;
  url: string;
  cpv: string[];
  noticeType: string;
  theme: string;
  score: number;
};

const secUniverse = [
  "NVDA", "MSFT", "AMZN", "GOOGL", "META", "AAPL", "AVGO", "AMD", "ORCL", "CRM",
  "JPM", "GS", "BAC", "XOM", "CVX", "GEV", "ETN", "CSCO", "UPS", "FDX", "CAT",
  "ASML", "SAP", "TSM", "SHEL", "TTE", "NVO", "BABA", "TM",
] as const;

const themes = [
  { id: "ai-digital", rx: /(ai|artificial intelligence|cloud|software|data center|datacenter|semiconductor|chip|cyber|network|server)/i, cpv: /^(30|32|48|72)/, base: 88 },
  { id: "energy-grid", rx: /(energy|electric|grid|transformer|power|battery|renewable|solar|utility)/i, cpv: /^(09|31|45)/, base: 86 },
  { id: "telecom", rx: /(telecom|fiber|fibre|broadband|5g|communications|network)/i, cpv: /^(32|64)/, base: 84 },
  { id: "logistics", rx: /(logistics|transport|cargo|airport|rail|shipping|freight|warehouse)/i, cpv: /^(34|60|63)/, base: 80 },
  { id: "finance", rx: /(bank|financial|payment|credit|fintech|insurance)/i, cpv: /^(66)/, base: 78 },
] as const;

function classify(text: string, cpv: string[] = []) {
  let best = { theme: "general", score: 58 };
  for (const theme of themes) {
    const textHit = theme.rx.test(text);
    const cpvHit = cpv.some((code) => theme.cpv.test(code));
    if (textHit || cpvHit) {
      const score = Math.min(98, theme.base + (textHit && cpvHit ? 6 : 0));
      if (score > best.score) best = { theme: theme.id, score };
    }
  }
  return best;
}

function multiText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(multiText).find(Boolean) ?? "";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["eng", "ENG", "mul", "MUL"]) {
      const text = multiText(record[key]);
      if (text) return text;
    }
    for (const item of Object.values(record)) {
      const text = multiText(item);
      if (text) return text;
    }
  }
  return "";
}

function secUrl(cik: number, accession: string, primaryDocument: string) {
  const clean = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${clean}/${primaryDocument}`;
}

export async function fetchSecDisclosures(): Promise<GlobalDisclosure[]> {
  const headers = {
    "user-agent": "ShadowGraph market intelligence https://shadowalpha.online",
    accept: "application/json",
  };
  const tickersResponse = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!tickersResponse.ok) throw new Error(`SEC tickers ${tickersResponse.status}`);
  const tickerJson = await tickersResponse.json();
  const byTicker = new Map<string, { cik: number; title: string }>();
  for (const value of Object.values(tickerJson as Record<string, any>)) {
    const ticker = String(value?.ticker ?? "").toUpperCase();
    if (secUniverse.includes(ticker as typeof secUniverse[number])) {
      byTicker.set(ticker, { cik: Number(value.cik_str), title: String(value.title ?? ticker) });
    }
  }

  const fetchCompany = async ([symbol, meta]: [string, { cik: number; title: string }]) => {
    const cik10 = String(meta.cik).padStart(10, "0");
    const response = await fetch(`https://data.sec.gov/submissions/CIK${cik10}.json`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SEC ${symbol} ${response.status}`);
    const json = await response.json();
    const recent = json?.filings?.recent ?? {};
    const forms: string[] = recent.form ?? [];
    const dates: string[] = recent.filingDate ?? [];
    const accessions: string[] = recent.accessionNumber ?? [];
    const docs: string[] = recent.primaryDocument ?? [];
    const descriptions: string[] = recent.primaryDocDescription ?? [];
    const rows: GlobalDisclosure[] = [];
    for (let i = 0; i < Math.min(forms.length, 80); i += 1) {
      const form = String(forms[i] ?? "");
      if (!["8-K", "10-Q", "10-K", "6-K", "20-F", "40-F"].includes(form)) continue;
      const filedAt = String(dates[i] ?? "");
      const ageDays = (Date.now() - Date.parse(filedAt + "T00:00:00Z")) / 86_400_000;
      if (!Number.isFinite(ageDays) || ageDays > 45) continue;
      const title = String(descriptions[i] || `${meta.title} ${form} filing`);
      const classified = classify(`${meta.title} ${title}`);
      rows.push({
        id: `sec:${accessions[i]}`,
        region: "US",
        source: "SEC EDGAR",
        symbol,
        company: meta.title,
        form,
        filedAt,
        title,
        url: secUrl(meta.cik, String(accessions[i] ?? ""), String(docs[i] ?? "")),
        theme: classified.theme,
        score: Math.min(100, classified.score + (form === "8-K" ? 5 : 0)),
      });
      if (rows.length >= 5) break;
    }
    return rows;
  };

  // SEC asks automated clients to stay within fair-access request rates.
  // Fetch in small batches instead of firing the whole issuer universe at once.
  const entries = [...byTicker.entries()];
  const settled: PromiseSettledResult<GlobalDisclosure[]>[] = [];
  for (let index = 0; index < entries.length; index += 4) {
    const batch = await Promise.allSettled(entries.slice(index, index + 4).map(fetchCompany));
    settled.push(...batch);
    if (index + 4 < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
  }

  return settled
    .filter((x): x is PromiseFulfilledResult<GlobalDisclosure[]> => x.status === "fulfilled")
    .flatMap((x) => x.value)
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
    .slice(0, 120);
}

export async function fetchTedProcurement(): Promise<GlobalProcurement[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  const body = {
    query: `PD>=${since} SORT BY publication-date DESC`,
    fields: [
      "publication-number",
      "notice-title",
      "buyer-name",
      "buyer-country",
      "publication-date",
      "classification-cpv",
      "notice-type",
    ],
    page: 1,
    limit: 200,
    scope: "ACTIVE",
    checkQuerySyntax: false,
    paginationMode: "PAGE_NUMBER",
  };
  const response = await fetch("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "ShadowGraph/6.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`TED ${response.status}`);
  const json = await response.json();
  const notices = Array.isArray(json?.notices) ? json.notices : [];
  return notices.map((notice: any) => {
    const id = String(notice["publication-number"] ?? "");
    const title = multiText(notice["notice-title"]);
    const buyer = multiText(notice["buyer-name"]);
    const countryRaw = notice["buyer-country"];
    const buyerCountry = Array.isArray(countryRaw) ? String(countryRaw[0] ?? "") : String(countryRaw ?? "");
    const cpv = Array.isArray(notice["classification-cpv"])
      ? [...new Set(notice["classification-cpv"].map((x: unknown) => String(x)))] as string[]
      : [];
    const classified = classify(`${title} ${buyer}`, cpv);
    return {
      id: `ted:${id}`,
      region: "EU" as const,
      source: "TED" as const,
      buyer,
      buyerCountry,
      title,
      publishedAt: String(notice["publication-date"] ?? "").slice(0, 10),
      url: `https://ted.europa.eu/en/notice/-/detail/${id}`,
      cpv,
      noticeType: String(notice["notice-type"] ?? ""),
      theme: classified.theme,
      score: classified.score,
    };
  }).filter((item: GlobalProcurement) => item.id !== "ted:" && item.title);
}

export async function fetchGlobalOfficialSignals() {
  const cacheKey = "cache:global-official:v3";
  const cached = await db
    .selectFrom("mppStore")
    .select(["value", "updatedAt"])
    .where("key", "=", cacheKey)
    .executeTakeFirst()
    .catch(() => undefined);
  const cacheAge = cached?.updatedAt
    ? Date.now() - new Date(cached.updatedAt as unknown as string | Date).getTime()
    : Number.POSITIVE_INFINITY;
  if (cached?.value && cacheAge < 300_000) {
    return cached.value as unknown as {
      fetchedAt: string;
      disclosures: GlobalDisclosure[];
      procurement: GlobalProcurement[];
      sources: { sec: string; ted: string };
    };
  }

  const [sec, ted] = await Promise.allSettled([
    fetchSecDisclosures(),
    fetchTedProcurement(),
  ]);
  if (sec.status === "rejected") console.warn("SEC source unavailable", String(sec.reason?.message ?? sec.reason));
  if (ted.status === "rejected") console.warn("TED source unavailable", String(ted.reason?.message ?? ted.reason));
  const output = {
    fetchedAt: new Date().toISOString(),
    disclosures: sec.status === "fulfilled" ? sec.value : [],
    procurement: ted.status === "fulfilled" ? ted.value : [],
    sources: {
      sec: sec.status === "fulfilled" ? (sec.value.length ? "ok" : "empty") : "error",
      ted: ted.status === "fulfilled" ? (ted.value.length ? "ok" : "empty") : "error",
    },
  };
  if (sec.status === "fulfilled" || ted.status === "fulfilled") {
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
