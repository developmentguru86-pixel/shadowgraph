import { Helmet } from "react-helmet";
import { BrandMark } from "./SiteHeader";
import { MAINTENANCE_HOSTS } from "../helpers/maintenance";
import styles from "./MaintenanceScreen.module.css";

// Runs in <head> before first paint: on domains that are not in maintenance the server-rendered screen stays invisible
// until the app takes over, so other hosts open without a maintenance flash.
const OPEN_EARLY = `(function(){try{if(${JSON.stringify(MAINTENANCE_HOSTS)}.indexOf(location.hostname.toLowerCase())<0)document.documentElement.classList.add("sg-open")}catch(e){}})();`;

/** Full-page notice shown on every route of the maintenance domains while helpers/maintenance MAINTENANCE is on. */
export function MaintenanceScreen() {
  return (
    <div className={styles.page} id="sg-maintenance">
      <Helmet>
        <title>Maintenance · ShadowGraph</title>
        <meta name="description" content="ShadowGraph is temporarily unavailable while we carry out maintenance." />
        <script>{OPEN_EARLY}</script>
        <style>{".sg-open #sg-maintenance{visibility:hidden}"}</style>
      </Helmet>
      <main className={styles.inner}>
        <span className={styles.brand}><BrandMark size={22} /> ShadowGraph</span>
        <p className={styles.state}><i className={styles.dot} /> Maintenance</p>
        <h1 className={styles.h1}>The site is in maintenance.</h1>
        <p className={styles.body}>ShadowGraph is temporarily unavailable while we carry out maintenance. Our measurements keep running in the background, so no data is lost. Please check back soon.</p>
      </main>
    </div>
  );
}
