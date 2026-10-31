type InputSeries = Record<string, { dates: string[]; closes: number[] }>;

type Row = {
  signalDate: string;
  outcomeDate: string;
  x: number;
  y: number;
};

type FoldWindow = {
  name: string;
  start: string | null;
  end: string | null;
  n: number;
  corr: number;
  p: number;
  signMatchesTrain: boolean;
};

export type LeadLagSignal = {
  leader: string;
  follower: string;
  lagDays: number;
  direction: "same" | "inverse";
  trainCorr: number;
  trainQ: number;
  testCorr: number;
  testP: number;
  zeroLagCorr: number;
  stability: number;
  windows: {
    train: { start: string | null; end: string | null; n: number };
    test: { start: string | null; end: string | null; n: number };
    folds: FoldWindow[];
  };
};

export type LeadLagRun = {
  method: string;
  sample: {
    tickerCount: number;
    tickers: string[];
    marketTicker: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    trainEnd: string | null;
    testStart: string | null;
    minCloseDays: number;
    maxCloseDays: number;
    discoveryFraction: number;
    testFraction: number;
  };
  testsPerformed: number;
  trainSurvivors: number;
  signals: LeadLagSignal[];
};

type Options = {
  marketTicker?: string;
  discoveryFraction?: number;
  fdrAlpha?: number;
  maxLagDays?: number;
  testFolds?: number;
  minTrainObservations?: number;
  minTestObservations?: number;
  minStability?: number;
};

type Hypothesis = {
  leader: string;
  follower: string;
  lagDays: number;
  trainRows: Row[];
  testRows: Row[];
  trainCorr: number;
  trainP: number;
  trainQ: number;
  zeroLagCorr: number;
};

function logReturns(series: { dates: string[]; closes: number[] }) {
  const out = new Map<string, number>();
  const n = Math.min(series.dates.length, series.closes.length);
  for (let i = 1; i < n; i += 1) {
    const prev = series.closes[i - 1];
    const cur = series.closes[i];
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0 && cur > 0) {
      out.set(series.dates[i], Math.log(cur / prev));
    }
  }
  return out;
}

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function corrRows(rows: Row[]) {
  return pearson(rows.map((row) => row.x), rows.map((row) => row.y));
}

function tStat(r: number, n: number) {
  const denom = Math.max(1e-12, 1 - r * r);
  return r * Math.sqrt(Math.max(1, n - 2) / denom);
}

function logGamma(z: number): number {
  const coeff = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019571e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.9999999999998099;
  const zz = z - 1;
  for (let i = 0; i < coeff.length; i += 1) x += coeff[i] / (zz + i + 1);
  const t = zz + coeff.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaCf(a: number, b: number, x: number) {
  const maxIterations = 200;
  const eps = 3e-12;
  const fpmin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betaCf(a, b, x)) / a;
  return 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

function pValueForCorrelation(r: number, n: number) {
  if (n <= 2) return 1;
  const t = tStat(r, n);
  const df = n - 2;
  const x = df / (df + t * t);
  return Math.max(1e-300, Math.min(1, regularizedBeta(x, df / 2, 0.5)));
}

function alignedRows(leader: Map<string, number>, follower: Map<string, number>, lagDays: number) {
  const leaderDates = [...leader.keys()].sort();
  const followerDates = [...follower.keys()].sort();
  const followerIndex = new Map(followerDates.map((date, index) => [date, index]));
  const rows: Row[] = [];

  for (const signalDate of leaderDates) {
    const index = followerIndex.get(signalDate);
    if (index === undefined) continue;
    const outcomeDate = followerDates[index + lagDays];
    if (!outcomeDate) continue;
    const x = leader.get(signalDate);
    const y = follower.get(outcomeDate);
    if (x !== undefined && y !== undefined) rows.push({ signalDate, outcomeDate, x, y });
  }
  return rows;
}

function estimateBeta(asset: Map<string, number>, market: Map<string, number>, trainEnd: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, marketReturn] of market.entries()) {
    if (date > trainEnd) continue;
    const assetReturn = asset.get(date);
    if (assetReturn === undefined) continue;
    xs.push(marketReturn);
    ys.push(assetReturn);
  }
  if (xs.length < 30) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i += 1) {
    cov += (xs[i] - mx) * (ys[i] - my);
    variance += (xs[i] - mx) ** 2;
  }
  return variance > 0 ? cov / variance : 0;
}

function marketResidualize(
  returnsByTicker: Map<string, Map<string, number>>,
  marketTicker: string | undefined,
  trainEnd: string,
) {
  if (!marketTicker || !returnsByTicker.has(marketTicker)) return returnsByTicker;

  const market = returnsByTicker.get(marketTicker)!;
  const adjusted = new Map<string, Map<string, number>>();

  for (const [ticker, asset] of returnsByTicker.entries()) {
    if (ticker === marketTicker) {
      adjusted.set(ticker, new Map(asset));
      continue;
    }
    const beta = estimateBeta(asset, market, trainEnd);
    const residuals = new Map<string, number>();
    for (const [date, assetReturn] of asset.entries()) {
      const marketReturn = market.get(date);
      if (marketReturn === undefined) continue;
      residuals.set(date, assetReturn - beta * marketReturn);
    }
    adjusted.set(ticker, residuals);
  }
  return adjusted;
}

function applyBh(hypotheses: Hypothesis[]) {
  const sorted = [...hypotheses].sort((a, b) => a.trainP - b.trainP);
  let running = 1;
  for (let rank = sorted.length; rank >= 1; rank -= 1) {
    const item = sorted[rank - 1];
    item.trainQ = Math.min(running, (item.trainP * sorted.length) / rank);
    running = item.trainQ;
  }
}

function foldRows(rows: Row[], count: number) {
  const folds: Row[][] = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((rows.length * i) / count);
    const end = Math.floor((rows.length * (i + 1)) / count);
    folds.push(rows.slice(start, end));
  }
  return folds;
}

function range(rows: Row[]) {
  return {
    start: rows[0]?.signalDate ?? null,
    end: rows.at(-1)?.outcomeDate ?? null,
    n: rows.length,
  };
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function runLeadLag(series: InputSeries, options: Options = {}): LeadLagRun {
  const tickers = Object.keys(series).sort();
  const discoveryFraction = options.discoveryFraction ?? 0.65;
  const fdrAlpha = options.fdrAlpha ?? 0.05;
  const maxLagDays = options.maxLagDays ?? 5;
  const testFolds = options.testFolds ?? 3;
  const minTrainObservations = options.minTrainObservations ?? 90;
  const minTestObservations = options.minTestObservations ?? 45;
  const minStability = options.minStability ?? 0.6;

  const rawReturns = new Map<string, Map<string, number>>();
  for (const ticker of tickers) rawReturns.set(ticker, logReturns(series[ticker]));

  const allDates = [...new Set([...rawReturns.values()].flatMap((map) => [...map.keys()]))].sort();
  const splitIndex = Math.max(1, Math.min(allDates.length - 2, Math.floor(allDates.length * discoveryFraction) - 1));
  const trainEnd = allDates[splitIndex] ?? "";
  const testStart = allDates[splitIndex + 1] ?? trainEnd;
  const adjustedReturns = marketResidualize(rawReturns, options.marketTicker, trainEnd);

  const hypotheses: Hypothesis[] = [];
  for (const leader of tickers) {
    for (const follower of tickers) {
      if (leader === follower) continue;
      const leaderReturns = adjustedReturns.get(leader)!;
      const followerReturns = adjustedReturns.get(follower)!;
      const zeroLagRows = alignedRows(leaderReturns, followerReturns, 0)
        .filter((row) => row.outcomeDate <= trainEnd);
      const zeroLagCorr = corrRows(zeroLagRows);

      for (let lagDays = 1; lagDays <= maxLagDays; lagDays += 1) {
        const rows = alignedRows(leaderReturns, followerReturns, lagDays);
        const trainRows = rows.filter((row) => row.outcomeDate <= trainEnd);
        const testRows = rows.filter((row) => row.signalDate >= testStart);
        if (trainRows.length < minTrainObservations) continue;
        const trainCorr = corrRows(trainRows);
        hypotheses.push({
          leader,
          follower,
          lagDays,
          trainRows,
          testRows,
          trainCorr,
          trainP: pValueForCorrelation(trainCorr, trainRows.length),
          trainQ: 1,
          zeroLagCorr,
        });
      }
    }
  }

  applyBh(hypotheses);

  const trainSurvivors = hypotheses.filter((h) =>
    h.trainQ <= fdrAlpha &&
    Math.abs(h.trainCorr) >= 0.20 &&
    Math.abs(h.trainCorr) - Math.abs(h.zeroLagCorr) >= 0.03,
  );

  // IMPORTANT: select at most one direction/lag per unordered pair using TRAIN
  // information only. Choosing the best direction/lag after looking at OOS
  // results would leak test information into model selection and overstate the
  // apparent validation strength.
  const selectedByPair = new Map<string, Hypothesis>();
  for (const h of trainSurvivors) {
    const key = [h.leader, h.follower].sort().join("__");
    const existing = selectedByPair.get(key);
    const excess = Math.abs(h.trainCorr) - Math.abs(h.zeroLagCorr);
    const existingExcess = existing
      ? Math.abs(existing.trainCorr) - Math.abs(existing.zeroLagCorr)
      : Number.NEGATIVE_INFINITY;
    if (
      !existing ||
      h.trainQ < existing.trainQ ||
      (h.trainQ === existing.trainQ && excess > existingExcess) ||
      (h.trainQ === existing.trainQ && excess === existingExcess && Math.abs(h.trainCorr) > Math.abs(existing.trainCorr))
    ) {
      selectedByPair.set(key, h);
    }
  }

  const signals: LeadLagSignal[] = [];
  for (const h of selectedByPair.values()) {
    if (h.testRows.length < minTestObservations) continue;

    const testCorr = corrRows(h.testRows);
    const testP = pValueForCorrelation(testCorr, h.testRows.length);
    const trainSign = Math.sign(h.trainCorr);

    if (trainSign === 0 || Math.sign(testCorr) !== trainSign) continue;
    if (Math.abs(testCorr) < 0.10 || testP > 0.10) continue;

    const folds = foldRows(h.testRows, testFolds)
      .filter((rows) => rows.length >= 12)
      .map((rows, index) => {
        const corr = corrRows(rows);
        return {
          name: `oos-${index + 1}`,
          start: rows[0]?.signalDate ?? null,
          end: rows.at(-1)?.outcomeDate ?? null,
          n: rows.length,
          corr: round(corr),
          p: round(pValueForCorrelation(corr, rows.length)),
          signMatchesTrain: Math.sign(corr) === trainSign,
        };
      });

    if (folds.length < 2) continue;
    const signConsistency = folds.filter((fold) => fold.signMatchesTrain).length / folds.length;
    const magnitudeRetention = Math.min(1, Math.abs(testCorr) / Math.max(1e-8, Math.abs(h.trainCorr)));
    const stability = 0.6 * signConsistency + 0.4 * magnitudeRetention;
    if (stability < minStability) continue;

    signals.push({
      leader: h.leader,
      follower: h.follower,
      lagDays: h.lagDays,
      direction: h.trainCorr >= 0 ? "same" : "inverse",
      trainCorr: round(h.trainCorr),
      trainQ: round(h.trainQ, 8),
      testCorr: round(testCorr),
      testP: round(testP, 8),
      zeroLagCorr: round(h.zeroLagCorr),
      stability: round(stability),
      windows: {
        train: range(h.trainRows),
        test: range(h.testRows),
        folds,
      },
    });
  }

  const published = [...signals]
    .sort((a, b) => Math.abs(b.testCorr) * b.stability - Math.abs(a.testCorr) * a.stability);

  const closeCounts = tickers.map((ticker) => Math.min(series[ticker].dates.length, series[ticker].closes.length));

  return {
    method: `2y daily log returns; first ${Math.round(discoveryFraction * 100)}% discovery; optional market residualization using ${options.marketTicker ?? "none"} estimated on discovery only; all directed pair × 1-${maxLagDays} day lags tested; Benjamini-Hochberg FDR q≤${fdrAlpha}; for each unordered pair at most one direction/lag is selected using TRAIN data only; final ${Math.round((1 - discoveryFraction) * 100)}% is untouched until aggregate OOS plus ${testFolds} forward-fold validation; signal requires same train/test sign, test p≤0.10, |test r|≥0.10 and stability≥${minStability}. Stability = 0.6×OOS fold sign-consistency + 0.4×min(1, |test r|/|train r|).`,
    sample: {
      tickerCount: tickers.length,
      tickers,
      marketTicker: options.marketTicker && tickers.includes(options.marketTicker) ? options.marketTicker : null,
      dateStart: allDates[0] ?? null,
      dateEnd: allDates.at(-1) ?? null,
      trainEnd: trainEnd || null,
      testStart: testStart || null,
      minCloseDays: closeCounts.length ? Math.min(...closeCounts) : 0,
      maxCloseDays: closeCounts.length ? Math.max(...closeCounts) : 0,
      discoveryFraction,
      testFraction: 1 - discoveryFraction,
    },
    testsPerformed: hypotheses.length,
    trainSurvivors: trainSurvivors.length,
    signals: published,
  };
}

function naiveFalsePositiveCount(series: InputSeries, options: Options & { thresholdP?: number } = {}) {
  const thresholdP = options.thresholdP ?? 0.004;
  const tickers = Object.keys(series).sort();
  const maxLagDays = options.maxLagDays ?? 5;
  const returnsByTicker = new Map<string, Map<string, number>>();
  for (const ticker of tickers) returnsByTicker.set(ticker, logReturns(series[ticker]));

  let tests = 0;
  let hits = 0;
  for (const leader of tickers) {
    for (const follower of tickers) {
      if (leader === follower) continue;
      for (let lagDays = 1; lagDays <= maxLagDays; lagDays += 1) {
        const rows = alignedRows(returnsByTicker.get(leader)!, returnsByTicker.get(follower)!, lagDays);
        if (rows.length < 90) continue;
        tests += 1;
        const r = corrRows(rows);
        const p = pValueForCorrelation(r, rows.length);
        if (p < thresholdP) hits += 1;
      }
    }
  }

  return {
    thresholdP,
    tests,
    hits,
    hitRatePct: tests ? round((hits / tests) * 100, 3) : 0,
    expectedByChance: round(tests * thresholdP, 2),
  };
}

export const leadLagEngine = {
  runLeadLag,
  naiveFalsePositiveCount,
};
