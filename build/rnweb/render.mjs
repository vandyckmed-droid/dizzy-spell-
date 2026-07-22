import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,160));});
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1400);
const top=async()=>p.evaluate(()=>{const r=document.body.innerText.match(/\n1\n([A-Z]{1,5})/);return r?r[1]:'?';});
const has=async(re)=>p.evaluate((s)=>new RegExp(s).test(document.body.innerText), re);
console.log('score card present:', await has('Score'), '| Sharpe default #1:', await top());
console.log('mode buttons:', await has('Return'), await has('Volatility'));
console.log('remove-market row:', await has('Remove market influence'));
// switch to Return mode
try{ await p.getByText('Return',{exact:true}).first().click({timeout:2500}); await p.waitForTimeout(500);
  console.log('Return mode #1:', await top()); }catch(e){console.log('return click',e.message.slice(0,40));}
// switch to Volatility mode
try{ await p.getByText('Volatility',{exact:true}).first().click({timeout:2500}); await p.waitForTimeout(500);
  console.log('Vol mode #1 (lowest vol):', await top());
  console.log('match-window toggle visible:', await has('Match return window')); }catch(e){console.log('vol click',e.message.slice(0,40));}
// back to sharpe, toggle remove market
try{ await p.getByText('Sharpe',{exact:true}).first().click({timeout:2500}); await p.waitForTimeout(400);
  // toggle the remove-market switch (first Switch)
  const sw=await p.$$('[role="switch"], input[type=checkbox]');
  if(sw.length){ await sw[0].click(); await p.waitForTimeout(500); console.log('after remove-market, #1:', await top()); }
  else console.log('no switch found (count',sw.length,')');
}catch(e){console.log('resid',e.message.slice(0,40));}
await p.screenshot({path:path.join(out,'v5-score.png')});
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'NONE');
await b.close();
