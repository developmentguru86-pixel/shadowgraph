import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { DoraReport } from "./doraReport";
import { T, fmtDate, fmtInt, layerLabel, pct, type ReportLang } from "./doraReportText";
import { SITE_URL } from "./site";

/**
 * Server-side A4 PDF of the paid ICT concentration risk assessment: cover page, numbered sections, tables that break
 * across pages with repeated headers, running header and footer with document ID, content hash and page x of y.
 * Standard PDF fonts (Helvetica, WinAnsi): any character outside that set is transliterated.
 */
const A4: [number, number] = [595.28, 841.89];
const M = { top: 64, bottom: 58, left: 52, right: 52 };
const W = A4[0] - M.left - M.right;
const C = {
  ink: rgb(0.067, 0.094, 0.153), muted: rgb(0.36, 0.4, 0.46), faint: rgb(0.55, 0.58, 0.63), line: rgb(0.84, 0.86, 0.89),
  band: rgb(0.955, 0.962, 0.972), accent: rgb(0.11, 0.25, 0.45),
  high: rgb(0.71, 0.14, 0.09), moderate: rgb(0.71, 0.28, 0.03), low: rgb(0.03, 0.46, 0.28),
};
const SEV: Record<string, RGB> = { high: C.high, moderate: C.moderate, low: C.low, na: C.muted };

const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const MAP: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "−": "-", "✓": "x", " ": " ", " ": " ", " ": " " };
function clean(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (MAP[ch] !== undefined) { out += MAP[ch]; continue; }
    const c = ch.codePointAt(0)!;
    if (c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.includes(ch)) { out += ch; continue; }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += /^[\x20-\x7e]+$/.test(base) ? base : "?";
  }
  return out;
}

type Col = { h: string; w: number; align?: "left" | "right"; color?: (row: string[]) => RGB | undefined; bold?: boolean; titled?: boolean };

class Doc {
  pdf!: PDFDocument; f!: PDFFont; b!: PDFFont;
  page!: PDFPage; y = 0;
  pages: PDFPage[] = [];
  constructor(public r: DoraReport, public lang: ReportLang) {}
  get t() { return T[this.lang]; }

  async init() {
    this.pdf = await PDFDocument.create();
    this.f = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.b = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    const r = this.r;
    this.pdf.setTitle(clean(`${this.t.title}${r.company ? ` · ${r.company}` : ""}`));
    this.pdf.setSubject(clean(`${r.doc.id} v${r.doc.version} · ${r.doc.method} · SHA-256 ${r.doc.hash}`));
    this.pdf.setAuthor(clean(r.doc.issuer?.name ?? "ShadowGraph"));
    this.pdf.setCreator("ShadowGraph"); this.pdf.setProducer("ShadowGraph");
    this.pdf.setLanguage(this.lang === "de" ? "de-AT" : "en-GB");
    this.pdf.setCreationDate(new Date(r.generatedAt));
  }

  newPage(header = true) {
    this.page = this.pdf.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - M.top;
    if (header) {
      const top = A4[1] - 34;
      this.page.drawText(clean(`${this.t.title}${this.r.company ? ` · ${this.r.company}` : ""}`), { x: M.left, y: top, size: 7.5, font: this.f, color: C.faint });
      const id = `${this.r.doc.id} · v${this.r.doc.version}`;
      this.page.drawText(id, { x: A4[0] - M.right - this.f.widthOfTextAtSize(id, 7.5), y: top, size: 7.5, font: this.f, color: C.faint });
      this.page.drawLine({ start: { x: M.left, y: top - 6 }, end: { x: A4[0] - M.right, y: top - 6 }, thickness: 0.5, color: C.line });
    }
  }
  need(h: number) { if (this.y - h < M.bottom) this.newPage(); }

  wrap(s: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) out.push(line);
        // a single word wider than the column is cut into pieces
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let k = w.length - 1;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }

  text(s: string, o: { size?: number; bold?: boolean; color?: RGB; indent?: number; width?: number; gap?: number; lh?: number } = {}) {
    const size = o.size ?? 9.5, font = o.bold ? this.b : this.f, lh = o.lh ?? size * 1.42;
    const x = M.left + (o.indent ?? 0), width = o.width ?? W - (o.indent ?? 0);
    for (const line of this.wrap(s, font, size, width)) {
      this.need(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? C.ink });
      this.y -= lh;
    }
    this.y -= o.gap ?? 6;
  }

  h2(s: string) {
    this.need(70);
    this.y -= 8;
    this.page.drawText(clean(s), { x: M.left, y: this.y - 14, size: 14, font: this.b, color: C.ink });
    this.y -= 24;
  }
  h3(s: string) { this.need(40); this.text(s, { size: 10.5, bold: true, gap: 3 }); }

  table(cols: Col[], rows: string[][], o: { size?: number; zebra?: boolean; noHead?: boolean; minRow?: number } = {}) {
    const size = o.size ?? 8.5, lh = size * 1.32, pad = 4;
    const widths = cols.map((c) => c.w * W);
    // a cell is a list of lines; in a "titled" column the first paragraph is set bold
    type Line = { s: string; bold: boolean };
    const cellLines = (v: string, i: number): Line[] => {
      const c = cols[i];
      if (c.titled) {
        const [title, ...rest] = (v ?? "").split("\n");
        return [...this.wrap(title, this.b, size, widths[i] - pad * 2).map((s) => ({ s, bold: true })),
          ...(rest.length ? this.wrap(rest.join("\n"), this.f, size, widths[i] - pad * 2).map((s) => ({ s, bold: false })) : [])];
      }
      const bold = !!c.bold && i === 0;
      return this.wrap(v ?? "", bold ? this.b : this.f, size, widths[i] - pad * 2).map((s) => ({ s, bold }));
    };
    const rowCells = (row: string[]) => row.slice(0, cols.length).map((v, i) => cellLines(v, i));
    const rowH = (cells: Line[][]) => Math.max(o.minRow ?? 0, Math.max(...cells.map((c) => c.length)) * lh + pad * 2);
    const firstH = rows.length ? rowH(rowCells(rows[0])) : 0;
    const head = () => {
      if (o.noHead) { this.need(firstH + 2); this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + W, y: this.y }, thickness: 0.8, color: C.muted }); return; }
      const lines = cols.map((c, i) => this.wrap(c.h.toUpperCase(), this.b, size - 1.5, widths[i] - pad * 2));
      const h = Math.max(...lines.map((l) => l.length)) * (size * 1.2) + pad * 2;
      // never leave a header alone at the bottom of a page: header and first row move together
      this.need(h + firstH + 2);
      let x = M.left;
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const tw = this.b.widthOfTextAtSize(ln, size - 1.5);
          const tx = cols[i].align === "right" ? x + widths[i] - pad - tw : x + pad;
          this.page.drawText(ln, { x: tx, y: this.y - pad - (k + 1) * (size * 1.2) + 2, size: size - 1.5, font: this.b, color: C.muted });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + W, y: this.y }, thickness: 0.8, color: C.muted });
    };
    head();
    rows.forEach((row, ri) => {
      // extra trailing values in a row are data for the colour callbacks, not cells
      const cells = rowCells(row);
      const h = rowH(cells);
      if (this.y - h < M.bottom) { this.newPage(); head(); }
      if (o.zebra && ri % 2 === 1) this.page.drawRectangle({ x: M.left, y: this.y - h, width: W, height: h, color: C.band });
      let x = M.left;
      cells.forEach((ls, i) => {
        const color = cols[i].color?.(row) ?? C.ink;
        ls.forEach((ln, k) => {
          const font = ln.bold ? this.b : this.f;
          const tw = font.widthOfTextAtSize(ln.s, size);
          const tx = cols[i].align === "right" ? x + widths[i] - pad - tw : x + pad;
          this.page.drawText(ln.s, { x: tx, y: this.y - pad - (k + 1) * lh + 2.5, size, font, color: ln.bold && cols[i].titled ? C.ink : color });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: M.left + W, y: this.y }, thickness: 0.4, color: C.line });
    });
    this.y -= 10;
  }

  footers() {
    const n = this.pages.length;
    const left = clean(`${this.t.footer} · SHA-256 ${this.r.doc.hash.slice(0, 16)}…`);
    this.pages.forEach((p, i) => {
      const y = 30;
      p.drawLine({ start: { x: M.left, y: y + 12 }, end: { x: A4[0] - M.right, y: y + 12 }, thickness: 0.5, color: C.line });
      p.drawText(left, { x: M.left, y, size: 7, font: this.f, color: C.faint });
      const pg = this.t.page(i + 1, n);
      p.drawText(pg, { x: A4[0] - M.right - this.f.widthOfTextAtSize(pg, 7.5), y, size: 7.5, font: this.f, color: C.muted });
    });
  }
}

export async function renderReportPdf(r: DoraReport, lang: ReportLang): Promise<Uint8Array> {
  const d = new Doc(r, lang);
  await d.init();
  const t = d.t;
  const L = (l: Parameters<typeof layerLabel>[0]) => layerLabel(l, lang);
  const day = (x: string | null | undefined) => fmtDate(x, lang);
  const sev = (k: string) => t.rating[k as keyof typeof t.rating] ?? k;

  // ---------- cover ----------
  d.newPage(false);
  const p = d.page;
  p.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: C.accent });
  p.drawText("ShadowGraph", { x: M.left, y: A4[1] - 70, size: 12, font: d.b, color: C.accent });
  p.drawText(clean(t.eyebrow), { x: M.left, y: A4[1] - 150, size: 9, font: d.f, color: C.muted });
  d.y = A4[1] - 168;
  d.text(t.title, { size: 28, bold: true, lh: 33, gap: 10 });
  if (r.company) { d.text(`${t.preparedFor}: ${r.company}`, { size: 14, color: C.muted, gap: 26 }); } else d.y -= 20;
  const meta: Array<[string, string]> = [
    [t.meta.vendors, String(r.scope.vendors)], [t.meta.critical, String(r.scope.critical)],
    [t.meta.collected, day(r.scannedAt)], [t.meta.generated, day(r.generatedAt)],
  ];
  const colW = W / 4;
  meta.forEach(([k, v], i) => {
    p.drawText(clean(k).toUpperCase(), { x: M.left + i * colW, y: d.y - 8, size: 6.8, font: d.b, color: C.faint });
    p.drawText(clean(v), { x: M.left + i * colW, y: d.y - 26, size: 14, font: d.f, color: C.ink });
  });
  d.y -= 60;
  // overall rating box
  p.drawRectangle({ x: M.left, y: d.y - 54, width: W, height: 54, color: C.band });
  p.drawRectangle({ x: M.left, y: d.y - 54, width: 4, height: 54, color: SEV[r.overall] });
  p.drawText(clean(t.overall).toUpperCase(), { x: M.left + 18, y: d.y - 20, size: 7.5, font: d.b, color: C.muted });
  p.drawText(clean(sev(r.overall)), { x: M.left + 18, y: d.y - 42, size: 18, font: d.b, color: SEV[r.overall] });
  d.y -= 80;
  // document control block at the bottom of the cover
  const ctl: Array<[string, string]> = [
    [t.docId, `${r.doc.id} · ${t.version} ${r.doc.version}`], [t.methodV, r.doc.method], [t.snapshot, day(r.scannedAt)],
    [t.integrity, r.doc.hash],
    ...(r.doc.issuer ? [[t.issuer, `${r.doc.issuer.name}, ${r.doc.issuer.address}${r.doc.issuer.vatId ? ` · ${r.doc.issuer.vatId}` : ""}`] as [string, string]] : []),
  ];
  let cy = M.bottom + 14 + ctl.length * 15;
  p.drawLine({ start: { x: M.left, y: cy + 10 }, end: { x: A4[0] - M.right, y: cy + 10 }, thickness: 0.5, color: C.line });
  for (const [k, v] of ctl) {
    p.drawText(clean(k), { x: M.left, y: cy - 4, size: 7.5, font: d.b, color: C.muted });
    const lines = d.wrap(v, d.f, 7.5, W - 130);
    p.drawText(lines[0] ?? "", { x: M.left + 130, y: cy - 4, size: 7.5, font: d.f, color: C.ink });
    cy -= 15;
  }

  // ---------- 1. executive summary ----------
  d.newPage();
  d.h2(t.s1);
  d.text(t.s1Lead(r.scope.vendors, r.scope.resolved, r.scope.unresolved), { color: C.muted, gap: 12 });
  d.h3(t.scopeH);
  d.text(`${t.scopeYesH}: ${t.scopeYes.join("; ")}.`, { size: 8.5, gap: 4 });
  d.text(`${t.scopeNoH}: ${t.scopeNo.join("; ")}.`, { size: 8.5, color: C.muted, gap: 12 });
  d.h3(t.keyFigures);
  const kf = r.keyFigures;
  const kw = W / Math.max(1, Math.min(kf.length, 5));
  d.need(60);
  kf.slice(0, 5).forEach((k, i) => {
    d.page.drawText(clean(k.value), { x: M.left + i * kw, y: d.y - 18, size: 16, font: d.b, color: C.ink });
    d.wrap(k.label, d.f, 7.5, kw - 10).slice(0, 4).forEach((ln, j) => d.page.drawText(ln, { x: M.left + i * kw, y: d.y - 32 - j * 9.5, size: 7.5, font: d.f, color: C.muted }));
  });
  d.y -= 78;
  d.h3(t.findings);
  d.table([
    { h: t.thRating, w: 0.13, color: (row) => SEV[row[2]] }, { h: t.findings, w: 0.87, titled: true },
  ], r.findings.map((f) => [sev(f.severity), `${f.title}\n${f.detail}`, f.severity]), { size: 8.8 });

  // ---------- concrete need for action ----------
  if (r.actionPlan.length) {
    d.h2(t.apH(r.company));
    d.text(t.apLead, { color: C.muted });
    r.actionPlan.forEach((a, i) => {
      d.h3(`${i + 1}. ${a.title}`);
      d.text(`${t.apEvidence}: ${a.evidence}`, { size: 8.2, color: C.muted });
      d.table([{ h: t.apInternal, w: 0.55 }, { h: t.apVendor, w: 0.45 }],
        [[a.internal.map((x) => `• ${x}`).join("\n"), a.vendor.map((x) => `• ${x}`).join("\n")]], { size: 8 });
      d.table(t.apFill.map((f) => ({ h: f, w: 1 / t.apFill.length })), [t.apFill.map(() => "")], { size: 8, minRow: 30 });
      d.text(a.ref, { size: 7.5, color: C.faint, gap: 8 });
    });
  }

  // ---------- 2. actions ----------
  d.h2(t.s2);
  d.text(t.s2Lead, { color: C.muted });
  if (r.decisions.length) {
    d.h3(t.decH);
    d.text(t.decLead, { size: 8.2, color: C.muted });
    d.table([
      { h: t.thPriority, w: 0.1, color: (row) => SEV[row[5]] }, { h: t.thVendor, w: 0.17, bold: true }, { h: t.thSignals, w: 0.3 },
      { h: t.thDecision, w: 0.28 }, { h: t.thOpen, w: 0.15 },
    ], r.decisions.map((x) => [t.priority[x.priority], x.vendor, x.signals.map((s) => `• ${s}`).join("\n"), `${x.decision}\n${x.ref}`, x.open, x.priority]), { size: 7.6 });
    d.h3(t.allActions);
  }
  d.table([
    { h: t.thPriority, w: 0.13, color: (row) => SEV[row[3]] }, { h: t.thAction, w: 0.62 }, { h: t.thRef, w: 0.25 },
  ], r.actions.map((a) => [t.priority[a.priority], a.action, a.ref, a.priority]), { size: 8.6 });

  // ---------- 3. layers ----------
  d.h2(t.s3);
  d.text(t.s3Lead, { color: C.muted });
  d.table([
    { h: t.thLayer, w: 0.2, bold: true }, { h: t.thKnown, w: 0.11, align: "right" }, { h: t.thHhi, w: 0.08, align: "right" },
    { h: t.thRating, w: 0.11, color: (row) => SEV[row[6]] }, { h: t.thLargest, w: 0.26 }, { h: t.thAmongCrit, w: 0.24 },
  ], r.layers.map((l) => [
    L(l.layer), `${l.resolved} ${t.of} ${r.scope.companies ?? r.scope.resolved}`, l.meaningful === false ? "—" : fmtInt(l.hhi, lang),
    l.layer === "email" || l.layer === "certificate authority" ? t.informative : l.meaningful === false ? t.notMeaningful : t.rating[l.rating],
    l.top[0] ? `${l.top[0].provider} · ${l.top[0].vendors} ${t.of} ${l.resolved}` : "—",
    l.criticalTop ? `${l.criticalTop.provider} · ${l.criticalTop.critical} (${pct(l.criticalTop.share)})` : "—",
    l.meaningful === false || l.layer === "email" || l.layer === "certificate authority" ? "na" : l.rating,
  ]), { zebra: true });
  d.text(t.infraNote, { size: 7.8, color: C.muted });

  // ---------- 4. scenarios ----------
  d.h2(t.s4);
  d.text(t.s4Lead, { color: C.muted });
  if (!r.scenarios.length) d.text(t.s4None);
  else d.table([
    { h: t.thProvider, w: 0.23, bold: true }, { h: t.thLayer, w: 0.13 }, { h: t.thVendors, w: 0.14, align: "right" },
    { h: t.thCritical, w: 0.1, align: "right" }, { h: t.thCritAffected, w: 0.4 },
  ], r.scenarios.map((s) => [s.provider, L(s.layer), `${s.vendors} (${pct(s.share)})`, String(s.critical), s.criticalNames.join(", ") || "—"]), { zebra: true });

  // ---------- 5. single points ----------
  d.h2(t.s5);
  if (!r.singlePoints.length) d.text(t.s5None);
  else {
    d.text(t.s5Lead, { color: C.muted });
    d.table([{ h: t.thProvider, w: 0.3, bold: true }, { h: t.thLayer, w: 0.16 }, { h: t.thCritAffected, w: 0.54 }],
      r.singlePoints.map((s) => [s.provider, L(s.layer), s.criticalNames.join(", ")]));
  }

  // ---------- 6. jurisdiction ----------
  d.h2(t.s6);
  d.text(t.s6Lead, { color: C.muted });
  const j = r.jurisdiction;
  d.table([{ h: "", w: 0.4, bold: true }, { h: t.euEea, w: 0.2, align: "right" }, { h: t.third, w: 0.2, align: "right" }, { h: t.undetermined, w: 0.2, align: "right" }], [
    [t.s6Endpoint, String(j.endpoint.eu), String(j.endpoint.third), String(j.endpoint.unknown)],
    [t.s6Hq, String(j.hq.eu), String(j.hq.third), String(j.hq.unknown)],
  ]);
  if (j.hq.byCountry.length) {
    d.h3(t.s6Hq);
    d.table([{ h: t.thCountry, w: 0.4 }, { h: t.euEea, w: 0.2 }, { h: t.thVendors, w: 0.2, align: "right" }, { h: t.thCritical, w: 0.2, align: "right" }],
      j.hq.byCountry.map((c) => [c.name, c.eu ? t.yes : t.no, String(c.vendors), String(c.critical)]));
    d.text(t.s6HqNote, { size: 8.5, color: C.muted });
  }
  d.table([
    { h: t.thVendor, w: 0.34, bold: true }, { h: t.thCrit, w: 0.08 }, { h: t.s6Endpoint, w: 0.32 }, { h: t.s6Hq, w: 0.26 },
  ], [...j.rows].sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name)).map((x) => [
    x.name, x.critical ? t.yes : t.no,
    x.endpoint ? `${new Intl.DisplayNames([lang === "de" ? "de-AT" : "en-GB"], { type: "region" }).of(x.endpoint) ?? x.endpoint} (${x.endpointBasis === "region" ? t.basisRegion : t.basisNetwork})` : t.undetermined,
    x.hq ? new Intl.DisplayNames([lang === "de" ? "de-AT" : "en-GB"], { type: "region" }).of(x.hq) ?? x.hq : "—",
  ]), { size: 8, zebra: true });

  // ---------- 7. CTPP ----------
  d.h2(t.s7);
  d.text(t.s7Lead(day(r.ctpp.listDate)), { color: C.muted });
  if (!r.ctpp.exposures.length) d.text(t.s7None);
  else d.table([{ h: t.thEntity, w: 0.3, bold: true }, { h: t.thVia, w: 0.22 }, { h: t.thAffected, w: 0.48 }],
    r.ctpp.exposures.map((e) => [e.entity, e.seenAs.join(", "), e.vendors.map((v) => (e.critical.includes(v) ? `${v} *` : v)).join(", ")]), { size: 8.2 });
  d.text(`* ${t.thCritical}. ${r.ctpp.source}`, { size: 7.5, color: C.faint });

  // ---------- 8. incidents ----------
  d.h2(t.s8);
  if (!r.incidents.length) d.text(t.s8None);
  else d.table([{ h: t.thProvider, w: 0.24, bold: true }, { h: t.thIncidents, w: 0.12, align: "right" }, { h: t.thSevere, w: 0.1, align: "right" }, { h: t.thLatest, w: 0.54 }],
    r.incidents.map((i) => [i.provider, String(i.incidents90d), String(i.severe90d), `${day(i.lastAt)}: ${i.lastTitle ?? ""}`]), { size: 8.2 });
  d.h3(t.obsH);
  d.text(t.obsLead, { size: 8.2, color: C.muted });
  const h1 = (m: number) => `${(m / 60).toLocaleString(t.locale, { maximumFractionDigits: 1 })} h`;
  if (!r.observed.length) d.text(t.obsNone);
  else d.table([
    { h: t.thVendor, w: 0.22, bold: true }, { h: t.thMeasuredOn, w: 0.2 }, { h: t.thUptime, w: 0.1, align: "right" }, { h: t.thOutages, w: 0.08, align: "right" },
    { h: t.thDown, w: 0.1, align: "right" }, { h: t.thLongest, w: 0.1, align: "right" }, { h: t.thShared, w: 0.2 },
  ], r.observed.map((o) => o.inferredFrom
    ? [`${o.vendor}${o.critical ? " *" : ""}`, t.notMeasured(o.inferredFrom), "—", "—", "—", "—", "—"]
    : [`${o.vendor}${o.critical ? " *" : ""}`, `${o.measuredOn}${o.basis === "same-hoster" ? ` (${t.sameHoster})` : o.basis === "report-monitor" ? ` (${t.ownMonitor})` : ""}${o.confirm ? `; ${t.worldwide(o.confirm.failed, o.confirm.checked)}` : ""}`,
      o.uptimePct != null ? `${o.uptimePct.toLocaleString(t.locale)} %` : "—", String(o.outages), h1(o.totalMinutes), h1(o.longestMinutes), o.sharedWith.join(", ") || "—"]), { size: 7.8 });
  if (r.observed.some((o) => o.outages > 0 && !o.inferredFrom)) d.text(`${t.evidenceCsv}: ${SITE_URL}/_api/vendors/evidence_csv?id=${r.id}`, { size: 7.8, color: C.accent, gap: 8 });
  if (r.publicIncidents.length) {
    d.h3(t.pubH);
    d.text(t.pubLead, { size: 8.2, color: C.muted });
    for (const p of r.publicIncidents) {
      d.text(p.title, { size: 9, bold: true });
      d.text(`${p.detail} (${p.vendors.join(", ")})`, { size: 8.4 });
      d.text(p.sources.map((x) => `${x.label}: ${x.url}`).join("  ·  "), { size: 7.5, color: C.faint, gap: 8 });
    }
  }

  // ---------- 9. expiry ----------
  d.h2(t.s9);
  if (r.expiring.certs.length + r.expiring.domains.length === 0) d.text(t.s9None);
  else d.table([{ h: t.thVendor, w: 0.3, bold: true }, { h: t.thItem, w: 0.38 }, { h: t.thExpires, w: 0.2 }, { h: t.thDays, w: 0.12, align: "right" }], [
    ...r.expiring.domains.map((x) => [x.name, `${t.domain} ${x.domain}`, day(x.date), String(x.days)]),
    ...r.expiring.certs.map((x) => [x.name, `${t.cert} ${x.domain}`, day(x.date), String(x.days)]),
  ]);

  // ---------- 10. mapping ----------
  d.h2(t.s10);
  d.table([{ h: t.thReq, w: 0.38, bold: true }, { h: t.thProvides, w: 0.62 }], t.mapping.map(([a, b]) => [a, b]), { size: 8.4 });
  d.text(t.mappingNote, { size: 8.5, color: C.muted });

  // ---------- 11. method ----------
  d.h2(t.s11);
  for (const para of t.method) d.text(para, { color: C.muted });

  // ---------- 12. document control and approval ----------
  d.h2(t.s12);
  d.table([{ h: "", w: 0.28, bold: true }, { h: "", w: 0.72 }], [
    [t.docId, r.doc.id], [t.version, r.doc.version], [t.methodV, r.doc.method], [t.snapshot, day(r.scannedAt)], [t.generated, new Date(r.generatedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    [t.integrity, r.doc.hash],
    ...(r.doc.issuer ? [[t.issuer, [r.doc.issuer.name, r.doc.issuer.address, r.doc.issuer.email, r.doc.issuer.vatId, r.doc.issuer.register].filter(Boolean).join(" · ")]] : []),
  ], { size: 8.4, noHead: true });
  if (r.doc.history?.length) {
    d.h3(t.histH);
    d.table([{ h: t.version, w: 0.12, bold: true }, { h: t.thDate, w: 0.16 }, { h: t.thChange, w: 0.72 }],
      r.doc.history.map((h) => [h.version, day(h.date), h.note]), { size: 8 });
  }
  d.text(t.approvalLead, { color: C.muted, gap: 8 });
  d.table([{ h: t.thRole, w: 0.34, bold: true }, { h: t.thName, w: 0.24 }, { h: t.thDate, w: 0.16 }, { h: t.thSignature, w: 0.26 }],
    t.roles.map((role) => [role, "", "", ""]), { size: 8.6, minRow: 46 });

  // ---------- annex ----------
  d.newPage();
  d.h2(t.annex);
  d.table([
    { h: t.thVendor, w: 0.17, bold: true }, { h: t.thFunction, w: 0.12 }, { h: t.thCrit, w: 0.05 }, { h: t.thHostingCol, w: 0.18 },
    { h: t.thCdn, w: 0.11 }, { h: t.thDns, w: 0.11 }, { h: t.thEmail, w: 0.1 }, { h: `${t.thCert} / ${t.thDomain}`, w: 0.16 },
  ], [...r.register].sort((a, b) => Number(b.critical) - Number(a.critical) || a.name.localeCompare(b.name)).map((v) => [
    `${v.name}\n${v.domain}`, v.fn ?? "—", v.critical ? t.yes : t.no,
    v.status !== "ok" ? t.noDns : [v.hosting ?? (v.originHidden ? t.hiddenByCdn : "—"), v.region, v.country].filter(Boolean).join(" · "),
    v.cdn ?? "—", (v.dns ?? "—").replace(/^Other \((.+)\)$/, "$1"), v.email ?? "—",
    [v.certIssuer ? `${v.certIssuer}${v.certNotAfter ? ` (${t.until} ${day(v.certNotAfter)})` : ""}` : null, v.registrar ? `${v.registrar}${v.domainExpiresAt ? ` (${t.until} ${day(v.domainExpiresAt)})` : ""}` : null].filter(Boolean).join("\n") || "—",
  ]), { size: 6.8, zebra: true });

  d.footers();
  return d.pdf.save();
}
