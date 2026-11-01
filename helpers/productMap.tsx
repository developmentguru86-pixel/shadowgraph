/**
 * One product, one chain. Every page of ShadowGraph belongs to exactly one step:
 * map what you depend on → monitor it live → prove what happened → price what it costs.
 * Header, stage bar, menu, footer and homepage all read from this map, so naming stays identical everywhere.
 */
export type StageKey = "dependencies" | "monitoring" | "evidence" | "impact";
export type StageLink = { href: string; label: string; hint: string; match?: (path: string) => boolean };
export type Stage = { key: StageKey; n: string; name: string; question: string; summary: string; landing: string; links: StageLink[] };

export const STAGES: Stage[] = [
  {
    key: "dependencies", n: "01", name: "Dependencies", question: "What do you rely on?", landing: "/check",
    summary: "Map the cloud, CDN, DNS and vendors underneath your stack, your ICT third parties and the customers public companies depend on.",
    links: [
      { href: "/check", label: "Check your stack", hint: "Map your own dependencies" },
      { href: "/vendors", label: "Vendor map & DORA", hint: "Scan up to 300 ICT third parties", match: (p) => p.startsWith("/vendors") },
      { href: "/companies", label: "Company dependencies", hint: "Major customers, year by year", match: (p) => p === "/companies" || p.startsWith("/company/") },
      { href: "/report", label: "Infrastructure report", hint: "Who runs the internet?" },
      { href: "/data", label: "Dependency data", hint: "Source-backed relationships" },
    ],
  },
  {
    key: "monitoring", n: "02", name: "Monitoring", question: "What is failing right now?", landing: "/radar",
    summary: "Check 3,000+ services every 5 minutes, warn when shared providers wobble and alert your team in Slack, Teams or email.",
    links: [
      { href: "/radar", label: "Outage radar", hint: "Live incidents & dependencies" },
      { href: "/is-it-down", label: "Is it down?", hint: "Check a single service", match: (p) => p.startsWith("/is-it-down") || p.startsWith("/status/") || (p.startsWith("/de/") && !p.startsWith("/de/dora/")) },
      { href: "/signals", label: "Upstream signals", hint: "Shared-provider problems, early" },
      { href: "/outlook", label: "Risk outlook", hint: "Early warnings & exposure" },
      { href: "/alerts", label: "Stack alerts", hint: "Slack, Teams, email · free", match: (p) => p.startsWith("/alerts") || p.startsWith("/watch") },
      { href: "/boards", label: "Status boards", hint: "Branded live boards for your team", match: (p) => p.startsWith("/boards") || p.startsWith("/board/") },
    ],
  },
  {
    key: "evidence", n: "03", name: "Evidence", question: "What can be proven?", landing: "/research",
    summary: "Every claim is measured in public: radar accuracy, signal hit rates, shared-fate studies, SLA evidence and open data.",
    links: [
      { href: "/research", label: "Research overview", hint: "Findings at a glance" },
      { href: "/dora/incident-classification", label: "DORA incident check", hint: "Major or not, and when to report", match: (p) => p.startsWith("/dora/") || p.startsWith("/de/dora/") },
      { href: "/research/radar-accuracy", label: "Radar accuracy", hint: "Measured against status pages" },
      { href: "/research/upstream-signals", label: "Signal track record", hint: "How often warnings were right" },
      { href: "/research/shared-fate", label: "Shared fate", hint: "Do shared providers fail together?" },
      { href: "/research/methods", label: "Methods", hint: "Rules, limits, changelog" },
      { href: "/research/data", label: "Data access", hint: "CSV tables with a data key" },
    ],
  },
  {
    key: "impact", n: "04", name: "Impact", question: "What does it cost?", landing: "/terminal",
    summary: "Follow outages and dependency shifts into money: customer concentration, market reactions and public contracts.",
    links: [
      { href: "/terminal", label: "Intelligence terminal", hint: "Signals from official records" },
      { href: "/research/concentration", label: "Customer concentration", hint: "Who depends on whom, in filings" },
      { href: "/research/concentration-signal", label: "Customer signal test", hint: "Does concentration predict returns?" },
      { href: "/terminal#event-signals", label: "Event research", hint: "Market costs of outages" },
      { href: "/terminal#contracts", label: "Public contracts", hint: "Open EU tender notices" },
    ],
  },
];

/** Building blocks that serve every step rather than one. */
export const BUILD_LINKS: StageLink[] = [
  { href: "/docs", label: "API docs", hint: "REST reference, try it live" },
  { href: "/terminal#agents", label: "For agents", hint: "MCP & A2A access" },
  { href: "/pricing", label: "Pricing", hint: "Free tools, plans, reports" },
];

const isLinkActive = (l: StageLink, path: string) => (l.match ? l.match(path) : l.href.split("#")[0] === path && !l.href.includes("#"));

/** Which step a path belongs to; null for pages that serve the whole product (home, pricing, docs, legal). */
export function stageOf(pathname: string): Stage | null {
  const path = pathname.replace(/\/$/, "") || "/";
  // the concentration studies live under /research but answer the impact question
  const impact = STAGES[3];
  if (impact.links.some((l) => isLinkActive(l, path))) return impact;
  return STAGES.find((s) => s.links.some((l) => isLinkActive(l, path)) || (s.key === "evidence" && path.startsWith("/research"))) ?? null;
}

export const linkActive = (l: StageLink, pathname: string) => isLinkActive(l, pathname.replace(/\/$/, "") || "/");
export const nextStage = (s: Stage): Stage | null => STAGES[STAGES.indexOf(s) + 1] ?? null;