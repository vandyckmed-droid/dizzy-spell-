import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1500);

// count selected rows via the selRow greenish tint on the row container
async function selCount() {
  return await p.evaluate(() => {
    let sel = 0;
    for (const el of document.querySelectorAll('[data-swipe]')) {
      const m = getComputedStyle(el).backgroundColor.match(/\d+/g);
      if (m && +m[1] > +m[0] && +m[1] > +m[2] && +m[1] < 70) sel++;
    }
    return sel;
  });
}
// tap the row body (left area, away from the trailing chevron) → should toggle
async function tapRow(sym) {
  const bx = await p.evaluate((sym) => {
    const el = document.querySelector(`[data-swipe="${sym}"]`);
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sym);
  if (!bx) return 'NO_ROW';
  await p.mouse.click(bx.x + 90, bx.y + bx.h / 2);   // left-of-center, on the name
  return 'OK';
}
// tap the far-right chevron → should open detail (NOT toggle)
async function tapChevron(sym) {
  const bx = await p.evaluate((sym) => {
    const el = document.querySelector(`[data-swipe="${sym}"]`);
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sym);
  if (!bx) return 'NO_ROW';
  await p.mouse.click(bx.x + bx.w - 14, bx.y + bx.h / 2);
  return 'OK';
}
async function detailOpen() {
  // detail modal shows a large ticker header + performance card; detect a back/close affordance
  return await p.evaluate(() => !!document.body.innerText.match(/annualized|β|Correlated|1y/i) && document.body.innerText.includes('Performance') || false);
}

await p.mouse.wheel(0, 1200); await p.waitForTimeout(400);
const syms = await p.evaluate(() => [...document.querySelectorAll('[data-swipe]')].slice(0, 6).map(e => e.getAttribute('data-swipe')));
console.log('rows:', syms, '| sel before:', await selCount());

for (const s of syms.slice(0, 3)) {
  await tapRow(s); await p.waitForTimeout(350);
  console.log(`tap row ${s} → selected:`, await selCount());
}
// re-tap first to de-select
await tapRow(syms[0]); await p.waitForTimeout(350);
console.log(`re-tap ${syms[0]} → selected:`, await selCount());

await p.screenshot({ path: path.join(out, 'tap-after.png') });

// chevron opens detail (use a row lower down so it's clearly visible)
const before = await selCount();
await tapChevron(syms[3]); await p.waitForTimeout(700);
const opened = await p.evaluate(() => document.body.innerText.includes('Performance') || document.body.innerText.includes('Correlated'));
const afterSel = await selCount();
console.log(`tap chevron ${syms[3]} → detail opened:`, opened, '| selection unchanged:', before === afterSel);
await p.screenshot({ path: path.join(out, 'tap-detail.png') });

console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'NONE');
await b.close();
