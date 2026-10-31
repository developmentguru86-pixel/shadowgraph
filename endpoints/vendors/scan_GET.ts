import { getVendorScan } from "../../helpers/vendorBulkScan";

export async function handle(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const scan = await getVendorScan(id);
  if (!scan) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(scan, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
