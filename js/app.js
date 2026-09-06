// app.js — bootstrap, tab switching, settings bar, and glue between modules.
(function (global) {
  "use strict";

  const S = global.VINStorage;
  const U = global.VINUniverse;
  const Scr = global.VINScreening;
  const M = global.VINMarkowitz;
  const A = global.VINApi;
  const Llm = global.VINLlm;
  const UI = global.VINUI;

  // ---- state ----
  const state = {
    apiKey: "",
    openRouterKey: "",
    screenResults: null,   // last screening results array
    selected: new Set(),   // selected symbols in tab 1
    savedPortfolio: [],     // persisted symbols
    // optimization
    optData: null,          // { metas, mu, Sigma, frontier, weights, stats, rf }
  };

  // ---- helpers ----
  function $(id) { return document.getElementById(id); }
  function setApiStatus(text, cls) {
    const el = $("api-status");
    el.textContent = text;
    el.className = "api-status" + (cls ? " " + cls : "");
  }
  function setOpenRouterStatus(text, cls) {
    const el = $("openrouter-status");
    el.textContent = text;
    el.className = "api-status" + (cls ? " " + cls : "");
  }

  // ---- settings bar ----
  function initSettings() {
    state.apiKey = S.getApiKey() || "";
    $("api-key-input").value = state.apiKey;

    $("api-key-save").addEventListener("click", () => {
      const k = $("api-key-input").value.trim();
      state.apiKey = k;
      S.setApiKey(k);
      setApiStatus("Saved.", "ok");
      setTimeout(() => setApiStatus("", ""), 1500);
    });

    $("api-key-test").addEventListener("click", () => {
      const k = $("api-key-input").value.trim();
      if (!k) { setApiStatus("Enter an API key first.", "err"); return; }
      setApiStatus("Testing…", "busy");
      A.testApiKey(k).then(() => {
        setApiStatus("Valid key.", "ok");
      }).catch((err) => {
        setApiStatus("Error: " + (err.message || "unknown"), "err");
      });
    });

    // OpenRouter key (for the executive summary LLM).
    state.openRouterKey = S.getOpenRouterKey() || "";
    $("openrouter-key-input").value = state.openRouterKey;

    $("openrouter-key-save").addEventListener("click", () => {
      const k = $("openrouter-key-input").value.trim();
      state.openRouterKey = k;
      S.setOpenRouterKey(k);
      setOpenRouterStatus("Saved.", "ok");
      setTimeout(() => setOpenRouterStatus("", ""), 1500);
    });
  }

  // ---- tabs ----
  function initTabs() {
    const tabs = ["construction", "optimization", "summary"];
    function show(name) {
      for (const t of tabs) {
        const btn = $("tab-" + t + "-btn");
        const panel = $("tab-" + t);
        const active = t === name;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      }
      if (name === "optimization") refreshOptTab();
      if (name === "summary") refreshSummaryTab();
    }
    $("tab-construction-btn").addEventListener("click", () => show("construction"));
    $("tab-optimization-btn").addEventListener("click", () => show("optimization"));
    $("tab-summary-btn").addEventListener("click", () => show("summary"));
  }

  // ---- Tab 1: construction ----
  function initConstruction() {
    state.savedPortfolio = S.getPortfolio() || [];
    UI.renderSavedPortfolio(state.savedPortfolio);

    $("screen-btn").addEventListener("click", runScreen);
    $("save-portfolio-btn").addEventListener("click", savePortfolio);

    // Restore any saved selection into the selected set (so re-screen keeps it).
    if (state.savedPortfolio.length === 15) {
      for (const s of state.savedPortfolio) state.selected.add(s);
    }
    UI.updateSelectCount(state.selected, $("save-portfolio-btn"));
  }

  function runScreen() {
    if (!state.apiKey) {
      const k = $("api-key-input").value.trim();
      if (k) { state.apiKey = k; S.setApiKey(k); }
    }
    if (!state.apiKey) {
      $("screen-progress").textContent = "Enter and save an API key first.";
      return;
    }
    const btn = $("screen-btn");
    btn.disabled = true;
    $("screen-progress").textContent = "Screening 0/" + U.UNIVERSE.length + "…";
    // Reset selected to the saved portfolio so we keep prior picks if still eligible.
    const keep = new Set(state.savedPortfolio);
    state.selected = new Set(keep);

    Scr.screenUniverse(state.apiKey, (done, total, sym, reason) => {
      $("screen-progress").textContent = "Screening " + done + "/" + total + " (" + sym + (reason ? " — " + reason : "") + ")";
    }).then((results) => {
      state.screenResults = results;
      // Pre-check the top 15 eligible by default, but keep any saved picks.
      const eligible = results.filter((r) => r.eligible);
      if (state.selected.size < 15) {
        for (const r of eligible) {
          if (state.selected.size >= 15) break;
          state.selected.add(r.symbol);
        }
      }
      UI.renderScreenTable(results, state.selected, toggleSelect);
      UI.updateSelectCount(state.selected, $("save-portfolio-btn"));
      $("screen-progress").textContent =
        "Done. " + eligible.length + " eligible of " + results.length + ".";
    }).catch((err) => {
      $("screen-progress").textContent = "Error: " + (err.message || "unknown");
    }).finally(() => {
      btn.disabled = false;
    });
  }

  function toggleSelect(symbol, checked) {
    if (checked) {
      if (state.selected.size >= 15) {
        // uncheck the just-toggled box
        const cb = document.querySelector('input[data-symbol="' + symbol + '"]');
        if (cb) cb.checked = false;
        $("screen-progress").textContent = "You can select at most 15 stocks.";
        return;
      }
      state.selected.add(symbol);
    } else {
      state.selected.delete(symbol);
    }
    UI.updateSelectCount(state.selected, $("save-portfolio-btn"));
    // re-render row highlight only (cheap)
    const tr = document.querySelector('input[data-symbol="' + symbol + '"]');
    if (tr) tr.closest("tr").classList.toggle("selected", checked);
  }

  function savePortfolio() {
    if (state.selected.size !== 15) return;
    const symbols = Array.from(state.selected);
    S.setPortfolio(symbols);
    state.savedPortfolio = symbols;
    UI.renderSavedPortfolio(symbols);
    $("screen-progress").textContent = "Portfolio saved (15 stocks).";
  }

  // ---- Tab 2: optimization ----
  function refreshOptTab() {
    const hint = $("opt-disabled-hint");
    const controls = $("opt-controls");
    const saved = S.getPortfolio() || [];
    if (saved.length !== 15) {
      hint.hidden = false;
      hint.textContent = "No portfolio saved (need exactly 15 stocks). Go to the Portfolio Construction tab to screen and save one.";
      controls.style.opacity = "0.5";
      $("optimize-btn").disabled = true;
      return;
    }
    hint.hidden = true;
    controls.style.opacity = "1";
    $("optimize-btn").disabled = false;
    // Show stale cached results if any.
    const cached = S.getOptimization();
    if (cached && cached.weights && cached.stats) {
      // We can't fully re-render without mu/Sigma, but we can show a note.
      $("opt-progress").textContent = "Showing last saved weights from " + new Date(cached.ts).toLocaleString() + ". Click “Fetch data & optimize” to refresh.";
    }
  }

  function initOptimization() {
    $("optimize-btn").addEventListener("click", runOptimize);
    $("recompute-btn").addEventListener("click", recomputeAtTarget);
    $("save-weights-btn").addEventListener("click", saveWeights);
    $("target-return-slider").addEventListener("input", () => {
      updateTargetLabel();
    });
  }

  function updateTargetLabel() {
    if (!state.optData) return;
    const slider = $("target-return-slider");
    const muMin = state.optData.muMin, muMax = state.optData.muMax;
    const frac = Number(slider.value) / 100;
    const target = muMin + frac * (muMax - muMin);
    $("target-return-value").textContent = (target * 100).toFixed(2) + "%";
  }

  function runOptimize() {
    const saved = S.getPortfolio() || [];
    if (saved.length !== 15) return;
    if (!state.apiKey) {
      const k = $("api-key-input").value.trim();
      if (k) { state.apiKey = k; S.setApiKey(k); }
    }
    if (!state.apiKey) {
      $("opt-progress").textContent = "Enter and save an API key first.";
      return;
    }
    const btn = $("optimize-btn");
    btn.disabled = true;
    $("recompute-btn").disabled = true;
    $("save-weights-btn").disabled = true;
    $("opt-progress").textContent = "Fetching 0/15…";

    // Build meta list in the saved order.
    const bySymbol = {};
    for (const s of U.UNIVERSE) bySymbol[s.symbol] = s;
    const metas = saved.map((sym) => bySymbol[sym] || { symbol: sym, name: "", sector: "" });

    // Fetch time series for each, sequentially via the rate limiter.
    let done = 0;
    const fetches = metas.map((meta) => {
      return A.fetchTimeSeries(meta.symbol, 252, state.apiKey, meta.exchange)
        .then((bars) => {
          done++;
          $("opt-progress").textContent = "Fetching " + done + "/15 (" + meta.symbol + ")";
          return bars;
        })
        .catch((err) => {
          done++;
          $("opt-progress").textContent = "Error fetching " + meta.symbol + ": " + (err.message || "unknown");
          throw err;
        });
    });

    Promise.all(fetches).then((allBars) => {
      // Need at least ~60 bars each for a reasonable covariance.
      const minBars = 60;
      const closeSeries = [];
      const usedMetas = [];
      for (let i = 0; i < allBars.length; i++) {
        const bars = allBars[i];
        if (!Array.isArray(bars) || bars.length < minBars) {
          throw new Error("Insufficient data for " + metas[i].symbol + " (" + (bars ? bars.length : 0) + " bars)");
        }
        closeSeries.push(bars.map((b) => b.close));
        usedMetas.push(metas[i]);
      }
      const returns = M.computeReturnsMatrix(closeSeries);
      const { mu, Sigma } = M.annualize(returns);

      // Efficient frontier.
      const frontier = M.efficientFrontier(mu, Sigma, 25);

      // Default portfolio: minimum variance (no target).
      const sol = M.minVariancePortfolio(mu, Sigma, null);
      const weights = sol.weights;
      const rf = Number($("risk-free-input").value) / 100 || 0;
      const stats = M.portfolioStats(weights, mu, Sigma, rf);

      state.optData = {
        metas: usedMetas, mu, Sigma, frontier,
        weights, stats, rf,
        muMin: Math.min.apply(null, mu),
        muMax: Math.max.apply(null, mu),
        method: sol.method,
      };

      // Configure slider to the min-variance return by default.
      const slider = $("target-return-slider");
      slider.disabled = false;
      const mvFrac = (stats.ret - state.optData.muMin) / (state.optData.muMax - state.optData.muMin || 1);
      slider.value = String(Math.round(Math.max(0, Math.min(100, mvFrac * 100))));
      updateTargetLabel();

      renderOptResults();
      $("opt-progress").textContent = "Optimized (method: " + sol.method + "). Weights sum to " +
        (weights.reduce((a, b) => a + b, 0) * 100).toFixed(1) + "%.";
      $("recompute-btn").disabled = false;
      $("save-weights-btn").disabled = false;
    }).catch((err) => {
      $("opt-progress").textContent = "Optimization failed: " + (err.message || "unknown");
    }).finally(() => {
      btn.disabled = false;
    });
  }

  function renderOptResults() {
    if (!state.optData) return;
    const { metas, mu, Sigma, weights, stats, frontier } = state.optData;
    $("opt-results").hidden = false;
    UI.renderWeightsTable(weights, metas, mu, Sigma);
    UI.renderStats(stats);
    const canvas = $("frontier-canvas");
    UI.drawFrontier(canvas, frontier, { ret: stats.ret, vol: stats.vol });
  }

  function recomputeAtTarget() {
    if (!state.optData) return;
    const { mu, Sigma, metas, frontier, muMin, muMax } = state.optData;
    const slider = $("target-return-slider");
    const frac = Number(slider.value) / 100;
    const target = muMin + frac * (muMax - muMin);
    const sol = M.minVariancePortfolio(mu, Sigma, target);
    const weights = sol.weights;
    const rf = Number($("risk-free-input").value) / 100 || 0;
    const stats = M.portfolioStats(weights, mu, Sigma, rf);
    state.optData.weights = weights;
    state.optData.stats = stats;
    state.optData.method = sol.method;
    renderOptResults();
    $("opt-progress").textContent = "Recomputed at target " + (target * 100).toFixed(2) + "% (method: " + sol.method + ").";
  }

  function saveWeights() {
    if (!state.optData) return;
    const { weights, stats, metas, method } = state.optData;
    S.setOptimization({
      symbols: metas.map((m) => m.symbol),
      weights, stats, method, ts: Date.now(),
    });
    $("opt-progress").textContent = "Weights saved to browser.";
  }

  // ---- Tab 3: executive summary ----

  function initSummary() {
    $("summary-btn").addEventListener("click", runSummary);
  }

  // Refresh the summary tab when shown: enable/disable the generate button
  // based on what data is available.
  function refreshSummaryTab() {
    const btn = $("summary-btn");
    const hasScreen = state.screenResults && state.screenResults.length > 0;
    btn.disabled = !hasScreen;
    if (!hasScreen) {
      $("summary-progress").textContent = "Run the portfolio construction screen first.";
    } else if (!state.openRouterKey) {
      $("summary-progress").textContent = "Enter and save an OpenRouter API key to generate.";
    } else {
      $("summary-progress").textContent = "";
    }
  }

  // Build the data payload sent to the LLM. Includes screening results and,
  // if available, the optimization weights/stats.
  function buildSummaryPayload() {
    const payload = { stage: "construction" };

    // Screening results.
    const results = state.screenResults || [];
    const eligible = results.filter((r) => r.eligible);
    const ineligible = results.filter((r) => !r.eligible);
    payload.screening = {
      universeSize: results.length,
      eligibleCount: eligible.length,
      ineligibleCount: ineligible.length,
      eligible: eligible.map((r) => ({
        symbol: r.symbol, name: r.name, sector: r.sector,
        rsi: r.rsi, ma50: r.ma50, ma200: r.ma200,
        vol30: r.vol30, avgVol30: r.avgVol30,
      })),
    };

    // Saved portfolio (the 15 selected stocks).
    const saved = S.getPortfolio() || [];
    if (saved.length > 0) {
      payload.savedPortfolio = saved;
    }

    // Optimization results, if computed.
    if (state.optData) {
      payload.stage = "construction+optimization";
      const { weights, stats, metas, method } = state.optData;
      payload.optimization = {
        method: method,
        expectedReturn: stats.ret,
        volatility: stats.vol,
        sharpe: stats.sharpe,
        riskFreeRate: state.optData.rf,
        holdings: metas.map((m, i) => ({
          symbol: m.symbol, name: m.name, sector: m.sector,
          weight: weights[i],
        })).filter((h) => h.weight > 1e-6),
      };
    }

    return payload;
  }

  function runSummary() {
    if (!state.screenResults || state.screenResults.length === 0) {
      $("summary-progress").textContent = "Run the portfolio construction screen first.";
      return;
    }
    if (!state.openRouterKey) {
      const k = $("openrouter-key-input").value.trim();
      if (k) { state.openRouterKey = k; S.setOpenRouterKey(k); }
    }
    if (!state.openRouterKey) {
      $("summary-progress").textContent = "Enter and save an OpenRouter API key first.";
      return;
    }
    const btn = $("summary-btn");
    btn.disabled = true;
    $("summary-progress").textContent = "Generating…";

    const payload = buildSummaryPayload();
    const systemPrompt =
      "You are a concise equity-research analyst. Write an executive summary of the " +
      "portfolio construction and (if provided) optimization results. " +
      "Hard constraint: the summary MUST NOT exceed 200 words. " +
      "Use plain prose (no headings, no bullet lists). " +
      "Cover: how many stocks passed screening, notable eligible names/sectors, " +
      "and — if optimization data is present — the expected return, volatility, " +
      "Sharpe ratio, and the largest holdings by weight. " +
      "Do not invent numbers; use only the data provided.";
    const userPrompt =
      "Summarize the following portfolio results as an executive summary (max 200 words):\n\n" +
      JSON.stringify(payload, null, 2);

    const model = $("summary-model-input").value.trim() || null;
    Llm.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      state.openRouterKey,
      model
    ).then((text) => {
      $("summary-box").hidden = false;
      $("summary-content").textContent = text;
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      $("summary-meta").textContent =
        (model || Llm.DEFAULT_MODEL) + " — " + wordCount + " words";
      $("summary-progress").textContent = "";
    }).catch((err) => {
      $("summary-progress").textContent = "Error: " + (err.message || "unknown");
    }).finally(() => {
      btn.disabled = false;
    });
  }

  // ---- boot ----
  function init() {
    initSettings();
    initTabs();
    initConstruction();
    initOptimization();
    initSummary();
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);
