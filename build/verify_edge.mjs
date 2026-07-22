/* Edge-case + performance verification of the shipped engine (req #11). */
import fs from 'node:fs';
const tpl = fs.readFileSync('build/template.html', 'utf8');
const snap = JSON.parse(fs.readFileSync('data/snapshot.json', 'utf8'));
function grab(name){
  const s = tpl.indexOf('function ' + name + '('); const o = tpl.indexOf('{', s);
  let d = 0, i = o; for (; i < tpl.length; i++){ const c = tpl[i]; if (c==='{') d++; else if (c==='}'){ d--; if(!d){i++;break;} } }
  return tpl.slice(s, i);
}
const NAMES=['simpleReturns','mean','sampleStd','sharpeMomentum','covMatrix','corrFromCov','quasiDiagOrder','clusterVar','recursiveBisection','hrpWeights','applyCaps','pct'];
fs.writeFileSync('build/_e.mjs','const TD=252;\n'+NAMES.map(grab).join('\n')+'\nexport {'+NAMES.join(',')+'};');
const E = await import('./_e.mjs'); fs.unlinkSync('build/_e.mjs');

const T = snap.tickers, N = snap.dates.length;
let pass=0, fail=0; const ok=(c,m)=>{ c?pass++:(fail++,console.log('FAIL',m)); };

// 1) Trading-day boundary: window opening before earliest date -> null, no throw
ok(E.sharpeMomentum(T[0].closes, 100, 200, 21)===null, 'window before start -> null');
ok(E.sharpeMomentum(T[0].closes, N-1, 3, 1)!==null, 'tiny valid window ok');
// start<=end degenerate: hi-lo<2 -> null
ok(E.sharpeMomentum(T[0].closes, N-1, 5, 5)===null, 'start==end -> null');
// default window return count == 231 across all tickers
let allN=new Set(); for(const t of T){ const m=E.sharpeMomentum(t.closes,N-1,252,21); if(m) allN.add(m.n); }
ok(allN.size===1 && allN.has(231), 'default 252->21 yields exactly 231 returns for all: '+[...allN]);

// 2) HRP stability: near-duplicate asset shouldn't blow up; weights finite, sum 1
const base=T[0].closes.slice(N-253,N);
const dup=base.map(x=>x*1.0000001);
const R2=[]; for(let i=1;i<base.length;i++) R2.push([base[i]/base[i-1]-1, dup[i]/dup[i-1]-1]);
const w2=E.hrpWeights(R2);
ok(w2.every(Number.isFinite) && Math.abs(w2[0]+w2[1]-1)<1e-12, 'HRP near-duplicate stable, sums to 1');
ok(Math.abs(w2[0]-0.5)<0.02, 'HRP splits near-identical pair ~50/50: '+w2.map(x=>x.toFixed(3)));

// 3) 100% normalization across 200 random selections + random caps
let worst=0, infeasSeen=0;
function rnd(seed){ return ()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }; }
const rand=rnd(42);
for(let trial=0; trial<200; trial++){
  const k=3+Math.floor(rand()*25);
  const pick=[]; const used=new Set();
  while(pick.length<k){ const idx=Math.floor(rand()*T.length); if(!used.has(idx)){used.add(idx);pick.push(T[idx]);} }
  const cols=pick.map(t=>t.closes.slice(N-253,N));
  const R=[]; for(let i=1;i<cols[0].length;i++) R.push(pick.map((_,j)=>cols[j][i]/cols[j][i-1]-1));
  const w=E.hrpWeights(R);
  const secs=pick.map(t=>t.sector);
  const ms=[0,0.15,0.20,0.30][Math.floor(rand()*4)];
  const mv=[0,0.30,0.45,0.60][Math.floor(rand()*4)];
  const c=E.applyCaps(w, secs, ms, mv);
  if(!c.feasible){ infeasSeen++; continue; }
  const sum=c.w.reduce((a,b)=>a+b,0);
  worst=Math.max(worst, Math.abs(sum-1));
  if(ms>0) ok(Math.max(...c.w)<=ms+1e-7, `trial ${trial} stock cap ${ms} violated max=${Math.max(...c.w)}`);
  if(mv>0){ for(const s of new Set(secs)){ let st=0; c.w.forEach((wi,ii)=>{if(secs[ii]===s)st+=wi;}); ok(st<=mv+1e-6,`trial ${trial} sector cap ${mv} violated ${s}=${st}`);} }
}
ok(worst<1e-9, '200 random portfolios normalize to exactly 100% (worst dev '+worst.toExponential(2)+')');
console.log(`  feasible trials capped & exact; ${infeasSeen} correctly flagged infeasible`);

// 4) Performance: rank a synthetic 500-universe + HRP on 50 names
const big=[]; for(let i=0;i<500;i++) big.push(T[i%T.length]);
let t0=performance.now();
for(let iter=0; iter<10; iter++) for(const t of big) E.sharpeMomentum(t.closes, N-1, 252, 21);
let rankMs=(performance.now()-t0)/10;
const sel50=big.slice(0,50); const cols=sel50.map(t=>t.closes.slice(N-253,N));
const R50=[]; for(let i=1;i<cols[0].length;i++) R50.push(sel50.map((_,j)=>cols[j][i]/cols[j][i-1]-1));
t0=performance.now(); for(let iter=0;iter<20;iter++) E.hrpWeights(R50); let hrpMs=(performance.now()-t0)/20;
console.log(`  rank 500 tickers: ${rankMs.toFixed(1)}ms/pass · HRP 50 names: ${hrpMs.toFixed(1)}ms`);
ok(rankMs<150, 'ranking 500 tickers < 150ms');
ok(hrpMs<80, 'HRP 50 names < 80ms');

console.log(`\n${pass}/${pass+fail} edge/perf checks passed`);
if(fail) process.exit(1);
console.log('EDGE + PERFORMANCE VERIFICATION PASSED');
