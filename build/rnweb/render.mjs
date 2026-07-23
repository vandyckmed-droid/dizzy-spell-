import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1300);
const txt=async()=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
// open WDC detail
try{ await p.getByText('Western Digital Corporation').first().click({timeout:2500}); await p.waitForTimeout(700);}catch(e){console.log('open',e.message.slice(0,40));}
const d=await txt();
console.log('sector tag tappable present (Technology ›):', /Technology ›/.test(d));
await p.screenshot({path:path.join(out,'v8-detail-header.png')});
// tap the sector tag -> should jump to Screener with Technology universe
try{ await p.getByText('Technology ›').first().click({timeout:2000}); await p.waitForTimeout(600);
  const s=await txt();
  const uni=s.match(/(\d+) ranked/);
  console.log('after sector tap -> back on screener, ranked:', uni?uni[1]:'?', '| Technology pill active area present:', /Technology/.test(s));
}catch(e){console.log('sector tap',e.message.slice(0,50));}
await p.screenshot({path:path.join(out,'v8-after-sector.png')});
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,5):'NONE');
await b.close();
