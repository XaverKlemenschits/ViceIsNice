// Test harness for indicators + markowitz + screening logic.
// Run with: node test.js  (loads the JS files via a fake `window` global).
const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "js");

const globalObj = {};
function load(file) {
  let code = fs.readFileSync(path.join(BASE, file), "utf8");
  // Replace the IIFE's `window` argument with our globalObj.
  code = code.replace(/\}\)\(window\);/, "})(globalObj);");
  // eslint-disable-next-line no-eval
  eval(code);
}
load("storage.js");
load("universe.js");
load("indicators.js");
load("markowitz.js");
load("screening.js");

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
}
function approx(a, b, eps) { eps = eps || 1e-6; return Math.abs(a - b) < eps; }

const IND = globalObj.VINIndicators;
const M = globalObj.VINMarkowitz;
const Scr = globalObj.VINScreening;

// ---------- indicators ----------
console.log("\n== indicators ==");

// SMA
assert("sma basic", approx(IND.sma([1,2,3,4,5], 5), 3));
assert("sma insufficient", IND.sma([1,2,3], 5) === null);
assert("sma last 3 of 5", approx(IND.sma([1,2,3,4,10], 3), (3+4+10)/3));

// RSI: monotonically rising series -> RSI = 100
const rising = [];
for (let i = 1; i <= 30; i++) rising.push(100 + i);
assert("rsi rising = 100", approx(IND.rsi(rising, 14), 100));

// RSI: monotonically falling series -> RSI = 0
const falling = [];
for (let i = 1; i <= 30; i++) falling.push(100 - i);
assert("rsi falling = 0", approx(IND.rsi(falling, 14), 0));

// RSI: flat series -> RSI = 100 (avgLoss=0 branch)
const flat = new Array(30).fill(50);
assert("rsi flat = 100", approx(IND.rsi(flat, 14), 100));

// RSI insufficient
assert("rsi insufficient", IND.rsi([1,2,3], 14) === null);

// volatility: constant series -> 0
assert("vol constant = 0", approx(IND.annualizedVolatility(new Array(40).fill(100), 30), 0));

// volatility: a known-ish series. Use a simple alternating pattern to check > 0.
const alt = [];
for (let i = 0; i < 40; i++) alt.push(100 * (i % 2 === 0 ? 1 : 1.01));
const v = IND.annualizedVolatility(alt, 30);
assert("vol alternating > 0", v > 0, "v=" + v);

// avgVolume
assert("avgVolume basic", approx(IND.avgVolume([10,20,30,40,50], 5), 30));
assert("avgVolume last 3", approx(IND.avgVolume([10,20,30,40,50], 3), 40));
assert("avgVolume insufficient", IND.avgVolume([1,2], 5) === null);

// logReturns
const lr = IND.logReturns([100, 110, 121]);
assert("logReturns length", lr.length === 2);
assert("logReturns values", approx(lr[0], Math.log(1.1)) && approx(lr[1], Math.log(1.1)));

// ---------- markowitz linear algebra ----------
console.log("\n== markowitz linear algebra ==");
// solveLinear: 2x2
const sol = M._solveLinear([[2, 0], [0, 4]], [4, 8]);
assert("solveLinear 2x2", approx(sol[0], 2) && approx(sol[1], 2), JSON.stringify(sol));

// projectSimplex: equal vector -> equal weights
const p = M._projectSimplex([1, 1, 1]);
assert("projectSimplex equal", approx(p[0], 1/3) && approx(p[1], 1/3) && approx(p[2], 1/3), JSON.stringify(p));
// projectSimplex sums to 1, non-negative
const p2 = M._projectSimplex([5, -1, 2]);
const sum = p2.reduce((a,b)=>a+b,0);
assert("projectSimplex sum=1", approx(sum, 1), "sum=" + sum);
assert("projectSimplex nonneg", p2.every(x => x >= -1e-9), JSON.stringify(p2));

// ---------- markowitz end-to-end ----------
console.log("\n== markowitz end-to-end ==");

// Build a synthetic 3-asset scenario with known-ish properties.
// Use a returns matrix directly.
// Asset A: low return, low vol; B: mid; C: high return, high vol.
function makeReturnsMatrix() {
  // 100 days, 3 assets. Generate deterministic-ish returns.
  const T = 100, N = 3;
  const rets = [];
  const means = [0.0002, 0.0005, 0.001]; // daily
  const vols = [0.005, 0.01, 0.02];
  // Simple LCG for reproducibility.
  let seed = 42;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function gauss() { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  for (let t = 0; t < T; t++) {
    const row = [0,0,0];
    for (let i = 0; i < N; i++) row[i] = means[i] + vols[i] * gauss();
    rets.push(row);
  }
  return rets;
}

const rets = makeReturnsMatrix();
const { mu, Sigma } = M.annualize(rets);
assert("annualize mu length", mu.length === 3);
assert("annualize Sigma shape", Sigma.length === 3 && Sigma[0].length === 3);
assert("annualize Sigma symmetric", approx(Sigma[0][2], Sigma[2][0]));
assert("annualize Sigma diag positive", Sigma[0][0] > 0 && Sigma[1][1] > 0 && Sigma[2][2] > 0);
assert("mu ordering preserved", mu[0] < mu[2], JSON.stringify(mu));

// minVariancePortfolio (no target -> min variance)
const sol2 = M.minVariancePortfolio(mu, Sigma, null);
assert("minVar weights length", sol2.weights.length === 3);
const wsum = sol2.weights.reduce((a,b)=>a+b,0);
assert("minVar weights sum=1", approx(wsum, 1, 1e-3), "sum=" + wsum);
assert("minVar weights nonneg", sol2.weights.every(w => w > -1e-6), JSON.stringify(sol2.weights));
const stats = M.portfolioStats(sol2.weights, mu, Sigma, 0);
assert("minVar stats vol>0", stats.vol > 0);
assert("minVar stats sharpe finite", isFinite(stats.sharpe));

// Efficient frontier
const front = M.efficientFrontier(mu, Sigma, 10);
assert("frontier length", front.length === 10);
assert("frontier vols increasing-ish", front[0].vol <= front[front.length-1].vol + 1e-6);
assert("frontier rets increasing", front[0].ret <= front[front.length-1].ret + 1e-6);
// Each frontier point: weights sum to 1, non-negative.
for (let i = 0; i < front.length; i++) {
  const s = front[i].weights.reduce((a,b)=>a+b,0);
  if (!approx(s, 1, 1e-2)) { fail++; console.log("  FAIL frontier[" + i + "] sum=" + s); }
  else pass++;
}

// Target return constraint: solve at a target and check the achieved return is close.
const target = (mu[0] + mu[2]) / 2;
const solT = M.minVariancePortfolio(mu, Sigma, target);
const retT = solT.weights.reduce((a,w,i)=>a+w*mu[i],0);
assert("target return achieved", approx(retT, target, 0.05), "target=" + target + " achieved=" + retT);

// ---------- screening ----------
console.log("\n== screening ==");
// Build a synthetic bar series that passes all criteria.
// Use mean-reverting noise around a slow uptrend so RSI stays mid-range (not overbought).
function makeBars(n, closeStart, dailyGrowth, vol) {
  const bars = [];
  let c = closeStart;
  for (let i = 0; i < n; i++) {
    // slow drift + mean-reverting oscillation (keeps RSI < 70)
    const reversion = Math.sin(i / 9) * 0.004;
    c = c * (1 + dailyGrowth + reversion);
    bars.push({ datetime: "2024-01-" + (i+1), open: c, high: c*1.01, low: c*0.99, close: c, volume: 2_000_000 });
  }
  return bars;
}
const goodBars = makeBars(220, 100, 0.0005, 0.01);
const goodRes = Scr.screenStock({symbol:"TEST", name:"Test", sector:"Oil"}, goodBars);
assert("screen good: has metrics", goodRes.rsi != null && goodRes.ma50 != null && goodRes.ma200 != null);
assert("screen good: momentum pass", goodRes.passes.momentum, "ma50=" + goodRes.ma50 + " ma200=" + goodRes.ma200);
assert("screen good: liquidity pass", goodRes.passes.liquidity, "avgVol=" + goodRes.avgVol30);
assert("screen good: eligible", goodRes.eligible, JSON.stringify(goodRes.passes));

// Insufficient data
const shortBars = makeBars(100, 100, 0.001, 0.01);
const shortRes = Scr.screenStock({symbol:"SHORT", name:"Short", sector:"Oil"}, shortBars);
assert("screen short: ineligible", !shortRes.eligible);
assert("screen short: reason set", shortRes.reason != null);

// High RSI (overbought): strong monotonic rise -> RSI=100 -> fail RSI
const overbought = [];
for (let i = 0; i < 220; i++) overbought.push(100 * Math.pow(1.005, i));
const obRes = Scr.screenStock({symbol:"OB", name:"OB", sector:"Oil"}, overbought.map((c,i)=>({datetime:"d"+i, open:c, high:c, low:c, close:c, volume:2e6})));
assert("screen overbought: rsi fail", !obRes.passes.rsi, "rsi=" + obRes.rsi);

console.log("\n== summary ==");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
