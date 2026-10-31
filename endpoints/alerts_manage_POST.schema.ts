import { z } from "zod";
import type { BoardSummary } from "../helpers/statusBoards";

export const schema = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["view", "update", "test", "portal", "addMonitor", "removeMonitor", "saveBoard", "removeBoard"]),
  serviceIds: z.array(z.string().max(200)).max(100).optional(),
  slack: z.string().max(500).nullable().optional(),
  teams: z.string().max(1000).nullable().optional(),
  webhook: z.string().max(1000).nullable().optional(),
  monitor: z.object({ name: z.string().max(80), url: z.string().min(4).max(2000), expect: z.enum(["any_lt_500", "success"]) }).optional(),
  monitorId: z.string().max(100).optional(),
  board: z.object({
    id: z.string().max(100).optional(), title: z.string().max(120), logoUrl: z.string().max(600).nullable().optional(),
    accent: z.string().max(9).optional(), theme: z.enum(["dark", "light"]).optional(), note: z.string().max(400).nullable().optional(),
    serviceIds: z.array(z.string().max(200)).max(60), monitorIds: z.array(z.string().max(100)).max(30), showPowered: z.boolean().optional(),
    slaTarget: z.number().nullable().optional(),
  }).optional(),
  boardId: z.string().max(100).optional(),
});
export type MonitorView = {
  id: string; name: string; url: string; expect: string; ok: boolean | null; status: number | null; latencyMs: number | null; error: string | null;
  checkedAt: string | null; downSince: string | null; uptime24h: number | null; p50Ms: number | null; samples24h: number;
  hostingProvider: string | null; hostingRegion: string | null; cdn: string | null; dnsProvider: string | null;
  certNotAfter: string | null; certIssuer: string | null; domain: string | null; domainExpiresAt: string | null;
};
export type View = {
  email: string; status: string; free?: boolean; serviceIds: string[]; slack: string | null; teams: string | null; webhook: string | null; emailEnabled: boolean;
  deliveries: Array<{ kind: string; title: string; createdAt: string; channels: Record<string, string> }>;
  monitors: MonitorView[]; monitorLimit: number;
  plan: "alerts" | "team"; planName: string; serviceLimit: number; boardLimit: number; boards: BoardSummary[];
};
export type OutputType = { view?: View; channels?: Record<string, string>; url?: string; error?: string };

export const postAlertsManage = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/alerts/manage", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};