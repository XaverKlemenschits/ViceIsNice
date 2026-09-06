// api.js — Twelve Data REST API helpers with rate limiting.
// Docs: https://api.twelvedata.com
// Only the `time_series` and `price` endpoints are used (Basic/free tier).
(function (global) {
  "use strict";

  const BASE = "https://api.twelvedata.com";
  // Free plan: 8 requests/minute, 800/day. Default conservative.
  const DEFAULT_RPM = 8;
  const MAX_RETRIES = 3;

  // Simple token-bucket-ish queue: at most `rpm` requests per 60s window,
  // spaced out. We serialize with a minimum interval to be safe.
  function RateLimiter(rpm) {
    this.rpm = rpm || DEFAULT_RPM;
    this.minIntervalMs = Math.ceil(60000 / this.rpm);
    this.queue = [];
    this.running = false;
    this.lastDispatch = 0;
  }
  RateLimiter.prototype.next = function (fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._pump();
    });
  };
  RateLimiter.prototype._pump = function () {
    if (this.running) return;
    this.running = true;
    const step = () => {
      if (this.queue.length === 0) { this.running = false; return; }
      const now = Date.now();
      const wait = Math.max(0, this.lastDispatch + this.minIntervalMs - now);
      setTimeout(() => {
        const job = this.queue.shift();
        this.lastDispatch = Date.now();
        Promise.resolve()
          .then(job.fn)
          .then(job.resolve, job.reject)
          .finally(() => step());
      }, wait);
    };
    step();
  };

  const limiter = new RateLimiter(DEFAULT_RPM);

  function setRpm(rpm) { limiter.rpm = rpm; limiter.minIntervalMs = Math.ceil(60000 / rpm); }

  // Build a query string from an object, skipping null/undefined.
  function qs(params) {
    const parts = [];
    for (const k in params) {
      if (params[k] != null) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  // Low-level GET with retry on 429.
  function getJson(path, params, apiKey) {
    const url = BASE + path + qs(params);
    let attempt = 0;
    const attemptOnce = () => {
      return fetch(url).then((res) => res.json()).then((data) => {
        if (data && data.status === "error") {
          const code = data.code;
          const msg = (data.message || "Unknown error").toString();
          // 429 or rate-limit related codes -> retry with backoff.
          if ((code === 429 || /rate limit/i.test(msg)) && attempt < MAX_RETRIES) {
            attempt++;
            const backoff = Math.min(8000, 1000 * Math.pow(2, attempt));
            return new Promise((resolve) => setTimeout(resolve, backoff)).then(attemptOnce);
          }
          const err = new Error(msg);
          err.code = code;
          err.status = "error";
          throw err;
        }
        return data;
      });
    };
    return limiter.next(attemptOnce);
  }

  // Validate an API key by fetching a single price.
  // Resolves to { ok: true } or rejects with an Error.
  function testApiKey(apiKey) {
    if (!apiKey) return Promise.reject(new Error("No API key provided."));
    return getJson("/price", { symbol: "AAPL", apikey: apiKey }).then((data) => {
      if (data && typeof data.price !== "undefined") return { ok: true, price: data.price };
      throw new Error("Unexpected response from /price.");
    });
  }

  // Fetch daily time series for a symbol.
  // Returns an array of bars oldest-first: [{datetime, open, high, low, close, volume}, ...]
  // Numeric fields are coerced to Numbers; null/invalid bars are dropped.
  // `exchange` (optional) disambiguates international listings (e.g. "LSE",
  // "Euronext", "OTC"); null/undefined omits the parameter. Throws on API
  // error or insufficient data.
  function fetchTimeSeries(symbol, outputsize, apiKey, exchange) {
    outputsize = outputsize || 250;
    if (!apiKey) return Promise.reject(new Error("No API key provided."));
    return getJson("/time_series", {
      symbol: symbol,
      interval: "1day",
      outputsize: outputsize,
      apikey: apiKey,
      exchange: exchange,
    }).then((data) => {
      if (!data || data.status === "error") {
        throw new Error((data && data.message) || "time_series error");
      }
      const values = (data && data.values) || [];
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error("No values returned for " + symbol);
      }
      // Twelve Data returns newest-first; reverse to oldest-first.
      const bars = [];
      for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        const close = v.close == null ? null : Number(v.close);
        const volume = v.volume == null ? null : Number(v.volume);
        // Require a valid close; volume may be null (some intl feeds).
        if (close == null || !isFinite(close)) continue;
        bars.push({
          datetime: v.datetime,
          open: v.open == null ? null : Number(v.open),
          high: v.high == null ? null : Number(v.high),
          low: v.low == null ? null : Number(v.low),
          close: close,
          volume: volume != null && isFinite(volume) ? volume : null,
        });
      }
      return bars;
    });
  }

  global.VINApi = {
    BASE, DEFAULT_RPM, setRpm,
    testApiKey, fetchTimeSeries,
  };
})(window);
