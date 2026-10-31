import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { StatusBoard } from "../components/StatusBoard";
import { getBoardPreview } from "../endpoints/board/preview_GET.schema";
import { getRadarStatus, type RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { BOARD_TEMPLATES, templateBySlug, DEFAULT_SLA } from "../helpers/boardTemplates";
import { SITE_URL } from "../helpers/site";
import styles from "./boards.module.css";

type Draft = { title: string; accent: string; theme: "dark" | "light"; logo: string; ids: string[]; sla: number | null };
const fromTemplate = (slug: string): Draft => {
  const t = templateBySlug(slug) ?? BOARD_TEMPLATES[0];
  return { title: t.title, accent: t.accent, theme: t.theme, logo: "", ids: t.serviceIds, sla: t.sla ?? DEFAULT_SLA };
};

/** Public board gallery and builder: pick an example, change it, see it live. Sharing and embedding need the Team plan. */
export default function BoardsPage() {
  const [tpl, setTpl] = useState(BOARD_TEMPLATES[0].slug);
  const [d, setD] = useState<Draft>(fromTemplate(BOARD_TEMPLATES[0].slug));
  const [q, setQ] = useState("");
  const [all, setAll] = useState<RadarServiceRow[]>([]);
  const [debounced, setDebounced] = useState(d);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t && templateBySlug(t)) { setTpl(t); setD(fromTemplate(t)); }
    getRadarStatus().then((r) => r.status === "live" && setAll(r.services.filter((s) => s.category !== "Cloud region canary"))).catch(() => undefined);
  }, []);
  useEffect(() => { const h = setTimeout(() => setDebounced(d), 350); return () => clearTimeout(h); }, [d]);

  const preview = useQuery({
    queryKey: ["board-preview", debounced.ids.join(","), debounced.title, debounced.accent, debounced.theme, debounced.logo, debounced.sla],
    queryFn: () => getBoardPreview({ ids: debounced.ids, title: debounced.title, accent: debounced.accent, theme: debounced.theme, logo: debounced.logo || undefined, sla: debounced.sla }),
    enabled: debounced.ids.length > 0, refetchInterval: 60_000, placeholderData: (prev) => prev, staleTime: 30_000,
  });
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const sugg = q.trim().length >= 2 ? all.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) && !d.ids.includes(s.id)).slice(0, 8) : [];
  const pick = (slug: string) => { setTpl(slug); setD(fromTemplate(slug)); window.history.replaceState(null, "", `/boards?t=${slug}`); };
  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setTpl(""); };
  const nameOf = (id: string) => byId.get(id)?.name ?? preview.data?.items.find((i) => i.key === id)?.name ?? id;
  const desc = "Live status boards for Google Workspace, Google Cloud, Microsoft 365 and other tools your company depends on. Build your own with your logo and colour, share it or embed it.";

  return (
    <>
      <Helmet>
        <title>Status boards: live status of the tools your company runs on · ShadowGraph</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={`${SITE_URL}/boards`} />
        <meta property="og:title" content="Status boards for Google Workspace, Microsoft 365 and your own stack" />
        <meta property="og:description" content={desc} />
      </Helmet>
      <SiteHeader active="status" />
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>Status boards</span>
          <h1 className={styles.h1}>One page that tells your colleagues whether it's them or the tool.</h1>
          <p className={styles.lead}>Pick an example, change the services, the title and the colour, and watch it update live. Every service is checked every 5 minutes from our probes; provider incidents show up with what they affect.</p>
        </header>

        <section aria-label="Example boards">
          <ul className={styles.templates}>
            {BOARD_TEMPLATES.map((t) => (
              <li key={t.slug}>
                <button className={tpl === t.slug ? styles.tplOn : styles.tpl} onClick={() => pick(t.slug)} aria-pressed={tpl === t.slug}>
                  <span className={styles.swatch} style={{ background: t.accent }} aria-hidden="true" />
                  <b>{t.name}</b><small>{t.blurb}</small>
                </button>
                <a className={styles.open} href={`/boards/${t.slug}`}>Open live board</a>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.builder} aria-label="Board builder">
          <div className={styles.controls}>
            <label className={styles.label}>Title<input className={styles.input} value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className={styles.label}>Logo URL (https, optional)<input className={styles.input} value={d.logo} placeholder="https://yourcompany.com/logo.svg" onChange={(e) => set({ logo: e.target.value })} /></label>
            <div className={styles.two}>
              <label className={styles.label}>Colour<span className={styles.colour}><input type="color" value={d.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Accent colour" /><code>{d.accent}</code></span></label>
              <label className={styles.label}>Theme<select className={styles.input} value={d.theme} onChange={(e) => set({ theme: e.target.value as Draft["theme"] })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
            </div>
            <label className={styles.label}>Contract SLA target
              <select className={styles.input} value={d.sla ?? ""} onChange={(e) => set({ sla: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option><option value="0.995">99.5% · 3 h 39 min downtime allowed per month</option><option value="0.999">99.9% · 43 min per month</option>
                <option value="0.9995">99.95% · 22 min per month</option><option value="0.9999">99.99% · 4 min per month</option>
              </select>
            </label>
            <span className={styles.label}>Services ({d.ids.length}/50)</span>
            <div className={styles.search}>
              <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={all.length ? `Add any of ${all.length.toLocaleString("en-US")} services` : "Loading services…"} aria-label="Add a service" disabled={d.ids.length >= 50} />
              {sugg.length > 0 && <ul className={styles.sugg}>{sugg.map((s) => <li key={s.id}><button onClick={() => { set({ ids: [...d.ids, s.id] }); setQ(""); }}>{s.name}<small>{s.category}</small></button></li>)}</ul>}
            </div>
            <div className={styles.chips}>{d.ids.map((id) => <span key={id}>{nameOf(id)}<button onClick={() => set({ ids: d.ids.filter((x) => x !== id) })} aria-label={`Remove ${nameOf(id)}`}>×</button></span>)}</div>

            <div className={styles.cta}>
              <a className={styles.primary} href={`/alerts?plan=team&s=${encodeURIComponent(d.ids.join(","))}`}>Get this board with your own link</a>
              <p>The preview is not saved. The Team plan ($99/month, 14 days free) gives you a permanent link, an iframe for your intranet or client portal, your own endpoints on the board, alerts in Slack or Teams, and up to 5 boards.</p>
            </div>
          </div>

          <div className={styles.preview} aria-live="polite">
            {d.ids.length === 0 && <p className={styles.muted}>Add at least one service to see the board.</p>}
            {d.ids.length > 0 && !preview.data && <p className={styles.muted}>{preview.isError ? "The preview is unavailable right now." : "Loading the live board…"}</p>}
            {d.ids.length > 0 && preview.data && <StatusBoard board={preview.data} fill={false} />}
          </div>
        </section>

        <section className={styles.why} aria-labelledby="why-h">
          <h2 id="why-h" className={styles.h2}>Why IT teams pay for it</h2>
          <ul className={styles.reasons}>
            <li><b>Evidence when a vendor misses its SLA.</b><span>Set the SLA from your contract and every tool shows how much of this month's allowed downtime is used. Saved boards export a timestamped day-by-day record to back a service-credit claim or answer an auditor.</span></li>
            <li><b>Fewer "is it us or them?" tickets.</b><span>When Teams or Salesforce stalls, people check the board instead of the service desk. The answer is there before the first ticket is written.</span></li>
            <li><b>It sees what vendor status pages leave out.</b><span>Our own checks every 5 minutes, the incidents each vendor declares, and severe notices of the cloud, CDN and DNS provider underneath. When our checks fail before the vendor posts, the board says so, in minutes.</span></li>
            <li><b>Shared risk, in one sentence.</b><span>"6 of 6 depend on AWS Route 53 for DNS." Concentration you can show to management, auditors or under DORA and NIS2, not just a list of green dots.</span></li>
            <li><b>Your own systems next to your vendors.</b><span>Add up to 25 of your own endpoints. They appear by name only; the URLs stay private.</span></li>
            <li><b>Alerts and your brand.</b><span>The same events go to Slack, Microsoft Teams, a webhook or email. Logo, colour, a permanent link and an iframe for the intranet or a client portal; hide our footer if you resell it.</span></li>
          </ul>
          <div className={styles.compare}>
            <div><h3>Free preview</h3><ul><li>Any services from the radar</li><li>Live state, history, events, shared risk, SLA budget</li><li>Not saved, no link, no evidence export</li></ul></div>
            <div className={styles.compareOn}><h3>Team · $99 / month</h3><ul><li>5 saved boards with permanent links and iframes</li><li>SLA evidence export per board (current and previous month)</li><li>100 services and 25 of your own endpoints</li><li>Alerts in Slack, Teams, webhook and email</li><li>Your logo and colours, footer optional · 14 days free</li></ul>
              <a className={styles.primary} href={`/alerts?plan=team&s=${encodeURIComponent(d.ids.join(","))}`}>Start the 14-day trial</a></div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
