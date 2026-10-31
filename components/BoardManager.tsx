import { useMemo, useState } from "react";
import type { RadarServiceRow } from "../endpoints/radar_status_GET.schema";
import { postAlertsManage, type View } from "../endpoints/alerts_manage_POST.schema";
import type { BoardSummary } from "../helpers/statusBoards";
import styles from "./BoardManager.module.css";

type Draft = { id?: string; title: string; logoUrl: string; accent: string; theme: "dark" | "light"; note: string; serviceIds: string[]; monitorIds: string[]; showPowered: boolean; slaTarget: number | null };
const blank = (view: View): Draft => ({ title: "", logoUrl: "", accent: "#5fe3a1", theme: "dark", note: "", serviceIds: view.serviceIds.slice(0, 20), monitorIds: view.monitors.map((m) => m.id), showPowered: true, slaTarget: 0.999 });
const ORIGIN = "https://shadowalpha.online";

/** Team plan: create and edit branded status boards, copy their link and iframe code. */
export function BoardManager({ token, view, all, onView }: { token: string; view: View; all: RadarServiceRow[]; onView: (v: View) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const sugg = draft && q.trim().length >= 2 ? all.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) && !draft.serviceIds.includes(s.id)).slice(0, 8) : [];

  const save = async () => {
    if (!draft) return;
    setBusy(true); setErr(null);
    const r = await postAlertsManage({ token, action: "saveBoard", board: { ...draft, logoUrl: draft.logoUrl || null, note: draft.note || null } }).catch(() => ({ error: "Could not save the board" }));
    setBusy(false);
    if ("view" in r && r.view) { onView(r.view); setDraft(null); } else setErr(r.error ?? "Could not save the board");
  };
  const remove = async (b: BoardSummary) => {
    if (!window.confirm(`Switch off "${b.title}"? Its link and embeds stop working.`)) return;
    const r = await postAlertsManage({ token, action: "removeBoard", boardId: b.id });
    if (r.view) onView(r.view);
  };
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600); } catch { setCopied(null); }
  };
  const edit = (b: BoardSummary) => setDraft({ id: b.id, title: b.title, logoUrl: b.logoUrl ?? "", accent: b.accent, theme: b.theme === "light" ? "light" : "dark", note: b.note ?? "",
    serviceIds: b.serviceIds, monitorIds: b.monitorIds, showPowered: b.showPowered, slaTarget: b.slaTarget });
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.h2}>Status boards</h2>
        <span className={styles.mono}>{view.boards.length}/{view.boardLimit}</span>
      </div>
      <p className={styles.hint}>Branded, read-only status pages for a team or a client: your logo, your colour, the services and endpoints you choose. Share the link or embed it in an intranet or client portal. Endpoint URLs are never shown, only their names.</p>

      {view.boards.length > 0 && (
        <ul className={styles.list}>
          {view.boards.map((b) => {
            const link = `${ORIGIN}/board/${b.publicId}`;
            const embed = `<iframe src="${ORIGIN}/embed/board/${b.publicId}" title="${b.title.replace(/"/g, "")} status" style="width:100%;height:520px;border:0" loading="lazy"></iframe>`;
            return (
              <li key={b.id}>
                <div className={styles.row}>
                  <span className={styles.swatch} style={{ background: b.accent }} aria-hidden="true" />
                  <b>{b.title}</b>
                  <span className={styles.meta}>{b.serviceIds.length} services · {b.monitorIds.length} endpoints · {b.theme}</span>
                </div>
                <div className={styles.actions}>
                  <a href={link} target="_blank" rel="noopener noreferrer">Open</a>
                  <button onClick={() => copy(`l${b.id}`, link)}>{copied === `l${b.id}` ? "Copied" : "Copy link"}</button>
                  <button onClick={() => copy(`e${b.id}`, embed)}>{copied === `e${b.id}` ? "Copied" : "Copy embed code"}</button>
                  <button onClick={() => edit(b)}>Edit</button>
                  <button onClick={() => remove(b)} className={styles.danger}>Switch off</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!draft && view.boards.length < view.boardLimit && <button className={styles.ghost} onClick={() => setDraft(blank(view))}>New status board</button>}

      {draft && (
        <div className={styles.form}>
          <label className={styles.label}>Title<input className={styles.input} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Acme IT · Service status" maxLength={80} /></label>
          <label className={styles.label}>Logo URL (https, optional)<input className={styles.input} value={draft.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://acme.com/logo.svg" /></label>
          <div className={styles.two}>
            <label className={styles.label}>Accent colour<span className={styles.colour}><input type="color" value={draft.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Accent colour" /><code>{draft.accent}</code></span></label>
            <label className={styles.label}>Theme
              <select className={styles.input} value={draft.theme} onChange={(e) => set({ theme: e.target.value as Draft["theme"] })}><option value="dark">Dark</option><option value="light">Light</option></select>
            </label>
          </div>
          <label className={styles.label}>Note under the title (optional)<textarea className={styles.input} rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} maxLength={280} placeholder="Questions? IT service desk, ext. 4400" /></label>
          <label className={styles.label}>Contract SLA target (error budget per month)
            <select className={styles.input} value={draft.slaTarget ?? ""} onChange={(e) => set({ slaTarget: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None</option><option value="0.995">99.5% · 3 h 39 min per month</option><option value="0.999">99.9% · 43 min per month</option>
              <option value="0.9995">99.95% · 22 min per month</option><option value="0.9999">99.99% · 4 min per month</option>
            </select>
          </label>

          <span className={styles.label}>Third-party services ({draft.serviceIds.length})</span>
          <div className={styles.search}>
            <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a service from the radar" aria-label="Add a service" />
            {sugg.length > 0 && <ul className={styles.sugg}>{sugg.map((s) => <li key={s.id}><button onClick={() => { set({ serviceIds: [...draft.serviceIds, s.id] }); setQ(""); }}>{s.name}<small>{s.category}</small></button></li>)}</ul>}
          </div>
          <div className={styles.chips}>{draft.serviceIds.map((id) => <span key={id}>{byId.get(id)?.name ?? id}<button onClick={() => set({ serviceIds: draft.serviceIds.filter((x) => x !== id) })} aria-label="Remove">×</button></span>)}</div>

          {view.monitors.length > 0 && (
            <>
              <span className={styles.label}>Your endpoints</span>
              <div className={styles.checks}>{view.monitors.map((m) => (
                <label key={m.id}><input type="checkbox" checked={draft.monitorIds.includes(m.id)}
                  onChange={(e) => set({ monitorIds: e.target.checked ? [...draft.monitorIds, m.id] : draft.monitorIds.filter((x) => x !== m.id) })} />{m.name}</label>
              ))}</div>
            </>
          )}
          <label className={styles.inline}><input type="checkbox" checked={draft.showPowered} onChange={(e) => set({ showPowered: e.target.checked })} />Show "Status data by ShadowGraph" in the footer</label>

          <div className={styles.actions}>
            <button className={styles.primary} onClick={save} disabled={busy || !draft.title.trim()}>{busy ? "Saving…" : draft.id ? "Save board" : "Create board"}</button>
            <button onClick={() => { setDraft(null); setErr(null); }}>Cancel</button>
          </div>
          {err && <p className={styles.err}>{err}</p>}
        </div>
      )}
    </section>
  );
}
