import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to the element named in the URL hash and keeps it aligned for a few seconds while async content above it
 * loads and grows (otherwise a deep link lands too high once data arrives). Stops as soon as the visitor scrolls,
 * touches or presses a key. Leaves room for the sticky site header.
 */
const HEADER_OFFSET = 76;
const FOLLOW_MS = 5000;

export const ScrollToHashElement = () => {
  const location = useLocation();

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    let stopped = false;
    const stop = () => { stopped = true; };
    const align = () => {
      if (stopped) return;
      const el = document.getElementById(id);
      if (!el) return;
      // room for the sticky site header plus a sticky section navigation, when the page has one
      const sectionNav = document.querySelector<HTMLElement>('nav[aria-label$=" sections"]');
      const top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET - (sectionNav?.offsetHeight ?? 0);
      if (Math.abs(window.scrollY - top) > 4) window.scrollTo({ top, behavior: "auto" });
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    align();
    const timer = setInterval(align, 200);
    const end = setTimeout(() => clearInterval(timer), FOLLOW_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(end);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [location.pathname, location.hash]);

  return null;
};
