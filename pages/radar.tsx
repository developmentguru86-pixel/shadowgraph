import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Button } from "../components/Button";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { RadarMapView, type RadarMapNode } from "../components/RadarMapView";
import { buildRadarNodes, edgeOnlyCount } from "../helpers/radarNodes";
import { getRadarGlobal, type OutputType as GlobalView } from "../endpoints/radar/global_GET.schema";
import { RadarGlobe } from "../components/RadarGlobe";
import { WorldwideChecks } from "../components/WorldwideChecks";
import { DependencyExplorer, type ExplorerFocus } from "../components/DependencyExplorer";
import { getRadarStatus, type OutputType as Status, type RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { postRadarWaitlist } from "../endpoints/radar_waitlist_POST.schema";
import styles from "./radar.module.css";

type Live = Extract<Status, { status: "live" }>;

// ---- world land dot-matrix (Natural Earth 110m, 2° grid, lat 76..-56) ----
const MASK = "AAAAADivwAf//wAAAAADAAf/wAHYAAAAAADoi3sAP//gAAAAAMAD///sAAAAgBgACfwz/AD/+gAAAwAEHf///+/8gBAP/7/nJdjwD/+AAAH/AA7f///////f4P//////h8H/gAAAf/6//f////////Mf/////9H4D8AeAA+ev///////////AP/////4A0B4AAAD5/////////////Af3////gHgA4AAAH5///////////LwAHgH///gHkAAAAAH4/////////+CIAABAB///4D+AAAAGCx/////////4A8AAIAAf///n/gAAAOCD/////////wA4AAAAAf///n/wAAAbP///////////AgAAAAAP/////wAAADf//////////9AAAAAAAF////0YAAAB///////////9AAAAAAAD////8EAAAB///////////5AAAAAAAD////2AAAAB/f5fP//////wAAAAAAAD////gAAAAfxnwPP//////jAAAAAAAD////AAAAAPCb3/n/////+CAAAAAAAD///8AAAAAfALf/n////+ECAAAAAAAB///8AAAAAGHQP/n/////mMAAAAAAAA///8AAAAAH+Ai///////E8AAAAAAAAf//wAAAAAP/AA///////BgAAAAAAAAP//gAAAAAf/73///////gAAAAAAAAAD/AQAAAAAf////f/////gAAAAAAAAAF+AQAAAAB///+/n/////AAAAAAAAAAC+AAAAAAB///+f0H////AAAAAAAAAAAeAwAAAAD////f/B///8gAAAAAAAAAAeGEAAAAH////v+B/z/AAAAAAAAAAAAPMAgAAAD////n+A/B+gAAAAAAAAAAAD8AAAAAD////n4AeB/AgAAAAAAAAAAAPAAAAAH////3gAcAfAgAAAAAAAAAAADAAAAAD////6AAcAfggAAAAAAAAAAABDwAAAD////8wAMATAIAAAAAAAAAAAAr/AAAB/////gAKASAAAAAAAAAAAAAAH/gAAA/////gACAAAIAAAAAAAAAAAAH/8AAAaH///AAAAsGAAAAAAAAAAAAAH/+AAAAB//+AAAAUOAAAAAAAAAAAAAP/+AAAAB//8AAAAYegAAAAAAAAAAAAP//gAAAD//4AAAAMeBgAAAAAAAAAAAP//8AAAB//wAAAAGdiuAAAAAAAAAAAf///AAAA//wAAAACAQHgAAAAAAAAAAP///gAAA//wAAAABwAHwgAAAAAAAAAH///AAAA//wAAAAACIDQIAAAAAAAAAH//+AAAAf/wAAAAAAAAAAAAAAAAAAAD//+AAAA//wgAAAAABxAAAAAAAAAAAD//+AAAA//wgAAAAAPxgBAAAAAAAAAA//8AAAA//jgAAAAAf5gAAAAAAAAAAAf/8AAAA//DgAAAAAf/gAAAAAAAAAAAf/8AAAAf/DAAAAAD//4CAAAAAAAAAAf/wAAAAf/DAAAAAH//4AAAAAAAAAAAf/AAAAAf+CAAAAAH//8AAAAAAAAAAAf/AAAAAP8AAAAAAH//+AAAAAAAAAAA/+AAAAAP8AAAAAAH//+AAAAAAAAAAA/+AAAAAH4AAAAAAD//+AAAAAAAAAAA/8AAAAAHwAAAAAADwf8AAAAAAAAAAA/gAAAAAAAAAAAAACAH4AIAAAAAAAAB/wAAAAAAAAAAAAAAAD4AEAAAAAAAAB+AAAAAAAAAAAAAAAAAAAGAAAAAAAAB6AAAAAAAAAAAAAAAAAwAMAAAAAAAAA8AAAAAAAAAAAAAAAAAQAYAAAAAAAAB4AAAAAAAAAAAAAAAAAAAwAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAACAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAA";
const COLS = 180, ROWS = 66, CELL = 6, LAT_TOP = 76, LAT_SPAN = 132;
const W = COLS * CELL, H = ROWS * CELL;
const project = (lat: number, lon: number): [number, number] => [((lon + 180) / 360) * W, ((LAT_TOP - lat) / LAT_SPAN) * H];

function landPath() {
  if (typeof atob === "undefined") return "";
  const bin = atob(MASK);
  let d = "";
  for (let i = 0; i < COLS * ROWS; i++) {
    if ((bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) {
      const x = (i % COLS) * CELL + 1.6, y = Math.floor(i / COLS) * CELL + 1.6;
      d += `M${x} ${y}h2.6v2.6h-2.6z`;
    }
  }
  return d;
}

// cloud regions and country centroids (lat, lon, label)
const REGIONS: Record<string, [number, number, string]> = {
  "us-east-1": [38.9, -77.4, "N. Virginia"], "us-east-2": [40.0, -83.0, "Ohio"], "us-west-1": [37.4, -122.0, "N. California"],
  "us-west-2": [45.8, -119.7, "Oregon"], "ca-central-1": [45.5, -73.6, "Montreal"], "sa-east-1": [-23.5, -46.6, "São Paulo"],
  "eu-central-1": [50.1, 8.7, "Frankfurt"], "eu-central-2": [47.4, 8.5, "Zurich"], "eu-west-1": [53.3, -6.3, "Ireland"],
  "eu-west-2": [51.5, -0.1, "London"], "eu-west-3": [48.9, 2.4, "Paris"], "eu-north-1": [59.3, 18.1, "Stockholm"],
  "eu-south-1": [45.5, 9.2, "Milan"], "ap-northeast-1": [35.7, 139.7, "Tokyo"], "ap-northeast-2": [37.6, 127.0, "Seoul"],
  "ap-southeast-1": [1.35, 103.8, "Singapore"], "ap-southeast-2": [-33.9, 151.2, "Sydney"], "ap-south-1": [19.1, 72.9, "Mumbai"],
  "me-central-1": [24.5, 54.4, "UAE"], "af-south-1": [-33.9, 18.4, "Cape Town"],
  "europe-west3": [50.1, 8.7, "Frankfurt"], "europe-west1": [50.4, 3.8, "Belgium"], "europe-west4": [53.4, 6.8, "Netherlands"],
  "europe-west2": [51.5, -0.1, "London"], "us-central1": [41.3, -95.9, "Iowa"], "us-east1": [33.2, -80.0, "S. Carolina"],
  "us-east4": [39.0, -77.5, "N. Virginia"], "us-west1": [45.6, -121.2, "Oregon"], "asia-east1": [24.0, 120.9, "Taiwan"],
  "asia-northeast1": [35.7, 139.7, "Tokyo"], "asia-southeast1": [1.35, 103.8, "Singapore"],
};
const COUNTRIES: Record<string, [number, number, string]> = {
  US: [39.5, -98.4, "United States"], CA: [56, -106, "Canada"], BR: [-10, -52, "Brazil"], MX: [23.6, -102.5, "Mexico"],
  GB: [53.5, -2, "United Kingdom"], IE: [53.1, -8, "Ireland"], FR: [46.6, 2.4, "France"], DE: [51.2, 10.4, "Germany"],
  AT: [47.6, 14.1, "Austria"], CH: [46.8, 8.2, "Switzerland"], NL: [52.2, 5.3, "Netherlands"], BE: [50.6, 4.6, "Belgium"],
  LU: [49.8, 6.1, "Luxembourg"], DK: [56, 10, "Denmark"], SE: [62, 15, "Sweden"], NO: [61, 9, "Norway"], FI: [64, 26, "Finland"],
  PL: [52, 19.4, "Poland"], CZ: [49.8, 15.5, "Czechia"], IT: [42.8, 12.8, "Italy"], ES: [40.2, -3.6, "Spain"], PT: [39.6, -8, "Portugal"],
  TR: [39, 35, "Türkiye"], IL: [31.4, 35, "Israel"], AE: [24, 54, "UAE"], IN: [22, 79, "India"], SG: [1.35, 103.8, "Singapore"],
  HK: [22.3, 114.2, "Hong Kong"], CN: [35, 104, "China"], TW: [23.7, 121, "Taiwan"], JP: [36.2, 138.3, "Japan"],
  KR: [36.5, 127.8, "South Korea"], AU: [-25.3, 133.8, "Australia"], ZA: [-30.6, 22.9, "South Africa"], RU: [61.5, 99, "Russia"],
};
// main measurement node: AWS us-east-1 (N. Virginia). Measured, not assumed: 9 ms minimum to DynamoDB us-east-1,
// 12 ms to S3 us-east-1, 350+ ms to eu-central-1 (radar_checks of the regional canaries, 13 Oct 2026).
const VANTAGE: [number, number] = [38.9, -77.4];

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const clock = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v >= 0.9995 ? 0 : 2)}%`);
const pct0 = (v: number) => `${Math.round(v * 100)}%`;

type MapNode = RadarMapNode;

// region (exact) → city (IP geolocation of a visible origin) → country; shared with the homepage globe
function useNodes(services: RadarServiceRow[]): MapNode[] {
  return useMemo(() => buildRadarNodes(services), [services]);
}

function RadarMap({ live, selected, onSelect }: { live: Live; selected: string | null; onSelect: (k: string | null) => void }) {
  const [land, setLand] = useState("");
  useEffect(() => setLand(landPath()), []);
  const nodes = useNodes(live.services);
  const hotRegions = new Set(live.incidents.filter((i) => i.status === "open" && i.layer === "region").map((i) => i.provider.split(" ").pop()));
  const [vx, vy] = project(...VANTAGE);
  return (
    <svg className={styles.map} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Live map of monitored cloud regions and hosting locations">
      <defs>
        <radialGradient id="sweepG" cx="0" cy="0" r="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></radialGradient>
      </defs>
      <path d={land} className={styles.land} />
      {[60, 30, 0, -30].map((lat) => { const [, y] = project(lat, 0); return <line key={lat} x1={0} y1={y} x2={W} y2={y} className={lat === 0 ? styles.equator : styles.grid} />; })}
      <g className={styles.sweep} style={{ transformOrigin: `${vx}px ${vy}px` }}>
        <path d={`M ${vx} ${vy} L ${vx + 900} ${vy - 230} A 930 930 0 0 1 ${vx + 900} ${vy + 230} Z`} fill="url(#sweepG)" />
      </g>
      {nodes.map((n) => {
        const bad = n.services.filter((s) => s.state === "down" || s.state === "degraded").length;
        if (!bad && !hotRegions.has(n.sub)) return null;
        const mx = (vx + n.x) / 2, my = Math.min(vy, n.y) - Math.abs(n.x - vx) * 0.18;
        return <path key={`a${n.key}`} d={`M${vx} ${vy} Q${mx} ${my} ${n.x} ${n.y}`} className={styles.arc} />;
      })}
      <g><circle cx={vx} cy={vy} r={4} className={styles.vantage} /><text x={vx + 8} y={vy + 16} className={styles.vantageLabel}>probe node</text></g>
      {nodes.map((n) => {
        const down = n.services.filter((s) => s.state === "down").length;
        const deg = n.services.filter((s) => s.state === "degraded").length;
        const hot = hotRegions.has(n.sub) || down > 0;
        const r = 3.5 + Math.sqrt(n.services.length) * 2.4;
        const cls = hot ? styles.nodeDown : deg ? styles.nodeWarn : n.kind === "country" ? styles.nodeCountry : styles.nodeUp;
        return (
          <g key={n.key} className={`${cls} ${selected === n.key ? styles.nodeSel : ""}`} onClick={() => onSelect(selected === n.key ? null : n.key)} style={{ cursor: "pointer" }}>
            {hot && [0, 1, 2].map((k) => <circle key={k} cx={n.x} cy={n.y} r={r} className={styles.ring} style={{ animationDelay: `${k * 0.6}s` }} />)}
            <circle cx={n.x} cy={n.y} r={r + 6} fill="transparent" />
            <circle cx={n.x} cy={n.y} r={r} className={styles.node}><title>{`${n.label} (${n.sub}): ${n.services.length} services · ${down} down · ${deg} degraded`}</title></circle>
            {n.services.length >= 3 && <text x={n.x} y={n.y - r - 5} className={styles.nodeLabel}>{n.label} · {n.services.length}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Bars({ rows, accent }: { rows: Array<{ provider: string; services: number; share: number }>; accent?: boolean }) {
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.provider} className={styles.barRow}>
          <span className={styles.barName}>{r.provider}</span>
          <span className={styles.barTrack}><i className={accent ? styles.barFillAlt : styles.barFill} style={{ width: `${Math.max(2, r.share * 100)}%` }} /></span>
          <span className={styles.barVal}>{pct0(r.share)}</span>
        </div>
      ))}
    </div>
  );
}

function Timeline({ live }: { live: Live }) {
  const max = Math.max(1, ...live.timeline.map((t) => t.failed / Math.max(t.checks, 1)));
  return (
    <div className={styles.timeline}>
      {live.timeline.length === 0 && <p className={styles.muted}>Collecting the first hours of data.</p>}
      <div className={styles.tlBars}>
        {live.timeline.map((t) => {
          const f = t.failed / Math.max(t.checks, 1);
          return <span key={t.bucket} className={f > 0.05 ? styles.tlBad : f > 0 ? styles.tlWarn : styles.tlOk} style={{ height: `${8 + (f / max) * 92}%` }} title={`${clock(t.bucket)} · ${t.failed}/${t.checks} failed probes · ${t.services} services`} />;
        })}
      </div>
      <div className={styles.tlAxis}><span>{live.timeline[0] ? clock(live.timeline[0].bucket) : ""}</span><span>now</span></div>
    </div>
  );
}

export default function RadarPage() {
  const [data, setData] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mapView, setMapView] = useState<"globe" | "flat">("globe");
  const [explorerFocus, setExplorerFocus] = useState<ExplorerFocus>(null);
  const [email, setEmail] = useState("");
  const [mine, setMine] = useState("");
  const [joined, setJoined] = useState<"idle" | "sending" | "done" | "error">("idle");

  useEffect(() => {
    let alive = true;
    const load = () => getRadarStatus().then((d) => { if (alive) { setData(d); setFailed(false); } }).catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const [global, setGlobal] = useState<GlobalView | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getRadarGlobal().then((d) => alive && setGlobal(d)).catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const live = data?.status === "live" ? data : null;
  const nodes = useNodes(live?.services ?? []);
  const probes = useMemo(() => [
    { lat: 38.9, lon: -77.4, label: "N. Virginia · every 5 min", ok: !live?.run.vantageSuspect },
    ...(global?.probes ?? []).map((p) => ({ lat: p.lat, lon: p.lon, label: `${p.city ?? "?"} · ${p.continent}`, ok: p.ok === p.total })),
  ], [global, live?.run.vantageSuspect]);
  const edgeOnly = live ? edgeOnlyCount(live.services) : null;
  const sel = nodes.find((n) => n.key === selected) ?? null;
  const hotRegions = new Set((live?.incidents ?? []).filter((i) => i.status === "open" && i.layer === "region").map((i) => i.provider.split(" ").pop()));
  // red only for real incidents: a detected region incident, or >= 3 services down that are >= 10% of the location
  const hotKeys = new Set(nodes.filter((n) => {
    const down = n.services.filter((s) => s.state === "down").length;
    return hotRegions.has(n.sub) || (down >= 3 && down / n.services.length >= 0.1);
  }).map((n) => n.key));
  const open = live?.incidents.filter((i) => i.status === "open") ?? [];
  const recent = live?.incidents.filter((i) => i.status !== "open").slice(0, 5) ?? [];
  const errors = live ? live.services.filter((s) => s.state === "down" || s.state === "degraded") : [];
  const rows = (sel ? sel.services : live?.services ?? []).filter((s) => !filter || `${s.name} ${s.category} ${s.hostingProvider ?? ""} ${s.hostingRegion ?? ""} ${s.cdn ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const nProviders = live ? new Set(live.services.map((s) => s.hostingProvider).filter(Boolean)).size : null;

  const join = async () => {
    setJoined("sending");
    try { const r = await postRadarWaitlist({ email, services: mine || undefined, channel: "radar-page" }); setJoined("ok" in r ? "done" : "error"); }
    catch { setJoined("error"); }
  };

  return (
    <>
    <SiteHeader active="radar" />
    <main className={styles.page}>
      <Helmet>
        <title>Internet Outages Right Now · Live Outage Map | ShadowGraph</title>
        <meta name="description" content="Is the internet down? Live outage map for AWS, Azure, Google Cloud, Cloudflare and thousands of apps and APIs, checked every 5 minutes. See what is down and which provider is behind it." />
        <meta property="og:title" content="Internet Outages Right Now · Live Outage Map" />
        <meta property="og:description" content="Is the internet down? Live outage map for AWS, Azure, Google Cloud, Cloudflare and thousands of apps and APIs, checked every 5 minutes. See what is down and which provider is behind it." />
      </Helmet>

      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.eyebrow}><i className={open.length ? styles.dotRed : styles.dotGreen} /> Internet Outage Radar · live</span>
          <h1 className={styles.h1}>{open.length ? `${open.length} active provider incident${open.length > 1 ? "s" : ""}` : "All monitored providers operational"}</h1>
          <p className={styles.sub}>What is down, which provider is behind it, and who is at risk next.</p>
        </div>
        <div className={styles.kpis}>
          <div><b>{live ? live.run.total : "—"}</b><span>services probed</span></div>
          <div><b>{live ? live.run.up : "—"}</b><span>reachable</span></div>
          <div><b className={errors.length ? styles.warnText : ""}>{live ? errors.length : "—"}</b><span>with errors</span></div>
          <div><b>{nProviders ?? "—"}</b><span>hosting networks</span></div>
          <div><b>{live?.run.medianLatencyMs != null ? `${live.run.medianLatencyMs} ms` : "—"}</b><span>median latency</span></div>
          <div><b>{live ? ago(live.run.at) : "—"}</b><span>last sweep · every 5 min</span></div>
        </div>
      </header>

      {failed && <p className={styles.warnText}>Radar data unavailable right now.</p>}
      {data?.status === "warming_up" && <p className={styles.muted}>The radar is running its first sweeps. This page fills in within a few minutes.</p>}
      {live?.run.vantageSuspect && <p className={styles.warnText}>Most probes failed in the last sweep, which points at our own measurement node. Incidents are suppressed until it recovers.</p>}

      <section className={styles.mapWrap}>
        <div className={styles.viewToggle} role="tablist" aria-label="Map view">
          <button role="tab" aria-selected={mapView === "globe"} className={mapView === "globe" ? styles.viewOn : ""} onClick={() => setMapView("globe")}>Globe</button>
          <button role="tab" aria-selected={mapView === "flat"} className={mapView === "flat" ? styles.viewOn : ""} onClick={() => setMapView("flat")}>Flat map</button>
        </div>
        {!live ? <div className={styles.mapSkeleton} />
          : mapView === "globe" ? <RadarGlobe nodes={nodes} hotKeys={hotKeys} selected={selected} onSelect={setSelected} probes={probes} agentLayer />
          : <RadarMapView nodes={nodes} hotKeys={hotKeys} selected={selected} onSelect={setSelected} />}
        <div className={styles.mapLegend}>
          <span><i className={styles.lgUp} />cloud region</span><span><i className={styles.lgCountry} />server location (city or country)</span>
          <span><i className={styles.lgWarn} />errors</span><span><i className={styles.lgDown} />incident · blast radius</span>
          {mapView === "globe" && <span><i className={styles.lgProbe} />measurement point</span>}
          <span className={styles.muted}>Circle size = services hosted there. {edgeOnly ? `${edgeOnly} services have no single location (they answer from CDN or anycast edges worldwide, or hide their origin) and are not drawn. ` : ""}{mapView === "globe" ? "Drag to rotate, pinch or scroll to zoom, tap a node for details." : "Click a node for details."}</span>
        </div>
      </section>

      <section className={styles.worldwide} id="worldwide">
        <div className={styles.explorerHead}>
          <div>
            <span className={styles.eyebrow}>Measured from six continents</span>
            <h2 className={styles.explorerTitle}>Is it down everywhere, or only here?</h2>
          </div>
          <p className={styles.muted}>Our main radar probes all {live ? live.run.total : "900"} services every 5 minutes from AWS us-east-1 (N. Virginia). Every 30 minutes, key infrastructure and every service that this node sees failing are checked again from North and South America, Europe, Asia, Oceania and Africa. That separates a global outage from a regional or measurement-path problem.</p>
        </div>
        <WorldwideChecks data={global} />
      </section>

      <section className={styles.explorer}>
        <div className={styles.explorerHead}>
          <div>
            <span className={styles.eyebrow}>Dependency graph</span>
            <h2 className={styles.explorerTitle}>Follow every path</h2>
          </div>
          <p className={styles.muted}>Click a provider to see every service that depends on it and what else those services rely on. Click a service to see its full chain: CDN, hosting, region, DNS and email.</p>
        </div>
        {live ? <DependencyExplorer services={live.services} focus={explorerFocus} onFocus={setExplorerFocus} /> : <div className={styles.mapSkeleton} />}
      </section>

      <div className={styles.grid3}>
        <section className={styles.card}>
          <h2 className={styles.h2}>Provider incidents</h2>
          {open.length === 0 && <p className={styles.muted}>None right now. An incident is declared only when several independent services on the same provider, region, CDN or DNS fail in two consecutive sweeps.</p>}
          {open.map((i) => (
            <article key={i.id} className={styles.incident}>
              <div className={styles.incHead}><span className={styles.badgeOpen}>open</span><b>{i.provider}</b></div>
              <p className={styles.muted}>{i.layer} · since {ago(i.startedAt)}</p>
              <p className={styles.incLine}><b>{i.affected.length} down:</b> {i.affected.map((a) => a.name).join(", ")}</p>
              {i.atRisk.length > 0 && <p className={styles.incLine}><b>{i.atRisk.length} at risk:</b> {i.atRisk.slice(0, 10).map((a) => a.name).join(", ")}{i.atRisk.length > 10 ? " …" : ""}</p>}
            </article>
          ))}
          {recent.length > 0 && <><h3 className={styles.h3}>Resolved · last 7 days</h3>{recent.map((i) => <p key={i.id} className={styles.feedLine}>{i.provider} · {i.affected.length} services · {new Date(i.startedAt).toUTCString().slice(5, 22)}</p>)}</>}
        </section>

        <section className={styles.card}>
          <h2 className={styles.h2}>Live event feed</h2>
          {live && live.events.length === 0 && <p className={styles.muted}>No state changes in the last 6 hours.</p>}
          <ul className={styles.feed}>
            {live?.events.slice(0, 14).map((e) => (
              <li key={`${e.serviceId}${e.at}`}><span className={styles.mono}>{clock(e.at)}</span><i className={e.ok ? styles.sUp : styles.sDown} /><b>{e.name}</b><span className={styles.muted}>{e.ok ? "recovered" : e.error ?? `HTTP ${e.httpStatus}`}</span></li>
            ))}
          </ul>
          {errors.length > 0 && <><h3 className={styles.h3}>Currently failing</h3>{errors.slice(0, 8).map((s) => <p key={s.id} className={styles.feedLine}><span className={s.state === "down" ? styles.badgeOpen : styles.badgeWarn}>{s.state}</span> {s.name} · {s.error ?? `HTTP ${s.httpStatus}`}</p>)}</>}
        </section>

        <section className={styles.card}>
          <h2 className={styles.h2}>Error rate · 24h</h2>
          {live ? <Timeline live={live} /> : <div className={styles.skeleton} />}
          <h3 className={styles.h3}>By category</h3>
          <div className={styles.catGrid}>
            {live?.categories.map((c) => (
              <div key={c.category} className={styles.cat}><span>{c.category}</span><b className={c.errors ? styles.warnText : ""}>{c.services - c.errors}/{c.services}</b><span className={styles.mono}>{c.medianLatencyMs != null ? `${c.medianLatencyMs} ms` : "—"}</span></div>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHead}><h2 className={styles.h2}>How concentrated is the internet?</h2><span className={styles.muted}>share of monitored services per provider</span></div>
        <div className={styles.grid4}>
          <div><h3 className={styles.h3}>Hosting</h3>{live && <Bars rows={live.concentration.hosting} />}</div>
          <div><h3 className={styles.h3}>CDN / edge</h3>{live && <Bars rows={live.concentration.cdn} accent />}</div>
          <div><h3 className={styles.h3}>DNS</h3>{live && <Bars rows={live.concentration.dns} />}</div>
          <div><h3 className={styles.h3}>Email</h3>{live && <Bars rows={live.concentration.email} accent />}</div>
        </div>
      </section>

      <div className={styles.grid2}>
        <section className={styles.card}>
          <h2 className={styles.h2}>Providers</h2>
          <div className={styles.provGrid}>
            {live?.providers.map((p) => (
              <div key={p.provider} className={`${styles.prov} ${p.errors ? styles.provBad : ""}`}>
                <span className={styles.provName}>{p.provider}</span>
                <b>{p.services}</b><span className={styles.muted}>services</span>
                <span className={styles.mono}>{p.errors ? `${p.errors} with errors` : "operational"} · {p.medianLatencyMs != null ? `${p.medianLatencyMs} ms` : "—"}</span>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.card}>
          <h2 className={styles.h2}>Data-center regions</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Provider</th><th>Region</th><th className={styles.num}>Services</th><th>Health</th></tr></thead>
              <tbody>
                {(live?.infrastructure ?? []).filter((g) => g.region).slice(0, 16).map((g) => (
                  <tr key={`${g.provider}${g.region}`}>
                    <td>{g.provider}</td><td className={styles.mono}>{g.region}</td><td className={styles.num}>{g.services}</td>
                    <td><span className={styles.health}><i className={styles.hUp} style={{ flex: g.up }} /><i className={styles.hWarn} style={{ flex: g.degraded }} /><i className={styles.hDown} style={{ flex: g.down }} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className={styles.alert}>
        <div>
          <span className={styles.eyebrow}>Stack alerts · free for a limited time</span>
          <h2 className={styles.h2}>Know before your vendor's status page does</h2>
          <p className={styles.muted}>Pick the services you depend on and add your own endpoints. When one of them, or the provider underneath it, starts failing, you get a Slack, Teams, webhook or email alert with the blast radius. Free for a limited time, no credit card.</p>
        </div>
        <div className={styles.form}>
          <Button asChild><a href="/alerts">Get free alerts</a></Button>
          <Button asChild variant="outline"><a href="/check">Check your stack first</a></Button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.h2}>{sel ? `Services in ${sel.label}` : "All monitored services"} <span className={styles.muted}>({rows.length})</span></h2>
          <div className={styles.headActions}>
            {sel && <button className={styles.linkBtn} onClick={() => setSelected(null)}>Show all</button>}
            <input className={styles.search} placeholder="Filter by name, category, provider, region, CDN" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter services" />
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Service</th><th>Status</th><th className={styles.num}>Latency</th><th className={styles.num}>24h uptime</th><th>Hosting</th><th>CDN</th><th>DNS</th></tr></thead>
            <tbody>
              {!live && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7}><span className={styles.skeleton} /></td></tr>)}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><span className={styles.svcName}>{s.name}</span><span className={styles.cat2}>{s.category}</span></td>
                  <td><span className={s.state === "up" ? styles.badgeUp : s.state === "down" ? styles.badgeOpen : s.state === "degraded" ? styles.badgeWarn : styles.badgeIdle}>{s.state}</span></td>
                  <td className={styles.num}>{s.latencyMs !== null ? `${s.latencyMs} ms` : "—"}</td>
                  <td className={styles.num}>{pct(s.uptime24h)}</td>
                  <td>{s.hostingProvider ?? <span className={styles.muted}>{s.cdn ? "behind CDN" : "—"}</span>}{s.hostingRegion && <span className={styles.region}>{s.hostingRegion}</span>}{!s.hostingRegion && s.hostingCountry && <span className={styles.region}>{s.hostingCountry}</span>}</td>
                  <td>{s.cdn ?? "—"}</td>
                  <td>{s.dnsProvider ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>Full sweeps run every 5 minutes from our main measurement node in AWS us-east-1 (N. Virginia); a service counts as down after two consecutive failed probes, and targets our node can never reach are removed automatically. Every 30 minutes, infrastructure anchors and every service the main node sees failing are re-checked from six continents through the Globalping probe network. Any HTTP answer below 500 counts as reachable. Infrastructure is inferred from public DNS, network ownership (ASN) and the AWS / Google Cloud published IP ranges; city locations of directly visible servers come from <a href="https://db-ip.com" target="_blank" rel="noreferrer">IP Geolocation by DB-IP</a> (IP-to-City Lite, CC BY 4.0, approximate). Worldwide checks: <a href="https://globalping.io" target="_blank" rel="noreferrer">Globalping</a>. Map: Natural Earth.</p>
      </section>
    </main>
    <SiteFooter />
    </>
  );
}
