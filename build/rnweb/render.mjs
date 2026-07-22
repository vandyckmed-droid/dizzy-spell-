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
console.log('default rank #1 ticker:', await top(), '| count:', await p.evaluate(()=>{const m=document.body.innerText.match(/\d+ ranked/);return m?m[0]:'?';}));
// open Rank by sheet
await p.getByText(/Sharpe ↓|Sharpe ↑/).first().click({timeout:3000}); await p.waitForTimeout(400);
console.log('rank sheet:', await p.evaluate(()=>/Rank by/.test(document.body.innerText)?'opened':'no'));
for(const f of ['12–1 raw momentum','6–1 raw momentum','Market-residual return']){
  try{ await p.getByText(/Sharpe ↓|Sharpe ↑|12–1 ↓|6–1 ↓|Resid ↓/).first().click({timeout:1500}); await p.waitForTimeout(200);}catch(e){}
  try{ await p.getByText(f,{exact:true}).click({timeout:2000}); await p.waitForTimeout(400);
    console.log(f,'-> #1:', await top());
  }catch(e){ console.log(f,'click err',e.message.slice(0,40)); }
}
await p.screenshot({path:path.join(out,'v4-factor.png')});
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'NONE');
await b.close();
