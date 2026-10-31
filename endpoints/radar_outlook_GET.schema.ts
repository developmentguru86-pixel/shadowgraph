export type OutputType = {
  generatedAt: string;
  certificates: Array<{ id: string; name: string; category: string; host: string; certNotAfter: string; certIssuer: string | null; daysLeft: number; risk: "expired" | "critical" | "renewal_overdue" | "watch" }>;
  domains: Array<{ name: string; domain: string | null; domainExpiresAt: string; domainRegistrar: string | null; daysLeft: number }>;
  coverage: { certs: number; certErrors: number; domains: number; domainErrors: number };
  warnings: Array<{ id: string; layer: string; provider: string; openedAt: string; closedAt: string | null; outcome: string | null; leadMinutes: number | null;
    evidence: { groupSize?: number; degraded?: Array<{ id: string; name: string; latencyMs: number | null; baselineMs: number | null }> } }>;
  trackRecord: { warnings: number; scored: number; confirmed: number; precision: number | null; medianLeadMinutes: number | null };
  retiredRule: { rule: string; warnings: number; scored: number; confirmed: number; retiredAt: string; reason: string } | null;
  changes: Array<{ id: string; name: string; category: string; field: string; oldValue: string | null; newValue: string | null; detectedAt: string }>;
};

export const getRadarOutlook = async (): Promise<OutputType> => {
  const r = await fetch("/_api/radar/outlook");
  if (!r.ok) throw new Error("Outlook unavailable");
  return r.json();
};