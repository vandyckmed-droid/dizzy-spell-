import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const cdp = await ctx.newCDPSession(p);
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1500);

async function box(sym) {
  return await p.evaluate((sym) => {
    const el = document.querySelector(`[data-swipe="${sym}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sym);
}
// trusted touch drag via CDP — the real device path RNW's responder consumes
async function swipe(sym) {
  const bx = await box(sym);
  if (!bx) return 'NO_ROW';
  const y = bx.y + bx.h / 2, x0 = bx.x + 24;
  const tp = (x) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x0) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x0 + i * 8) });
    await p.waitForTimeout(10);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return 'OK';
}
// selected rows: a selected swipe container carries the selRow tint (greenish, dark)
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

await p.mouse.wheel(0, 1200); await p.waitForTimeout(400);
const syms = await p.evaluate(() => [...document.querySelectorAll('[data-swipe]')].slice(0, 6).map(e => e.getAttribute('data-swipe')));
console.log('rows:', syms, '| sel before:', await selCount());

for (const s of syms.slice(0, 3)) {
  const r = await swipe(s);
  await p.waitForTimeout(500);
  console.log(`swipe ${s}: ${r} → selected rows now:`, await selCount());
}
// swipe MU (already selected) again to confirm de-select round-trips
const r2 = await swipe('MU');
await p.waitForTimeout(500);
console.log(`re-swipe MU: ${r2} → selected rows now:`, await selCount());

await p.screenshot({ path: path.join(out, 'swipe-after.png') });
console.log('ERRORS:', errs.length ? errs.slice(0, 4) : 'NONE');
await b.close();
