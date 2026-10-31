import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";

/**
 * Directory behind the public "Is X down?" status pages (/status/:provider).
 * A provider page covers every monitored service that depends on that provider for hosting, CDN/edge or DNS.
 * Any other slug is matched against service names (e.g. /status/github covers all GitHub endpoints).
 */
export type ProviderDef = {
  slug: string; name: string; kind: "cloud" | "edge" | "hosting" | "platform";
  hosting?: RegExp; cdn?: RegExp; dns?: RegExp; regions?: boolean; blurb: string;
};

const PROVIDERS: ProviderDef[] = [
  { slug: "aws", name: "AWS", kind: "cloud", hosting: /^Amazon Web Services$/, cdn: /CloudFront/, dns: /AWS Route 53/, regions: true,
    blurb: "Amazon Web Services: EC2, S3, DynamoDB, CloudFront and Route 53, with native regional canaries." },
  { slug: "google-cloud", name: "Google Cloud", kind: "cloud", hosting: /^Google Cloud$/, dns: /Google Cloud DNS/, regions: true,
    blurb: "Google Cloud Platform, including Cloud Run regional endpoints and Google front ends." },
  { slug: "azure", name: "Microsoft Azure", kind: "cloud", hosting: /^Microsoft Azure$/, cdn: /Azure/, dns: /Azure DNS/,
    blurb: "Microsoft Azure hosting, Front Door and Azure DNS." },
  { slug: "cloudflare", name: "Cloudflare", kind: "edge", cdn: /^Cloudflare$/, dns: /^Cloudflare$/,
    blurb: "Cloudflare's edge network (CDN, proxy, WAF) and authoritative DNS." },
  { slug: "akamai", name: "Akamai", kind: "edge", cdn: /^Akamai$/, dns: /Akamai Edge DNS/, hosting: /Akamai \(Linode\)/,
    blurb: "Akamai's CDN and Edge DNS, plus Akamai Cloud (Linode) hosting." },
  { slug: "fastly", name: "Fastly", kind: "edge", cdn: /^Fastly$/, blurb: "Fastly's edge cloud and CDN." },
  { slug: "oracle-cloud", name: "Oracle Cloud", kind: "cloud", hosting: /^Oracle Cloud$/, dns: /Oracle Dyn/, blurb: "Oracle Cloud Infrastructure and Dyn DNS." },
  { slug: "hetzner", name: "Hetzner", kind: "hosting", hosting: /^Hetzner$/, dns: /^Hetzner$/, blurb: "Hetzner cloud and dedicated hosting in Germany and Finland." },
  { slug: "ovhcloud", name: "OVHcloud", kind: "hosting", hosting: /^OVHcloud$/, dns: /^OVHcloud$/, blurb: "OVHcloud hosting and DNS." },
  { slug: "digitalocean", name: "DigitalOcean", kind: "hosting", hosting: /^DigitalOcean$/, blurb: "DigitalOcean droplets, apps and managed services." },
  { slug: "vercel", name: "Vercel", kind: "platform", cdn: /^Vercel$/, blurb: "Vercel's frontend cloud and edge network." },
  { slug: "netlify", name: "Netlify", kind: "platform", cdn: /^Netlify$/, blurb: "Netlify's web platform and edge." },
  { slug: "imperva", name: "Imperva", kind: "edge", cdn: /Imperva/, blurb: "Imperva (Incapsula) CDN and web application firewall." },
];

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Correct brand casing for titles rendered before live data arrives (SEO: server HTML). */
const BRAND_NAMES: Record<string, string> = {
  github: "GitHub", gitlab: "GitLab", openai: "OpenAI", chatgpt: "ChatGPT", paypal: "PayPal", linkedin: "LinkedIn",
  youtube: "YouTube", tiktok: "TikTok", whatsapp: "WhatsApp", hubspot: "HubSpot", sendgrid: "SendGrid", mongodb: "MongoDB",
  pagerduty: "PagerDuty", circleci: "CircleCI", digitalocean: "DigitalOcean", huggingface: "Hugging Face", elevenlabs: "ElevenLabs",
  icloud: "iCloud", ebay: "eBay", airbnb: "Airbnb", docusign: "DocuSign", playstation: "PlayStation", bitpanda: "Bitpanda",
  coinbase: "Coinbase", binance: "Binance", deepseek: "DeepSeek", npm: "npm", pypi: "PyPI", "docker": "Docker", x: "X",
  n26: "N26", okx: "OKX", tradingview: "TradingView", stackoverflow: "Stack Overflow", wordpress: "WordPress",
};

export type Dependency = "hosting" | "cdn" | "dns";

export const statusDirectory = {
  providers: PROVIDERS,
  brandName(slug: string) {
    return BRAND_NAMES[slug] ?? null;
  },
  provider(slug: string) {
    return PROVIDERS.find((p) => p.slug === slug) ?? null;
  },
  /** services depending on a provider, with the layer(s) through which they depend on it */
  dependents(p: ProviderDef, services: RadarServiceRow[]) {
    const out: Array<{ service: RadarServiceRow; via: Dependency[] }> = [];
    for (const s of services) {
      const via: Dependency[] = [];
      if (p.hosting && s.hostingProvider && p.hosting.test(s.hostingProvider)) via.push("hosting");
      if (p.cdn && s.cdn && p.cdn.test(s.cdn)) via.push("cdn");
      if (p.dns && s.dnsProvider && p.dns.test(s.dnsProvider)) via.push("dns");
      if (via.length) out.push({ service: s, via });
    }
    return out;
  },
  /** services matching a brand slug, e.g. "github" -> GitHub API, GitHub Packages, ... */
  servicesFor(slug: string, services: RadarServiceRow[]) {
    return services.filter((s) => {
      if (s.category === "Cloud region canary") return false;
      const n = slugify(s.name);
      return n === slug || n.startsWith(`${slug}-`);
    });
  },
  /** brand slugs worth a page: first word(s) of service names that are not providers */
  popularServices(services: RadarServiceRow[], limit = 60) {
    const seen = new Map<string, string>();
    for (const s of services) {
      if (s.category === "Cloud region canary") continue;
      const slug = slugify(s.name).split("-")[0];
      if (slug.length < 2 || PROVIDERS.some((p) => p.slug === slug) || seen.has(slug)) continue;
      seen.set(slug, s.name.split(" ")[0]);
    }
    return [...seen.entries()].slice(0, limit).map(([slug, name]) => ({ slug, name }));
  },
};
