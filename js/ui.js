// ui.js — DOM rendering helpers for both tabs.
// Depends on: VINStorage, VINUniverse, VINScreening, VINMarkowitz, VINApi, VINIndicators.
(function (global) {
  "use strict";

  const fmt = {
    num: (x, d) => (x == null || !isFinite(x)) ? "—" : Number(x).toFixed(d == null ? 2 : d),
    pct: (x, d) => (x == null || !isFinite(x)) ? "—" : (Number(x) * 100).toFixed(d == null ? 1 : d) + "%",
    pctRaw: (x, d) => (x == null || !isFinite(x)) ? "—" : Number(x).toFixed(d == null ? 1 : d) + "%",
    vol: (x) => {
      if (x == null || !isFinite(x)) return "—";
      if (x >= 1e9) return (x / 1e9).toFixed(2) + "B";
      if (x >= 1e6) return (x / 1e6).toFixed(2) + "M";
      if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
      return x.toFixed(0);
    },
  };

  function chip(pass, label) {
    const cls = pass ? "pass" : "fail";
    return '<span class="chip ' + cls + '" title="' + label + '">' + (pass ? "P" : "F") + "</span>";
  }

  // ---- Tab 1: screening table ----

  // Render the screening results table. `results` is the array from screenUniverse.
  // `selected` is a Set of symbols currently checked. Returns nothing.
  function renderScreenTable(results, selected, onToggle) {
    const body = document.getElementById("screen-body");
    body.innerHTML = "";
    if (!results || results.length === 0) {
      body.innerHTML = '<tr class="empty-row"><td colspan="11">No results. Click “Screen universe”.</td></tr>';
      return;
    }
    for (const r of results) {
      const tr = document.createElement("tr");
      if (!r.eligible) tr.className = "ineligible";
      if (selected.has(r.symbol)) tr.classList.add("selected");

      // checkbox cell
      const tdC = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(r.symbol);
      cb.dataset.symbol = r.symbol;
      cb.addEventListener("change", () => onToggle(r.symbol, cb.checked));
      tdC.appendChild(cb);
      tr.appendChild(tdC);

      const cells = [
        r.symbol,
        r.name,
        r.sector,
        fmt.num(r.rsi, 1),
        fmt.num(r.ma50, 2),
        fmt.num(r.ma200, 2),
        fmt.pct(r.vol30, 1),
        fmt.vol(r.avgVol30),
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }

      // criteria chips
      const tdCrit = document.createElement("td");
      tdCrit.className = "criteria-cell";
      tdCrit.innerHTML =
        chip(r.passes.rsi, "RSI < 70") +
        chip(r.passes.momentum, "50d MA > 200d MA") +
        chip(r.passes.vol, "30d vol < 30%") +
        chip(r.passes.liquidity, "30d avg vol > 1M");
      tr.appendChild(tdCrit);

      // eligible chip
      const tdEl = document.createElement("td");
      if (r.reason) {
        tdEl.innerHTML = '<span class="chip na" title="' + escapeHtml(r.reason) + '">N/A</span>';
      } else {
        tdEl.innerHTML = chip(r.eligible, r.eligible ? "Eligible" : "Not eligible");
      }
      tr.appendChild(tdEl);

      body.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Render the saved-portfolio box.
  function renderSavedPortfolio(symbols) {
    const box = document.getElementById("saved-portfolio-box");
    const list = document.getElementById("saved-portfolio-list");
    const count = document.getElementById("saved-count");
    if (!symbols || symbols.length === 0) {
      box.hidden = true;
      list.innerHTML = "";
      count.textContent = "0";
      return;
    }
    box.hidden = false;
    count.textContent = String(symbols.length);
    const bySymbol = {};
    for (const s of global.VINUniverse.UNIVERSE) bySymbol[s.symbol] = s;
    list.innerHTML = "";
    for (const sym of symbols) {
      const li = document.createElement("li");
      const meta = bySymbol[sym];
      li.textContent = sym + (meta ? " — " + meta.name : "");
      list.appendChild(li);
    }
  }

  // Update the "X/15 selected" label and Save button state.
  function updateSelectCount(selected, saveBtn) {
    const n = selected.size;
    document.getElementById("select-count").textContent = n + "/15 selected";
    saveBtn.disabled = n !== 15;
  }

  // ---- Tab 2: optimization results ----

  function renderWeightsTable(weights, metas, mu, Sigma) {
    const body = document.getElementById("weights-body");
    body.innerHTML = "";
    const n = weights.length;
    // Precompute per-asset marginal vol contribution (sqrt(diag(Sigma)) * w).
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (w < 1e-6) continue; // skip near-zero weights for brevity
      const tr = document.createElement("tr");
      const meta = metas[i] || { symbol: "?", name: "" };
      const retContrib = w * mu[i];
      const volContrib = w * Math.sqrt(Sigma[i][i]);
      const cells = [
        meta.symbol,
        meta.name,
        fmt.pctRaw(w * 100, 2),
        fmt.pctRaw(retContrib * 100, 2),
        fmt.pctRaw(volContrib * 100, 2),
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    if (body.children.length === 0) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No weights to display.</td></tr>';
    }
  }

  // Render the weights table from saved data only (no mu/Sigma available).
  // Keeps the same 5-column layout; the return/vol contribution columns show
  // "—" since they can't be recomputed without the covariance matrix.
  function renderWeightsTableSimple(weights, metas) {
    const body = document.getElementById("weights-body");
    body.innerHTML = "";
    const n = weights.length;
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      if (w < 1e-6) continue;
      const tr = document.createElement("tr");
      const meta = metas[i] || { symbol: "?", name: "" };
      const cells = [
        meta.symbol,
        meta.name,
        fmt.pctRaw(w * 100, 2),
        "—",
        "—",
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    if (body.children.length === 0) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No weights to display.</td></tr>';
    }
  }

  function renderStats(stats) {
    document.getElementById("stat-return").textContent = fmt.pctRaw(stats.ret * 100, 2);
    document.getElementById("stat-vol").textContent = fmt.pctRaw(stats.vol * 100, 2);
    document.getElementById("stat-sharpe").textContent = fmt.num(stats.sharpe, 3);
  }

  // Draw the efficient frontier on a canvas.
  // points: [{ ret, vol, ... }], current: { ret, vol }.
  function drawFrontier(canvas, points, current) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!points || points.length === 0) return;

    const pad = { l: 50, r: 16, t: 16, b: 40 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    const allPts = points.slice();
    if (current) allPts.push(current);
    const vols = allPts.map((p) => p.vol);
    const rets = allPts.map((p) => p.ret);
    let volMin = Math.min.apply(null, vols), volMax = Math.max.apply(null, vols);
    let retMin = Math.min.apply(null, rets), retMax = Math.max.apply(null, rets);
    // pad ranges a touch
    const volPad = (volMax - volMin) * 0.08 || 0.01;
    const retPad = (retMax - retMin) * 0.08 || 0.01;
    volMin -= volPad; volMax += volPad;
    retMin -= retPad; retMax += retPad;

    const xOf = (vol) => pad.l + (vol - volMin) / (volMax - volMin) * plotW;
    const yOf = (ret) => pad.t + plotH - (ret - retMin) / (retMax - retMin) * plotH;

    // axes
    ctx.strokeStyle = "#2a2f3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + plotH);
    ctx.lineTo(pad.l + plotW, pad.t + plotH);
    ctx.stroke();

    // axis labels
    ctx.fillStyle = "#9aa0ab";
    ctx.font = "11px sans-serif";
    ctx.fillText("Volatility", pad.l + plotW / 2 - 24, H - 8);
    ctx.save();
    ctx.translate(12, pad.t + plotH / 2 + 24);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Return", 0, 0);
    ctx.restore();
    // tick labels
    ctx.fillText((volMin * 100).toFixed(1) + "%", pad.l - 4, pad.t + plotH + 14);
    ctx.fillText((volMax * 100).toFixed(1) + "%", pad.l + plotW - 30, pad.t + plotH + 14);
    ctx.fillText((retMin * 100).toFixed(1) + "%", 4, pad.t + plotH);
    ctx.fillText((retMax * 100).toFixed(1) + "%", 4, pad.t + 8);

    // frontier line (sort by vol)
    const sorted = points.slice().sort((a, b) => a.vol - b.vol);
    ctx.strokeStyle = "#d9a441";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < sorted.length; i++) {
      const x = xOf(sorted[i].vol), y = yOf(sorted[i].ret);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // frontier dots
    ctx.fillStyle = "#f0c674";
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(xOf(p.vol), yOf(p.ret), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // current portfolio star
    if (current) {
      const x = xOf(current.vol), y = yOf(current.ret);
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const ang = -Math.PI / 2 + k * 2 * Math.PI / 5;
        const r = 7;
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        const ang2 = ang + Math.PI / 5;
        ctx.lineTo(x + Math.cos(ang2) * 3, y + Math.sin(ang2) * 3);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  global.VINUI = {
    fmt, escapeHtml,
    renderScreenTable, renderSavedPortfolio, updateSelectCount,
    renderWeightsTable, renderWeightsTableSimple, renderStats, drawFrontier,
  };
})(window);
