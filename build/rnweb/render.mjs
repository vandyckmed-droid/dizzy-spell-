import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1400);
// select 2 to show selected-row state, then scroll to the ranked list
try{ await p.getByLabel('Add SNDK').click({timeout:1200}); await p.getByLabel('Add LRCX').click({timeout:1200}); }catch(e){}
await p.mouse.wheel(0,1350); await p.waitForTimeout(500);
await p.screenshot({path:path.join(out,'rh-list.png')});
console.log('ERRORS:', errs.length?errs.slice(0,4):'NONE');
await b.close();
