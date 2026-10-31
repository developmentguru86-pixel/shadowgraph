import { db } from "../../helpers/db";
import { statusDirectory, slugify } from "../../helpers/statusDirectory";
import { renderStatusCard } from "../../helpers/ogImage";
import { statusPath } from "../../helpers/statusCopy";
import { SITE_URL } from "../../helpers/site";

// the site-wide preview image (same as components/SeoDefaults OG_IMAGE)
const OG_IMAGE = `${SITE_URL}/_cdn/static/a609bb36-fcb5-4b6c-97e2-40c18d1aaad5-og-shadowgraph.jpg`;

/** GET /_api/og/status?slug=netflix&lang=de → 1200×630 PNG link preview for one status page (cached a week at the edge). */
export async function handle(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = slugify(params.get("slug") ?? "");
  const lang = params.get("lang") === "de" ? "de" : "en";
  const de = lang === "de";
  const fallback = () => new Response(null, { status: 302, headers: { Location: OG_IMAGE, "Cache-Control": "public, s-maxage=3600" } });
  if (!slug) return fallback();
  try {
    const def = statusDirectory.provider(slug);
    let name: string | null = def?.name ?? null;
    let sub = "";
    if (def) {
      sub = de ? `Jeder Dienst auf unserem Radar, der von ${def.name} abhängt, live geprüft.` : `Every service on our radar that depends on ${def.name}, checked live.`;
    } else {
      const rows = await db.selectFrom("radarServices").select(["name", "category", "hostingProvider", "cdn"]).where("active", "=", true).execute();
      const hit = rows.find((r) => r.category !== "Cloud region canary" && slugify(r.name) === slug);
      const brand = statusDirectory.brandName(slug);
      name = hit?.name ?? brand ?? null;
      const infra = hit ? [hit.hostingProvider, hit.cdn && hit.cdn !== hit.hostingProvider ? `${hit.cdn} (CDN)` : null].filter(Boolean).join(" · ") : "";
      sub = infra
        ? (de ? `Läuft auf ${infra}. Seit wann gestört, und warum.` : `Runs on ${infra}. Down since when, and why.`)
        : (de ? "Alle 5 Minuten unabhängig geprüft: seit wann gestört, und warum." : "Checked independently every 5 minutes: down since when, and why.");
    }
    if (!name) return fallback();
    const png = await renderStatusCard({ name, lang, path: statusPath(lang, slug), sub });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
  } catch (e) {
    console.error("og image failed", e instanceof Error ? e.message : e);
    return fallback();
  }
}