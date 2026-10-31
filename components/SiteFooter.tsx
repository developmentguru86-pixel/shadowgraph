import { BrandMark } from "./SiteHeader";
import { STAGES, BUILD_LINKS } from "../helpers/productMap";
import { GEO_ATTRIBUTION } from "../helpers/licensing";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <a href="/" className={styles.brand}><BrandMark size={20} /><span>ShadowGraph</span></a>
          <p className={styles.tag}>Infrastructure dependency intelligence: map what you rely on, watch it live, prove what happened and price what it costs. Built in the Vienna region, Austria.</p>
          <div className={styles.build}>
            {BUILD_LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
            <a href="/openapi.json">OpenAPI</a>
            <a href="/server.json">MCP server</a>
          </div>
        </div>
        {STAGES.map((s) => (
          <div className={styles.col} key={s.key}>
            <span className={styles.head}><b>{s.n}</b> {s.name}</span>
            {s.links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
            {s.key === "monitoring" && <a href="/de/ist-es-down" hrefLang="de" lang="de">Ist es down? (Deutsch)</a>}
          </div>
        ))}
      </div>
      <div className={styles.base}>
        <span>© {new Date().getUTCFullYear()} ShadowGraph · <a href="/privacy">Privacy</a></span>
        <span>Live data from public internet infrastructure and official filings. No fabricated metrics.</span>
        <span>Independent monitoring: not affiliated with or endorsed by the services shown; trademarks belong to their owners. <a href={GEO_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">{GEO_ATTRIBUTION.text}</a> ({GEO_ATTRIBUTION.licence}).</span>
      </div>
    </footer>
  );
}