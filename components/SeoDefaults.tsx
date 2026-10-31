import { Helmet } from "react-helmet";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "../helpers/site";

/**
 * Site-wide SEO defaults, rendered once for every route (server and client).
 * - canonical: always the shadowalpha.online URL of the current path, so the www host and any platform
 *   subdomain consolidate into one indexed URL. Pages that set their own canonical override this
 *   (react-helmet keeps the innermost rel=canonical).
 * - Open Graph / Twitter card image and site name for link previews; pages may override og:* tags.
 * - Organization + WebSite structured data on the homepage.
 */
export const OG_IMAGE = `${SITE_URL}/_cdn/static/a609bb36-fcb5-4b6c-97e2-40c18d1aaad5-og-shadowgraph.jpg`;

/** Google Search Console "HTML tag" verification code (the content value only). Empty = not rendered; DNS verification at IONOS also works. */
const GOOGLE_SITE_VERIFICATION = "";

const LD = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ShadowGraph",
    url: SITE_URL,
    description: "Independent live status and infrastructure dependency intelligence for 3,000+ internet services.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "ShadowGraph",
    alternateName: "ShadowGraph Outage Radar",
    url: `${SITE_URL}/`,
    inLanguage: ["en", "de"],
  },
];

export function SeoDefaults() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "") || "/";
  const url = path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
  const lang = path === "/de" || path.startsWith("/de/") ? "de" : "en";
  return (
    <Helmet htmlAttributes={{ lang }}>
      <link rel="canonical" href={url} />
      <meta property="og:site_name" content="ShadowGraph" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:locale" content={lang === "de" ? "de_AT" : "en_GB"} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="ShadowGraph live outage radar: is it down, since when, and why." />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content={OG_IMAGE} />
      {GOOGLE_SITE_VERIFICATION && path === "/" && <meta name="google-site-verification" content={GOOGLE_SITE_VERIFICATION} />}
      {path === "/" && <script type="application/ld+json">{JSON.stringify(LD)}</script>}
    </Helmet>
  );
}
