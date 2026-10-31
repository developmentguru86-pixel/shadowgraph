import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import styles from "./DependencyExplorer.module.css";

type Layer = "hosting" | "region" | "cdn" | "dns" | "email";
type Entity = { key: string; label: string; layer: Layer; services: RadarServiceRow[] };
export type ExplorerFocus = { kind: "entity" | "service"; key: string } | null;

const LAYER_LABEL: Record<Layer, string> = { hosting: "Hosting", region: "Cloud region", cdn: "CDN / edge", dns: "DNS", email: "Email" };
const VW = 1000, VH = 720, CX = 500, CY = 360;
const shortProvider = (p: string) => p.replace("Amazon Web Services", "AWS").replace("Google Cloud", "GCP").replace("Microsoft Azure", "Azure");

function entitiesOf(s: RadarServiceRow): Array<{ key: string; label: string; layer: Layer }> {
  const out: Array<{ key: string; label: string; layer: Layer }> = [];
  if (s.hostingProvider) out.push({ key: `hosting:${s.hostingProvider}`, label: s.hostingProvider, layer: "hosting" });
  if (s.hostingProvider && s.hostingRegion && s.hostingRegion !== "global") out.push({ key: `region:${s.hostingProvider}|${s.hostingRegion}`, label: `${shortProvider(s.hostingProvider)} ${s.hostingRegion}`, layer: "region" });
  if (s.cdn) out.push({ key: `cdn:${s.cdn}`, label: s.cdn, layer: "cdn" });
  if (s.dnsProvider && !/^Other \(/.test(s.dnsProvider)) out.push({ key: `dns:${s.dnsProvider}`, label: s.dnsProvider, layer: "dns" });
  if (s.emailProvider && !/^Other \(/.test(s.emailProvider)) out.push({ key: `email:${s.emailProvider}`, label: s.emailProvider, layer: "email" });
  return out;
}

const polar = (i: number, n: number, r: number, offset = -Math.PI / 2) => {
  const a = offset + (2 * Math.PI * i) / Math.max(n, 1);
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
};
const stateClass = (s: RadarServiceRow) => (s.state === "up" ? styles.sUp : s.state === "down" ? styles.sDown : styles.sWarn);

/**
 * Interactive dependency graph over the radar's mapped services.
 * Overview: largest infrastructure dependencies; edges = number of services that rely on both (hidden coupling).
 * Entity focus: every service depending on it (ring 1) and what else those services depend on (ring 2), with paths.
 * Service focus: its full chain (CDN -> hosting -> region, DNS, email) and how many services share each link.
 */
export function DependencyExplorer({ services, focus, onFocus, className, stack = false }: {
  services: RadarServiceRow[]; focus: ExplorerFocus; onFocus: (f: ExplorerFocus) => void; className?: string;
  /** Stack mode: the services are one company's tools. Overview draws each tool (inner ring) with a path to every provider it uses (outer ring). */
  stack?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [full]);

  const svc = useMemo(() => services.filter((s) => s.category !== "Cloud region canary"), [services]);
  const entities = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const s of svc) for (const e of entitiesOf(s)) {
      if (!m.has(e.key)) m.set(e.key, { ...e, services: [] });
      m.get(e.key)!.services.push(s);
    }
    return m;
  }, [svc]);
  const byId = useMemo(() => new Map(svc.map((s) => [s.id, s])), [svc]);

  const matches = query.trim().length >= 2
    ? [...[...entities.values()].filter((e) => e.label.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map((e) => ({ kind: "entity" as const, key: e.key, label: `${e.label}`, sub: `${LAYER_LABEL[e.layer]} · ${e.services.length} services` })),
       ...svc.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6).map((s) => ({ kind: "service" as const, key: s.id, label: s.name, sub: s.category }))]
    : [];

  // ---------- layouts ----------
  let nodes: Array<{ id: string; x: number; y: number; r: number; label: string; sub?: string; cls: string; onClick?: () => void; title: string }> = [];
  let edges: Array<{ a: string; b: string; w: number; cls?: string; label?: string }> = [];
  let panel: ReactNode = null;

  if (!focus && stack) {
    const ents = [...entities.values()].sort((a, b) => b.services.length - a.services.length || a.label.localeCompare(b.label)).slice(0, 16);
    const max = Math.max(...ents.map((e) => e.services.length), 1);
    ents.forEach((e, i) => {
      const [x, y] = polar(i, ents.length, 292);
      nodes.push({ id: e.key, x, y, r: 13 + 21 * Math.sqrt(e.services.length / max), label: shortProvider(e.label), sub: `${LAYER_LABEL[e.layer]} · ${e.services.length}`,
        cls: styles[`l_${e.layer}`], onClick: () => onFocus({ kind: "entity", key: e.key }), title: `${e.label}: ${e.services.length} of your ${svc.length} tools (${LAYER_LABEL[e.layer]})` });
    });
    const onRing = new Set(ents.map((e) => e.key));
    svc.forEach((s, i) => {
      const [x, y] = svc.length === 1 ? [CX, CY] as const : polar(i, svc.length, 128, -Math.PI / 2 + Math.PI / svc.length);
      nodes.push({ id: s.id, x, y, r: 10, label: s.name, cls: `${styles.svc} ${stateClass(s)}`, onClick: () => onFocus({ kind: "service", key: s.id }), title: `${s.name} (${s.state})` });
      for (const e of entitiesOf(s)) if (onRing.has(e.key)) edges.push({ a: s.id, b: e.key, w: 1, cls: styles[`e_${e.layer}`] });
    });
    const shared = ents.filter((e) => e.services.length >= 2);
    panel = (
      <>
        <p className={styles.pTitle}>Shared paths</p>
        <p className={styles.pText}>Each line is one dependency of one of your tools. Where several lines meet in one circle, a single outage there hits all of those tools at once. Click any circle for its full chain.</p>
        <ul className={styles.pList}>{shared.slice(0, 6).map((e) => (
          <li key={e.key}><button onClick={() => onFocus({ kind: "entity", key: e.key })}>{shortProvider(e.label)} <small>{LAYER_LABEL[e.layer]}</small></button><b>{e.services.length}/{svc.length}</b></li>
        ))}</ul>
        {!shared.length && <p className={styles.pSub}>No provider is shared by two or more of these tools.</p>}
      </>
    );
  } else if (!focus) {
    const top = [...entities.values()].filter((e) => e.layer !== "email" || e.services.length > 30)
      .sort((a, b) => b.services.length - a.services.length).slice(0, 18);
    const max = Math.max(...top.map((e) => e.services.length), 1);
    top.forEach((e, i) => {
      const [x, y] = polar(i, top.length, 290);
      nodes.push({ id: e.key, x, y, r: 10 + 34 * Math.sqrt(e.services.length / max), label: shortProvider(e.label), sub: `${LAYER_LABEL[e.layer]} · ${e.services.length}`,
        cls: styles[`l_${e.layer}`], onClick: () => onFocus({ kind: "entity", key: e.key }), title: `${e.label}: ${e.services.length} services (${LAYER_LABEL[e.layer]})` });
    });
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const a = new Set(top[i].services.map((s) => s.id));
      const shared = top[j].services.filter((s) => a.has(s.id)).length;
      if (shared >= 8 && !(top[i].layer === "region" && top[j].key.startsWith(`hosting:${top[i].key.split(":")[1].split("|")[0]}`))) edges.push({ a: top[i].key, b: top[j].key, w: shared, cls: styles.eShared });
    }
    const strongest = [...edges].sort((a, b) => b.w - a.w).slice(0, 5);
    panel = (
      <>
        <p className={styles.pTitle}>Hidden coupling</p>
        <p className={styles.pText}>Lines connect dependencies that share services. The thicker the line, the more services fail on <em>either</em> provider. Click any circle to see its blast radius.</p>
        <ul className={styles.pList}>{strongest.map((e) => (
          <li key={e.a + e.b}><span>{shortProvider(entities.get(e.a)!.label)} + {shortProvider(entities.get(e.b)!.label)}</span><b>{e.w}</b></li>
        ))}</ul>
      </>
    );
  } else if (focus.kind === "entity" && entities.has(focus.key)) {
    const E = entities.get(focus.key)!;
    const deps = [...E.services].sort((a, b) => (a.state === "up" ? 1 : 0) - (b.state === "up" ? 1 : 0) || a.name.localeCompare(b.name));
    const shown = deps.slice(0, 44);
    nodes.push({ id: E.key, x: CX, y: CY, r: 34, label: shortProvider(E.label), sub: `${LAYER_LABEL[E.layer]} · ${E.services.length} services`, cls: `${styles[`l_${E.layer}`]} ${styles.center}`, title: E.label });
    shown.forEach((s, i) => {
      const [x, y] = polar(i, shown.length, 175);
      nodes.push({ id: s.id, x, y, r: 6, label: s.name, cls: `${styles.svc} ${stateClass(s)}`, onClick: () => onFocus({ kind: "service", key: s.id }), title: `${s.name} (${s.state})` });
      edges.push({ a: E.key, b: s.id, w: 1, cls: styles[`e_${E.layer}`] });
    });
    // ring 2: what else these services depend on
    const co = new Map<string, number>();
    for (const s of deps) for (const e of entitiesOf(s)) if (e.key !== E.key && !(E.layer === "hosting" && e.layer === "region") && !(E.layer === "region" && e.layer === "hosting")) co.set(e.key, (co.get(e.key) ?? 0) + 1);
    const ring2 = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    ring2.forEach(([k, n], i) => {
      const e = entities.get(k)!;
      const [x, y] = polar(i, ring2.length, 315, -Math.PI / 2 + Math.PI / ring2.length);
      nodes.push({ id: k, x, y, r: 8 + 16 * Math.sqrt(n / deps.length), label: shortProvider(e.label), sub: `${n} shared`, cls: styles[`l_${e.layer}`], onClick: () => onFocus({ kind: "entity", key: k }), title: `${n} of these services also depend on ${e.label} (${LAYER_LABEL[e.layer]})` });
      for (const s of shown) if (entitiesOf(s).some((x) => x.key === k)) edges.push({ a: s.id, b: k, w: 1, cls: styles.eSecond });
    });
    const bad = deps.filter((s) => s.state !== "up");
    panel = (
      <>
        <p className={styles.pKicker}>{LAYER_LABEL[E.layer]}</p>
        <p className={styles.pTitle}>{E.label}</p>
        <p className={styles.pText}>If {shortProvider(E.label)} fails, <b>{deps.length}</b> monitored services lose their {LAYER_LABEL[E.layer].toLowerCase()}. {bad.length ? `${bad.length} report errors right now.` : "All of them are reachable right now."}</p>
        <p className={styles.pSub}>These services also depend on</p>
        <ul className={styles.pList}>{ring2.slice(0, 8).map(([k, n]) => (
          <li key={k}><button onClick={() => onFocus({ kind: "entity", key: k })}>{shortProvider(entities.get(k)!.label)} <small>{LAYER_LABEL[entities.get(k)!.layer]}</small></button><b>{n}</b></li>
        ))}</ul>
        {deps.length > shown.length && <p className={styles.pSub}>Showing {shown.length} of {deps.length} services (failing first).</p>}
      </>
    );
  } else if (focus.kind === "service" && byId.has(focus.key)) {
    const S = byId.get(focus.key)!;
    const chain = entitiesOf(S);
    nodes.push({ id: S.id, x: CX, y: CY, r: 22, label: S.name, sub: `${S.state}${S.latencyMs != null ? ` · ${S.latencyMs} ms` : ""}`, cls: `${styles.svc} ${stateClass(S)} ${styles.center}`, title: S.name });
    chain.forEach((c, i) => {
      const e = entities.get(c.key)!;
      const [x, y] = polar(i, chain.length, 210);
      nodes.push({ id: c.key, x, y, r: 12 + 18 * Math.min(1, Math.sqrt(e.services.length / 300)), label: shortProvider(c.label), sub: `shared by ${e.services.length}`, cls: styles[`l_${c.layer}`], onClick: () => onFocus({ kind: "entity", key: c.key }), title: `${c.label}: ${e.services.length} services depend on it` });
      edges.push({ a: S.id, b: c.key, w: 2, cls: styles[`e_${c.layer}`], label: LAYER_LABEL[c.layer] });
      // a few siblings per link, to show the shared blast radius
      const sib = e.services.filter((x) => x.id !== S.id).slice(0, 5);
      sib.forEach((x, j) => {
        const [sx, sy] = polar(i * 6 + j + 1, chain.length * 6, 320);
        const id = `${c.key}::${x.id}`;
        nodes.push({ id, x: sx, y: sy, r: 4, label: x.name, cls: `${styles.svc} ${styles.faint} ${stateClass(x)}`, onClick: () => onFocus({ kind: "service", key: x.id }), title: `${x.name} also depends on ${c.label}` });
        edges.push({ a: c.key, b: id, w: 1, cls: styles.eSecond });
      });
    });
    panel = (
      <>
        <p className={styles.pKicker}>{S.category}</p>
        <p className={styles.pTitle}>{S.name}</p>
        <p className={styles.pText}>Dependency chain{S.analyzedHost ? ` of ${S.analyzedHost}` : ""}:</p>
        <ol className={styles.chain}>{chain.map((c) => (
          <li key={c.key}><span>{LAYER_LABEL[c.layer]}</span><button onClick={() => onFocus({ kind: "entity", key: c.key })}>{c.label}</button><small>shared by {entities.get(c.key)!.services.length}</small></li>
        ))}</ol>
        {chain.length === 0 && <p className={styles.pSub}>No infrastructure could be mapped for this service.</p>}
        {S.cdn && !S.hostingProvider && <p className={styles.pSub}>The origin behind {S.cdn} is hidden, so the hosting link is unknown.</p>}
      </>
    );
  }

  const pos = new Map(nodes.map((n) => [n.id, n]));
  const lit = (id: string) => !hover || hover === id || edges.some((e) => (e.a === hover && e.b === id) || (e.b === hover && e.a === id));
  const maxW = Math.max(...edges.map((e) => e.w), 1);

  return (
    <div className={`${styles.wrap} ${full ? styles.full : ""} ${stack ? styles.stackMode : ""} ${className ?? ""}`}>
      <div className={styles.bar}>
        <div className={styles.crumbs}>
          <button onClick={() => onFocus(null)} className={!focus ? styles.on : ""}>All dependencies</button>
          {focus && <><span>/</span><span className={styles.on}>{focus.kind === "entity" ? shortProvider(entities.get(focus.key)?.label ?? "") : byId.get(focus.key)?.name}</span></>}
        </div>
        <div className={styles.search}>
          <input placeholder="Find a service or provider (e.g. Stripe, Cloudflare)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a service or provider" />
          {matches.length > 0 && (
            <ul className={styles.results}>{matches.map((m) => (
              <li key={m.kind + m.key}><button onClick={() => { onFocus({ kind: m.kind, key: m.key }); setQuery(""); }}>{m.label}<small>{m.sub}</small></button></li>
            ))}</ul>
          )}
        </div>
        <button className={styles.fullBtn} onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? "×" : "⤢"}</button>
      </div>
      <div className={styles.body}>
        <svg className={styles.svg} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Dependency graph">
          {edges.map((e, i) => {
            const a = pos.get(e.a), b = pos.get(e.b);
            if (!a || !b) return null;
            const on = !hover || hover === e.a || hover === e.b;
            const mx = (a.x + b.x) / 2 + (CY - (a.y + b.y) / 2) * 0.08, my = (a.y + b.y) / 2 + ((a.x + b.x) / 2 - CX) * 0.08;
            return (
              <g key={i} className={on ? undefined : styles.dim}>
                <path d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`} className={`${styles.edge} ${e.cls ?? ""}`} strokeWidth={!focus ? (stack ? 2 : 0.6 + 7 * (e.w / maxW)) : e.w} />
                {e.label && <text x={mx} y={my - 4} className={styles.edgeLabel}>{e.label}</text>}
              </g>
            );
          })}
          {nodes.map((n) => (
            <g key={n.id} className={`${styles.node} ${n.cls} ${lit(n.id) ? "" : styles.dim}`} onClick={n.onClick} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: n.onClick ? "pointer" : "default" }}>
              <circle cx={n.x} cy={n.y} r={n.r}><title>{n.title}</title></circle>
              {(n.r >= 8 || hover === n.id || focus?.kind === "service" || (focus?.kind === "entity" && nodes.length < 40)) && (
                <text x={n.x} y={n.y + n.r + 13} className={styles.nLabel}>{n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}</text>
              )}
              {n.sub && n.r >= 12 && <text x={n.x} y={n.y + n.r + 26} className={styles.nSub}>{n.sub}</text>}
            </g>
          ))}
        </svg>
        <aside className={styles.panel}>{panel}</aside>
      </div>
      <div className={styles.legend}>
        {(["hosting", "region", "cdn", "dns", "email"] as Layer[]).map((l) => <span key={l}><i className={styles[`l_${l}`]} />{LAYER_LABEL[l]}</span>)}
        <span><i className={styles.sUp} />service up</span><span><i className={styles.sDown} />down</span>
      </div>
    </div>
  );
}