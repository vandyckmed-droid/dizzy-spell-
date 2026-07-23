import { chromium } from 'playwright';
import path from 'node:path';
const out = '/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('build/rnweb/index.html'), { waitUntil: 'load' });
await p.waitForTimeout(1400);
const click = async (label, exact = false) => { try { await p.getByLabel(label, { exact }).first().click({ timeout: 1500 }); return true; } catch (e) { return false; } };
const clickText = async (t) => { try { await p.getByText(t, { exact: false }).first().click({ timeout: 1500 }); return true; } catch (e) { return false; } };
const txt = async () => p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
const tab = async (name) => { const y = 795; const x = name === 'screener' ? 65 : name === 'portfolio' ? 195 : 325; await p.mouse.click(x, y); await p.waitForTimeout(500); };

// book #1: add SNDK + LRCX
await click('Add SNDK'); await click('Add LRCX'); await p.waitForTimeout(200);
await tab('portfolio');
let t = await txt();
console.log('1) Portfolio shows HRP + 2 holdings:', t.includes('HRP') && t.includes('Holdings'));
console.log('   switcher shows ◆ Portfolio:', /Portfolio/.test(t));
await p.screenshot({ path: path.join(out, 'books-portfolio.png') });

// create a new book via the ＋ New pill (accessibilityLabel "New book")
const madeNew = await click('New book');
await p.waitForTimeout(400);
t = await txt();
console.log('2) created new book (＋New worked):', madeNew, '| now shows Portfolio 2:', /Portfolio 2/.test(t));
console.log('   new book is empty (No holdings yet):', t.includes('No holdings yet'));
await p.screenshot({ path: path.join(out, 'books-new-empty.png') });

// open manage sheet (⋯), switch the new book to Watchlist
await click('Manage book'); await p.waitForTimeout(400);
await clickText('Watchlist');
await p.waitForTimeout(400);
// close sheet by tapping backdrop top
await p.mouse.click(195, 60); await p.waitForTimeout(400);
t = await txt();
console.log('3) new book switched to watchlist (empty watch copy):', t.includes('Nothing on this watchlist') || t.includes('tracked by momentum'));
await p.screenshot({ path: path.join(out, 'books-watch.png') });

// switch back to book #1 by tapping its pill (accessibilityLabel "Book Portfolio 1"? default name "Portfolio")
const back = await click('Book Portfolio');
await p.waitForTimeout(400);
t = await txt();
console.log('4) switched back to book #1, holdings restored (SNDK/LRCX):', (t.includes('SNDK') || t.includes('LRCX')) && t.includes('Holdings'));
await p.screenshot({ path: path.join(out, 'books-back.png') });

console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'NONE');
await b.close();
