/* Headless iPhone smoke test + screenshots of the delivered artifact. */
import { chromium, devices } from 'playwright';
import path from 'node:path';

const file = 'file://' + path.resolve('dist/portfolio-screener.html');
const iphone = devices['iPhone 13'];
const outDir = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ ...iphone });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(file, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Screener rendered?
const cards = await page.locator('#rankList .card').count();
const freshness = await page.locator('#freshness').textContent();
console.log('screener cards:', cards);
console.log('freshness:', freshness);
await page.screenshot({ path: path.join(outDir, '01-screener.png') });

// Change window (start offset -), confirm recompute doesn't crash
await page.locator('[data-k="start"][data-d="-1"]').click();
await page.waitForTimeout(150);
const note = await page.locator('#windowNote').textContent();
console.log('window note:', note.slice(0, 90));

// Select first 8 names
const btns = page.locator('#rankList .selbtn');
for (let i = 0; i < 8; i++) await btns.nth(i).click();
const badge = await page.locator('#tabBadge').textContent();
console.log('badge after 8 selects:', badge);

// Open a detail
await page.locator('#rankList .tap').first().click();
await page.waitForTimeout(350);
const detailTicker = await page.locator('#detailBody .dhead .t').textContent();
const perfRows = await page.locator('#detailBody .perf-row').count();
console.log('detail ticker:', detailTicker, 'perf rows:', perfRows);
await page.screenshot({ path: path.join(outDir, '02-detail.png') });
await page.locator('#detailBack').click();
await page.waitForTimeout(300);

// Portfolio tab
await page.locator('.tabbar [data-tab="portfolio"]').click();
await page.waitForTimeout(300);
const total = await page.locator('#pfTotal').textContent();
const holdings = await page.locator('#pfCount').textContent();
const wrows = await page.locator('#weightList .wrow').count();
console.log('portfolio holdings:', holdings, 'allocated:', total, 'weight rows:', wrows);
await page.screenshot({ path: path.join(outDir, '03-portfolio.png') });

// Apply a stock cap and re-check total
await page.locator('[data-cap="stock"][data-d="1"]').click(); // turns on ~25%
await page.locator('[data-cap="stock"][data-d="-1"]').click(); // 20%
await page.locator('[data-cap="stock"][data-d="-1"]').click(); // 15%
await page.waitForTimeout(200);
const totalCapped = await page.locator('#pfTotal').textContent();
const maxStock = await page.locator('#maxStockVal').textContent();
console.log('after cap', maxStock, '-> allocated', totalCapped);
await page.screenshot({ path: path.join(outDir, '04-portfolio-capped.png') });

// Light theme screenshot
await page.locator('#themeBtn').click(); // dark
await page.locator('#themeBtn').click(); // light
await page.waitForTimeout(200);
await page.locator('.tabbar [data-tab="screener"]').click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, '05-screener-light.png') });

console.log('\nconsole errors:', errors.length ? errors : 'NONE');
await browser.close();
if (errors.length) process.exit(1);
console.log('SMOKE TEST PASSED');
