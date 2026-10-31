import { z } from "zod";

export const schema = z.object({});
export type OutputType = { ran: boolean; at?: string; source?: string; eligible?: number; added?: number; changed?: number; unchanged?: number; failed?: number; removed?: number };
