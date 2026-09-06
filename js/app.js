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
    const tabs = ["construction", "optimization", "summary", "news"];
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
      if (name === "news") refreshNewsTab();
    }
    $("tab-construction-btn").addEventListener("click", () => show("construction"));
    $("tab-optimization-btn").addEventListener("click", () => show("optimization"));
    $("tab-summary-btn").addEventListener("click", () => show("summary"));
    $("tab-news-btn").addEventListener("click", () => show("news"));
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

    // If a fresh optimization was run this session, renderOptResults already
    // showed it; don't clobber it with the saved-data view.
    if (state.optData) return;

    // Otherwise, render the saved weights (if any) so the user sees real data
    // instead of just a text hint.
    const cached = S.getOptimization();
    if (!cached || !cached.weights || !cached.stats) return;

    const bySymbol = {};
    for (const s of U.UNIVERSE) bySymbol[s.symbol] = s;
    const metas = (cached.symbols || []).map((sym) =>
      bySymbol[sym] || { symbol: sym, name: "", sector: "" }
    );

    // If the save includes mu/Sigma/frontier (newer saves), reconstruct a
    // full optData so renderOptResults draws the complete table (with
    // contribution columns) and the efficient frontier — identical to a
    // fresh run.
    if (cached.mu && cached.Sigma && cached.frontier) {
      state.optData = {
        metas: metas,
        mu: cached.mu,
        Sigma: cached.Sigma,
        frontier: cached.frontier,
        weights: cached.weights,
        stats: cached.stats,
        rf: cached.rf != null ? cached.rf : 0,
        muMin: cached.muMin != null ? cached.muMin : Math.min.apply(null, cached.mu),
        muMax: cached.muMax != null ? cached.muMax : Math.max.apply(null, cached.mu),
        method: cached.method,
      };
      // Slider: position at the saved portfolio's return.
      const slider = $("target-return-slider");
      slider.disabled = false;
      const frac = (cached.stats.ret - state.optData.muMin) /
        (state.optData.muMax - state.optData.muMin || 1);
      slider.value = String(Math.round(Math.max(0, Math.min(100, frac * 100))));
      updateTargetLabel();
      renderOptResults();
      $("recompute-btn").disabled = false;
      $("save-weights-btn").disabled = false;
    } else {
      // Older save without mu/Sigma: render the simple table and a canvas
      // placeholder. Running "Fetch data & optimize" upgrades the save.
      $("opt-results").hidden = false;
      UI.renderWeightsTableSimple(cached.weights, metas);
      UI.renderStats(cached.stats);
      const canvas = $("frontier-canvas");
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#9aa0ab";
      ctx.font = "13px sans-serif";
      ctx.fillText("Efficient frontier unavailable for saved weights.", 60, canvas.height / 2);
      ctx.fillText("Click “Fetch data & optimize” to recompute.", 60, canvas.height / 2 + 20);
    }
    $("opt-progress").textContent = "Showing saved weights from " +
      new Date(cached.ts).toLocaleString() +
      ". Click “Fetch data & optimize” to refresh.";
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
    const { weights, stats, metas, method, mu, Sigma, frontier, rf, muMin, muMax } = state.optData;
    S.setOptimization({
      symbols: metas.map((m) => m.symbol),
      weights, stats, method, ts: Date.now(),
      // Persist mu/Sigma/frontier so the Optimization tab can fully
      // re-render (weights table with contribution columns + efficient
      // frontier) from saved data alone, without re-fetching prices.
      mu, Sigma, frontier, rf, muMin, muMax,
    });
    $("opt-progress").textContent = "Weights saved to browser.";
  }

  // ---- Tab 3: executive summary ----

  function initSummary() {
    $("summary-btn").addEventListener("click", runSummary);
  }

  // Refresh the summary tab when shown: enable/disable the generate button
  // based on what data is available. The summary can be generated from any
  // combination of: live screening results, a saved portfolio, and saved
  // optimization weights.
  function refreshSummaryTab() {
    const btn = $("summary-btn");
    const hasData = hasSummaryData();
    btn.disabled = !hasData;
    if (!hasData) {
      $("summary-progress").textContent =
        "Screen the universe, save a portfolio, or optimize first.";
    } else if (!state.openRouterKey) {
      $("summary-progress").textContent = "Enter and save an OpenRouter API key to generate.";
    } else {
      $("summary-progress").textContent = "";
    }
  }

  // True if there is any data to summarize: live screening results, a saved
  // portfolio, or saved optimization weights.
  function hasSummaryData() {
    const hasScreen = state.screenResults && state.screenResults.length > 0;
    const savedPortfolio = S.getPortfolio() || [];
    const hasPortfolio = savedPortfolio.length > 0;
    const savedOpt = S.getOptimization();
    const hasWeights = savedOpt && savedOpt.weights && savedOpt.weights.length > 0;
    return hasScreen || hasPortfolio || hasWeights;
  }

  // Build the data payload sent to the LLM. Includes whatever is available:
  // live screening results, the saved portfolio, and saved optimization
  // weights/stats. Falls back to persisted data when the in-session state is
  // empty (e.g. after a page reload).
  function buildSummaryPayload() {
    const payload = { stage: "construction" };
    const bySymbol = {};
    for (const s of U.UNIVERSE) bySymbol[s.symbol] = s;

    // Screening results (live, if a screen was run this session).
    const results = state.screenResults || [];
    if (results.length > 0) {
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
    }

    // Saved portfolio (the 15 selected stocks), with names/sectors resolved
    // from the universe.
    const saved = S.getPortfolio() || [];
    if (saved.length > 0) {
      payload.savedPortfolio = saved.map((sym) => {
        const m = bySymbol[sym] || {};
        return { symbol: sym, name: m.name || "", sector: m.sector || "" };
      });
    }

    // Optimization results. Prefer the in-session optData (richer: has full
    // metas); fall back to the persisted optimization object.
    let opt = null;
    if (state.optData) {
      const { weights, stats, metas, method } = state.optData;
      opt = {
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
    } else {
      const savedOpt = S.getOptimization();
      if (savedOpt && savedOpt.weights && savedOpt.weights.length > 0) {
        opt = {
          method: savedOpt.method,
          expectedReturn: savedOpt.stats && savedOpt.stats.ret,
          volatility: savedOpt.stats && savedOpt.stats.vol,
          sharpe: savedOpt.stats && savedOpt.stats.sharpe,
          riskFreeRate: null,
          holdings: (savedOpt.symbols || []).map((sym, i) => {
            const m = bySymbol[sym] || {};
            return {
              symbol: sym, name: m.name || "", sector: m.sector || "",
              weight: savedOpt.weights[i],
            };
          }).filter((h) => h.weight > 1e-6),
        };
      }
    }
    if (opt) {
      payload.stage = payload.savedPortfolio || payload.screening ? "construction+optimization" : "optimization";
      payload.optimization = opt;
    }

    return payload;
  }

  function runSummary() {
    if (!hasSummaryData()) {
      $("summary-progress").textContent =
        "Screen the universe, save a portfolio, or optimize first.";
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
      "Cover: how many stocks passed screening (if screening data is present), " +
      "the saved portfolio composition (if present), and — if optimization data " +
      "is present — the expected return, volatility, Sharpe ratio, and the " +
      "largest holdings by weight. " +
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

  // ---- Tab 4: trading signals / news ----

  // In-session cache of the last fetched press releases, so the Summarize
  // button can reuse them without re-fetching. Shape: [{ symbol, name, title,
  // datetime, url }, ...].
  let newsArticles = [];

  function initNews() {
    $("news-btn").addEventListener("click", runNews);
    $("news-summarize-btn").addEventListener("click", runNewsSummary);
  }

  // Enable/disable the fetch button based on whether a 15-stock portfolio is
  // saved. Mirrors the pattern used by refreshOptTab.
  function refreshNewsTab() {
    const hint = $("news-disabled-hint");
    const btn = $("news-btn");
    const saved = S.getPortfolio() || [];
    if (saved.length !== 15) {
      hint.hidden = false;
      hint.textContent = "No portfolio saved (need exactly 15 stocks). Go to the Portfolio Construction tab to screen and save one.";
      btn.disabled = true;
      $("news-summarize-btn").disabled = true;
      return;
    }
    hint.hidden = true;
    btn.disabled = false;
    // Summarize is enabled only once articles have been fetched.
    $("news-summarize-btn").disabled = newsArticles.length === 0;
    if (newsArticles.length === 0) {
      $("news-progress").textContent = "";
    }
  }

  // Fetch press releases for every ticker in the saved portfolio, collect them
  // into a flat list, and render it. Fetches run through the shared rate
  // limiter (8 req/min on the free tier), so 15 tickers take ~2 minutes.
  function runNews() {
    const saved = S.getPortfolio() || [];
    if (saved.length !== 15) return;
    if (!state.apiKey) {
      const k = $("api-key-input").value.trim();
      if (k) { state.apiKey = k; S.setApiKey(k); }
    }
    if (!state.apiKey) {
      $("news-progress").textContent = "Enter and save an API key first.";
      return;
    }
    const btn = $("news-btn");
    btn.disabled = true;
    $("news-summarize-btn").disabled = true;
    $("news-progress").textContent = "Fetching 0/15…";

    const bySymbol = {};
    for (const s of U.UNIVERSE) bySymbol[s.symbol] = s;
    const metas = saved.map((sym) => bySymbol[sym] || { symbol: sym, name: "", exchange: null });

    let done = 0;
    const fetches = metas.map((meta) => {
      return A.fetchPressReleases(meta.symbol, state.apiKey, meta.exchange, 10)
        .then((items) => {
          done++;
          $("news-progress").textContent = "Fetching " + done + "/15 (" + meta.symbol + ")";
          // Tag each article with its source ticker for display.
          return items.map((it) => ({
            symbol: meta.symbol,
            name: meta.name,
            title: it.title,
            datetime: it.datetime,
            url: it.url,
          }));
        })
        .catch((err) => {
          done++;
          // A single ticker failing should not abort the whole fetch; record
          // an empty result and keep going.
          $("news-progress").textContent = "Fetching " + done + "/15 (" + meta.symbol + " — " + (err.message || "error") + ")";
          return [];
        });
    });

    Promise.all(fetches).then((perTicker) => {
      // Flatten, newest-first within each ticker is already the API order;
      // keep a stable ticker order, then by datetime descending overall.
      const all = [];
      for (const arr of perTicker) for (const a of arr) all.push(a);
      all.sort((a, b) => (b.datetime || "").localeCompare(a.datetime || ""));
      newsArticles = all;
      renderNewsList(all);
      $("news-summarize-btn").disabled = all.length === 0;
      $("news-progress").textContent =
        "Done. " + all.length + " press release" + (all.length === 1 ? "" : "s") + " across " + saved.length + " tickers.";
    }).catch((err) => {
      // Should not happen (per-ticker errors are swallowed above), but guard.
      $("news-progress").textContent = "Error: " + (err.message || "unknown");
    }).finally(() => {
      btn.disabled = false;
    });
  }

  // Render the collected articles as a list of links. Falls back to a web
  // search URL when no link could be extracted from the press-release body.
  function renderNewsList(articles) {
    const box = $("news-results");
    const list = $("news-list");
    const heading = $("news-list-heading");
    box.hidden = false;
    list.innerHTML = "";
    if (!articles || articles.length === 0) {
      heading.textContent = "Press releases";
      list.innerHTML = '<li class="news-empty">No press releases found for the saved portfolio.</li>';
      return;
    }
    heading.textContent = "Press releases (" + articles.length + ")";
    for (const a of articles) {
      const li = document.createElement("li");
      li.className = "news-item";
      const href = a.url || ("https://www.google.com/search?q=" + encodeURIComponent(
        (a.title || a.symbol) + " press release " + (a.datetime || "")
      ));
      const ticker = document.createElement("span");
      ticker.className = "news-ticker";
      ticker.textContent = a.symbol;
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = a.title || "(untitled)";
      const meta = document.createElement("span");
      meta.className = "news-meta";
      const when = a.datetime ? new Date(a.datetime).toLocaleString() : "";
      meta.textContent = (a.name || "") + (when ? " — " + when : "");
      li.appendChild(ticker);
      li.appendChild(link);
      li.appendChild(meta);
      list.appendChild(li);
    }
  }

  // Send the collected article titles/dates/symbols to the LLM for a short
  // summary of the news across the portfolio.
  function runNewsSummary() {
    if (newsArticles.length === 0) {
      $("news-progress").textContent = "Fetch press releases first.";
      return;
    }
    if (!state.openRouterKey) {
      const k = $("openrouter-key-input").value.trim();
      if (k) { state.openRouterKey = k; S.setOpenRouterKey(k); }
    }
    if (!state.openRouterKey) {
      $("news-progress").textContent = "Enter and save an OpenRouter API key first.";
      return;
    }
    const btn = $("news-summarize-btn");
    btn.disabled = true;
    $("news-progress").textContent = "Summarizing…";

    const systemPrompt =
      "You are a concise equity-news analyst. Summarize the press releases " +
      "provided for a portfolio of stocks. Hard constraint: the summary MUST " +
      "NOT exceed 200 words. Use plain prose (no headings, no bullet lists). " +
      "Group themes across tickers where possible (e.g. earnings, guidance, " +
      "M&A, regulatory). Mention specific tickers only when material. " +
      "Do not invent facts; use only the titles and dates provided.";
    const userPrompt =
      "Summarize the following press releases (max 200 words). " +
      "Each line: <TICKER> <datetime> <title>.\n\n" +
      newsArticles.map((a) =>
        a.symbol + " " + (a.datetime || "") + " " + (a.title || "")
      ).join("\n");

    const model = $("news-model-input").value.trim() || null;
    Llm.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      state.openRouterKey,
      model
    ).then((text) => {
      $("news-summary-box").hidden = false;
      $("news-summary-content").textContent = text;
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      $("news-summary-meta").textContent =
        (model || Llm.DEFAULT_MODEL) + " — " + wordCount + " words";
      $("news-progress").textContent = "";
    }).catch((err) => {
      $("news-progress").textContent = "Error: " + (err.message || "unknown");
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
    initNews();
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);
