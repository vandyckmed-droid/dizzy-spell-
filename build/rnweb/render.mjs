import { chromium } from 'playwright';
import path from 'node:path';
const out='/tmp/claude-0/-home-user-dizzy-spell-/92717a28-4df1-5955-adcb-8275b27edb98/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,colorScheme:'dark'});
const p=await ctx.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,200));});
await p.goto('file://'+path.resolve('build/rnweb/index.html'),{waitUntil:'load'});
await p.waitForTimeout(1000);
// select 6 names via accessibility labels (Add <SYM>)
for(const sym of ['WDC','MU','MKSI','LITE','LRCX','CIEN']){
  try{ await p.getByLabel('Add '+sym).click({timeout:2000}); }catch(e){ console.log('add',sym,'->',e.message.slice(0,50)); }
}
await p.waitForTimeout(300);
// open a detail by tapping WDC row text
try{ await p.getByText('Western Digital Corporation').click({timeout:2000}); await p.waitForTimeout(500);
  await p.screenshot({path:path.join(out,'rnweb-detail.png')});
  const dt=await p.evaluate(()=>document.body.innerText.slice(0,260));
  console.log('DETAIL:', JSON.stringify(dt.replace(/\s+/g,' ').slice(0,220)));
  await p.getByText('Back').click({timeout:2000}).catch(()=>{});
  await p.waitForTimeout(300);
}catch(e){console.log('detail:',e.message.slice(0,60));}
// go to portfolio
await p.getByText('Portfolio').first().click({timeout:2000});
await p.waitForTimeout(600);
await p.screenshot({path:path.join(out,'rnweb-portfolio.png')});
const pf=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
const m=pf.match(/(\d+) HOLDINGS.*?(\d+%) ALLOCATED.*?(\d+) SECTORS/);
console.log('PORTFOLIO stats:', m?`${m[1]} holdings, ${m[2]} allocated, ${m[3]} sectors`:'(parse fail) '+pf.slice(0,120));
console.log('has weight %:', /\d+%/.test(pf));
console.log('ERRORS:', errs.length?[...new Set(errs)].slice(0,8):'NONE');
await b.close();
