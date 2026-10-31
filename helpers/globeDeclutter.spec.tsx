import { declutter, type Disc } from "./globeDeclutter";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("declutter", () => {
  it("leaves markers that do not touch where they are", () => {
    const out = declutter([{ key: "a", x: 0, y: 0, r: 5 }, { key: "b", x: 100, y: 0, r: 5 }]);
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("b")).toEqual({ x: 100, y: 0 });
  });

  it("separates markers with identical coordinates so none overlap", () => {
    const discs: Disc[] = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, x: 200, y: 200, r: 4 + (i % 5) * 2 }));
    const out = declutter(discs, 3);
    for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i], b = discs[j];
      expect(dist(out.get(a.key)!, out.get(b.key)!)).toBeGreaterThan(a.r + b.r);
    }
  });

  it("is deterministic and independent of input order", () => {
    const discs: Disc[] = [{ key: "x", x: 10, y: 10, r: 6 }, { key: "y", x: 11, y: 10, r: 6 }, { key: "z", x: 10, y: 12, r: 3 }];
    const a = declutter(discs), b = declutter([...discs].reverse());
    for (const d of discs) expect(a.get(d.key)).toEqual(b.get(d.key));
  });

  it("keeps markers that only touch at their true positions (geography stays right; zoom separates them)", () => {
    const out = declutter([{ key: "a", x: 0, y: 0, r: 10 }, { key: "b", x: 15, y: 0, r: 10 }]);
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("b")).toEqual({ x: 15, y: 0 });
  });

  it("keeps a group centred on its true positions", () => {
    const out = declutter([{ key: "a", x: 50, y: 50, r: 5 }, { key: "b", x: 52, y: 50, r: 5 }]);
    const mx = (out.get("a")!.x + out.get("b")!.x) / 2;
    expect(Math.abs(mx - 51)).toBeLessThan(15);
  });
});
