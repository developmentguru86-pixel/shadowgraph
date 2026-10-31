import { z } from "zod";

export const schema = z.object({});
export type OutputType = { ran: boolean; targets?: number; rows?: number; failed?: number };
