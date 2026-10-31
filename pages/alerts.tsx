import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { getRadarStatus, type RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { postAlertsCheckout } from "../endpoints/alerts_checkout_POST.schema";
import { postAlertsClaim } from "../endpoints/alerts_claim_POST.schema";
import { postAlertsManage, type View, type MonitorView } from "../endpoints/alerts_manage_POST.schema";
import { BoardManager } from "../components/BoardManager";
import { PLANS, type PlanId } from "../helpers/alertPlans";
import { ALERTS_FREE } from "../helpers/promo";
import styles from "./alerts.module.css";

const TOKEN_KEY = "sg_alerts_token";
const KIND: Record<string, string> = { incident: "Provider incident", incident_resolved: "Resolved", warning: "Early warning", down: "Service down", certificate: "Certificate", domain: "Domain", change: "Infra change", upstream: "Upstream signal", recovered: "Recovered", slow: "Slow", test: "Test" };
const daysTo = (iso: string | null) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : null);
const since = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`; };

function MonitorRow({ m, onRemove }: { m: MonitorView; onRemove: () => void }) {
  const cert = daysTo(m.certNotAfter), dom = daysTo(m.domainExpiresAt);
  const state = m.ok === null ? "pending" : m.ok ? "up" : m.downSince ? "down" : "failing";
  return (
    <li className={styles.mon}>
      <div className={styles.monMain}>
        <span className={styles[`st_${state}`]}>{state === "down" ? `Down ${since(m.downSince!)}` : state === "failing" ? "Failing" : state === "up" ? "Up" : "Checking"}</span>
        <div className={styles.monName}><b>{m.name}</b><span className={styles.mono}>{m.url}</span></div>
        <button className={styles.monRemove} onClick={onRemove} aria-label={`Stop monitoring ${m.name}`}>Remove</button>
      </div>
      <div className={styles.monStats}>
        <span><small>Now</small>{m.latencyMs != null ? `${m.latencyMs} ms` : m.error ?? "—"}</span>
        <span><small>Median 24h</small>{m.p50Ms != null ? `${Math.round(m.p50Ms)} ms` : "—"}</span>
        <span><small>Uptime 24h</small>{m.uptime24h != null ? `${(m.uptime24h * 100).toFixed(m.uptime24h >= 0.9995 ? 0 : 2)}%` : "—"}</span>
        <span><small>Hosting</small>{m.hostingProvider ? `${m.hostingProvider}${m.hostingRegion ? ` · ${m.hostingRegion}` : ""}` : m.cdn ? "hidden by CDN" : "—"}</span>
        <span><small>CDN / DNS</small>{[m.cdn, m.dnsProvider].filter(Boolean).join(" · ") || "—"}</span>
        <span><small>Certificate</small><em className={cert === null ? "" : cert < 7 ? styles.bad : cert < 21 ? styles.warnTxt : ""}>{cert === null ? (m.url.startsWith("https") ? "—" : "no TLS") : cert < 0 ? "expired" : `${cert} days`}</em></span>
        <span><small>Domain</small><em className={dom === null ? "" : dom < 14 ? styles.bad : dom < 30 ? styles.warnTxt : ""}>{dom === null ? "—" : dom < 0 ? "expired" : `${dom} days`}</em></span>
      </div>
    </li>
  );
}

function ServicePicker({ all, value, onChange, limit = 25 }: { all: RadarServiceRow[]; value: string[]; onChange: (v: string[]) => void; limit?: number }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const sugg = q.trim().length >= 2 ? all.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) && !value.includes(s.id)).slice(0, 8) : [];
  return (
    <div className={styles.picker}>
      <div className={styles.searchBox}>
        <input placeholder={all.length ? `Add a service (${value.length}/${limit})` : "Loading services…"} value={q} onChange={(e) => setQ(e.target.value)} disabled={!all.length || value.length >= limit} aria-label="Add a service" />
        {sugg.length > 0 && <ul className={styles.sugg}>{sugg.map((s) => <li key={s.id}><button onClick={() => { onChange([...value, s.id]); setQ(""); }}>{s.name}<small>{s.category}</small></button></li>)}</ul>}
      </div>
      <div className={styles.chips}>
        {value.map((id) => <span key={id}>{byId.get(id)?.name ?? id}<button onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove">×</button></span>)}
        {!value.length && <span className={styles.muted}>No services selected</span>}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [all, setAll] = useState<RadarServiceRow[]>([]);
  const [mode, setMode] = useState<"buy" | "claiming" | "manage">("buy");
  const [token, setToken] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // buy form
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanId>("alerts");
  // manage form
  const [svc, setSvc] = useState<string[]>([]);
  const [slack, setSlack] = useState(""); const [teams, setTeams] = useState(""); const [hook, setHook] = useState("");
  const [mName, setMName] = useState(""); const [mUrl, setMUrl] = useState(""); const [mExpect, setMExpect] = useState<"any_lt_500" | "success">("any_lt_500");
  const [mErr, setMErr] = useState<string | null>(null); const [mBusy, setMBusy] = useState(false);

  useEffect(() => {
    getRadarStatus().then((d) => d.status === "live" && setAll(d.services.filter((s) => s.category !== "Cloud region canary"))).catch(() => undefined);
    const q = new URLSearchParams(window.location.search);
    const sid = q.get("session_id"), m = q.get("m") ?? localStorage.getItem(TOKEN_KEY);
    if (q.get("plan") === "team") setPlan("team");
    if (q.get("s")) setPicked(q.get("s")!.split(",").filter(Boolean).slice(0, 100));
    if (q.get("e")) setEmail(q.get("e")!);
    if (q.get("free") === "sent") setMsg(`Check your inbox${q.get("e") ? ` (${q.get("e")})` : ""}: we sent you the link that activates your free alerts. It is also your private settings page.`);
    if (sid) {
      setMode("claiming");
      postAlertsClaim({ sessionId: sid }).then((r) => {
        if (r.status === "issued") { localStorage.setItem(TOKEN_KEY, r.token); window.history.replaceState(null, "", `/alerts?m=${r.token}`); setToken(r.token); setFresh(true); setMode("manage"); }
        else if (m) { setToken(m); setMode("manage"); }
        else { setMode("buy"); setMsg(r.status === "already_claimed" ? "This purchase is already set up. Open your management link from the device you used, or contact us." : r.status === "not_paid" ? "Stripe has not confirmed the checkout yet. Refresh in a minute." : "We could not find that checkout."); }
      }).catch(() => { setMode("buy"); setMsg("Could not confirm the checkout. Refresh to retry."); });
    } else if (m) { setToken(m); setMode("manage"); }
  }, []);

  useEffect(() => {
    if (mode !== "manage" || !token) return;
    postAlertsManage({ token, action: "view" }).then((r) => {
      if (r.view) { setView(r.view); setSvc(r.view.serviceIds); localStorage.setItem(TOKEN_KEY, token); }
      else { setMsg(r.error ?? "Unknown management link"); localStorage.removeItem(TOKEN_KEY); setMode("buy"); }
    });
  }, [mode, token]);

  const isFree = (p: PlanId) => ALERTS_FREE && p === "alerts";
  const buy = async () => {
    setBusy(true); setMsg(null);
    const r = await postAlertsCheckout({ email, serviceIds: picked.slice(0, PLANS[plan].services), plan }).catch(() => ({ error: "Checkout unavailable" }) as { error: string; url?: string });
    if (r.url) window.location.href = r.url; else { setMsg(r.error ?? "Checkout unavailable"); setBusy(false); }
  };
  const act = async (action: "update" | "test" | "portal") => {
    if (!token) return;
    setBusy(true); setMsg(null);
    const body = action === "update" ? { token, action, serviceIds: svc, ...(slack ? { slack } : {}), ...(teams ? { teams } : {}), ...(hook ? { webhook: hook } : {}) } : { token, action };
    const r = await postAlertsManage(body);
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (action === "portal" && r.url) { window.location.href = r.url; return; }
    if (action === "test") setMsg(`Test sent: ${Object.entries(r.channels ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "no channel connected yet"}`);
    if (r.view) { setView(r.view); setSlack(""); setTeams(""); setHook(""); setMsg("Saved."); }
  };
  const remove = async (field: "slack" | "teams" | "webhook") => {
    if (!token) return;
    const r = await postAlertsManage({ token, action: "update", [field]: null });
    if (r.view) setView(r.view);
  };
  const addMonitor = async () => {
    if (!token) return;
    setMBusy(true); setMErr(null);
    const r = await postAlertsManage({ token, action: "addMonitor", monitor: { name: mName, url: mUrl, expect: mExpect } }).catch(() => ({ error: "Could not add the endpoint" }) as { error: string });
    setMBusy(false);
    if ("view" in r && r.view) { setView(r.view); setMName(""); setMUrl(""); } else setMErr(r.error ?? "Could not add the endpoint");
  };
  const removeMonitor = async (monitorId: string) => {
    if (!token) return;
    const r = await postAlertsManage({ token, action: "removeMonitor", monitorId });
    if (r.view) setView(r.view);
  };

  return (
    <>
      <Helmet>
        <title>Stack alerts: know before your vendors' status pages do · ShadowGraph</title>
        <meta name="description" content="Slack, Teams, webhook and email alerts when a service you depend on, or the provider underneath it, starts failing. Early warnings, certificate and domain risk, infrastructure changes." />
        <meta property="og:title" content="Stack alerts: know before your vendors' status pages do" />
        <meta property="og:description" content="Slack, Teams, webhook and email alerts when a service you depend on, or the provider underneath it, starts failing. Early warnings, certificate and domain risk, infrastructure changes." />
      </Helmet>
      <SiteHeader />
      <main className={styles.page}>
        {mode === "claiming" && <p className={styles.muted}>Confirming your subscription with Stripe…</p>}

        {mode === "buy" && (
          <div className={styles.buy}>
            <div>
              <span className={styles.eyebrow}>Stack alerts</span>
              <h1 className={styles.h1}>Know before your vendors' status pages do.</h1>
              <ul className={styles.features}>
                <li><b>Provider incidents</b> with the blast radius: which of your services are down, which are at risk next.</li>
                <li><b>Early warnings</b> when your providers slow down, before anyone declares an outage.</li>
                <li><b>Upstream signals</b> when several companies on one of your providers declare incidents within the same hour, often before the provider says anything.</li>
                <li><b>Certificate and domain risk</b> on your vendors, days before it turns into an outage.</li>
                <li><b>Infrastructure changes</b> when a vendor moves hosting, region, CDN or DNS.</li>
                <li><b>Your own endpoints:</b> up to 10 URLs of your own (API, app, checkout) checked every 5 minutes, with uptime, latency, certificate and domain expiry, and an alert when the provider they run on has an incident.</li>
                <li><b>Where you work:</b> Slack, Microsoft Teams, a JSON webhook, and email.</li>
                <li><b>Team plan:</b> 100 services, 25 own endpoints and 5 <b>branded status boards</b> with your logo and colour, to share with a team or embed in a client portal.</li>
              </ul>
            </div>
            <section className={styles.card}>
              <div className={styles.plans} role="radiogroup" aria-label="Plan">
                {(["alerts", "team"] as PlanId[]).map((id) => (
                  <button key={id} role="radio" aria-checked={plan === id} className={plan === id ? styles.planOn : styles.planOff} onClick={() => setPlan(id)}>
                    <b>{PLANS[id].name}</b><span>{isFree(id) ? <>Free <s>{PLANS[id].priceLabel}</s></> : `${PLANS[id].priceLabel} / month`}</span>
                    <small>{PLANS[id].services} services · {PLANS[id].monitors} endpoints{PLANS[id].boards ? ` · ${PLANS[id].boards} status boards` : ""}</small>
                  </button>
                ))}
              </div>
              <div className={styles.price}>{isFree(plan) ? "Free" : PLANS[plan].priceLabel}<small>{isFree(plan) ? ` for a limited time · normally ${PLANS[plan].priceLabel} / month · up to ${PLANS[plan].services} services` : ` / month · up to ${PLANS[plan].services} services`}</small></div>
              <p className={styles.muted}>{isFree(plan) ? "No credit card. We email you an activation link; it is also your private settings page." : "14 days free. Cancel any time from the billing portal."}</p>
              <label className={styles.label} htmlFor="em">Work email</label>
              <input id="em" className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              <label className={styles.label}>Services to watch</label>
              <ServicePicker all={all} value={picked} onChange={setPicked} limit={PLANS[plan].services} />
              <p className={styles.hint}>Tip: build your list on <a href="/check">Check your stack</a>, then press "Monitor my stack".{plan === "team" && <> See what your clients or colleagues get: <a href="/boards" target="_blank" rel="noopener noreferrer">example status boards</a>.</>}</p>
              <button className={styles.primary} onClick={buy} disabled={busy || !email || !picked.length}>{isFree(plan) ? (busy ? "Sending…" : "Get free alerts") : busy ? "Opening Stripe…" : "Start 14-day free trial"}</button>
              {msg && <p className={styles.warn}>{msg}</p>}
            </section>
          </div>
        )}

        {mode === "manage" && (
          <div className={styles.manage}>
            <header>
              <span className={styles.eyebrow}>Your stack alerts</span>
              <h1 className={styles.h1s}>{view ? `${view.serviceIds.length} services watched` : "Loading…"}</h1>
              {view && <p className={styles.muted}>{view.email} · {view.planName} plan{view.free ? " (free)" : ""} · <span className={view.status === "active" ? styles.ok : styles.warn}>{view.status}</span></p>}
              {fresh && <p className={styles.notice}>Bookmark this page: its address is your private management link. It is also remembered in this browser.</p>}
              {view && !view.slack && !view.teams && !view.webhook && !view.emailEnabled && (
                <p className={styles.notice}><b>You are not receiving alerts yet.</b> Connect Slack, Microsoft Teams or a webhook below, then press "Send test alert". Email delivery is being switched on.</p>
              )}
            </header>

            <section className={styles.card}>
              <h2 className={styles.h2}>Where alerts go</h2>
              {!view?.emailEnabled && <p className={styles.hint}>Email delivery switches on shortly. Connect Slack, Teams or a webhook to receive alerts today.</p>}
              <div className={styles.channel}><label className={styles.label}>Slack incoming webhook</label>
                {view?.slack ? <p className={styles.connected}>Connected <span className={styles.mono}>{view.slack}</span><button onClick={() => remove("slack")}>Remove</button></p>
                  : <input className={styles.input} placeholder="https://hooks.slack.com/services/…" value={slack} onChange={(e) => setSlack(e.target.value)} />}</div>
              <div className={styles.channel}><label className={styles.label}>Microsoft Teams workflow webhook</label>
                {view?.teams ? <p className={styles.connected}>Connected <span className={styles.mono}>{view.teams}</span><button onClick={() => remove("teams")}>Remove</button></p>
                  : <input className={styles.input} placeholder="https://….webhook.office.com/… or Power Automate URL" value={teams} onChange={(e) => setTeams(e.target.value)} />}</div>
              <div className={styles.channel}><label className={styles.label}>JSON webhook (developers)</label>
                {view?.webhook ? <p className={styles.connected}>Connected <span className={styles.mono}>{view.webhook}</span><button onClick={() => remove("webhook")}>Remove</button></p>
                  : <input className={styles.input} placeholder="https://your-system.example.com/hooks/shadowgraph" value={hook} onChange={(e) => setHook(e.target.value)} />}</div>
            </section>

            <section className={styles.card}>
              <h2 className={styles.h2}>Services</h2>
              <ServicePicker all={all} value={svc} onChange={setSvc} limit={view?.serviceLimit ?? 25} />
            </section>

            <section className={styles.card}>
              <div className={styles.monHead}>
                <h2 className={styles.h2}>Your own endpoints</h2>
                <span className={styles.mono}>{view ? `${view.monitors.length}/${view.monitorLimit}` : ""}</span>
              </div>
              <p className={styles.hint}>Checked every 5 minutes from our main node in AWS us-east-1 (N. Virginia). Private: never shown on public pages. You are alerted when one goes down or recovers, slows down against its own normal, its certificate or domain is about to expire, its infrastructure changes, or the provider it runs on has an incident.</p>
              <ul className={styles.monList}>{view?.monitors.map((m) => <MonitorRow key={m.id} m={m} onRemove={() => removeMonitor(m.id)} />)}</ul>
              {view && view.monitors.length < view.monitorLimit && (
                <div className={styles.monForm}>
                  <input className={styles.input} placeholder="Name (e.g. Checkout API)" value={mName} onChange={(e) => setMName(e.target.value)} aria-label="Endpoint name" />
                  <input className={styles.input} placeholder="https://api.yourcompany.com/health" value={mUrl} onChange={(e) => setMUrl(e.target.value)} aria-label="Endpoint URL" />
                  <select className={styles.input} value={mExpect} onChange={(e) => setMExpect(e.target.value as "any_lt_500" | "success")} aria-label="Success criterion">
                    <option value="any_lt_500">Up if it answers (any status below 500)</option>
                    <option value="success">Up only on success (200–399)</option>
                  </select>
                  <button className={styles.ghost} onClick={addMonitor} disabled={mBusy || !mUrl}>{mBusy ? "Checking…" : "Add endpoint"}</button>
                </div>
              )}
              {mErr && <p className={styles.warn}>{mErr}</p>}
            </section>

            {view && token && view.boardLimit > 0 && <BoardManager token={token} view={view} all={all} onView={setView} />}
            {view && view.boardLimit === 0 && (
              <section className={styles.card}>
                <h2 className={styles.h2}>Branded status boards</h2>
                <p className={styles.hint}>Share your stack's live status with a team or a client under your own logo and colours, as a link or embedded in an intranet. Part of the Team plan ($99/month, 5 boards, 100 services, 25 endpoints). <a href="/pricing#enterprise">Ask us to switch your plan</a>.</p>
              </section>
            )}

            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => act("update")} disabled={busy}>Save changes</button>
              <button className={styles.ghost} onClick={() => act("test")} disabled={busy}>Send test alert</button>
              {!view?.free && <button className={styles.ghost} onClick={() => act("portal")} disabled={busy}>Billing & cancel</button>}
            </div>
            {msg && <p className={styles.msg}>{msg}</p>}

            <section className={styles.card}>
              <h2 className={styles.h2}>Recent alerts</h2>
              {view && view.deliveries.length === 0 && <p className={styles.muted}>No alerts yet. That is the goal.</p>}
              <ul className={styles.log}>{view?.deliveries.map((d, i) => (
                <li key={i}><span className={styles.kind}>{KIND[d.kind] ?? d.kind}</span><span>{d.title}</span><span className={styles.mono}>{new Date(d.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span></li>
              ))}</ul>
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}