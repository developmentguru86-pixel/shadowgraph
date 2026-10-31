/**
 * Shared world geometry for ShadowGraph maps.
 * Land: Natural Earth 110m rasterised to a 2° dot grid (180 x 66 cells, lat 76..-56), 1 bit per cell, base64.
 */
const MASK = "AAAAADivwAf//wAAAAADAAf/wAHYAAAAAADoi3sAP//gAAAAAMAD///sAAAAgBgACfwz/AD/+gAAAwAEHf///+/8gBAP/7/nJdjwD/+AAAH/AA7f///////f4P//////h8H/gAAAf/6//f////////Mf/////9H4D8AeAA+ev///////////AP/////4A0B4AAAD5/////////////Af3////gHgA4AAAH5///////////LwAHgH///gHkAAAAAH4/////////+CIAABAB///4D+AAAAGCx/////////4A8AAIAAf///n/gAAAOCD/////////wA4AAAAAf///n/wAAAbP///////////AgAAAAAP/////wAAADf//////////9AAAAAAAF////0YAAAB///////////9AAAAAAAD////8EAAAB///////////5AAAAAAAD////2AAAAB/f5fP//////wAAAAAAAD////gAAAAfxnwPP//////jAAAAAAAD////AAAAAPCb3/n/////+CAAAAAAAD///8AAAAAfALf/n////+ECAAAAAAAB///8AAAAAGHQP/n/////mMAAAAAAAA///8AAAAAH+Ai///////E8AAAAAAAAf//wAAAAAP/AA///////BgAAAAAAAAP//gAAAAAf/73///////gAAAAAAAAAD/AQAAAAAf////f/////gAAAAAAAAAF+AQAAAAB///+/n/////AAAAAAAAAAC+AAAAAAB///+f0H////AAAAAAAAAAAeAwAAAAD////f/B///8gAAAAAAAAAAeGEAAAAH////v+B/z/AAAAAAAAAAAAPMAgAAAD////n+A/B+gAAAAAAAAAAAD8AAAAAD////n4AeB/AgAAAAAAAAAAAPAAAAAH////3gAcAfAgAAAAAAAAAAADAAAAAD////6AAcAfggAAAAAAAAAAABDwAAAD////8wAMATAIAAAAAAAAAAAAr/AAAB/////gAKASAAAAAAAAAAAAAAH/gAAA/////gACAAAIAAAAAAAAAAAAH/8AAAaH///AAAAsGAAAAAAAAAAAAAH/+AAAAB//+AAAAUOAAAAAAAAAAAAAP/+AAAAB//8AAAAYegAAAAAAAAAAAAP//gAAAD//4AAAAMeBgAAAAAAAAAAAP//8AAAB//wAAAAGdiuAAAAAAAAAAAf///AAAA//wAAAACAQHgAAAAAAAAAAP///gAAA//wAAAABwAHwgAAAAAAAAAH///AAAA//wAAAAACIDQIAAAAAAAAAH//+AAAAf/wAAAAAAAAAAAAAAAAAAAD//+AAAA//wgAAAAABxAAAAAAAAAAAD//+AAAA//wgAAAAAPxgBAAAAAAAAAA//8AAAA//jgAAAAAf5gAAAAAAAAAAAf/8AAAA//DgAAAAAf/gAAAAAAAAAAAf/8AAAAf/DAAAAAD//4CAAAAAAAAAAf/wAAAAf/DAAAAAH//4AAAAAAAAAAAf/AAAAAf+CAAAAAH//8AAAAAAAAAAAf/AAAAAP8AAAAAAH//+AAAAAAAAAAA/+AAAAAP8AAAAAAH//+AAAAAAAAAAA/+AAAAAH4AAAAAAD//+AAAAAAAAAAA/8AAAAAHwAAAAAADwf8AAAAAAAAAAA/gAAAAAAAAAAAAACAH4AIAAAAAAAAB/wAAAAAAAAAAAAAAAD4AEAAAAAAAAB+AAAAAAAAAAAAAAAAAAAGAAAAAAAAB6AAAAAAAAAAAAAAAAAwAMAAAAAAAAA8AAAAAAAAAAAAAAAAAQAYAAAAAAAAB4AAAAAAAAAAAAAAAAAAAwAAAAAAAAB4AAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAACAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAA";
const COLS = 180, ROWS = 66, CELL = 6, LAT_TOP = 76, LAT_SPAN = 132;

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

let landCache: Float32Array | null = null;

export const worldMap = {
  width: COLS * CELL,
  height: ROWS * CELL,
  regions: REGIONS,
  countries: COUNTRIES,
  project(lat: number, lon: number): [number, number] {
    return [((lon + 180) / 360) * COLS * CELL, ((LAT_TOP - lat) / LAT_SPAN) * ROWS * CELL];
  },
  /** Inverse of project(): flat-map x/y back to [lat, lon]. */
  unproject(x: number, y: number): [number, number] {
    return [LAT_TOP - (y / (ROWS * CELL)) * LAT_SPAN, (x / (COLS * CELL)) * 360 - 180];
  },
  /** Land cell centres as a flat [lat, lon, lat, lon, …] array (client-side only; empty during SSR). Used by the globe. */
  landLatLon(): Float32Array {
    if (landCache) return landCache;
    if (typeof atob === "undefined") return new Float32Array(0);
    const bin = atob(MASK);
    const out: number[] = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      if ((bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) {
        out.push(LAT_TOP - (Math.floor(i / COLS) + 0.5) * (LAT_SPAN / ROWS), -180 + ((i % COLS) + 0.5) * (360 / COLS));
      }
    }
    landCache = new Float32Array(out);
    return landCache;
  },
  /** SVG path of the land dot-matrix (client-side only; returns "" during SSR). */
  landPath(dot = 2.6): string {
    if (typeof atob === "undefined") return "";
    const bin = atob(MASK);
    let d = "";
    const pad = (CELL - dot) / 2;
    for (let i = 0; i < COLS * ROWS; i++) {
      if ((bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) {
        d += `M${(i % COLS) * CELL + pad} ${Math.floor(i / COLS) * CELL + pad}h${dot}v${dot}h-${dot}z`;
      }
    }
    return d;
  },
};
