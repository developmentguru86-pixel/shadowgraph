import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RadarMapNode } from "./RadarMapView";
import { worldMap } from "../helpers/worldMap";
import { arcDegrees, greatCircle } from "../helpers/agentSignals";
import { declutter } from "../helpers/globeDeclutter";
import { getAgentGlobe } from "../endpoints/agents/globe_GET.schema";
import type { AgentGlobeData } from "../helpers/agentGlobe";
import styles from "./RadarGlobe.module.css";

type Arc = AgentGlobeData["signals"][number];
/** Strongest step an arc reached: paid > challenge > preview > discovery. */
const arcKind = (a: Arc) => (a.kinds.paid ? "paid" : a.kinds.challenge || a.kinds.payment_failed ? "challenge" : a.kinds.preview ? "preview" : "discovery");
const hubR = (n: number, sc: number) => (1.5 + 1.25 * Math.cbrt(n)) * sc;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const KIND_LABEL: Record<string, string> = { discovery: "handshake", preview: "free call", challenge: "asked to pay", payment_failed: "payment failed", paid: "paid call" };

const DEG = Math.PI / 180;
// deep zoom down to street-block scale; from DECLUTTER_Z on, overlapping markers are fanned out (globeDeclutter)
const MIN_Z = 0.8, MAX_Z = 160, DECLUTTER_Z = 4;
/** Agent pulses replay real requests: each one starts this long after it happened (data refresh + CDN cache) and travels TRAVEL_MS. */
const REPLAY_MS = 75_000, TRAVEL_MS = 2_600;
const clampLat = (v: number) => Math.max(-80, Math.min(80, v));
const wrapLon = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
/** Node radius: cube-root scaling keeps a 274-service country readable next to a 3-service region. */
const nodeR = (n: number, sc: number) => (2.4 + 2.3 * Math.cbrt(n)) * sc;
const lonDiff = (a: number, b: number) => wrapLon(a - b);
/** Stable 0..1 value per string, so every arc's flowing dots start at their own phase. */
const hash01 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10007) / 10007; };

type Rgb = [number, number, number];
type Palette = Record<"primary" | "warning" | "error" | "fg" | "muted" | "bg" | "card" | "country" | "line" | "agent", Rgb>;
function parseColor(v: string, fallback: Rgb): Rgb {
  const s = v.trim();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (h) {
    const x = h[1].length === 3 ? h[1].split("").map((c) => c + c).join("") : h[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  const r = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : fallback;
}
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const g = (n: string, f: Rgb) => parseColor(cs.getPropertyValue(n), f);
  return {
    primary: g("--primary", [95, 227, 161]), warning: g("--warning", [242, 192, 99]), error: g("--error", [255, 122, 107]),
    fg: g("--foreground", [238, 242, 245]), muted: g("--muted-foreground", [124, 138, 150]), bg: g("--background", [5, 7, 10]),
    card: g("--card", [12, 17, 23]), country: g("--accent-foreground", [143, 240, 191]), line: g("--border-strong", [38, 49, 60]),
    agent: g("--info", [127, 178, 255]),
  };
}

type Props = {
  nodes: RadarMapNode[];
  hotKeys: Set<string>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  className?: string;
  /** Initial view centre [lat, lon]. Defaults to the North Atlantic, so America and Europe are both in view. */
  center?: [number, number];
  /** Slow spin while nobody touches the globe. */
  autoRotate?: boolean;
  /** Measurement points (worldwide probes), drawn as diamonds: white = all targets reachable, amber = some failed. */
  probes?: Array<{ lat: number; lon: number; label: string; ok: boolean }>;
  /** Adds the "Agents" layer: public agent endpoints (MCP / A2A registries) and live signal arcs of agents calling ShadowGraph. */
  agentLayer?: boolean;
};

/**
 * Interactive 3D globe (orthographic projection on canvas) of monitored hosting locations.
 * Drag or swipe to rotate (with inertia), pinch / wheel / buttons to zoom, tap a node to select it.
 * Same node model and colour rules as RadarMapView: red = incident, amber = errors, green = healthy.
 */
export function RadarGlobe({ nodes, hotKeys, selected, onSelect, className, center = [34, -42], autoRotate = true, probes = [], agentLayer = false }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [full, setFull] = useState(false);
  const [zoomLabel, setZoomLabel] = useState("1.0×");
  const [hint, setHint] = useState(true);
  const [agentsOn, setAgentsOn] = useState(true);
  const [agentSel, setAgentSel] = useState<string | null>(null); // hub key "a:lat,lon" or "feed"
  const agentsQ = useQuery({ queryKey: ["agent-globe"], queryFn: getAgentGlobe, enabled: agentLayer, refetchInterval: 30_000, staleTime: 15_000 });
  const agents = agentLayer && agentsOn ? agentsQ.data ?? null : null;

  // everything the render loop reads lives in a ref, so dragging never re-renders React
  const st = useRef({
    lat: center[0], lon: center[1], z: 1, vLat: 0, vLon: 0,
    target: null as null | { lat: number; lon: number; z?: number },
    lastTouch: 0, dragging: false, hover: null as string | null,
    nodes, hotKeys, selected, onSelect, probes,
    agents: null as AgentGlobeData | null, agentSel: null as string | null, setAgentSel: (_: string | null) => {},
    pointers: new Map<number, { x: number; y: number }>(),
    pinch: null as null | { d: number; z: number },
    down: null as null | { x: number; y: number; t: number; moved: boolean; lastX: number; lastY: number; lastT: number },
    /** eased declutter offsets per marker key, and the marker positions of the last frame (used for hit-testing) */
    offsets: new Map<string, { dx: number; dy: number }>(),
    /** request id -> wall-clock ms when this page first received it (pulse replay); the data object it came with */
    seen: new Map<string, number>(),
    agentsSeenRef: null as AgentGlobeData | null,
    layout: [] as Array<{ key: string; x: number; y: number; r: number; hub: boolean }>,
  });
  st.current.nodes = nodes; st.current.hotKeys = hotKeys; st.current.selected = selected; st.current.onSelect = onSelect; st.current.probes = probes;
  st.current.agents = agents; st.current.agentSel = agentSel; st.current.setAgentSel = setAgentSel;

  // fly to a node when it gets selected
  useEffect(() => {
    const n = nodes.find((x) => x.key === selected);
    if (!n) return;
    setAgentSel(null);
    const [lat, lon] = worldMap.unproject(n.x, n.y);
    st.current.target = { lat: clampLat(lat - 8 / Math.max(st.current.z, 1)), lon, z: Math.max(st.current.z, 1.6) };
    st.current.lastTouch = performance.now();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // fly to an agent hub when it gets selected
  useEffect(() => {
    const h = agents?.hubs.find((x) => x.key === agentSel);
    if (!h) return;
    st.current.target = { lat: clampLat(h.lat - 8 / Math.max(st.current.z, 1)), lon: h.lon, z: Math.max(st.current.z, 1.6) };
    st.current.lastTouch = performance.now();
  }, [agentSel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const land = worldMap.landLatLon();
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let pal = readPalette(wrap);
    let raf = 0, visible = true, frame = 0, lastZoomShown = "";
    let W = 0, H = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(draw); }, { rootMargin: "100px" });
    io.observe(canvas);

    const radius = () => (Math.min(W, H) / 2) * 0.88 * st.current.z;

    function draw(now: number) {
      raf = 0;
      if (!visible || document.hidden) return;
      const s = st.current;
      frame++;
      if (frame % 90 === 0) pal = readPalette(wrap!);

      // motion: fly-to target, inertia, idle spin
      if (s.target) {
        const dl = lonDiff(s.target.lon, s.lon), dp = s.target.lat - s.lat;
        s.lon = wrapLon(s.lon + dl * 0.12); s.lat = clampLat(s.lat + dp * 0.12);
        if (s.target.z) s.z += (s.target.z - s.z) * 0.12;
        const tol = 0.05 / Math.max(1, s.z); // stop when the remaining move is below ~1 px, at any zoom
        if (Math.abs(dl) < tol && Math.abs(dp) < tol && (!s.target.z || Math.abs(s.target.z - s.z) < 0.01 * s.z)) s.target = null;
      } else if (!s.dragging) {
        if (Math.abs(s.vLon) > 0.001 || Math.abs(s.vLat) > 0.001) {
          s.lon = wrapLon(s.lon + s.vLon); s.lat = clampLat(s.lat + s.vLat);
          s.vLon *= 0.94; s.vLat *= 0.94;
        } else if (autoRotate && !reduced && !s.selected && now - s.lastTouch > 2500) {
          s.lon = wrapLon(s.lon + 0.05);
        }
      }

      const R = radius(), cx = W / 2, cy = H / 2;
      const φ0 = s.lat * DEG, sinφ0 = Math.sin(φ0), cosφ0 = Math.cos(φ0), λ0 = s.lon;
      const proj = (lat: number, lon: number): [number, number, number] => {
        const φ = lat * DEG, λ = (lon - λ0) * DEG, cosφ = Math.cos(φ), sinφ = Math.sin(φ), cosλ = Math.cos(λ);
        const cosc = sinφ0 * sinφ + cosφ0 * cosφ * cosλ;
        return [cx + R * cosφ * Math.sin(λ), cy - R * (cosφ0 * sinφ - sinφ0 * cosφ * cosλ), cosc];
      };

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      // atmosphere + sphere
      const glow = ctx!.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
      glow.addColorStop(0, rgba(pal.primary, 0.11)); glow.addColorStop(1, rgba(pal.primary, 0));
      ctx!.fillStyle = glow; ctx!.beginPath(); ctx!.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx!.fill();
      const sphere = ctx!.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
      sphere.addColorStop(0, rgba(pal.card, 1)); sphere.addColorStop(1, rgba(pal.bg, 1));
      ctx!.fillStyle = sphere; ctx!.beginPath(); ctx!.arc(cx, cy, R, 0, Math.PI * 2); ctx!.fill();
      ctx!.strokeStyle = rgba(pal.primary, 0.3); ctx!.lineWidth = 1; ctx!.stroke();

      // graticule
      ctx!.strokeStyle = rgba(pal.line, 0.45); ctx!.lineWidth = 0.6;
      const line = (pts: Array<[number, number]>) => {
        ctx!.beginPath(); let on = false;
        for (const [la, lo] of pts) { const [x, y, c] = proj(la, lo); if (c > 0) { on ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y); on = true; } else on = false; }
        ctx!.stroke();
      };
      for (let la = -60; la <= 60; la += 30) { const p: Array<[number, number]> = []; for (let lo = -180; lo <= 180; lo += 4) p.push([la, lo]); line(p); }
      for (let lo = -180; lo < 180; lo += 30) { const p: Array<[number, number]> = []; for (let la = -80; la <= 80; la += 4) p.push([la, lo]); line(p); }

      // land dots
      const dot = Math.max(1.4, Math.min(4.2, R / 115));
      ctx!.fillStyle = rgba(pal.fg, 1);
      for (let i = 0; i < land.length; i += 2) {
        const [x, y, c] = proj(land[i], land[i + 1]);
        if (c <= 0) continue;
        ctx!.globalAlpha = 0.14 + 0.46 * c;
        const d = dot * (0.55 + 0.45 * c);
        ctx!.fillRect(x - d / 2, y - d / 2, d, d);
      }
      ctx!.globalAlpha = 1;

      const sc = Math.max(0.75, Math.min(2.2, R / 260));
      const ag = s.agents;

      // project service nodes and agent hubs first, so overlapping markers can be fanned out before anything is drawn
      const drawn = s.nodes.map((n) => {
        const [lat, lon] = worldMap.unproject(n.x, n.y);
        const [x, y, c] = proj(lat, lon);
        return { n, x, y, tx: x, ty: y, c, r: nodeR(n.services.length, sc) };
      }).filter((d) => d.c > 0.02).sort((a, b) => a.c - b.c);
      const hubsDrawn = (ag?.hubs ?? []).map((h) => {
        const [x, y, c] = proj(h.lat, h.lon);
        return { h, x, y, tx: x, ty: y, c, r: hubR(h.count, sc) };
      }).filter((d) => d.c > 0.02);

      // declutter once zoomed in: markers at (nearly) the same place are fanned out on a small spiral with a leader
      // line to their true position; offsets are eased so groups open and close smoothly while zooming
      const want = new Map<string, { dx: number; dy: number }>();
      if (s.z >= DECLUTTER_Z) {
        const pad = 60;
        const onScreen = (d: { x: number; y: number }) => d.x > -pad && d.x < W + pad && d.y > -pad && d.y < H + pad;
        const discs = [
          ...drawn.filter((d) => d.c > 0.2 && onScreen(d)).map((d) => ({ key: d.n.key, x: d.x, y: d.y, r: d.r * 1.15 })),
          ...hubsDrawn.filter((d) => d.c > 0.2 && onScreen(d)).map((d) => ({ key: d.h.key, x: d.x, y: d.y, r: d.r })),
        ];
        const pos = declutter(discs, 4);
        for (const d of discs) { const p = pos.get(d.key)!; if (Math.abs(p.x - d.x) > 0.3 || Math.abs(p.y - d.y) > 0.3) want.set(d.key, { dx: p.x - d.x, dy: p.y - d.y }); }
      }
      const eased = (key: string) => {
        const cur = s.offsets.get(key) ?? { dx: 0, dy: 0 }, w = want.get(key) ?? { dx: 0, dy: 0 };
        const next = { dx: cur.dx + (w.dx - cur.dx) * 0.25, dy: cur.dy + (w.dy - cur.dy) * 0.25 };
        if (Math.abs(next.dx) < 0.1 && Math.abs(next.dy) < 0.1 && !want.has(key)) s.offsets.delete(key); else s.offsets.set(key, next);
        return next;
      };
      for (const d of drawn) { const o = eased(d.n.key); d.x += o.dx; d.y += o.dy; }
      for (const d of hubsDrawn) { const o = eased(d.h.key); d.x += o.dx; d.y += o.dy; }
      // leader lines + true-position dots for displaced markers
      for (const d of [...hubsDrawn, ...drawn]) {
        if (Math.hypot(d.x - d.tx, d.y - d.ty) < 2.5) continue;
        const a = Math.min(1, 0.25 + d.c);
        ctx!.strokeStyle = rgba(pal.muted, 0.55 * a); ctx!.lineWidth = 0.8;
        ctx!.beginPath(); ctx!.moveTo(d.tx, d.ty); ctx!.lineTo(d.x, d.y); ctx!.stroke();
        ctx!.fillStyle = rgba(pal.muted, 0.8 * a); ctx!.beginPath(); ctx!.arc(d.tx, d.ty, 1.6, 0, Math.PI * 2); ctx!.fill();
      }
      s.layout = [
        ...drawn.filter((d) => d.c > 0.05).map((d) => ({ key: d.n.key, x: d.x, y: d.y, r: d.r, hub: false })),
        ...hubsDrawn.filter((d) => d.c > 0.05).map((d) => ({ key: d.h.key, x: d.x, y: d.y, r: d.r, hub: true })),
      ];

      // agent layer, part 1: public agent endpoints as blue rings, under the service nodes
      for (const d of hubsDrawn) {
        const { h, x, y, c, r } = d;
        const a = Math.min(1, 0.2 + c);
        const isSel = s.agentSel === h.key, isHover = s.hover === h.key;
        // ring colour = measured reachability from the hourly probe: blue = reachable, amber >= 15 % / red >= 50 % unreachable
        const down = h.checked > 0 ? (h.checked - h.reachable) / h.checked : 0;
        const rc = down >= 0.5 ? pal.error : down >= 0.15 ? pal.warning : pal.agent;
        ctx!.fillStyle = rgba(rc, (isSel ? 0.3 : 0.14) * a); ctx!.beginPath(); ctx!.arc(x, y, r, 0, Math.PI * 2); ctx!.fill();
        ctx!.strokeStyle = rgba(rc, (isSel || isHover ? 1 : 0.8) * a); ctx!.lineWidth = isSel ? 2.2 : 1.3; ctx!.stroke();
      }

      // nodes, back to front
      const labelMin = s.z < 1.4 ? 12 : s.z < 2.6 ? 3 : 1;
      const placed: Array<[number, number, number, number]> = [];
      for (const d of drawn) {
        const { n, x, y, c, r } = d;
        const bad = n.services.filter((v) => v.state !== "up").length;
        const hot = s.hotKeys.has(n.key);
        const col = hot ? pal.error : bad ? pal.warning : n.kind !== "region" ? pal.country : pal.primary;
        const a = Math.min(1, 0.25 + c * 1.1);
        if (hot && !reduced) {
          for (let k = 0; k < 3; k++) {
            const t = ((now / 1700) + k / 3) % 1;
            ctx!.strokeStyle = rgba(pal.error, (1 - t) * 0.8 * a); ctx!.lineWidth = 1.4;
            ctx!.beginPath(); ctx!.arc(x, y, r * (1 + t * 3), 0, Math.PI * 2); ctx!.stroke();
          }
        }
        ctx!.fillStyle = rgba(col, 0.18 * a); ctx!.beginPath(); ctx!.arc(x, y, r * 1.55, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = rgba(col, 0.92 * a); ctx!.beginPath(); ctx!.arc(x, y, r, 0, Math.PI * 2); ctx!.fill();
        const isSel = s.selected === n.key, isHover = s.hover === n.key;
        ctx!.lineWidth = isSel ? 2.2 : 1; ctx!.strokeStyle = isSel || isHover ? rgba(pal.fg, 0.95) : rgba(pal.bg, 0.9); ctx!.stroke();
      }
      // agent layer, part 2: signal arcs (sender → ShadowGraph), lifted above the surface, with a travelling pulse
      const senders: Array<{ x: number; y: number; c: number; text: string; monitor: boolean }> = [];
      if (ag) {
        const home: [number, number] = [ag.home.lat, ag.home.lon];
        const lifted = (lat: number, lon: number, k: number): [number, number, boolean] => {
          const φ = lat * DEG, λ = (lon - λ0) * DEG, cosφ = Math.cos(φ), sinφ = Math.sin(φ), cosλ = Math.cos(λ);
          const cosc = sinφ0 * sinφ + cosφ0 * cosφ * cosλ;
          const x = cx + R * k * cosφ * Math.sin(λ), y = cy - R * k * (cosφ0 * sinφ - sinφ0 * cosφ * cosλ);
          return [x, y, cosc > 0.02]; // front hemisphere only: arcs fade out at the horizon instead of looping through space
        };
        // register newly arrived requests: on the first data load everything already past is marked as seen long ago,
        // so opening the page never plays a burst of old requests
        const wall = Date.now();
        if (ag !== s.agentsSeenRef) {
          const first = s.agentsSeenRef === null;
          for (const sg of ag.signals) for (const t of sg.recent ?? []) {
            const id = `${sg.key}@${t}`;
            if (!s.seen.has(id)) s.seen.set(id, first ? 0 : wall);
          }
          for (const [id, at] of s.seen) if (wall - Number(id.slice(id.lastIndexOf("@") + 1)) > 20 * 60_000 && wall - at > 60_000) s.seen.delete(id);
          s.agentsSeenRef = ag;
        }
        let arriving = false;
        ag.signals.forEach((sg) => {
          const from: [number, number] = [sg.lat, sg.lon];
          const deg = arcDegrees(from, home);
          if (deg < 0.3) return;
          const kind = arcKind(sg);
          // green is reserved for settled payments; "asked to pay" (HTTP 402, not paid) is amber so the two can never be confused;
          // connection checks (uptime / registry robots, handshakes only) are drawn like every other handshake;
          // the stats line under the globe still counts them separately from data requests
          const col = kind === "paid" ? pal.primary : kind === "challenge" ? pal.warning : pal.fg;
          const fresh = Date.now() - new Date(sg.lastAt).getTime() < 24 * 3600_000;
          const alpha = (fresh ? 0.75 : 0.38) * (kind === "discovery" ? 0.7 : 1);
          const hgt = 0.04 + 0.22 * (deg / 180);
          const N = Math.max(12, Math.min(64, Math.round(deg / 2)));
          const pts: Array<[number, number, boolean]> = [];
          for (let k = 0; k <= N; k++) {
            const t = k / N, [la, lo] = greatCircle(from, home, t);
            pts.push(lifted(la, lo, 1 + hgt * Math.sin(Math.PI * t)));
          }
          ctx!.strokeStyle = rgba(col, alpha); ctx!.lineWidth = kind === "paid" ? 2 : kind === "discovery" ? 0.9 : 1.3;
          ctx!.setLineDash(kind === "discovery" ? [3, 4] : []);
          ctx!.beginPath();
          let on = false;
          for (const [x, y, v] of pts) { if (v) { on ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y); on = true; } else on = false; }
          ctx!.stroke(); ctx!.setLineDash([]);
          // continuous flow: every sender active in the last 24 hours streams small dots towards ShadowGraph.
          // More requests per day = more dots on the arc (1 to 4). Each real request additionally fires the bright pulse below.
          if (!reduced && (sg.count24h > 0 || fresh)) {
            const hf = hash01(sg.key);
            const nDots = Math.min(4, 1 + Math.floor(Math.log10(1 + sg.count24h)));
            const period = 4200 + hf * 2600 + deg * 18;
            for (let d = 0; d < nDots; d++) {
              const ph = (now / period + d / nDots + hf) % 1;
              const fade = Math.sin(Math.PI * ph);
              const dr = 1.9 * Math.max(1, Math.min(1.5, sc));
              for (let k = 0; k <= 3; k++) {
                const tp = ph - k * 0.018;
                if (tp <= 0) break;
                const [la, lo] = greatCircle(from, home, tp);
                const [x, y, v] = lifted(la, lo, 1 + hgt * Math.sin(Math.PI * tp));
                if (!v) continue;
                ctx!.fillStyle = rgba(col, (k === 0 ? 0.9 : 0.5 * (1 - k / 4)) * fade);
                ctx!.beginPath(); ctx!.arc(x, y, dr * (1 - k * 0.15), 0, Math.PI * 2); ctx!.fill();
              }
              if (ph > 0.94) arriving = true;
            }
          }
          // one pulse per REAL request: each request of the last 15 minutes is replayed once, REPLAY_MS after it happened
          // (or as soon as the data arrives, if later). No request, no pulse.
          if (!reduced) {
            for (const t of sg.recent ?? []) {
              const start = Math.max(t + REPLAY_MS, s.seen.get(`${sg.key}@${t}`) ?? 0);
              const ph = (wall - start) / TRAVEL_MS;
              if (ph < 0 || ph > 1) continue;
              if (ph > 0.8) arriving = true;
              const [la, lo] = greatCircle(from, home, ph);
              const [x, y, v] = lifted(la, lo, 1 + hgt * Math.sin(Math.PI * ph));
              if (v) {
                const pc = col;
                const pr = 2.8 * Math.max(1, Math.min(1.5, sc));
                // short comet tail along the arc, then a soft halo and the head
                for (let k = 1; k <= 5; k++) {
                  const tp = ph - k * 0.025;
                  if (tp <= 0) break;
                  const [ta, to] = greatCircle(from, home, tp);
                  const [tx, ty, tv] = lifted(ta, to, 1 + hgt * Math.sin(Math.PI * tp));
                  if (!tv) continue;
                  ctx!.fillStyle = rgba(pc, 0.6 * (1 - k / 6)); ctx!.beginPath(); ctx!.arc(tx, ty, pr * (1 - k * 0.12), 0, Math.PI * 2); ctx!.fill();
                }
                ctx!.fillStyle = rgba(pc, 0.3); ctx!.beginPath(); ctx!.arc(x, y, pr * 2.6, 0, Math.PI * 2); ctx!.fill();
                ctx!.fillStyle = rgba(pc, 1); ctx!.beginPath(); ctx!.arc(x, y, pr, 0, Math.PI * 2); ctx!.fill();
              }
            }
          }
          // sender dot
          const [sx, sy, sc0] = proj(sg.lat, sg.lon);
          if (sc0 > 0.02) {
            ctx!.fillStyle = rgba(col, 0.95); ctx!.strokeStyle = rgba(pal.bg, 0.9); ctx!.lineWidth = 1.2;
            ctx!.beginPath(); ctx!.arc(sx, sy, 2.6 * Math.min(1.4, sc), 0, Math.PI * 2); ctx!.fill(); ctx!.stroke();
            senders.push({ x: sx, y: sy, c: sc0, monitor: sg.monitor, text: `${sg.agent}${sg.count24h > 0 ? ` · ${sg.count24h}/24h` : ""}` });
          }
        });
        // receiver: ShadowGraph
        const [hx, hy, hc] = proj(home[0], home[1]);
        if (hc > 0) {
          // the receiver ring only pulses while a real request is arriving
          if (!reduced && arriving) {
            const t = (now / 700) % 1;
            ctx!.strokeStyle = rgba(pal.primary, (1 - t) * 0.7); ctx!.lineWidth = 1.2;
            ctx!.beginPath(); ctx!.arc(hx, hy, 5 + t * 14, 0, Math.PI * 2); ctx!.stroke();
          }
          ctx!.fillStyle = rgba(pal.primary, 1); ctx!.strokeStyle = rgba(pal.bg, 1); ctx!.lineWidth = 2;
          ctx!.beginPath(); ctx!.arc(hx, hy, 4.6, 0, Math.PI * 2); ctx!.fill(); ctx!.stroke();
        }
      }

      // measurement points: small diamonds with a thin ring, labelled once zoomed in a little
      for (const p of s.probes) {
        const [x, y, c] = proj(p.lat, p.lon);
        if (c <= 0.05) continue;
        const d = 4.2 * Math.min(1.4, Math.max(0.9, sc)), a = Math.min(1, 0.3 + c);
        ctx!.save(); ctx!.translate(x, y); ctx!.rotate(Math.PI / 4);
        ctx!.fillStyle = rgba(p.ok ? pal.fg : pal.warning, 0.95 * a); ctx!.strokeStyle = rgba(pal.bg, 0.9); ctx!.lineWidth = 1.5;
        ctx!.fillRect(-d / 2, -d / 2, d, d); ctx!.strokeRect(-d / 2, -d / 2, d, d);
        ctx!.restore();
        ctx!.strokeStyle = rgba(p.ok ? pal.fg : pal.warning, 0.35 * a); ctx!.lineWidth = 1;
        ctx!.beginPath(); ctx!.arc(x, y, d * 1.8, 0, Math.PI * 2); ctx!.stroke();
      }

      // labels on top, skipping collisions (selected / hovered always win)
      ctx!.font = `500 ${Math.round(10.5 * Math.min(1.25, Math.max(0.95, sc)))}px "Geist Mono", ui-monospace, monospace`;
      ctx!.textAlign = "center"; ctx!.lineJoin = "round";
      const order = [...drawn].reverse().sort((a, b) => Number(b.n.key === s.selected || b.n.key === s.hover) - Number(a.n.key === s.selected || a.n.key === s.hover));
      for (const d of order) {
        const force = d.n.key === s.selected || d.n.key === s.hover;
        if (!force && (d.n.services.length < labelMin || d.c < 0.35)) continue;
        const text = `${d.n.label} · ${d.n.services.length}`;
        const w = ctx!.measureText(text).width, ty = d.y - d.r - 7;
        const box: [number, number, number, number] = [d.x - w / 2 - 3, ty - 11, d.x + w / 2 + 3, ty + 3];
        if (!force && placed.some((p) => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) continue;
        placed.push(box);
        ctx!.globalAlpha = force ? 1 : Math.min(1, d.c * 1.4);
        ctx!.lineWidth = 3.5; ctx!.strokeStyle = rgba(pal.bg, 0.9); ctx!.strokeText(text, d.x, ty);
        ctx!.fillStyle = rgba(force ? pal.fg : pal.muted, 1); ctx!.fillText(text, d.x, ty);
      }
      // probe labels last, only where they do not collide with a service label
      if (s.z >= 1.3) {
        ctx!.font = `500 10px "Geist Mono", ui-monospace, monospace`; ctx!.textAlign = "left";
        for (const p of s.probes) {
          const [x, y, c] = proj(p.lat, p.lon);
          if (c <= 0.35) continue;
          const text = `probe · ${p.label}`, w = ctx!.measureText(text).width, lx = x + 9, ly = y + 14;
          const box: [number, number, number, number] = [lx - 2, ly - 10, lx + w + 2, ly + 3];
          if (placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3]))) continue;
          placed.push(box);
          ctx!.globalAlpha = Math.min(1, c * 1.3);
          ctx!.lineWidth = 3; ctx!.strokeStyle = rgba(pal.bg, 0.9); ctx!.strokeText(text, lx, ly);
          ctx!.fillStyle = rgba(pal.fg, 0.85); ctx!.fillText(text, lx, ly);
        }
      }
      // agent labels: receiver always, selected / hovered hub, then senders where there is room
      if (ag) {
        const tag = (text: string, x: number, y: number, color: Rgb, force: boolean, alpha = 1) => {
          const w = ctx!.measureText(text).width;
          const box: [number, number, number, number] = [x - 2, y - 10, x + w + 2, y + 3];
          if (!force && placed.some((q) => !(box[2] < q[0] || box[0] > q[2] || box[3] < q[1] || box[1] > q[3]))) return;
          placed.push(box);
          ctx!.globalAlpha = alpha;
          ctx!.lineWidth = 3; ctx!.strokeStyle = rgba(pal.bg, 0.92); ctx!.strokeText(text, x, y);
          ctx!.fillStyle = rgba(color, 1); ctx!.fillText(text, x, y);
          ctx!.globalAlpha = 1;
        };
        ctx!.textAlign = "left";
        ctx!.font = `600 11px "Geist Mono", ui-monospace, monospace`;
        const [hx, hy, hc] = proj(ag.home.lat, ag.home.lon);
        if (hc > 0.1) tag(ag.home.label, hx + 9, hy - 7, pal.primary, true);
        ctx!.font = `500 10px "Geist Mono", ui-monospace, monospace`;
        for (const d of hubsDrawn) {
          if (d.h.key !== s.agentSel && d.h.key !== s.hover) continue;
          if (d.c > 0.1) tag(`${d.h.label} · ${d.h.count} agents`, d.x + d.r + 5, d.y + 4, pal.agent, true);
        }
        if (s.z >= 1.15 || senders.length <= 6) {
          // data senders get their labels first; connection checkers where room is left
          for (const p of [...senders].sort((a, b) => Number(a.monitor) - Number(b.monitor))) {
            if (p.c > 0.3) tag(p.text, p.x + 7, p.y + 13, pal.fg, false, Math.min(1, p.c * 1.3) * 0.9);
          }
        }
      }
      ctx!.globalAlpha = 1;

      const zl = `${s.z.toFixed(1)}×`;
      if (zl !== lastZoomShown) { lastZoomShown = zl; setZoomLabel(zl); }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    const onVis = () => { if (!document.hidden && !raf) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", onVis);

    // ---------- interaction ----------
    const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // hit-testing uses the positions drawn in the last frame (after declutter), so a tap lands on what is visible
    const hit = (px: number, py: number): string | null => {
      const s = st.current;
      // a finger is coarse: allow more slack when markers are apart, less when they were fanned out next to each other
      const slack = s.z >= DECLUTTER_Z ? 6 : 14;
      let best: string | null = null, bestD = Infinity;
      for (const m of s.layout) {
        if (m.hub) continue;
        const d = Math.hypot(px - m.x, py - m.y);
        if (d < m.r + slack && d - m.r < bestD) { bestD = d - m.r; best = m.key; }
      }
      if (best) return best;
      // agent hubs are only picked when no service node is under the finger
      for (const m of s.layout) {
        if (!m.hub) continue;
        const d = Math.hypot(px - m.x, py - m.y);
        if (d < m.r + slack && d - m.r < bestD) { bestD = d - m.r; best = m.key; }
      }
      return best;
    };
    const touch = () => { st.current.lastTouch = performance.now(); setHint(false); };

    const onDown = (e: PointerEvent) => {
      const s = st.current; const p = local(e);
      canvas.setPointerCapture(e.pointerId);
      s.pointers.set(e.pointerId, p); s.target = null; s.vLat = 0; s.vLon = 0; touch();
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: s.z }; s.down = null;
      } else {
        s.down = { x: p.x, y: p.y, t: performance.now(), moved: false, lastX: p.x, lastY: p.y, lastT: performance.now() };
      }
    };
    const onMove = (e: PointerEvent) => {
      const s = st.current; const p = local(e);
      if (!s.pointers.has(e.pointerId)) {
        if (e.pointerType === "mouse") { const h = hit(p.x, p.y); if (h !== s.hover) { s.hover = h; canvas.style.cursor = h ? "pointer" : "grab"; } }
        return;
      }
      s.pointers.set(e.pointerId, p);
      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        s.z = Math.max(MIN_Z, Math.min(MAX_Z, s.pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(s.pinch.d, 1))));
        touch(); return;
      }
      const d = s.down;
      if (!d) return;
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > 5) { d.moved = true; s.dragging = true; canvas.style.cursor = "grabbing"; }
      if (!d.moved) return;
      const R = radius(), k = (180 / Math.PI) / R;
      const dLon = -(p.x - d.lastX) * k, dLat = (p.y - d.lastY) * k;
      s.lon = wrapLon(s.lon + dLon); s.lat = clampLat(s.lat + dLat);
      const dt = Math.max(1, performance.now() - d.lastT);
      s.vLon = (dLon / dt) * 16; s.vLat = (dLat / dt) * 16;
      d.lastX = p.x; d.lastY = p.y; d.lastT = performance.now();
      touch();
    };
    const onUp = (e: PointerEvent) => {
      const s = st.current; const p = local(e);
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      const d = s.down;
      if (d && !d.moved && s.pointers.size === 0) {
        const h = hit(p.x, p.y);
        if (h?.startsWith("a:")) { s.onSelect(null); s.setAgentSel(s.agentSel === h ? null : h); }
        else if (h) { s.setAgentSel(null); s.onSelect(s.selected === h ? null : h); }
      }
      if (d && performance.now() - d.lastT > 80) { s.vLon = 0; s.vLat = 0; }
      if (s.pointers.size === 0) { s.down = null; s.dragging = false; canvas.style.cursor = "grab"; }
      touch();
    };
    const onLeave = () => { st.current.hover = null; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current; s.target = null;
      s.z = Math.max(MIN_Z, Math.min(MAX_Z, s.z * Math.exp(-e.deltaY * 0.0015)));
      touch();
    };
    const onKey = (e: KeyboardEvent) => {
      const s = st.current; const step = 8 / s.z;
      const map: Record<string, () => void> = {
        ArrowLeft: () => { s.lon = wrapLon(s.lon - step); }, ArrowRight: () => { s.lon = wrapLon(s.lon + step); },
        ArrowUp: () => { s.lat = clampLat(s.lat + step); }, ArrowDown: () => { s.lat = clampLat(s.lat - step); },
        "+": () => { s.z = Math.min(MAX_Z, s.z * 1.4); }, "=": () => { s.z = Math.min(MAX_Z, s.z * 1.4); }, "-": () => { s.z = Math.max(MIN_Z, s.z / 1.4); },
      };
      if (map[e.key]) { e.preventDefault(); s.target = null; map[e.key](); touch(); }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
    };
  }, [autoRotate]);

  const zoomBy = (f: number) => {
    const s = st.current;
    s.target = { lat: s.lat, lon: s.lon, z: Math.max(MIN_Z, Math.min(MAX_Z, (s.target?.z ?? s.z) * f)) };
    s.lastTouch = performance.now(); setHint(false);
  };
  const reset = () => { st.current.target = { lat: center[0], lon: center[1], z: 1 }; st.current.lastTouch = performance.now(); onSelect(null); setAgentSel(null); };
  const sel = nodes.find((n) => n.key === selected);
  const hub = agents?.hubs.find((h) => h.key === agentSel) ?? null;
  const showFeed = agentSel === "feed" && !!agents;
  const flyTo = (lat: number, lon: number, z = 2.4) => { st.current.target = { lat: clampLat(lat - 6 / z), lon, z }; st.current.lastTouch = performance.now(); };

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${full ? styles.full : ""} ${className ?? ""}`}>
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} tabIndex={0}
          role="img" aria-label={`Interactive globe of ${nodes.length} monitored hosting locations${agents ? `, ${agents.hubs.length} public agent locations and ${agents.signals.length} agent signal arcs to ShadowGraph` : ""}. Drag to rotate, pinch or scroll to zoom, arrow keys to rotate, plus and minus to zoom.`} />
        <div className={styles.controls}>
          <button onClick={() => zoomBy(1.6)} aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">−</button>
          <button onClick={reset} aria-label="Reset view">⟲</button>
          <button onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? "×" : "⤢"}</button>
        </div>
        <div className={styles.zoomLevel}>{zoomLabel}{hint ? " · drag to rotate · pinch to zoom" : ""}</div>
      </div>

      {agentLayer && (
        <div className={styles.agentBar}>
          <button className={`${styles.layerBtn} ${agentsOn ? styles.layerOn : ""}`} onClick={() => { setAgentsOn((v) => !v); setAgentSel(null); }} aria-pressed={agentsOn}>
            <i className={styles.ringIcon} /> Agents {agentsOn ? "on" : "off"}
          </button>
          {agentsOn && agents && (
            <>
              <span className={styles.legend}><i className={styles.ringIcon} /><b>{agents.totals.placed.toLocaleString("en-US")}</b> public agent endpoints placed
                <small> · {agents.totals.edge.toLocaleString("en-US")} on edge networks (no single location)</small></span>
              {agents.probe && agents.probe.checked > 0 && (
                <span className={styles.legend}><i className={styles.okDot} style={{ marginRight: 0 }} /><b>{agents.probe.reachable.toLocaleString("en-US")}</b> of {agents.probe.checked.toLocaleString("en-US")} hosts reachable
                  <small> · checked hourly, last {ago(agents.probe.at)}</small></span>
              )}
              <span className={styles.legend}><i className={styles.arcIcon} />
                <b>{(agents.totals.kinds7d.preview + agents.totals.kinds7d.challenge + agents.totals.kinds7d.paid + agents.totals.kinds7d.payment_failed).toLocaleString("en-US")}</b> data requests
                <small> · {agents.totals.kinds7d.discovery.toLocaleString("en-US")} uptime / registry checks · 7d · each pulse = one real request, shown ~1 min later</small></span>
              <button className={`${styles.layerBtn} ${showFeed ? styles.layerOn : ""}`} onClick={() => { onSelect(null); setAgentSel(showFeed ? null : "feed"); }}>Signal feed</button>
            </>
          )}
          {agentsOn && agentsQ.isLoading && <span className={styles.legend}>Loading agents…</span>}
          {agentsOn && agentsQ.isError && <span className={styles.legend}>Agent layer unavailable</span>}
        </div>
      )}

      {hub && (
        <aside className={styles.panel}>
          <div className={styles.pHead}>
            <b>{hub.label}</b><span className={styles.mono}>{hub.sub}{hub.placement === "region" ? " · cloud region" : ""}</span>
            <button className={styles.close} onClick={() => setAgentSel(null)} aria-label="Close">×</button>
          </div>
          <div className={styles.pStats}>
            <span><b>{hub.count}</b> public agents</span>
            <span><b>{hub.mcp}</b> MCP</span>
            <span><b>{hub.a2a}</b> A2A</span>
          </div>
          {hub.checked > 0 ? (
            <div className={styles.pBreak}>
              <span><i className={styles.okDot} />reachable <b>{hub.reachable}</b></span>
              <span className={hub.checked - hub.reachable > 0 ? styles.warnText : ""}><i className={styles.badDot} />unreachable <b>{hub.checked - hub.reachable}</b></span>
              {agents?.probe && <span className={styles.mono}>checked {ago(agents.probe.at)}</span>}
            </div>
          ) : <p className={styles.more}>Not yet checked — endpoints are probed once per hour.</p>}
          <ul className={styles.pList}>
            {hub.sample.map((a) => (
              <li key={`${a.p}:${a.h}:${a.n}`}>
                <i className={a.s === 1 ? styles.sUp : a.s === 0 ? styles.sDown : styles.ringDot} title={a.s === 1 ? "Reachable at last check" : a.s === 0 ? "Unreachable at last check" : "Not checked yet"} />
                <span title={a.h}>{a.n}</span><span className={styles.mono}>{a.p.toUpperCase()}</span>
              </li>
            ))}
          </ul>
          {hub.count > hub.sample.length && <p className={styles.more}>+{hub.count - hub.sample.length} more at this location</p>}
          <p className={styles.note}>Where the agent's public endpoint is hosted ({hub.placement === "region" ? "cloud region from the provider's official IP ranges" : "DNS lookup + DB-IP city geolocation, approximate"}), not where its operator sits. Source: official MCP Registry and A2A Registry. Reachable = the host answered an HTTPS request with a status below 500 within 8 s; it says nothing about whether the agent's tools work.</p>
          <button className={styles.zoomTo} onClick={() => flyTo(hub.lat, hub.lon, 3.2)}>Zoom to {hub.label}</button>
        </aside>
      )}

      {showFeed && agents && (
        <aside className={styles.panel}>
          <div className={styles.pHead}>
            <b>Signals to ShadowGraph</b><span className={styles.mono}>live · last 7 days</span>
            <button className={styles.close} onClick={() => setAgentSel(null)} aria-label="Close">×</button>
          </div>
          <div className={styles.pStats}>
            <span><b>{agents.totals.signals24h}</b> in 24h</span>
            <span><b>{agents.totals.signals7d}</b> in 7d</span>
            <span><b>{agents.totals.located7d}</b> located</span>
          </div>
          <div className={styles.pBreak} aria-label="Requests per step, last 7 days">
            <span><i className={styles.kDisc} />handshake <b>{agents.totals.kinds7d.discovery}</b></span>
            <span><i className={styles.kFree} />free call <b>{agents.totals.kinds7d.preview}</b></span>
            <span><i className={styles.kAsk} />asked to pay <b>{agents.totals.kinds7d.challenge}</b></span>
            <span className={agents.totals.kinds7d.paid ? "" : styles.zeroKind}><i className={styles.kPaid} />paid <b>{agents.totals.kinds7d.paid}</b></span>
          </div>
          {agents.totals.kinds7d.paid === 0 && (
            <p className={styles.more}>No agent has paid yet: every "asked to pay" request ended at the payment request (HTTP 402).</p>
          )}
          {agents.feed.length === 0 ? <p className={styles.more}>No agent requests in the last 7 days.</p> : (
            <ul className={styles.feed}>
              {agents.feed.map((f, i) => {
                const arc = agents.signals.find((s) => s.agent === f.agent && f.place && s.place === f.place);
                return (
                  <li key={`${f.at}-${i}`}>
                    <span className={styles.mono}>{ago(f.at)}</span>
                    <span className={styles.fAgent}>{f.agent}</span>
                    <span className={styles.mono}>{f.channel.toUpperCase()} · {KIND_LABEL[f.kind] ?? f.kind}</span>
                    {arc ? <button className={styles.fPlace} onClick={() => flyTo(arc.lat, arc.lon)}>{f.place}</button>
                      : <span className={styles.fNone}>{f.place ?? "location not recorded"}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className={styles.note}>Each pulse on the globe is one real request, replayed about a minute after it arrived; no request, no pulse. Dashed white arcs are handshakes, most of them uptime and registry robots that only check that ShadowGraph answers and never ask for data (counted separately above as uptime / registry checks). Only requests to ShadowGraph's MCP, A2A and REST endpoints are visible here. Traffic between other agents is private and is not drawn. Sender location comes from the CDN (city level, rounded to ~10 km; recorded since {agents.locationSince}); IP addresses are not stored.</p>
        </aside>
      )}

      {sel && (
        <aside className={styles.panel}>
          <div className={styles.pHead}>
            <b>{sel.label}</b><span className={styles.mono}>{sel.sub}</span>
            <button className={styles.close} onClick={() => onSelect(null)} aria-label="Close">×</button>
          </div>
          <div className={styles.pStats}>
            <span><b>{sel.services.length}</b> services</span>
            <span><b>{sel.services.filter((s) => s.state === "up").length}</b> up</span>
            <span className={sel.services.some((s) => s.state !== "up") ? styles.warnText : ""}><b>{sel.services.filter((s) => s.state !== "up").length}</b> errors</span>
          </div>
          <div className={styles.pBreak}>
            {Object.entries(sel.services.reduce<Record<string, number>>((a, s) => { const c = s.cdn ?? "no CDN"; a[c] = (a[c] ?? 0) + 1; return a; }, {}))
              .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => <span key={c}>{c} <b>{n}</b></span>)}
          </div>
          <ul className={styles.pList}>
            {[...sel.services].sort((a, b) => (a.state === "up" ? 1 : 0) - (b.state === "up" ? 1 : 0)).slice(0, 40).map((s) => (
              <li key={s.id}><i className={s.state === "up" ? styles.sUp : s.state === "down" ? styles.sDown : styles.sWarn} /><span>{s.name}</span><span className={styles.mono}>{s.latencyMs != null ? `${s.latencyMs} ms` : "—"}</span></li>
            ))}
          </ul>
          {sel.services.length > 40 && <p className={styles.more}>+{sel.services.length - 40} more</p>}
          <button className={styles.zoomTo} onClick={() => { const [lat, lon] = worldMap.unproject(sel.x, sel.y); st.current.target = { lat, lon, z: 3.2 }; }}>Zoom to {sel.label}</button>
        </aside>
      )}
    </div>
  );
}
