/** Display formatting shared by the Research and Signals pages. Missing values render as "—", never as zero. */
export type Prop = { k: number; n: number; p: number | null; lo: number | null; hi: number | null };

export const fmt = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
export const ci = (x: Prop | null | undefined) => (!x || x.n === 0 ? "no cases yet" : `${x.k} of ${x.n} · 95% CI ${pct(x.lo)}–${pct(x.hi)}`);
export const lift = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `×${x.toFixed(2)}`);
export const pv = (p: number | null | undefined) => (p === null || p === undefined ? "—" : p <= 0.001 ? "≤ 0.001" : p.toFixed(3));
export const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
export const when = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const shortTime = (iso: string | null | undefined) => (iso ? `${iso.slice(11, 16)} UTC` : "—");

/** "1 in 3,400" style odds for a probability. */
export const odds = (p: number | null | undefined) => {
  if (p === null || p === undefined || p <= 0) return "—";
  const n = 1 / p;
  const r = n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n);
  return `1 in ${r.toLocaleString("en-US")}`;
};

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

/** Plain-language verdict for a permutation-test row (minimum evidence: 10 pairs observed or expected). */
export function verdict(l: { observed: number; expected: number; p: number }, p = l.p) {
  if (l.observed + l.expected < 10) return { key: "few" as const, label: "Too few events" };
  return p < 0.05 ? { key: "yes" as const, label: "Excess detected" } : { key: "no" as const, label: "Not detected" };
}

export const LAYER_LABEL: Record<string, string> = { region: "Cloud region", hosting: "Hosting provider", cdn: "CDN", dns: "DNS provider" };
