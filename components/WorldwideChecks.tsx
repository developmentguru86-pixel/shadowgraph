import type { OutputType as GlobalView } from "../endpoints/radar/global_GET.schema";
import styles from "./WorldwideChecks.module.css";

const ORDER = ["NA", "SA", "EU", "AS", "OC", "AF"] as const;
const SHORT: Record<string, string> = { NA: "N. America", SA: "S. America", EU: "Europe", AS: "Asia", OC: "Oceania", AF: "Africa" };
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(v >= 0.9995 ? 0 : 1)}%`);

/** Worldwide reachability: the same targets checked from one probe on each continent (Globalping network). */
export function WorldwideChecks({ data }: { data: GlobalView | null }) {
  if (!data) return <div className={styles.skeleton} />;
  if (!data.runAt) return <p className={styles.muted}>The first worldwide check runs within 30 minutes.</p>;
  const confirm = data.targets.filter((t) => t.kind === "confirm");
  const anchors = data.targets.filter((t) => t.kind !== "confirm");
  const probeBy = new Map(data.probes.map((p) => [p.continent, p]));

  return (
    <div className={styles.wrap}>
      <div className={styles.continents}>
        {ORDER.map((code) => {
          const c = data.continents.find((x) => x.code === code);
          const p = probeBy.get(code);
          const bad = c && c.total > 0 && c.reachable < c.total;
          return (
            <div key={code} className={`${styles.cont} ${bad ? styles.contBad : ""}`}>
              <span className={styles.cName}>{SHORT[code]}</span>
              <b>{c && c.total ? `${c.reachable}/${c.total}` : "—"}</b>
              <span className={styles.cMeta}>{c?.medianMs != null ? `${c.medianMs} ms median` : "no data"}</span>
              <span className={styles.cMeta}>24 h: {pct(c?.availability24h ?? null)}</span>
              <span className={styles.cProbe}>{p ? `${p.city ?? "?"}, ${p.country ?? ""}` : ""}</span>
            </div>
          );
        })}
      </div>

      {data.regionalOutages.length > 0 && (
        <div className={styles.alert}>
          <b>Regional failure</b>
          {data.regionalOutages.map((o) => <p key={o.id}>{o.name}: unreachable from {o.downIn.join(", ")}, reachable from {o.upIn.join(", ")}.</p>)}
        </div>
      )}

      {confirm.length > 0 && (
        <div className={styles.block}>
          <p className={styles.kicker}>Cross-checked from six continents · services our main node (AWS us-east-1) sees failing right now</p>
          <Table rows={confirm} />
          <p className={styles.muted}>{confirm.every((t) => Object.values(t.cells).every((c) => c?.ok))
            ? "All of them answer normally from every continent: the problem is local to our main measurement path (AWS us-east-1) (blocking, rate limiting or regional routing), not a global outage."
            : "Where a cell is marked ✕ the failure is visible outside Europe too."}</p>
        </div>
      )}

      <div className={styles.block}>
        <p className={styles.kicker}>Infrastructure anchors</p>
        <Table rows={anchors} />
      </div>
      <p className={styles.muted}>
        Checked {ago(data.runAt)} · every 30 minutes · HTTPS request from one probe per continent via the <a href="https://globalping.io" target="_blank" rel="noreferrer">Globalping</a> network (jsDelivr).
        A cell is reachable when the target answers with any HTTP status below 500. Times are full request times including TLS from that probe.
      </p>
    </div>
  );
}

function Table({ rows }: { rows: GlobalView["targets"] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Target</th>{ORDER.map((c) => <th key={c}>{SHORT[c]}</th>)}</tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id}>
            <td>{t.name}</td>
            {ORDER.map((c) => {
              const cell = t.cells[c];
              return <td key={c} className={!cell ? styles.na : cell.ok ? (cell.ms != null && cell.ms > 2000 ? styles.slow : styles.ok) : styles.bad}
                title={cell ? `${cell.city ?? ""}, ${cell.country ?? ""}${cell.error ? ` · ${cell.error}` : ""}` : "no probe"}>
                {!cell ? "—" : cell.ok ? (cell.ms != null ? `${cell.ms} ms` : "ok") : "✕"}
              </td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
