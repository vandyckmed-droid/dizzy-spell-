import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1500);
await p.mouse.wheel(0, 1200); await p.waitForTimeout(400);
const bx = await p.evaluate(() => { const r = document.querySelector('[data-swipe="SNDK"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const y = bx.y + bx.h / 2, x0 = bx.x + 24;
const tp = (x) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
// pre-arm frame (~half throw, un-armed) and armed frame (past commit), holding the touch
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x0) });
for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x0 + i * 8) }); await p.waitForTimeout(10); }
await p.waitForTimeout(120);
await p.screenshot({ path: path.join(out, 'swipe-prearm.png') });
for (let i = 6; i <= 13; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x0 + i * 8) }); await p.waitForTimeout(10); }
await p.waitForTimeout(120);
await p.screenshot({ path: path.join(out, 'swipe-armed.png') });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await b.close();
console.log('frames captured');
