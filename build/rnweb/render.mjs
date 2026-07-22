import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1300);
const txt=async()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
// open the #1 card's company (default Sharpe -> WDC)
try{ await p.getByText('Western Digital Corporation').first().click({timeout:2500}); await p.waitForTimeout(800);}catch(e){console.log('open',e.message.slice(0,40));}
const dt=await txt();
console.log('correlated card:', /Most correlated/.test(dt), '| ρ present:', /ρ /.test(dt));
// scroll detail to show correlated card
await p.evaluate(()=>{const sc=document.querySelector('div');window.scrollTo?window.scrollTo(0,2000):0;});
await p.mouse.wheel(0,1600); await p.waitForTimeout(500);
await p.screenshot({path:path.join(out,'v6-detail.png')});
// select a few then portfolio
await p.getByText('Back').first().click({timeout:2000}).catch(()=>{}); await p.waitForTimeout(300);
for(const s of ['WDC','MU','LITE','AVGO']){ try{ await p.getByLabel('Add '+s).click({timeout:1200}); }catch(e){} }
await p.getByText('Portfolio').first().click({timeout:2000}); await p.waitForTimeout(600);
console.log('clear basket button:', /Clear basket/.test(await txt()));
await p.screenshot({path:path.join(out,'v6-portfolio.png')});
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'NONE');
await b.close();
