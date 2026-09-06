// screening.js — apply technical criteria to a stock's time series and
// rank the universe. Pure-ish: depends on VINIndicators and VINApi.
(function (global) {
  "use strict";

  const IND = global.VINIndicators;
  const API = global.VINApi;

  // Thresholds (from Implementation.md / FunctionalRequirements.md).
  const THRESH = {
    rsiMax: 70,            // not overbought
    volMax: 0.30,          // 30d annualized vol < 30%
    avgVolMin: 1_000_000,  // 30d avg volume > 1M shares
    minBars: 200,          // need >= 200 valid bars for 200d SMA
  };

  // Screen a single stock given its bar series (oldest-first).
  // meta: { symbol, name, sector }
  // Returns a result object with metrics, per-criterion pass/fail, eligibility,
  // and a sort score. On error/insufficient data, marks ineligible with reason.
  function screenStock(meta, bars) {
    const base = {
      symbol: meta.symbol,
      name: meta.name,
      sector: meta.sector,
      rsi: null, ma50: null, ma200: null, vol30: null, avgVol30: null,
      passes: { rsi: false, momentum: false, vol: false, liquidity: false },
      eligible: false,
      reason: null,
      score: 0,
    };

    if (!Array.isArray(bars) || bars.length < THRESH.minBars) {
      base.reason = "insufficient data (" + (bars ? bars.length : 0) + " bars)";
      return base;
    }

    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);

    base.rsi = IND.rsi(closes, 14);
    base.ma50 = IND.sma(closes, 50);
    base.ma200 = IND.sma(closes, 200);
    base.vol30 = IND.annualizedVolatility(closes, 30);
    base.avgVol30 = IND.avgVolume(volumes, 30);

    // Evaluate criteria (null metric => fail that criterion).
    base.passes.rsi = base.rsi != null && base.rsi < THRESH.rsiMax;
    base.passes.momentum = base.ma50 != null && base.ma200 != null && base.ma50 > base.ma200;
    base.passes.vol = base.vol30 != null && base.vol30 < THRESH.volMax;
    // Liquidity: some international feeds return null volume; treat null as fail
    // unless we genuinely have no volume data at all (then mark N/A).
    base.passes.liquidity = base.avgVol30 != null && base.avgVol30 > THRESH.avgVolMin;

    base.eligible = base.passes.rsi && base.passes.momentum && base.passes.vol && base.passes.liquidity;

    // Sort score: higher = better. Priority order RSI > momentum > vol > liquidity,
    // then lower volatility is better. Encode as a tuple packed into a number.
    // We use a layered integer score so ties break correctly.
    const rsiPass = base.passes.rsi ? 1 : 0;
    const momPass = base.passes.momentum ? 1 : 0;
    const volPass = base.passes.vol ? 1 : 0;
    const liqPass = base.passes.liquidity ? 1 : 0;
    // 4-bit priority, then subtract normalized volatility (lower vol -> higher score).
    const volNorm = base.vol30 != null ? Math.min(base.vol30, 1) : 1;
    base.score =
      rsiPass * 1000 + momPass * 100 + volPass * 10 + liqPass * 1 - volNorm;

    return base;
  }

  // Screen the whole universe. Calls onProgress(done, total, lastSymbol, status).
  // Returns a sorted array of results (eligible first, then by score desc).
  function screenUniverse(apiKey, onProgress) {
    const universe = global.VINUniverse.UNIVERSE;
    const total = universe.length;
    let done = 0;
    const results = [];

    const tasks = universe.map((meta) => {
      return API.fetchTimeSeries(meta.symbol, 250, apiKey, meta.exchange)
        .then((bars) => screenStock(meta, bars))
        .catch((err) => {
          const r = screenStock(meta, []); // insufficient data path
          r.reason = (err && err.message) || "fetch error";
          return r;
        })
        .then((res) => {
          results.push(res);
          done++;
          if (onProgress) onProgress(done, total, meta.symbol, res.reason);
        });
    });

    return Promise.all(tasks).then(() => {
      // Sort: eligible first, then score desc, then symbol asc for stability.
      results.sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
      });
      return results;
    });
  }

  global.VINScreening = { THRESH, screenStock, screenUniverse };
})(window);
