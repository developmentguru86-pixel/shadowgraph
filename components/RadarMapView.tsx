import { useCallback, useEffect, useRef, useState } from "react";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { worldMap } from "../helpers/worldMap";
import styles from "./RadarMapView.module.css";

export type RadarMapNode = { key: string; label: string; sub: string; x: number; y: number; services: RadarServiceRow[]; kind: "region" | "city" | "country" };

type View = { x: number; y: number; w: number };
const W = worldMap.width, H = worldMap.height;
const clampView = (v: View): View => {
  const w = Math.min(W, Math.max(W / 10, v.w)), h = (w / W) * H;
  return { w, x: Math.min(W - w, Math.max(0, v.x)), y: Math.min(H - h, Math.max(0, v.y)) };
};

/**
 * Zoomable, pannable, full-screen-capable world map of monitored hosting locations.
 * A node turns red only when it carries a real incident: a detected region incident, or at least 3 services down
 * that make up >= 10% of the node. A single failing service only turns it amber.
 */
export function RadarMapView({ nodes, hotKeys, selected, onSelect, className }: {
  nodes: RadarMapNode[]; hotKeys: Set<string>; selected: string | null; onSelect: (key: string | null) => void; className?: string;
}) {
  const [land, setLand] = useState("");
  const [view, setView] = useState<View>({ x: 0, y: 0, w: W });
  const [full, setFull] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ px: number; py: number; v: View; moved: boolean } | null>(null);
  useEffect(() => setLand(worldMap.landPath()), []);

  const k = view.w / W; // 1 = whole world, smaller = zoomed in
  const zoom = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const h = (v.w / W) * H;
      const fx = cx ?? v.x + v.w / 2, fy = cy ?? v.y + h / 2;
      const w = v.w * factor;
      return clampView({ w, x: fx - ((fx - v.x) * w) / v.w, y: fy - ((fy - v.y) * w) / v.w });
    });
  }, []);

  // wheel zoom (needs a non-passive listener)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const h = (v.w / W) * H;
        const cx = v.x + ((e.clientX - r.left) / r.width) * v.w, cy = v.y + ((e.clientY - r.top) / r.height) * h;
        const w = v.w * (e.deltaY > 0 ? 1.18 : 1 / 1.18);
        return clampView({ w, x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * w) / v.w });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  const onPointerDown = (e: React.PointerEvent) => { drag.current = { px: e.clientX, py: e.clientY, v: view, moved: false }; };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, el = svgRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const scale = d.v.w / el.getBoundingClientRect().width;
    setView(clampView({ w: d.v.w, x: d.v.x - dx * scale, y: d.v.y - dy * scale }));
  };
  const onPointerUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  const click = (key: string) => { if (drag.current?.moved) return; onSelect(selected === key ? null : key); };
  const focus = (n: RadarMapNode) => setView(clampView({ w: W / 4, x: n.x - W / 8, y: n.y - H / 8 }));

  const h = (view.w / W) * H;
  const labelMin = k > 0.6 ? 3 : k > 0.3 ? 2 : 1;
  const sel = nodes.find((n) => n.key === selected);

  return (
    <div className={`${styles.wrap} ${full ? styles.full : ""} ${className ?? ""}`}>
      <svg ref={svgRef} className={styles.svg} viewBox={`${view.x} ${view.y} ${view.w} ${h}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        onDoubleClick={(e) => { const r = svgRef.current!.getBoundingClientRect(); zoom(0.5, view.x + ((e.clientX - r.left) / r.width) * view.w, view.y + ((e.clientY - r.top) / r.height) * h); }}
        role="img" aria-label="Zoomable map of monitored hosting locations">
        <path d={land} className={styles.land} />
        {[60, 30, 0, -30].map((lat) => { const [, y] = worldMap.project(lat, 0); return <line key={lat} x1={0} y1={y} x2={W} y2={y} className={styles.grid} strokeWidth={0.6 * k} />; })}
        {nodes.map((n) => {
          const down = n.services.filter((s) => s.state === "down").length;
          const bad = n.services.filter((s) => s.state !== "up").length;
          const hot = hotKeys.has(n.key);
          const r = (3.2 + Math.sqrt(n.services.length) * 2.3) * Math.max(0.32, Math.sqrt(k));
          const cls = hot ? styles.down : bad ? styles.warn : n.kind !== "region" ? styles.country : styles.up;
          const showLabel = n.services.length >= labelMin || selected === n.key;
          return (
            <g key={n.key} className={`${cls} ${selected === n.key ? styles.sel : ""}`} onClick={() => click(n.key)} style={{ cursor: "pointer" }}>
              {hot && [0, 1, 2].map((i) => <circle key={i} cx={n.x} cy={n.y} r={r} className={styles.ring} strokeWidth={1.4 * k} style={{ animationDelay: `${i * 0.6}s` }} />)}
              <circle cx={n.x} cy={n.y} r={r + 6 * k} fill="transparent" />
              <circle cx={n.x} cy={n.y} r={r} className={styles.node} strokeWidth={1.4 * k}>
                <title>{`${n.label} (${n.sub}): ${n.services.length} services · ${down} down · ${bad - down} degraded`}</title>
              </circle>
              {showLabel && <text x={n.x} y={n.y - r - 4 * k} className={styles.label} fontSize={9.5 * k} strokeWidth={3 * k}>{n.label} · {n.services.length}</text>}
            </g>
          );
        })}
      </svg>

      <div className={styles.controls}>
        <button onClick={() => zoom(1 / 1.6)} aria-label="Zoom in">+</button>
        <button onClick={() => zoom(1.6)} aria-label="Zoom out">−</button>
        <button onClick={() => setView({ x: 0, y: 0, w: W })} aria-label="Reset view">⟲</button>
        <button onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? "×" : "⤢"}</button>
      </div>
      <div className={styles.zoomLevel}>{(1 / k).toFixed(1)}×{k < 1 ? " · drag to pan" : " · scroll or + to zoom"}</div>

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
          {sel.services.length > 40 && <p className={styles.more}>+{sel.services.length - 40} more in the table below</p>}
          <button className={styles.zoomTo} onClick={() => focus(sel)}>Zoom to {sel.label}</button>
        </aside>
      )}
    </div>
  );
}