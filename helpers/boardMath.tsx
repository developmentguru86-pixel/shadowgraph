/** Pure calculations behind status boards (tested in boardMath.spec.tsx). */
export type MonthSla = { up: number | null; downMin: number; budgetMin: number | null; usedShare: number | null };

/** "api.github.com" -> "github.com", "www.bbc.co.uk" -> "bbc.co.uk" (enough to match vendor status pages). */
export function orgOf(host: string | null | undefined): string | null {
  if (!host) return null;
  const p = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (p.length < 2) return null;
  const sld = p[p.length - 2];
  return p.length >= 3 && p[p.length - 1].length === 2 && /^(co|com|org|net|ac|gov|or|ne)$/.test(sld) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

/** Minutes in the calendar month (UTC) that contains `at`. */
export const monthMinutes = (at: Date) =>
  (Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)) / 60_000;

/** Error budget: each failed 5-minute check counts as 5 minutes of downtime against (1 - target) of the month. */
export function slaBudget(okChecks: number, checks: number, target: number | null, minutesInMonth: number): MonthSla {
  const downMin = Math.max(0, checks - okChecks) * 5;
  const budgetMin = target ? (1 - target) * minutesInMonth : null;
  return { up: checks ? okChecks / checks : null, downMin, budgetMin, usedShare: budgetMin ? downMin / budgetMin : null };
}

/** Minutes by which our first failing check preceded the vendor's post, or null if we were not first (window: 3 h before, still failing 30 min before). */
export function leadMinutes(postedAt: number, episodes: Array<{ start: number; end: number | null }>, now = Date.now()): number | null {
  const ours = episodes.filter((e) => e.start < postedAt && e.start > postedAt - 3 * 3600_000 && (e.end ?? now) > postedAt - 30 * 60_000);
  if (!ours.length) return null;
  return Math.max(1, Math.round((postedAt - Math.min(...ours.map((e) => e.start))) / 60_000));
}