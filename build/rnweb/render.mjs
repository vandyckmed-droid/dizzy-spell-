import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1300);
try{ await p.getByText('Western Digital Corporation').first().click({timeout:2500}); await p.waitForTimeout(700);}catch(e){}
await p.mouse.wheel(0,700); await p.waitForTimeout(400);
await p.screenshot({path:path.join(out,'v7-detail.png')});
console.log('ERRORS:', errs.length?errs.slice(0,4):'NONE');
await b.close();
