import { z } from "zod";

export const schema = z.object({
  /** Pasted list or file contents: CSV / TSV / semicolon, or one domain per line. */
  text: z.string().min(3).max(200_000),
  company: z.string().max(120).optional(),
  email: z.string().max(200).optional(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { id: string; accepted: number; rejected: string[]; truncated: number } | { error: string; rejected?: string[] };

export const postVendorScanStart = async (body: InputType): Promise<OutputType> => {
  const r = await fetch("/_api/vendors/scan_start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};
