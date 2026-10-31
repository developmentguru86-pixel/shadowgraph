export type RadarServiceRow = {
  id: string; name: string; category: string; hostingProvider: string | null; hostingRegion: string | null; cdn: string | null;
  hostingCountry: string | null; emailProvider: string | null;
  dnsProvider: string | null; analyzedHost: string | null; state: "up" | "down" | "degraded" | "unknown";
  httpStatus: number | null; latencyMs: number | null; error: string | null; uptime24h: number | null; samples24h: number;
  /** City-level location from IP geolocation (DB-IP Lite), only for services whose origin server is directly visible. */
  hostingCity?: string | null; geoCountry?: string | null; hostingLat?: number | null; hostingLon?: number | null;
};
export type RadarIncident = {
  id: string; layer: string; provider: string; status: string; startedAt: string; lastSeenAt: string; resolvedAt: string | null;
  affected: Array<{ id: string; name: string }>; atRisk: Array<{ id: string; name: string }>; peakFailureShare: number;
  evidence: Record<string, unknown>;
};
export type ShareRow = { provider: string; services: number; share: number };
export type OutputType =
  | { status: "warming_up" }
  | {
      status: "live";
      run: { runId: string; at: string; total: number; up: number; degraded: number; down: number; vantageSuspect: boolean; medianLatencyMs: number | null };
      services: RadarServiceRow[];
      infrastructure: Array<{ provider: string; region: string | null; services: number; up: number; down: number; degraded: number }>;
      incidents: RadarIncident[];
      timeline: Array<{ bucket: string; checks: number; failed: number; services: number }>;
      events: Array<{ serviceId: string; name: string; at: string; ok: boolean; error: string | null; httpStatus: number | null }>;
      providers: Array<{ provider: string; services: number; up: number; errors: number; medianLatencyMs: number | null }>;
      concentration: { hosting: ShareRow[]; cdn: ShareRow[]; dns: ShareRow[]; email: ShareRow[] };
      categories: Array<{ category: string; services: number; errors: number; medianLatencyMs: number | null }>;
    };

export const getRadarStatus = async (): Promise<OutputType> => {
  const r = await fetch("/_api/radar/status");
  if (!r.ok) throw new Error("Radar status unavailable");
  return r.json();
};