import { useQuery } from "@tanstack/react-query";
import { getResearchOverview } from "../endpoints/research/overview_GET.schema";
import { getUpstreamSignals } from "../endpoints/upstream/signals_GET.schema";

/** Shared, cached data for the Research section and the Upstream Signals page (one request per session per source). */
export function useResearchOverview() {
  return useQuery({ queryKey: ["research-overview"], queryFn: getResearchOverview, staleTime: 5 * 60_000, retry: 1 });
}

export function useUpstreamSignals() {
  return useQuery({ queryKey: ["upstream-signals"], queryFn: getUpstreamSignals, staleTime: 60_000, refetchInterval: 120_000, retry: 1 });
}
