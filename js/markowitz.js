// markowitz.js — portfolio optimization (Markowitz) in vanilla JS.
// Implements:
//   - computeReturnsMatrix: aligns multiple price series and computes log returns
//   - annualize: mu (252 * mean) and Sigma (252 * covariance)
//   - minVariancePortfolio: analytical (Lagrange) with long-only projected-gradient fallback
//   - efficientFrontier: sweep target returns
//   - portfolioStats: return, volatility, Sharpe
// No external libraries. Matrix ops hand-rolled.
(function (global) {
  "use strict";

  const TRADING_DAYS = 252;

  // ---------- linear algebra helpers ----------

  function zeros(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = 0; return a; }
  function zerosM(n, m) {
    const A = new Array(n);
    for (let i = 0; i < n; i++) { A[i] = new Array(m); for (let j = 0; j < m; j++) A[i][j] = 0; }
    return A;
  }

  // Solve A x = b via Gaussian elimination with partial pivoting. A is n x n.
  function solveLinear(A, b) {
    const n = A.length;
    // Augmented copy.
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let col = 0; col < n; col++) {
      // pivot
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-12) throw new Error("Singular matrix in solveLinear");
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      // eliminate
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = zeros(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  // Matrix-vector multiply.
  function matVec(A, x) {
    const n = A.length, m = x.length;
    const out = zeros(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += A[i][j] * x[j];
      out[i] = s;
    }
    return out;
  }

  // ---------- returns & moments ----------

  // Given an array of close-series (each oldest-first, possibly different lengths),
  // align them on the common tail (by index from the end) and compute daily log returns.
  // Returns a matrix [T-1][N] of returns, oldest-first.
  function computeReturnsMatrix(closeSeries) {
    const N = closeSeries.length;
    if (N === 0) return [];
    // Find the common length (min across series).
    let T = Infinity;
    for (const s of closeSeries) T = Math.min(T, s.length);
    if (!isFinite(T) || T < 2) return [];
    // Truncate each series to the last T bars (assume dates roughly align; we use
    // index alignment which is acceptable for daily data with good coverage).
    const truncated = closeSeries.map((s) => s.slice(s.length - T));
    const retM = [];
    for (let t = 1; t < T; t++) {
      const row = zeros(N);
      for (let i = 0; i < N; i++) {
        const prev = truncated[i][t - 1];
        const cur = truncated[i][t];
        row[i] = prev > 0 ? Math.log(cur / prev) : 0;
      }
      retM.push(row);
    }
    return retM;
  }

  // Annualized mean vector and covariance matrix from a returns matrix [T][N].
  function annualize(returns) {
    const T = returns.length;
    const N = T > 0 ? returns[0].length : 0;
    const mu = zeros(N);
    if (T === 0) return { mu, Sigma: zerosM(N, N) };
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += returns[t][i];
      mu[i] = (s / T) * TRADING_DAYS;
    }
    const Sigma = zerosM(N, N);
    // Covariance of daily returns, then annualize.
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        let s = 0;
        const mi = mu[i] / TRADING_DAYS, mj = mu[j] / TRADING_DAYS;
        for (let t = 0; t < T; t++) s += (returns[t][i] - mi) * (returns[t][j] - mj);
        const cov = s / T; // population covariance
        Sigma[i][j] = cov * TRADING_DAYS;
        Sigma[j][i] = Sigma[i][j];
      }
    }
    return { mu, Sigma };
  }

  // Portfolio variance wᵀ Σ w and mean μᵀ w.
  function portfolioVariance(w, Sigma) {
    const n = w.length;
    let v = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) v += w[i] * Sigma[i][j] * w[j];
    }
    return v;
  }
  function portfolioReturn(w, mu) {
    let r = 0;
    for (let i = 0; i < w.length; i++) r += w[i] * mu[i];
    return r;
  }

  // ---------- solvers ----------

  // Analytical minimum-variance portfolio with two equality constraints:
  //   min wᵀ Σ w  s.t.  μᵀ w = target,  1ᵀ w = 1.
  // Uses Lagrange multipliers. May produce negative weights (long-only not enforced).
  // Returns { weights, ok } where ok=false if the system is singular.
  function minVarianceAnalytical(mu, Sigma, target) {
    const n = mu.length;
    // KKT system:
    // [ 2Σ   -μ   -1 ] [ w ]   [ 0 ]
    // [ μᵀ   0    0 ] [ λ1 ] = [ target ]
    // [ 1ᵀ   0    0 ] [ λ2 ]   [ 1 ]
    const A = zerosM(n + 2, n + 2);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] = 2 * Sigma[i][j];
      A[i][n] = -mu[i];
      A[i][n + 1] = -1;
      A[n][i] = mu[i];
      A[n + 1][i] = 1;
    }
    const b = zeros(n + 2);
    b[n] = target;
    b[n + 1] = 1;
    try {
      const sol = solveLinear(A, b);
      return { weights: sol.slice(0, n), ok: true };
    } catch (e) {
      return { weights: null, ok: false };
    }
  }

  // Project a vector onto the simplex { w >= 0, Σw = 1 } (Wang & Carreira-Perpiñán).
  function projectSimplex(v) {
    const n = v.length;
    const u = v.slice().sort((a, b) => b - a); // descending
    let cssv = 0;
    let rho = 0;
    let theta = 0;
    for (let i = 0; i < n; i++) {
      cssv += u[i];
      let t = (cssv - 1) / (i + 1);
      if (u[i] - t > 0) { rho = i; theta = t; }
    }
    const w = zeros(n);
    for (let i = 0; i < n; i++) w[i] = Math.max(0, v[i] - theta);
    return w;
  }

  // Long-only projected gradient descent for min wᵀ Σ w s.t. μᵀ w = target, Σw = 1, w >= 0.
  // We handle the equality constraints via penalty + projection onto the simplex,
  // then nudge toward the target return. This is a pragmatic heuristic; for a
  // production solver use a real QP library, but it is adequate for 15 assets.
  function minVarianceLongOnly(mu, Sigma, target, opts) {
    opts = opts || {};
    const n = mu.length;
    const maxIter = opts.maxIter || 4000;
    const tol = opts.tol || 1e-7;

    // Start from equal weights.
    let w = zeros(n);
    for (let i = 0; i < n; i++) w[i] = 1 / n;

    // If target is outside [min(mu), max(mu)], clamp.
    const muMin = Math.min.apply(null, mu);
    const muMax = Math.max.apply(null, mu);
    const tgt = Math.max(muMin, Math.min(muMax, target == null ? (muMin + muMax) / 2 : target));

    // Adaptive step size. Lipschitz constant L = 2 * max eigenvalue of Σ (approx 2*trace).
    let trace = 0;
    for (let i = 0; i < n; i++) trace += Sigma[i][i];
    let step = 1 / (2 * (trace / n) + 1e-9);

    let best = w.slice();
    let bestObj = Infinity;
    let bestRet = portfolioReturn(w, mu);

    for (let iter = 0; iter < maxIter; iter++) {
      // Gradient of variance: 2 Σ w.
      const grad = matVec(Sigma, w).map((x) => 2 * x);
      // Gradient step.
      const y = w.map((wi, i) => wi - step * grad[i]);
      // Project onto simplex (handles w>=0, Σw=1).
      let wNew = projectSimplex(y);
      // Pull toward target return: blend with the asset closest to target if off.
      const ret = portfolioReturn(wNew, mu);
      // Soft penalty: if return is far from target, shift weight toward higher/lower-mu assets.
      const diff = tgt - ret;
      if (Math.abs(diff) > 1e-5) {
        // Move a small fraction of mass from low-grad to high-mu assets depending on sign.
        const dir = diff > 0 ? 1 : -1;
        // Rank assets by mu; shift a tiny amount toward the top/bottom.
        const idx = mu.map((m, i) => i).sort((a, b) => (mu[b] - mu[a]) * dir);
        const shift = Math.min(0.05, Math.abs(diff) / (Math.abs(muMax - muMin) + 1e-9));
        // Take from the opposite end, give to the favorable end.
        const takeFrom = dir > 0 ? idx.slice(-3) : idx.slice(0, 3);
        const giveTo = dir > 0 ? idx.slice(0, 3) : idx.slice(-3);
        for (const k of giveTo) wNew[k] += shift / giveTo.length;
        for (const k of takeFrom) wNew[k] = Math.max(0, wNew[k] - shift / takeFrom.length);
        // Renormalize to simplex.
        let s = 0;
        for (const wi of wNew) s += wi;
        if (s > 0) for (let i = 0; i < n; i++) wNew[i] /= s;
      }
      // Track best feasible-by-variance solution close to target.
      const obj = portfolioVariance(wNew, Sigma) + 1000 * Math.pow(portfolioReturn(wNew, mu) - tgt, 2);
      if (obj < bestObj) { bestObj = obj; best = wNew.slice(); bestRet = ret; }
      // Convergence check.
      let maxDelta = 0;
      for (let i = 0; i < n; i++) maxDelta = Math.max(maxDelta, Math.abs(wNew[i] - w[i]));
      w = wNew;
      if (maxDelta < tol && Math.abs(portfolioReturn(w, mu) - tgt) < 1e-3) break;
    }
    return { weights: best, ok: true, achievedReturn: bestRet };
  }

  // Public: solve for the minimum-variance portfolio at a target return.
  // Tries the analytical solver; if it produces negative weights or is singular,
  // falls back to the long-only projected-gradient solver.
  function minVariancePortfolio(mu, Sigma, target) {
    const n = mu.length;
    if (n === 0) return { weights: [], ok: false, method: "empty" };
    const muMin = Math.min.apply(null, mu);
    const muMax = Math.max.apply(null, mu);
    const tgt = target == null ? null : Math.max(muMin, Math.min(muMax, target));

    const analytical = minVarianceAnalytical(mu, Sigma, tgt == null ? (muMin + muMax) / 2 : tgt);
    if (analytical.ok && analytical.weights) {
      const allNonNeg = analytical.weights.every((w) => w > -1e-6);
      const sum1 = Math.abs(analytical.weights.reduce((a, b) => a + b, 0) - 1) < 1e-5;
      if (allNonNeg && sum1) {
        // Clip tiny negatives, renormalize.
        const w = analytical.weights.map((x) => Math.max(0, x));
        const s = w.reduce((a, b) => a + b, 0) || 1;
        return { weights: w.map((x) => x / s), ok: true, method: "analytical" };
      }
    }
    // Fallback: long-only numerical solver.
    const lo = minVarianceLongOnly(mu, Sigma, tgt);
    return { weights: lo.weights, ok: lo.ok, method: "long-only" };
  }

  // Efficient frontier: sweep target returns from the min-variance portfolio's
  // return up to max(mu), compute the min-variance long-only portfolio at each.
  // Returns array of { target, weights, ret, vol }.
  function efficientFrontier(mu, Sigma, nPoints) {
    nPoints = nPoints || 25;
    const n = mu.length;
    if (n === 0) return [];
    const muMin = Math.min.apply(null, mu);
    const muMax = Math.max.apply(null, mu);
    // Start from the global min-variance long-only portfolio.
    const mv = minVarianceLongOnly(mu, Sigma, null);
    const startRet = portfolioReturn(mv.weights, mu);
    const lo = Math.max(muMin, startRet);
    const hi = muMax;
    if (hi - lo < 1e-6) {
      const w = mv.weights;
      return [{ target: startRet, weights: w, ret: startRet, vol: Math.sqrt(portfolioVariance(w, Sigma)) }];
    }
    const pts = [];
    for (let i = 0; i < nPoints; i++) {
      const t = lo + (hi - lo) * (i / (nPoints - 1));
      const sol = minVarianceLongOnly(mu, Sigma, t);
      const w = sol.weights;
      pts.push({
        target: t,
        weights: w,
        ret: portfolioReturn(w, mu),
        vol: Math.sqrt(portfolioVariance(w, Sigma)),
      });
    }
    return pts;
  }

  // Portfolio stats: { ret, vol, sharpe }.
  function portfolioStats(weights, mu, Sigma, rf) {
    rf = rf || 0;
    const ret = portfolioReturn(weights, mu);
    const vol = Math.sqrt(portfolioVariance(weights, Sigma));
    const sharpe = vol > 0 ? (ret - rf) / vol : 0;
    return { ret, vol, sharpe };
  }

  global.VINMarkowitz = {
    TRADING_DAYS,
    computeReturnsMatrix, annualize,
    minVariancePortfolio, minVarianceAnalytical, minVarianceLongOnly,
    efficientFrontier, portfolioStats,
    // exposed for testing
    _solveLinear: solveLinear, _projectSimplex: projectSimplex,
  };
})(window);
