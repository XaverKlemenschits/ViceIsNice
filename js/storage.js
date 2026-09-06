// storage.js — versioned localStorage helpers for Vice Is Nice.
// All values are stored as JSON {v: <schemaVersion>, ...payload}.
(function (global) {
  "use strict";

  const SCHEMA_VERSION = 1;

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "v" in parsed) {
        return parsed.v === SCHEMA_VERSION ? parsed.payload : fallback;
      }
      return fallback;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, payload) {
    try {
      localStorage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, payload }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // Convenience accessors for the known keys.
  const KEYS = {
    apiKey: "vin_apikey",
    openRouterKey: "vin_openrouterkey",
    portfolio: "vin_portfolio",
    optimization: "vin_optimization",
  };

  function getApiKey() { return get(KEYS.apiKey, ""); }
  function setApiKey(k) { return set(KEYS.apiKey, k); }

  function getOpenRouterKey() { return get(KEYS.openRouterKey, ""); }
  function setOpenRouterKey(k) { return set(KEYS.openRouterKey, k); }

  function getPortfolio() { return get(KEYS.portfolio, []); }
  function setPortfolio(symbols) { return set(KEYS.portfolio, symbols); }

  function getOptimization() { return get(KEYS.optimization, null); }
  function setOptimization(data) { return set(KEYS.optimization, data); }

  global.VINStorage = {
    SCHEMA_VERSION,
    KEYS,
    get, set, remove,
    getApiKey, setApiKey,
    getOpenRouterKey, setOpenRouterKey,
    getPortfolio, setPortfolio,
    getOptimization, setOptimization,
  };
})(window);
