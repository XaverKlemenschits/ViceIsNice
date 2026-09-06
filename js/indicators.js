// indicators.js — pure technical-indicator helpers.
// All functions take arrays of numbers (closes or volumes) ordered
// oldest-first (chronological). They return null when there is not
// enough data, so callers can mark a stock ineligible.
(function (global) {
  "use strict";

  // Simple Moving Average of the last `period` values.
  // Returns the single latest SMA value, or null if insufficient data.
  function sma(values, period) {
    if (!Array.isArray(values) || values.length < period || period <= 0) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return sum / period;
  }

  // RSI using Wilder's smoothing (period default 14).
  // Returns the latest RSI value, or null if insufficient data.
  function rsi(closes, period) {
    if (!Array.isArray(closes) || closes.length < period + 1 || period <= 0) return null;
    let gain = 0, loss = 0;
    // Seed with the first `period` average gains/losses.
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch >= 0) gain += ch; else loss -= ch;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    // Smooth the remaining bars.
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // Annualized volatility from daily log returns over the last `window` bars.
  // sigma_daily * sqrt(252), expressed as a fraction (e.g. 0.18 = 18%).
  // Returns null if insufficient data.
  function annualizedVolatility(closes, window) {
    window = window || 30;
    if (!Array.isArray(closes) || closes.length < window + 1) return null;
    const n = closes.length;
    const rets = [];
    for (let i = n - window; i < n; i++) {
      const prev = closes[i - 1];
      if (prev <= 0) return null; // guard against bad data
      rets.push(Math.log(closes[i] / prev));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    let variance = 0;
    for (const r of rets) variance += (r - mean) * (r - mean);
    variance /= rets.length; // population std
    return Math.sqrt(variance) * Math.sqrt(252);
  }

  // Average of the last `window` volume values. Returns null if insufficient.
  function avgVolume(volumes, window) {
    window = window || 30;
    if (!Array.isArray(volumes) || volumes.length < window) return null;
    let sum = 0;
    for (let i = volumes.length - window; i < volumes.length; i++) sum += volumes[i];
    return sum / window;
  }

  // Daily log returns for a close series (length n -> n-1 returns).
  // Skips pairs where prev <= 0 (defensive).
  function logReturns(closes) {
    if (!Array.isArray(closes) || closes.length < 2) return [];
    const out = [];
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1];
      if (prev > 0) out.push(Math.log(closes[i] / prev));
    }
    return out;
  }

  global.VINIndicators = {
    sma, rsi, annualizedVolatility, avgVolume, logReturns,
  };
})(window);
