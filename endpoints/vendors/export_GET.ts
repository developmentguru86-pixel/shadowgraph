import { getVendorScan } from "../../helpers/vendorBulkScan";
import { vendorCsv } from "../../helpers/vendorList";

export async function handle(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return new Response("not found", { status: 404 });
  const scan = await getVendorScan(id);
  if (!scan) return new Response("not found", { status: 404 });
  const name = `ict-third-parties-${(scan.company ?? "scan").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${scan.createdAt.slice(0, 10)}.csv`;
  return new Response(vendorCsv(scan.rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
