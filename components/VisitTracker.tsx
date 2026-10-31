import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { postVisit } from "../endpoints/visit_POST.schema";

const OPT_OUT = "sg-notrack";
const optedOut = () => { try { return localStorage.getItem(OPT_OUT) === "1"; } catch { return false; } };
const optOut = () => { try { localStorage.setItem(OPT_OUT, "1"); } catch { /* storage blocked */ } };

/** How long a page must be visible before it counts: link previews, prerenders and most scripted fetches close sooner. */
const DWELL_MS = 3000;

/**
 * Sends one anonymous page-view ping per route change (no cookies; the only thing stored is the owner's opt-out flag).
 * The owner's browsers exclude themselves: opening /stats once sets the flag (also ?notrack=1; undo with ?track=1).
 * A view counts only after the page has been visible for 3 seconds in a browser that reports a language: this filters
 * link previews, prerendering and headless fetchers that run JavaScript but never show the page to a person.
 */
export const VisitTracker = () => {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(location.search);
    try {
      if (q.get("notrack") === "1") optOut();
      if (q.get("track") === "1") localStorage.removeItem(OPT_OUT);
    } catch { /* storage blocked: tracking stays on */ }
    if (location.pathname.startsWith("/stats")) { optOut(); return; } // only the owner opens /stats
    const nav = navigator as Navigator & { webdriver?: boolean };
    if (optedOut() || nav.webdriver || !(nav.languages?.length || nav.language)) return;
    const referrer = first.current ? document.referrer || undefined : undefined;
    first.current = false;
    let shown = document.visibilityState === "visible" ? Date.now() : 0;
    let sent = false;
    const send = () => { if (!sent) { sent = true; postVisit({ path: location.pathname, referrer }); } };
    // local visibility check only; it sends at most one ping per page view and then stops
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") { shown = 0; return; }
      if (!shown) shown = Date.now();
      if (Date.now() - shown >= DWELL_MS) { send(); window.clearInterval(timer); }
    }, 500);
    return () => window.clearInterval(timer);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};
