import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,160));});
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1200);
const uni=await p.evaluate(()=>document.body.innerText.match(/US Top 500|Financial|Technology|Industrials/g));
const cards=await p.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>/^\+$/.test(e.textContent)&&e.children.length===0).length);
console.log('universe pills seen:', [...new Set(uni||[])]);
console.log('count line:', await p.evaluate(()=>{const m=document.body.innerText.match(/\d+ ranked/);return m?m[0]:'?';}));
await p.screenshot({path:path.join(out,'v2-screener.png')});
// switch to Technology pill
try{ await p.getByText('Technology',{exact:true}).first().click({timeout:2000}); await p.waitForTimeout(400);}catch(e){console.log('pill click',e.message.slice(0,40));}
console.log('after Technology pill:', await p.evaluate(()=>{const m=document.body.innerText.match(/\d+ ranked/);return m?m[0]:'?';}));
await p.screenshot({path:path.join(out,'v2-tech.png')});
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'NONE');
await b.close();
