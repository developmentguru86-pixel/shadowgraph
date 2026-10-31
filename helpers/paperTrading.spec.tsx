import { paperTrading, type PaperTrade } from "./paperTrading";
import type { AlphaSetup } from "../endpoints/alpha_GET.schema";

const base: AlphaSetup = {
  signalId: "test-001", generatedAt: "2026-10-07T10:00:00Z",
  instrument: "BTC", direction: "LONG", state: "ARMED",
  confidence: 82, evidenceCount: 5, currentPrice: 99,
  trigger: 100, stop: 95, target1: 105, target2: 110,
  rewardRisk: 2, atr15m: 3,
  hiddenChain: ["DXY softens", "Liquidity rises", "BTC follows"],
  thesis: "Paper setup", invalidation: "Stop 95",
};

describe("paperTrading", () => {
  it("WAIT does not create a paper trade", () => {
    expect(paperTrading.reconcile([], { ...base, direction: "WAIT", state: "WAIT" }, { BTC: 99 }, "2026-10-07T10:00:00Z")).toEqual([]);
  });

  it("creates an ARMED setup only once, then activates at trigger", () => {
    const armed = paperTrading.reconcile([], base, { BTC: 99 }, "2026-10-07T10:00:00Z");
    expect(armed.length).toBe(1);
    expect(armed[0].state).toBe("ARMED");
    const active = paperTrading.reconcile(armed, base, { BTC: 101 }, "2026-10-07T10:05:00Z");
    expect(active.length).toBe(1);
    expect(active[0].state).toBe("ACTIVE");
    expect(active[0].activatedAt).toBe("2026-10-07T10:05:00Z");
  });

  it("closes at stop for -1R and at target2 for +2R", () => {
    const active: PaperTrade = { ...paperTrading.reconcile([], base, { BTC: 101 }, "2026-10-07T10:00:00Z")[0], state: "ACTIVE" };
    const stop = paperTrading.reconcile([active], null, { BTC: 94 }, "2026-10-07T10:10:00Z")[0];
    const win = paperTrading.reconcile([active], null, { BTC: 112 }, "2026-10-07T10:10:00Z")[0];
    expect(stop.state).toBe("STOPPED");
    expect(stop.rMultiple).toBe(-1);
    expect(win.state).toBe("TARGET HIT");
    expect(win.rMultiple).toBe(2);
    const stats = paperTrading.stats([stop, win]);
    expect(stats.resolved).toBe(2);
    expect(stats.winRate).toBe(50);
    expect(stats.avgR).toBe(0.5);
    expect(stats.maxDrawdown).toBe(-1);
  });

  it("expires an unfilled setup without inventing a realized return", () => {
    const armed = paperTrading.reconcile([], base, { BTC: 99 }, "2026-10-07T10:00:00Z");
    const expired = paperTrading.reconcile(armed, null, {}, "2026-10-07T16:01:00Z")[0];
    expect(expired.state).toBe("INVALIDATED");
    expect(expired.rMultiple).toBeUndefined();
    expect(paperTrading.stats([expired]).resolved).toBe(0);
  });

  it("does not create duplicate open trades for one instrument", () => {
    const first = paperTrading.reconcile([], base, { BTC: 99 }, "2026-10-07T10:00:00Z");
    const second = paperTrading.reconcile(first, { ...base, signalId: "test-002" }, { BTC: 99 }, "2026-10-07T10:10:00Z");
    expect(second.length).toBe(1);
  });

  it("tracks target1 touch without prematurely counting a win", () => {
    const active = paperTrading.reconcile([], base, { BTC: 101 }, "2026-10-07T10:00:00Z");
    const touched = paperTrading.reconcile(active, null, { BTC: 106 }, "2026-10-07T10:05:00Z")[0];
    expect(touched.state).toBe("ACTIVE");
    expect(touched.target1HitAt).toBeDefined();
    expect(paperTrading.stats([touched]).resolved).toBe(0);
  });
});
