import superjson from "superjson";
import type { InfraNode, OutputType } from "./infra_GET.schema";

async function fetchList(path: string) {
  const response = await fetch(`https://www.peeringdb.com/api/${path}`, {
    headers: { accept: "application/json", "user-agent": "ShadowGraph/2.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`PeeringDB ${response.status}`);
  return response.json();
}

export async function handle() {
  try {
    const [facilityData, exchangeData] = await Promise.all([
      fetchList("fac?country=TR&limit=250"),
      fetchList("ix?country=TR&limit=250"),
    ]);

    const facilities: InfraNode[] = (facilityData?.data ?? []).map((item: any) => ({
      id: `fac-${item.id}`,
      type: "facility",
      name: String(item.name ?? "Unknown facility"),
      city: String(item.city ?? "Türkiye"),
      website: item.website ? String(item.website) : null,
    }));
    const exchanges: InfraNode[] = (exchangeData?.data ?? []).map((item: any) => ({
      id: `ix-${item.id}`,
      type: "exchange",
      name: String(item.name ?? "Unknown exchange"),
      city: String(item.city ?? "Türkiye"),
      website: item.website ? String(item.website) : null,
    }));

    const output: OutputType = {
      fetchedAt: new Date().toISOString(),
      facilities,
      exchanges,
    };
    return new Response(superjson.stringify(output), {
      headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return new Response(
      superjson.stringify({ error: error instanceof Error ? error.message : "Infrastructure source unavailable" }),
      { status: 502 },
    );
  }
}