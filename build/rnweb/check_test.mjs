import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1400);
// toggle a few via the checkmark buttons (accessibility labels), then open one detail via the row body
for (const s of ['SNDK', 'WDC', 'MU']) { try { await p.getByLabel('Add ' + s, { exact: false }).first().click({ timeout: 1500 }); } catch (e) { console.log('miss', s, e.message.slice(0, 40)); } }
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(out, 'check-top.png') });
// de-select WDC (its label is now "Remove WDC")
try { await p.getByLabel('Remove WDC', { exact: false }).first().click({ timeout: 1500 }); } catch (e) { console.log('miss remove WDC', e.message.slice(0, 40)); }
await p.waitForTimeout(300);
// tap the SNDK row body (not the checkmark) → detail opens
try { await p.getByText('Sandisk', { exact: false }).first().click({ timeout: 1500 }); } catch (e) { console.log('miss row tap', e.message.slice(0, 40)); }
await p.waitForTimeout(700);
const detail = await p.evaluate(() => document.body.innerText.includes('PERFORMANCE') || document.body.innerText.toLowerCase().includes('performance') || document.body.innerText.includes('Correlated'));
console.log('row tap opened detail:', detail);
await p.screenshot({ path: path.join(out, 'check-detail.png') });
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'NONE');
await b.close();
