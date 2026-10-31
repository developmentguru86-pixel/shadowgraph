import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { OPERATOR } from "../helpers/site";
import styles from "./privacy.module.css";

/** Privacy notice (GDPR Art. 13): what personal data the site processes, why, with whom, for how long. */
export default function Privacy() {
  return (
    <>
      <Helmet><title>Privacy notice · ShadowGraph</title><meta name="description" content="What personal data ShadowGraph processes, why, and your rights." /></Helmet>
      <SiteHeader />
      <main className={styles.page}>
        <span className={styles.eyebrow}>Legal</span>
        <h1 className={styles.h1}>Privacy notice</h1>
        <p className={styles.muted}>Last updated 18 October 2026</p>

        <h2>Who is responsible</h2>
        <p>{OPERATOR.name}, {OPERATOR.address}.{OPERATOR.email ? <> Contact: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.</> : ""}</p>

        <h2>Visiting the site</h2>
        <p>We do not use cookies and store nothing on your device for tracking. To count visitors we compute a daily anonymous fingerprint from your IP address and browser identifier, hashed with a secret that changes every day; neither the IP address nor the browser identifier is stored, and fingerprints cannot be linked across days. We store the pages viewed, the referring website, an approximate country and the device type. Legal basis: our legitimate interest in understanding how the site is used (Art. 6(1)(f) GDPR). Aggregated counts are kept; daily fingerprints are not linkable to a person.</p>
        <p>Our application hosting provider (running on Amazon Web Services) processes technical request data such as IP addresses in server logs to deliver the site and keep it secure, and counts page views without storing anything on your device.</p>

        <h2>Vendor Map scans</h2>
        <p>If you scan a vendor list on /vendors we store the list (vendor names, websites, functions, criticality), the scan results, the optional company name and work email you enter, and a one-way hash of your IP address for rate limiting. The results are reachable only through the unguessable link created for the scan and are deleted automatically after 30 days. If you buy the assessment report for a scan, the scan, the report and the billing email from the payment are kept for 12 months so you can download the report again; payment and invoice data are processed by Stripe. Only public information about the vendors is read (DNS, network ownership, TLS certificates, domain registration data). Legal basis: providing the scan you requested (Art. 6(1)(b) GDPR); for the optional email, our legitimate interest in replying to you (Art. 6(1)(f) GDPR).</p>
        <h2>Free alerts</h2>
        <p>If you ask for a free alert we store your email address, the service you want to watch, the page you signed up on and the time of sign-up and confirmation. We only send the confirmation email until you click its link (double opt-in), then alert emails for that service. Every email has a one-click unsubscribe link; after unsubscribing we keep the address only as unsubscribed so we do not email it again. Legal basis: your consent (Art. 6(1)(a) GDPR), which you can withdraw at any time by unsubscribing. Emails are sent through Amazon Simple Email Service via our hosting platform.</p>
        <p>The free concentration watch on company pages works the same way: we store your email address, the companies you watch (up to 10) and the times of sign-up and confirmation, send a confirmation email first (double opt-in) and then an email when a new annual report changes a watched company's major customers. One-click unsubscribe in every email. Legal basis: your consent (Art. 6(1)(a) GDPR).</p>

        <h2>Paid plans</h2>
        <p>Payments are handled by Stripe. We receive your email address, the subscription status and the alert channels you configure (for example Slack or Teams webhook addresses); we never see your card details. Legal basis: performance of the contract (Art. 6(1)(b) GDPR) and legal retention duties for invoices.</p>
        <p>Subscribers can add their own endpoints (a name and a URL) to be checked every 5 minutes, and Team subscribers can publish status boards with a title, logo address, colour, note and the services and endpoints they choose. Endpoint URLs are never shown publicly; a board shows endpoint names only and is reachable through an unguessable link that the subscriber shares. Check results are kept for 100 days so a board can export monthly availability evidence. People who open a board are counted like any other visitor (see above); nothing else is recorded about them.</p>

        <h2>Searches and the board builder</h2>
        <p>Search terms and board previews are processed to answer the request and are not stored with any personal reference. A one-way hash of your IP address is kept for at most one hour to limit abuse.</p>

        <h2>Recipients and transfers</h2>
        <p>Processors: our application hosting provider, Amazon Web Services (servers, content delivery, email sending), Neon (database), Stripe (payments). Some of them are based in the United States; transfers rely on the EU–US Data Privacy Framework or standard contractual clauses.</p>

        <h2>Your rights</h2>
        <p>You can ask for access, correction, deletion, restriction, data portability and object to processing based on legitimate interest. You can also complain to a data protection authority, in Austria the Datenschutzbehörde (dsb.gv.at).</p>

        <h2>What we measure about other services</h2>
        <p>The outage radar probes public service endpoints of companies, not people. It does not collect personal data.</p>
      </main>
      <SiteFooter />
    </>
  );
}
