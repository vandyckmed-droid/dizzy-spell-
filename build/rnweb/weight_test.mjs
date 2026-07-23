import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1400);
const click = async (l) => { try { await p.getByLabel(l, { exact: false }).first().click({ timeout: 1500 }); return true; } catch (e) { return false; } };
const txt = async () => p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
const tab = async (n) => { await p.mouse.click(n === 'portfolio' ? 195 : 65, 795); await p.waitForTimeout(500); };

// add 5 diversified names
for (const s of ['SNDK', 'LRCX', 'RY', 'JNJ', 'XOM']) await click('Add ' + s);
await p.waitForTimeout(200);
await tab('portfolio');
let t = await txt();
console.log('Weighting card present:', t.includes('SCHEME') && t.includes('EFF BETS') && t.includes('ANN VOL'));
console.log('all four schemes listed:', ['HRP', 'Min-var', 'Inverse-vol', 'Equal'].every(s => t.includes(s)));
await p.screenshot({ path: path.join(out, 'weight-hrp.png') });

// switch to Min-var
const sw = await click('Weight by Min-var');
await p.waitForTimeout(500);
t = await txt();
console.log('switched to Min-var (worked):', sw);
await p.screenshot({ path: path.join(out, 'weight-minvar.png') });

// switch to Equal
await click('Weight by Equal'); await p.waitForTimeout(500);
await p.screenshot({ path: path.join(out, 'weight-equal.png') });
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'NONE');
await b.close();
