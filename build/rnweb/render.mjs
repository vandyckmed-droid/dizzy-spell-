import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text().slice(0,140));});
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1400);
const txt=async()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
const top=async()=>p.evaluate(()=>{const r=document.body.innerText.match(/\n1\n([A-Z]{1,5})/);return r?r[1]:'?';});
console.log('names/market:', (await txt()).match(/500 names/)?'500':'?', '| default #1:', await top());
// toggle Remove market influence (first switch)
const sw=await p.$$('[role="switch"], input[type=checkbox]');
if(sw.length){ await sw[0].click(); await p.waitForTimeout(600); }
console.log('after residual toggle #1:', await top());
const cl=(await txt()).match(/\d+ ranked · \d+ selected here( · \d+ n\/a)?/);
console.log('count line:', cl?cl[0]:'?');
console.log('score note has OLS/756:', /OLS|756/.test(await txt()));
await p.screenshot({path:path.join(out,'v9-residual-screener.png')});
// open a detail in residual mode -> check beta/alpha line
try{ const nm=(await txt()).match(/([A-Z][a-z]+ (?:Inc|Corp|Company|Group)[^·]*)/); 
  await p.getByText(/Inc\.|Corp|Corporation/).first().click({timeout:2500}); await p.waitForTimeout(700);
  const d=await txt();
  console.log('detail beta/alpha line:', /β \d|α [+-]/.test(d), '| resid label:', /Resid ret\.|Idio\. vol/.test(d));
  await p.screenshot({path:path.join(out,'v9-residual-detail.png')});
}catch(e){console.log('detail',e.message.slice(0,40));}
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'NONE');
await b.close();
