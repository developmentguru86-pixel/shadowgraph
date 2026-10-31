import satori from "satori";
import sharp from "sharp";

/**
 * Link-preview images (1200×630 PNG) for the public status pages. satori lays the card out and turns all text into
 * vector paths, sharp rasterises it, so no system fonts are needed on the server. The card never shows live state:
 * social networks cache previews for days, so a "down" badge would soon be wrong.
 */
const FONT_CDN = "https://cdn.jsdelivr.net/npm/@fontsource";
const FONT_FILES: Array<{ name: string; file: string; weight: 400 | 600; style: "normal" | "italic" }> = [
  { name: "Serif", file: "instrument-serif@5.3.0/files/instrument-serif-latin-400-normal.woff", weight: 400, style: "normal" },
  { name: "Serif", file: "instrument-serif@5.3.0/files/instrument-serif-latin-400-italic.woff", weight: 400, style: "italic" },
  { name: "Serif", file: "instrument-serif@5.3.0/files/instrument-serif-latin-ext-400-normal.woff", weight: 400, style: "normal" },
  { name: "Serif", file: "instrument-serif@5.3.0/files/instrument-serif-latin-ext-400-italic.woff", weight: 400, style: "italic" },
  { name: "Sans", file: "inter@5.3.0/files/inter-latin-400-normal.woff", weight: 400, style: "normal" },
  { name: "Sans", file: "inter@5.3.0/files/inter-latin-600-normal.woff", weight: 600, style: "normal" },
  { name: "Sans", file: "inter@5.3.0/files/inter-latin-ext-400-normal.woff", weight: 400, style: "normal" },
  { name: "Mono", file: "jetbrains-mono@5.3.0/files/jetbrains-mono-latin-400-normal.woff", weight: 400, style: "normal" },
];

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" | "italic" };
let fontsPromise: Promise<Font[]> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all(FONT_FILES.map(async (f) => {
    const r = await fetch(`${FONT_CDN}/${f.file}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`font ${f.file}: HTTP ${r.status}`);
    return { name: f.name, data: await r.arrayBuffer(), weight: f.weight, style: f.style };
  })).catch((e) => { fontsPromise = null; throw e; });
  return fontsPromise;
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children: unknown = []): Node =>
  ({ type, props: { style: type === "div" ? { display: "flex", ...style } : style, children } });

export type StatusCard = { name: string; lang: "en" | "de"; path: string; sub: string };

function layout({ name, lang, path, sub }: StatusCard): Node {
  const de = lang === "de";
  const size = name.length <= 10 ? 112 : name.length <= 16 ? 96 : name.length <= 24 ? 80 : name.length <= 34 ? 64 : 52;
  const ring = (d: number, o: number) => h("div", { position: "absolute", left: 1010 - d / 2, top: 290 - d / 2, width: d, height: d, borderRadius: d, border: `1px solid rgba(238,242,245,${o})` });
  const dot = (x: number, y: number, d: number, o: number) => h("div", { position: "absolute", left: x, top: y, width: d, height: d, borderRadius: d, background: "#5fe3a1", opacity: o });
  // one span per word so long names wrap between words; the name itself in green italics
  const words = [
    ...(de ? ["Ist"] : ["Is"]).map((w) => ({ w, hl: false })),
    ...name.split(/\s+/).filter(Boolean).map((w) => ({ w, hl: true })),
    { w: "down?", hl: false },
  ];
  return h("div", { width: 1200, height: 630, position: "relative", background: "#05070a", color: "#eef2f5", fontFamily: "Sans" }, [
    ring(500, 0.06), ring(370, 0.07), ring(240, 0.08), ring(110, 0.1),
    dot(1003, 283, 14, 1), dot(1130, 170, 10, 0.8), dot(912, 360, 8, 0.7), dot(1075, 420, 8, 0.6),
    h("div", { flexDirection: "column", position: "absolute", left: 80, top: 70, width: 700, height: 500 }, [
      h("div", { alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }, [
        h("div", { width: 30, height: 30, borderRadius: 30, border: "2px solid rgba(238,242,245,0.55)", alignItems: "center", justifyContent: "center" }, [
          h("div", { width: 10, height: 10, borderRadius: 10, background: "#5fe3a1" }),
        ]),
        "ShadowGraph",
      ]),
      h("div", { marginTop: 64, fontFamily: "Mono", fontSize: 19, letterSpacing: 4, color: "#8b96a3" }, de ? "LIVE-STATUS · STÖRUNGEN" : "LIVE STATUS · OUTAGES"),
      h("div", { flexWrap: "wrap", marginTop: 14, fontFamily: "Serif", fontSize: size, lineHeight: 1.04, letterSpacing: -1 },
        words.map(({ w, hl }) => h("span", { marginRight: size * 0.24, ...(hl ? { fontStyle: "italic", color: "#5fe3a1" } : {}) }, w))),
      h("div", { marginTop: 26, fontSize: 25, lineHeight: 1.4, color: "#aab4bf", maxWidth: 690 }, sub),
      h("div", { marginTop: "auto", fontFamily: "Mono", fontSize: 22, color: "#5fe3a1" }, `shadowalpha.online${path}`),
    ]),
  ]);
}

export async function renderStatusCard(card: StatusCard): Promise<Buffer> {
  const svg = await satori(layout(card) as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: await loadFonts() });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}