import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'})).newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,160));});
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1400);
console.log('count line:', await p.evaluate(()=>{const m=document.body.innerText.match(/\d+ ranked/);return m?m[0]:'?';}));
// open sort sheet
try{ await p.getByText(/Sharpe ↓|Sharpe ↑/).first().click({timeout:2000}); await p.waitForTimeout(400);
  console.log('sort sheet:', await p.evaluate(()=>/Sort by/.test(document.body.innerText)?'opened':'no'));
  await p.getByText('Cumulative return').click({timeout:2000}); await p.waitForTimeout(300);
}catch(e){console.log('sort:',e.message.slice(0,50));}
// open filter sheet
try{ await p.getByText(/⚑ Filter/).first().click({timeout:2000}); await p.waitForTimeout(300);
  console.log('filter sheet:', await p.evaluate(()=>/Market cap/.test(document.body.innerText)?'opened':'no'));
  await p.getByText('≥ $500B').click({timeout:2000}); await p.waitForTimeout(300);
  console.log('after mega filter:', await p.evaluate(()=>{const m=document.body.innerText.match(/\d+ ranked/);return m?m[0]:'?';}));
  // close by tapping backdrop area (top)
  await p.mouse.click(195,80); await p.waitForTimeout(300);
}catch(e){console.log('filter:',e.message.slice(0,50));}
await p.screenshot({path:path.join(out,'v3-screener.png')});
// select 5, open detail (chart)
for(const s of ['NVDA','AAPL','MSFT','AVGO','TSM']){ try{ await p.getByLabel('Add '+s).click({timeout:1500}); }catch(e){} }
try{ await p.getByText('NVIDIA Corporation').first().click({timeout:2000}); await p.waitForTimeout(600);
  console.log('detail:', await p.evaluate(()=>/ranking window|vs window open/i.test(document.body.innerText)?'chart present':'no chart'));
  await p.screenshot({path:path.join(out,'v3-detail.png')});
  await p.getByText('Back').click({timeout:2000}).catch(()=>{});
}catch(e){console.log('detail:',e.message.slice(0,50));}
await p.waitForTimeout(200);
try{ await p.getByText('Portfolio').first().click({timeout:2000}); await p.waitForTimeout(700);
  const m=(await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).match(/(\d+) HOLDINGS.*?(\d+%) ALLOCATED/);
  console.log('portfolio:', m?`${m[1]} holdings ${m[2]}`:'?');
  await p.screenshot({path:path.join(out,'v3-portfolio.png')});
}catch(e){console.log('pf:',e.message.slice(0,50));}
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,8):'NONE');
await b.close();
