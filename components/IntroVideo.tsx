import { useEffect, useRef, useState } from "react";
import styles from "./IntroVideo.module.css";

const DESKTOP = { src: "/_cdn/static/shadowgraph-intro-light.mp4", poster: "/_cdn/static/shadowgraph-intro-light-poster.jpg" };
const MOBILE = { src: "/_cdn/static/shadowgraph-intro-light-mobile.mp4", poster: "/_cdn/static/shadowgraph-intro-light-mobile-poster.jpg" };

/**
 * 26-second silent explainer (16:9 on desktop, 4:5 on phones). The server renders only the poster (no layout shift,
 * no video download for crawlers); the browser picks the right file after mount and plays it muted in a loop.
 * Reduced motion: no autoplay, the viewer starts it.
 */
export function IntroVideo() {
  const [v, setV] = useState<typeof DESKTOP | null>(null);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    setV(window.matchMedia("(max-width: 700px)").matches ? MOBILE : DESKTOP);
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  const toggle = () => { const el = ref.current; if (!el) return; if (el.paused) el.play().catch(() => undefined); else el.pause(); };
  return (
    <div className={styles.frame}>
      {v && (
        <video ref={ref} className={styles.video} src={v.src} poster={v.poster} muted loop playsInline autoPlay={!reduced} controls={reduced}
          preload="metadata" onClick={toggle} aria-label="ShadowGraph in 26 seconds: an outage at a shared cloud region, the alert you get, and what Stack Alerts costs" />
      )}
    </div>
  );
}