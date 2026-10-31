import type { GlobalInfraNode, OutputType } from "./global_infra_GET.schema";

const countryPacks = [
  { country: "US", region: "North America" },
  { country: "DE", region: "Europe" },
  { country: "GB", region: "Europe" },
  { country: "CH", region: "Europe" },
  { country: "NL", region: "Europe" },
  { country: "SG", region: "Asia" },
  { country: "JP", region: "Asia" },
  { country: "AE", region: "Middle East" },
  { country: "TR", region: "Türkiye" },
] as const;

async function fetchList(kind: "fac" | "ix", country: string) {
  const response = await fetch(`https://www.peeringdb.com/api/${kind}?country=${country}&limit=80`, {
    headers: { accept: "application/json", "user-agent": "ShadowGraph-Global/1.0" },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) throw new Error(`PeeringDB ${kind}/${country} ${response.status}`);
  return response.json();
}

export async function handle() {
  const requests = countryPacks.flatMap((pack) => [
    { pack, kind: "fac" as const },
    { pack, kind: "ix" as const },
  ]);
  const settled = await Promise.allSettled(requests.map(async ({ pack, kind }) => ({
    pack,
    kind,
    data: await fetchList(kind, pack.country),
  })));

  const facilities: GlobalInfraNode[] = [];
  const exchanges: GlobalInfraNode[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { pack, kind, data } = result.value;
    for (const item of (data?.data ?? []).slice(0, 50)) {
      const node: GlobalInfraNode = {
        id: `${kind}-${item.id}`,
        type: kind === "fac" ? "facility" : "exchange",
        name: String(item.name ?? "Unknown"),
        city: String(item.city ?? ""),
        country: pack.country,
        region: pack.region,
        website: item.website ? String(item.website) : null,
      };
      if (kind === "fac") facilities.push(node); else exchanges.push(node);
    }
  }
  const output: OutputType = {
    fetchedAt: new Date().toISOString(),
    facilities,
    exchanges,
    countries: countryPacks.map((item) => item.country),
  };
  return new Response(JSON.stringify(output), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
  });
}