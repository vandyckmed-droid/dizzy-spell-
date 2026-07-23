import { chromium } from 'playwright';
import path from 'node:path';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1300);
try{ await p.getByText('Western Digital Corporation').first().click({timeout:2500}); await p.waitForTimeout(600);}catch(e){}
// the SvgText renders as <div data-svg=text> with the date string as textContent
const labels=await p.evaluate(()=>[...document.querySelectorAll('[data-svg="text"]')].map(e=>e.textContent).filter(Boolean));
console.log('svg text labels found:', labels);
console.log('ERRORS:', errs.length?errs.slice(0,4):'NONE');
await b.close();
