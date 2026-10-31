import type { VendorScanView } from "../../helpers/vendorBulkScan";

export type OutputType = VendorScanView;

export const getVendorScan = async (id: string): Promise<OutputType> => {
  const r = await fetch(`/_api/vendors/scan?id=${encodeURIComponent(id)}`);
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error("Scan unavailable");
  return r.json();
};
