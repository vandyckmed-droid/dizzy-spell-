/* Cross-check the SHIPPED JS numerics (extracted from template.html) against
   the Python reference dump (build/expected.json). Run: node build/validate_js.mjs */
import fs from 'node:fs';

const tpl = fs.readFileSync('build/template.html', 'utf8');
const snap = JSON.parse(fs.readFileSync('data/snapshot.json', 'utf8'));
const expected = JSON.parse(fs.readFileSync('build/expected.json', 'utf8'));

// Pull the numeric functions out of the template verbatim so we test real code.
// Brace-match from the declaration so single-line and nested-block bodies both
// extract correctly.
function grab(name){
  const start = tpl.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('could not find ' + name);
  const open = tpl.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < tpl.length; i++){
    const ch = tpl[i];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (depth === 0){ i++; break; } }
  }
  return tpl.slice(start, i);
}
const NAMES = ['simpleReturns','mean','sampleStd','sharpeMomentum','momentumDaily',
  'annualizeStats','olsFit','momentumScore','covMatrix','corrFromCov',
  'quasiDiagOrder','clusterVar','recursiveBisection','hrpWeights','applyCaps','pct'];
const src = 'const TD=252;\n' + NAMES.map(grab).join('\n') +
  '\nexport {' + NAMES.join(',') + '};';
fs.writeFileSync('build/_engine.mjs', src);
const eng = await import('./_engine.mjs');

const BYSYM = Object.fromEntries(snap.tickers.map(t => [t.symbol, t]));
const asof = expected.asof;
let fails = 0, checks = 0;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * (1 + Math.abs(b));
function chk(cond, msg){ checks++; if (!cond){ fails++; console.log('FAIL:', msg); } }

// 1) Sharpe momentum
for (const [s, exp] of Object.entries(expected.sharpe)){
  const m = eng.sharpeMomentum(BYSYM[s].closes, asof, 252, 21);
  if (exp === null){ chk(m === null, `${s} expected null`); continue; }
  chk(m && close(m.sharpe, exp.sharpe, 1e-10), `${s} sharpe ${m&&m.sharpe} vs ${exp.sharpe}`);
  chk(m && close(m.annVol, exp.ann_vol, 1e-10), `${s} annVol`);
  chk(m && close(m.cum, exp.cum, 1e-10), `${s} cum`);
  chk(m && m.n === exp.n, `${s} n ${m&&m.n} vs ${exp.n}`);
}

// 1b) the market proxy is the fixed VTI series embedded in the snapshot
const mretAll = snap.market;
chk(Array.isArray(mretAll) && mretAll.length === expected.market.length &&
    mretAll.every((v, i) => close(v, expected.market[i], 1e-12)), 'VTI market series matches reference');

// 1c) configurable momentum score across configs (incl. residual with 756d beta)
for (const [name, cfg] of Object.entries(expected.configs)){
  for (const [s, exp] of Object.entries(expected.scores[name])){
    const r = eng.momentumScore(BYSYM[s].closes, mretAll, asof, cfg);
    if (exp == null) { chk(r == null, `${name}/${s} expected null`); continue; }
    chk(r && close(r.score, exp.score, 1e-9), `${name}/${s} score ${r&&r.score} vs ${exp.score}`);
    chk(r && close(r.annRet, exp.annRet, 1e-9), `${name}/${s} annRet`);
    chk(r && close(r.cum, exp.cum, 1e-9), `${name}/${s} cum`);
    chk(r && (exp.annVol == null ? r.annVol == null : close(r.annVol, exp.annVol, 1e-9)), `${name}/${s} annVol`);
    chk(r && (exp.beta == null ? r.beta == null : close(r.beta, exp.beta, 1e-9)), `${name}/${s} beta`);
    chk(r && (exp.alpha == null ? r.alpha == null : close(r.alpha, exp.alpha, 1e-12)), `${name}/${s} alpha`);
  }
}
// default sharpe config must equal the original sharpeMomentum
for (const s of Object.keys(expected.scores.default).slice(0, 8)){
  const sm = eng.sharpeMomentum(BYSYM[s].closes, asof, 252, 21);
  const ms = eng.momentumScore(BYSYM[s].closes, mretAll, asof, expected.configs.default);
  chk(sm && ms && close(sm.sharpe, ms.score, 1e-12), `${s} default score == sharpeMomentum`);
}

// 2) HRP weights on the exact selection Python used
const sel = expected.hrp_selection;
const cols = sel.map(s => BYSYM[s].closes.slice(asof-252, asof+1));
const R = [];
for (let t = 1; t < cols[0].length; t++)
  R.push(sel.map((_, j) => cols[j][t]/cols[j][t-1] - 1));
const w = eng.hrpWeights(R);
chk(close(w.reduce((a,b)=>a+b,0), 1, 1e-12), 'HRP sums to 1');
for (let i = 0; i < sel.length; i++)
  chk(close(w[i], expected.hrp_weights[i], 1e-8), `HRP ${sel[i]} ${w[i]} vs ${expected.hrp_weights[i]}`);

// 3) Constraint caps
const secs = sel.map(s => BYSYM[s].sector);
const cap = eng.applyCaps(w, secs, expected.caps.maxStock, expected.caps.maxSector);
chk(cap.feasible === expected.caps.feasible, 'caps feasibility');
chk(close(cap.w.reduce((a,b)=>a+b,0), 1, 1e-12), 'capped sums to exactly 1');
for (let i = 0; i < sel.length; i++)
  chk(close(cap.w[i], expected.caps.weights[i], 1e-7), `cap ${sel[i]} ${cap.w[i]} vs ${expected.caps.weights[i]}`);
chk(Math.max(...cap.w) <= expected.caps.maxStock + 1e-9, 'stock cap respected');

// 4) Determinism
const w2 = eng.hrpWeights(R);
chk(w.every((x,i)=>x===w2[i]), 'HRP deterministic');

fs.unlinkSync('build/_engine.mjs');

// 5) The Expo app's generated engine must be identical to the shipped template
const appEng = await import('../app/engine.js');
for (const [s, exp] of Object.entries(expected.sharpe)){
  if (exp === null) continue;
  const m = appEng.sharpeMomentum(BYSYM[s].closes, asof, 252, 21);
  chk(m && close(m.sharpe, exp.sharpe, 1e-10), `app engine ${s} sharpe`);
}
const wApp = appEng.hrpWeights(R);
for (let i = 0; i < sel.length; i++)
  chk(close(wApp[i], expected.hrp_weights[i], 1e-8), `app engine HRP ${sel[i]}`);
const capApp = appEng.applyCaps(wApp, secs, expected.caps.maxStock, expected.caps.maxSector);
chk(close(capApp.w.reduce((a,b)=>a+b,0), 1, 1e-12), 'app engine caps sum to 1');

console.log(`\n${checks-fails}/${checks} checks passed`);
if (fails){ console.log(`${fails} FAILURES`); process.exit(1); }
console.log('JS numerics (template + Expo engine) match Python reference ✓');
