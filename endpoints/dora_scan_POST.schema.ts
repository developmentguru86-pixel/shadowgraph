import { z } from "zod";
import type { VendorFinding, ScanSummary } from "../helpers/vendorScan";

export const schema = z.object({ domains: z.array(z.string().min(3).max(260)).min(1).max(10) });
export type OutputType =
  | { findings: VendorFinding[]; summary: ScanSummary; scannedAt: string; rejected: string[] }
  | { error: string };

export const postDoraScan = async (body: z.infer<typeof schema>): Promise<OutputType> => {
  const r = await fetch("/_api/dora/scan", { method: "POST", body: JSON.stringify(body) });
  return r.json();
};