import type { AlphaSetup } from "../endpoints/alpha_GET.schema";

export type PaperTrade = {
  signalId: string;
  instrument: string;
  direction: "LONG" | "SHORT";
  state: "ARMED" | "ACTIVE" | "TARGET HIT" | "STOPPED" | "INVALIDATED";
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  rewardRisk: number;
  confidence: number;
  createdAt: string;
  activatedAt?: string;
  target1HitAt?: string;
  closedAt?: string;
  closePrice?: number;
  rMultiple?: number;
};

const MAX_TRADES = 100;
const ARM_TTL_MS = 6 * 60 * 60 * 1000;

function isOpen(trade: PaperTrade) {
  return trade.state === "ARMED" || trade.state === "ACTIVE";
}

function calcR(trade: PaperTrade, closePrice: number) {
  const risk = Math.abs(trade.entry - trade.stop);
  if (!(risk > 0)) return 0;
  const move = trade.direction === "LONG"
    ? closePrice - trade.entry
    : trade.entry - closePrice;
  return Math.round((move / risk) * 100) / 100;
}

function reached(trade: PaperTrade, price: number, level: number, aboveForLong: boolean) {
  return trade.direction === "LONG"
    ? (aboveForLong ? price >= level : price <= level)
    : (aboveForLong ? price <= level : price >= level);
}

function close(trade: PaperTrade, state: PaperTrade["state"], now: string, price: number): PaperTrade {
  return {
    ...trade,
    state,
    closedAt: now,
    closePrice: price,
    rMultiple: state === "INVALIDATED" ? undefined : calcR(trade, price),
  };
}

function qualified(setup: AlphaSetup): setup is AlphaSetup & {
  direction: "LONG" | "SHORT";
  trigger: number;
  stop: number;
  target1: number;
  target2: number;
  rewardRisk: number;
} {
  return (
    (setup.direction === "LONG" || setup.direction === "SHORT") &&
    (setup.state === "ARMED" || setup.state === "ACTIVE") &&
    setup.confidence >= 75 &&
    setup.rewardRisk !== null &&
    setup.rewardRisk >= 2 &&
    [setup.trigger, setup.stop, setup.target1, setup.target2].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    (setup.direction === "LONG"
      ? setup.stop! < setup.trigger! && setup.trigger! < setup.target1! && setup.target1! < setup.target2!
      : setup.stop! > setup.trigger! && setup.trigger! > setup.target1! && setup.target1! > setup.target2!)
  );
}

function reconcile(
  previous: PaperTrade[],
  setup: AlphaSetup | null,
  prices: Record<string, number>,
  now: string,
): PaperTrade[] {
  const nowMs = Date.parse(now);
  let trades = [...previous];

  if (setup && qualified(setup) &&
      !trades.some((trade) => trade.signalId === setup.signalId) &&
      !trades.some((trade) => trade.instrument === setup.instrument && isOpen(trade))) {
    trades.unshift({
      signalId: setup.signalId,
      instrument: setup.instrument,
      direction: setup.direction,
      state: "ARMED",
      entry: setup.trigger,
      stop: setup.stop,
      target1: setup.target1,
      target2: setup.target2,
      rewardRisk: setup.rewardRisk,
      confidence: setup.confidence,
      createdAt: now,
    });
  }

  trades = trades.map((trade) => {
    if (!isOpen(trade)) return trade;
    const price = prices[trade.instrument];
    const hasPrice = Number.isFinite(price) && price > 0;

    if (trade.state === "ARMED") {
      if (Number.isFinite(nowMs) && nowMs - Date.parse(trade.createdAt) >= ARM_TTL_MS) {
        return close(trade, "INVALIDATED", now, hasPrice ? price : trade.entry);
      }
      if (!hasPrice) return trade;
      // A breached stop before entry invalidates a pending setup.
      if (reached(trade, price, trade.stop, false)) {
        return close(trade, "INVALIDATED", now, price);
      }
      if (reached(trade, price, trade.entry, true)) {
        // Paper entry is the published trigger, not a claimed executable fill.
        return { ...trade, state: "ACTIVE", activatedAt: now };
      }
      return trade;
    }

    if (!hasPrice) return trade;
    // Polling cannot reconstruct intrabar order; evaluate adverse stop first.
    if (reached(trade, price, trade.stop, false)) {
      return close(trade, "STOPPED", now, trade.stop);
    }
    if (reached(trade, price, trade.target2, true)) {
      return close(trade, "TARGET HIT", now, trade.target2);
    }
    if (!trade.target1HitAt && reached(trade, price, trade.target1, true)) {
      return { ...trade, target1HitAt: now };
    }
    return trade;
  });

  return trades.slice(0, MAX_TRADES);
}

function stats(trades: PaperTrade[]) {
  const closed = trades
    .filter((trade) => (trade.state === "TARGET HIT" || trade.state === "STOPPED") && Number.isFinite(trade.rMultiple))
    .sort((a, b) => Date.parse(a.closedAt ?? a.createdAt) - Date.parse(b.closedAt ?? b.createdAt));
  const wins = closed.filter((trade) => (trade.rMultiple ?? 0) > 0).length;
  const totalR = closed.reduce((sum, trade) => sum + (trade.rMultiple ?? 0), 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of closed) {
    equity += trade.rMultiple ?? 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return {
    resolved: closed.length,
    winRate: closed.length ? 100 * wins / closed.length : 0,
    avgR: closed.length ? totalR / closed.length : 0,
    totalR,
    maxDrawdown,
    open: trades.filter(isOpen).length,
    invalidated: trades.filter((trade) => trade.state === "INVALIDATED").length,
  };
}

export const paperTrading = { reconcile, stats, qualified };
