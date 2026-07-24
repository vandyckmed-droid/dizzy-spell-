import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1400);
// Markets tab (bottom-right)
await p.mouse.click(325, 795); await p.waitForTimeout(600);
// pick a symbol tile with a clear cross — GLD; tap the GLD tile
try { await p.getByText('GLD', { exact: false }).first().click({ timeout: 1500 }); } catch (e) { console.log('no GLD tile click'); }
await p.waitForTimeout(500);
// ensure 6M timeframe (daily) — click "6M"
try { await p.getByText('6M', { exact: true }).first().click({ timeout: 1200 }); } catch (e) {}
await p.waitForTimeout(500);
await p.screenshot({ path: path.join(out, 'macro-chart.png') });
// check the fast EMA is drawn as bi-color paths (green + red strokes) and glow markers exist
const svg = await p.evaluate(() => {
  const paths = [...document.querySelectorAll('svg path')];
  const circles = [...document.querySelectorAll('svg circle')];
  const radial = document.querySelectorAll('svg radialGradient').length;
  return { paths: paths.length, circles: circles.length, radialGradients: radial };
});
console.log('svg:', JSON.stringify(svg));
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'NONE');
await b.close();
