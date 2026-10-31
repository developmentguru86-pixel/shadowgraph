import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import styles from "./ResearchLayout.module.css";

/** Shell of the Research section: site header, research sub-navigation, page, footer. */
export function ResearchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader active="research" />
      <main className={styles.main}>{children}</main>
      <SiteFooter />
    </>
  );
}

export default ResearchLayout;
