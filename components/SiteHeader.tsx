import { useLocation } from "react-router-dom";
import styles from "./SiteHeader.module.css";
import { AppMenu } from "./AppMenu";
import { GlobalSearch } from "./GlobalSearch";
import { SectionNav } from "./SectionNav";
import { STAGES, stageOf } from "../helpers/productMap";

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.mark}>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1" />
      <path d="M12 12 L21.5 7.5" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.2" fill="var(--primary)" />
    </svg>
  );
}

type Active = "check" | "radar" | "signals" | "outlook" | "status" | "data" | "developers" | "terminal" | "pricing" | "research";

/** Site header plus the stage bar. The active step is derived from the URL, so every page is placed in the same chain. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SiteHeader(_props: { active?: Active } = {}) {
  const { pathname } = useLocation();
  const stage = stageOf(pathname);
  const path = pathname.replace(/\/$/, "") || "/";
  const link = (href: string, label: string, on: boolean) => (
    <a href={href} className={on ? styles.active : undefined} aria-current={on ? "page" : undefined}>{label}</a>
  );
  return (
    <>
    <header className={styles.header}>
      <div className={styles.inner}>
        <a href="/" className={styles.brand} aria-label="ShadowGraph home">
          <BrandMark />
          <span>ShadowGraph</span>
        </a>
        <nav className={styles.nav} aria-label="Primary">
          {STAGES.map((s) => <span key={s.key}>{link(s.landing, s.name, stage?.key === s.key)}</span>)}
          {link("/pricing", "Pricing", path === "/pricing")}
        </nav>
        <GlobalSearch />
        <div className={styles.menu}><AppMenu /></div>
        <a href="/alerts" className={styles.cta}><i className={styles.live} />Free alerts</a>
      </div>
    </header>
    <SectionNav />
    </>
  );
}
