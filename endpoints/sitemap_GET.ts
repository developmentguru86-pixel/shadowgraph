import { featuredStatusSlugs } from "../helpers/statusPage";
import { DIRECTORY_LETTERS } from "../helpers/statusLetters";
import { SITE_URL } from "../helpers/site";
import { companyDependencies } from "../helpers/companyDependencies";
import { BOARD_TEMPLATES } from "../helpers/boardTemplates";

// Served at /sitemap.xml (dynamic: one status page per monitored service). Cached 1 h by the platform.
const PAGES: Array<[string, string, string?]> = [
  ["/", "hourly", "1.0"], ["/radar", "always", "1.0"], ["/check", "daily", "1.0"], ["/vendors", "weekly", "0.9"], ["/is-it-down", "always", "0.9"], ["/pricing", "weekly", "0.9"],
  ["/alerts", "weekly", "0.9"], ["/outlook", "hourly", "0.8"], ["/report", "daily", "0.8"], ["/signals", "always", "0.8"], ["/research", "hourly", "0.8"],
  ["/research/shared-fate", "daily", "0.7"], ["/research/upstream-signals", "daily", "0.7"], ["/research/radar-accuracy", "daily", "0.7"], ["/research/php2shell", "monthly", "0.8"],
  ["/research/concentration", "daily", "0.7"], ["/research/concentration-signal", "weekly", "0.7"], ["/research/methods", "weekly", "0.6"], ["/research/data", "daily", "0.6"], ["/data", "weekly", "0.6"],
  ["/companies", "daily", "0.8"], ["/boards", "weekly", "0.8"],
  ...BOARD_TEMPLATES.map((t) => [`/boards/${t.slug}`, "always", "0.7"] as [string, string, string]),
  ["/de/ist-es-down", "always", "0.9"], ["/docs", "weekly", "0.8"],
  ["/dora/incident-classification", "monthly", "0.9"], ["/de/dora/vorfall-klassifizierung", "monthly", "0.9"],
  ["/openapi.json", "daily"], ["/server.json", "daily"],
];

export async function handle(_request: Request) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // only the status pages with real demand and history; the long tail stays live with noindex (helpers/statusPage)
  const slugs = await featuredStatusSlugs();
  // company pages: listed filers and every customer with two or more suppliers (single-mention pages stay out of the sitemap)
  const companies = (await companyDependencies.index().catch(() => [])).filter((c) => c.customers > 0 || c.suppliers >= 2);
  const urls = [
    ...PAGES.map(([p, f, pr]) => `<url><loc>${SITE_URL}${p}</loc><changefreq>${f}</changefreq>${pr ? `<priority>${pr}</priority>` : ""}</url>`),
    ...DIRECTORY_LETTERS.flatMap((l) => [`${SITE_URL}/is-it-down/${l}`, `${SITE_URL}/de/ist-es-down/${l}`]).map((u) => `<url><loc>${u}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`),
    ...slugs.en.map((s) => `<url><loc>${SITE_URL}/status/${esc(s)}</loc><changefreq>hourly</changefreq><priority>0.7</priority></url>`),
    ...slugs.de.map((s) => `<url><loc>${SITE_URL}/de/status/${esc(s)}</loc><changefreq>hourly</changefreq><priority>0.6</priority></url>`),
    ...companies.map((c) => `<url><loc>${SITE_URL}/company/${esc(c.slug)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
