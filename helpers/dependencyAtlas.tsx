export type AtlasEvent = { id: string; title: string; url: string; source: string; publishedAt: string; kind: "filing" | "procurement" | "news" };
export type AtlasChannel = {
 id: string; title: string; layer: string; terms: string[]; trigger: string;
 stages: Array<{ name: string; mechanism: string; metric: string; horizon: string }>;
 upside: string; downside: string; invalidation: string; alternative: string;
 source: { title: string; url: string; year: string };
};
const channels: AtlasChannel[] = [
 {
  "id": "ai-power",
  "title": "AI → power infrastructure",
  "layer": "Energy & digital",
  "terms": [
   "data center",
   "data centre",
   "datacenter",
   "artificial intelligence",
   "ai infrastructure"
  ],
  "trigger": "If data-center capacity or computing demand increases",
  "stages": [
   {
    "name": "Data-center load",
    "mechanism": "New computing capacity can increase power density and demand for uninterrupted electricity.",
    "metric": "Commissioned MW; actual electricity consumption",
    "horizon": "Commissioning schedule"
   },
   {
    "name": "Grid connection",
    "mechanism": "Limited local connection capacity can leave new centers waiting for power.",
    "metric": "Connection queue; permits; commissioning dates",
    "horizon": "Months–years · model assumption"
   },
   {
    "name": "Transformers, cables and power equipment",
    "mechanism": "Capacity gaps may generate equipment orders and shift bottlenecks to delivery lead times.",
    "metric": "Binding orders; lead times; cancellation rate",
    "horizon": "Quarters–years · model assumption"
   }
  ],
  "upside": "Grid-equipment and power-infrastructure suppliers, conditional on confirmed orders, capacity and margins.",
  "downside": "Data-center projects waiting for connections and operators unable to pass on costs.",
  "invalidation": "Cancellations, low utilization or efficiency gains that offset additional load weaken the chain.",
  "alternative": "Grid renewal or industrialization may explain equipment demand instead of AI.",
  "source": {
   "title": "IEA · Energy and AI",
   "url": "https://www.iea.org/reports/energy-and-ai/executive-summary",
   "year": "2025"
  }
 },
 {
  "id": "shipping",
  "title": "Shipping routes → capacity → costs",
  "layer": "Logistics & trade",
  "terms": [
   "red sea",
   "suez",
   "shipping",
   "freight",
   "maritime",
   "panama"
  ],
  "trigger": "If shipping routes lengthen or passage restrictions arise",
  "stages": [
   {
    "name": "Strait / canal passage",
    "mechanism": "Restrictions or avoidance may divert vessels to longer routes.",
    "metric": "Passage counts; share of diverted vessels",
    "horizon": "Days–weeks · model assumption"
   },
   {
    "name": "Effective vessel capacity",
    "mechanism": "Longer round trips can reduce the number of voyages the same fleet can complete.",
    "metric": "Voyage duration; port waiting; tonne-miles",
    "horizon": "Weeks · model assumption"
   },
   {
    "name": "Freight and operating costs",
    "mechanism": "Tight capacity can increase rates while fuel and insurance costs may also rise.",
    "metric": "Route-level spot freight; fuel; insurance",
    "horizon": "Weeks–months · model assumption"
   }
  ],
  "upside": "Carriers with capacity on the affected routes; higher freight rates alone do not establish higher profits.",
  "downside": "Import-dependent manufacturers and inventory-carrying businesses, subject to contract terms.",
  "invalidation": "Normal passage, weaker demand or new vessel capacity may eliminate pricing pressure.",
  "alternative": "Seasonality, strikes or trade policy can also explain rising freight rates.",
  "source": {
   "title": "UNCTAD · Review of Maritime Transport",
   "url": "https://unctad.org/publication/review-maritime-transport-2025",
   "year": "2025"
  }
 },
 {
  "id": "dollar",
  "title": "Dollar → funding → investment",
  "layer": "Funding",
  "terms": [
   "dollar",
   "dxy",
   "capital flows",
   "foreign debt",
   "usd debt"
  ],
  "trigger": "If the broad dollar strengthens and funding conditions tighten",
  "stages": [
   {
    "name": "Dollar and capital flows",
    "mechanism": "Dollar movements may affect global investors' capacity to take risk.",
    "metric": "Broad dollar index; country-level fund flows",
    "horizon": "Days–weeks · model assumption"
   },
   {
    "name": "Refinancing conditions",
    "mechanism": "Currency mismatches and reliance on foreign investors may amplify funding pressure.",
    "metric": "Debt currency; maturity; hedges; credit spreads",
    "horizon": "Debt maturity schedule"
   },
   {
    "name": "Investment capacity",
    "mechanism": "Tight funding may constrain investments that rely on external capital.",
    "metric": "Realized investment; credit growth; deferred projects",
    "horizon": "Quarters · model assumption"
   }
  ],
  "upside": "Businesses with lower external funding needs and aligned foreign-currency cash flows may be more resilient.",
  "downside": "Businesses with unhedged foreign-currency debt and near-term refinancing needs.",
  "invalidation": "Natural hedges, central-bank intervention or strong local funding may weaken transmission.",
  "alternative": "Country-specific political risk or balance-sheet deterioration may create the same spread movement.",
  "source": {
   "title": "BIS · The US dollar and capital flows to EMEs",
   "url": "https://www.bis.org/publications/qr-202409/us-dollar-and-capital-flows-emes",
   "year": "2024"
  }
 },
 {
  "id": "capital-ai",
  "title": "Funding → data centers → energy",
  "layer": "Funding & energy",
  "terms": [
   "data center",
   "data centre",
   "datacenter",
   "ai investment",
   "ai capex",
   "hyperscaler"
  ],
  "trigger": "If funding conditions for data-center investments change",
  "stages": [
   {
    "name": "Capital-market access",
    "mechanism": "Large investment programs may depend on external funding and return expectations.",
    "metric": "Financial close; borrowing cost; binding investment",
    "horizon": "Transaction schedule"
   },
   {
    "name": "Construction and capacity schedule",
    "mechanism": "Funding problems can delay projects; announced budgets are not realized investment.",
    "metric": "Construction starts; cancellations; commissioned MW",
    "horizon": "Months–years · model assumption"
   },
   {
    "name": "Energy and equipment demand",
    "mechanism": "Changes to project schedules may advance or defer connection and equipment needs.",
    "metric": "Order changes; power agreements; connection date",
    "horizon": "Project-dependent"
   }
  ],
  "upside": "Projects with financing closed and suppliers with firm orders may have a relative advantage.",
  "downside": "Unfunded projects and capacity expansion based only on statements of intent.",
  "invalidation": "Sensitivity decreases if investments are fully cash-funded or financing is already fixed.",
  "alternative": "Permitting, chip availability or grid bottlenecks may explain delays instead of funding.",
  "source": {
   "title": "IEA · Key Questions on Energy and AI",
   "url": "https://www.iea.org/reports/key-questions-on-energy-and-ai/executive-summary",
   "year": "2026"
  }
 }
];
function matching(text: string, channel: AtlasChannel) {
 const value = text.toLocaleLowerCase("en-US");
 return channel.terms.some(term => value.includes(term));
}
function recent(events: AtlasEvent[], now: number) {
 const seen = new Set<string>();
 return events.filter(event => {
  const t = Date.parse(event.publishedAt);
  if (!event.url || !Number.isFinite(t) || t > now || now - t > 30 * 86400000) return false;
  const key = event.url.replace(/[?#].*$/, "");
  if (seen.has(key)) return false;
  seen.add(key); return true;
 }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
}
export const dependencyAtlas = {
 channels, matching,
 analyze(events: AtlasEvent[], now = Date.now()) {
  const eligible = recent(events, now);
  return channels.map(channel => ({
   ...channel, matches: eligible.filter(event=>matching(event.title,channel)).slice(0,12),
   status: "hypothesis" as const,
   pricingStatus: "not_assessed" as const,
   reason: "A title match is only a research candidate, not verification of event direction, contracts or causality."
  }));
 }
};