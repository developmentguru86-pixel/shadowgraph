import { useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { postRadarWaitlist } from "../endpoints/radar_waitlist_POST.schema";
import { DORA_REPORT_PRICE_LABEL } from "../helpers/promo";
import styles from "./pricing.module.css";

const PLANS: Array<{ id: string; step: string; name: string; price: string; per: string; tagline: string; features: string[]; cta: string; href: string; featured?: boolean; note?: string; demo?: string }> = [
  {
    id: "free", step: "All four steps", name: "Free", price: "$0", per: "forever", tagline: "See what your business depends on.",
    features: ["Live Outage Radar and status pages for 3,000+ services", "Check your stack: concentration grade and failure scenarios", "Vendor Map: scan up to 300 ICT vendors, CSV export", "Risk outlook: certificates, domains, early warnings", "Radar status API (JSON) and a 25-row data sample"],
    cta: "Check your stack", href: "/check",
  },
  {
    id: "alerts", step: "02 Monitoring", name: "Stack Alerts", price: "Free", per: "for a limited time (normally $29 / month)", tagline: "Know before your vendors' status pages do.", featured: true, note: "no credit card · activation link by email",
    features: ["Up to 25 services from the radar, plus 10 of your own endpoints checked every 5 minutes", "Provider incidents with the blast radius on your stack", "Early warnings when your providers degrade", "Certificate, domain and infrastructure-change alerts", "Slack, Microsoft Teams, JSON webhook and email"],
    cta: "Get free alerts", href: "/alerts",
  },
  {
    id: "team", step: "02 Monitoring · 03 Evidence", name: "Team", price: "$99", per: "per month", tagline: "Your stack's status, under your brand.", note: "14-day free trial · for IT teams and MSPs",
    features: ["Everything in Stack Alerts, for up to 100 services", "25 own endpoints checked every 5 minutes", "5 branded status boards: your logo, colour, light or dark", "SLA budget per service and a downloadable SLA evidence file", "Outages we detected before the vendor posted them, with the lead time", "Share as a link or embed in an intranet or client portal (iframe)"],
    cta: "Start free trial", href: "/alerts?plan=team", demo: "/boards",
  },
  {
    id: "dora", step: "01 Dependencies · 03 Evidence", name: "DORA Assessment", price: DORA_REPORT_PRICE_LABEL, per: "one-time per scan", tagline: "Your ICT concentration risk, ready to file.", note: "invoice with VAT ID · PDF in English and German",
    features: ["Executive summary and prioritised actions with DORA references", "Concentration per layer (hosting, region, CDN, DNS, email, CA) with HHI rating", "Shared points of failure for critical functions", "Jurisdiction per vendor (EU/EEA or third country) and exposure to ESA-designated CTPPs", "Mapping to DORA Art. 28–31 and NIS2 Art. 21, approval page", "Register annex and pre-filled register extract (CSV) with LEI candidates for up to 300 vendors"],
    cta: "Scan your vendors", href: "/vendors",
  },
  {
    id: "data", step: "04 Impact", name: "Dependency Data", price: "$99", per: "per month", tagline: "Who depends on whom, from official filings.",
    features: ["Every disclosed customer → supplier revenue dependency we can verify in SEC annual filings", "Share of revenue, fiscal period, filing date and source link on every row", "CSV download and JSON API with a private key", "Refreshed weekly as new filings arrive"],
    cta: "Get the data", href: "/data",
  },
  {
    id: "agents", step: "All steps, for agents", name: "Agent API", price: "$0.50–$5", per: "per call", tagline: "Intelligence for AI agents, paid per request.",
    features: ["MCP server and A2A agent card", "Free factual tools for discovery", "Paid deep intelligence settled per call over HTTP 402", "No subscription, no key to manage"],
    cta: "Read the docs", href: "/docs#payments",
  },
];

const FAQ: Array<[string, string]> = [
  ["How is billing handled?", "Subscriptions run through Stripe. You can change your card or cancel at any time from the billing portal linked in your alert settings; the trial ends without a charge if you cancel before day 14."],
  ["Where does the data come from?", "Public internet infrastructure (DNS, network ownership, published cloud IP ranges), live probes of public service endpoints, official SEC filings and official EU tender notices. Every finding links to or names its source."],
  ["How reliable are the alerts?", "Probes run every 5 minutes from our main node in AWS us-east-1 (N. Virginia), and failures are cross-checked from six continents every 30 minutes. A service counts as down after two consecutive failures, and a provider incident needs several independent services failing together. Early-warning accuracy is published on the Risk outlook page, including a retired rule that did not work."],
  ["Is any of this investment advice?", "No. We publish market research with its full results, including the ideas that failed our tests. Nothing on ShadowGraph is a recommendation to buy or sell."],
  ["Can I get an invoice or a custom plan?", "Yes. Use the form above; we reply within one business day."],
];

export default function PricingPage() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [need, setNeed] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const send = async () => {
    setState("sending");
    try {
      const r = await postRadarWaitlist({ email, channel: "enterprise", services: `${company} — ${need}`.slice(0, 990) });
      setState("ok" in r ? "done" : "error");
    } catch {
      setState("error");
    }
  };
  return (
    <>
      <Helmet>
        <title>Pricing · ShadowGraph</title>
        <meta name="description" content={`Free outage radar and stack check. Stack Alerts free for a limited time, Team with branded status boards $99/month with a 14-day trial. DORA assessment ${DORA_REPORT_PRICE_LABEL}. Dependency Data $99/month.`} />
        <meta property="og:title" content="ShadowGraph pricing" />
        <meta property="og:description" content="Free outage radar and stack check. Stack Alerts free for a limited time. Dependency Data $99/month. Agent API from $0.50 per call." />
      </Helmet>
      <SiteHeader active="pricing" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Pricing</span>
          <h1 className={styles.h1}>Start free. <em>Pay when it protects revenue.</em></h1>
          <p className={styles.lead}>One product in four steps: map your dependencies, monitor them, prove what happened, price what it costs. The radar, status pages and stack check are free. You pay where it protects revenue.</p>
        </header>

        <section className={styles.plans} aria-label="Plans">
          {PLANS.map((p) => (
            <article key={p.id} className={`${styles.plan} ${p.featured ? styles.featured : ""}`} id={p.id}>
              {p.featured && <span className={styles.badge}>Most popular</span>}
              <span className={styles.step}>{p.step}</span>
              <h2 className={styles.planName}>{p.name}</h2>
              <p className={styles.tagline}>{p.tagline}</p>
              <div className={styles.price}><b>{p.price}</b><span>{p.per}</span></div>
              <p className={styles.note}>{p.note ?? " "}</p>
              <a className={p.featured ? styles.ctaPrimary : styles.cta} href={p.href}>{p.cta}</a>
              {p.demo && <a className={styles.demo} href={p.demo}>See example boards</a>}
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </article>
          ))}
        </section>

        <section className={styles.enterprise} id="enterprise">
          <div>
            <span className={styles.eyebrow}>Teams & enterprise</span>
            <h2 className={styles.h2}>Need more endpoints, a private data feed or an invoice?</h2>
            <p className={styles.lead}>Larger stacks, custom service catalogs, data licensing for your platform and invoice billing. Tell us what you need.</p>
          </div>
          <div className={styles.form}>
            {state === "done" ? <p className={styles.ok}>Thank you. We will reply within one business day.</p> : (
              <>
                <input type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Work email" />
                <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" />
                <textarea rows={3} placeholder="What do you need? (e.g. 200 endpoints, a data feed for our risk platform)" value={need} onChange={(e) => setNeed(e.target.value)} aria-label="Your needs" />
                <button onClick={send} disabled={state === "sending" || !email || company.length < 2}>{state === "sending" ? "Sending…" : "Talk to us"}</button>
                {state === "error" && <p className={styles.err}>Please check the email address.</p>}
              </>
            )}
          </div>
        </section>

        <section className={styles.faq}>
          <h2 className={styles.h2}>Questions</h2>
          <dl>{FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
