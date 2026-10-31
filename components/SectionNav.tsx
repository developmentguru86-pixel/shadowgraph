import { useLocation } from "react-router-dom";
import { stageOf, linkActive, nextStage } from "../helpers/productMap";
import styles from "./SectionNav.module.css";

/**
 * Stage bar under the site header: shows which step of the product the page belongs to, its sibling pages,
 * and the next step. Rendered by SiteHeader for every page that belongs to a step.
 */
export function SectionNav({ className }: { className?: string }) {
  const { pathname, hash } = useLocation();
  const stage = stageOf(pathname);
  if (!stage) return null;
  const next = nextStage(stage);
  return (
    <nav className={`${styles.bar} ${className ?? ""}`} aria-label={`${stage.name} pages`}>
      <div className={styles.inner}>
        <a href={stage.landing} className={styles.title}><span className={styles.n}>{stage.n}</span>{stage.name}</a>
        <div className={styles.items}>
          {stage.links.map((it) => {
            const active = it.href.includes("#") ? pathname === it.href.split("#")[0] && hash === `#${it.href.split("#")[1]}` : linkActive(it, pathname) && !(it.href === "/terminal" && hash);
            return (
              <a key={it.href} href={it.href} className={active ? styles.active : undefined} aria-current={active ? "page" : undefined}>
                {it.label}
              </a>
            );
          })}
        </div>
        {next
          ? <a href={next.landing} className={styles.next}>Next step <b>{next.n} {next.name}</b></a>
          : <a href="/docs" className={styles.next}>Build on it <b>API & agents</b></a>}
      </div>
    </nav>
  );
}