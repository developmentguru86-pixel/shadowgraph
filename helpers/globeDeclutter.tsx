/**
 * Screen-space declutter for globe markers that hide each other, e.g. AWS eu-central-1, Google europe-west3 and the
 * DB-IP city "Frankfurt am Main": a few km apart or exactly the same point. Zooming separates markers that are
 * merely close (the globe zooms to 160x), but it can never separate identical coordinates. So only markers whose
 * centres lie inside another marker are grouped (union-find), and each such group is fanned out on a small sunflower
 * spiral around its centre, largest marker in the middle. Everything else keeps its true position, so the geography
 * stays right. The caller draws a leader line from the true position to the fanned-out marker.
 * Pure and deterministic (stable order by size, then key), so markers do not jitter between frames.
 */
export type Disc = { key: string; x: number; y: number; r: number };
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.5°

/** `hide` = how deep one centre must sit inside the other marker to count as hidden (fraction of the larger radius). */
export function declutter(discs: Disc[], gap = 3, hide = 0.85): Map<string, { x: number; y: number }> {
  const n = discs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const maxR = discs.reduce((m, d) => Math.max(m, d.r), 0);
  const cell = Math.max(1, maxR * hide);
  const grid = new Map<string, number[]>();
  discs.forEach((d, i) => { const k = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`; const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
  for (let i = 0; i < n; i++) {
    const a = discs[i], gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const j of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
        if (j <= i) continue;
        const b = discs[j], lim = Math.max(a.r, b.r) * hide;
        if (Math.hypot(a.x - b.x, a.y - b.y) < lim) { const ra = find(i), rb = find(j); if (ra !== rb) parent[ra] = rb; }
      }
    }
  }
  const groups = new Map<number, Disc[]>();
  for (let i = 0; i < n; i++) { const g = find(i); const l = groups.get(g); if (l) l.push(discs[i]); else groups.set(g, [discs[i]]); }
  const out = new Map<string, { x: number; y: number }>();
  for (const members of groups.values()) {
    if (members.length === 1) { out.set(members[0].key, { x: members[0].x, y: members[0].y }); continue; }
    members.sort((a, b) => b.r - a.r || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    const step = members[0].r + members[1].r + gap; // the second marker just clears the largest one
    members.forEach((m, k) => {
      if (k === 0) { out.set(m.key, { x: cx, y: cy }); return; }
      const rad = step * Math.sqrt(k), ang = k * GOLDEN - Math.PI / 2;
      out.set(m.key, { x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang) });
    });
  }
  return out;
}
