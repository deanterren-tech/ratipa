const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const logs = [];
  page.on('console', m => { const t=m.text(); if(/error|warn|firebase|permission/i.test(t)) logs.push('CON:'+t.slice(0,140)); });
  page.on('pageerror', e => logs.push('ERR:'+e.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  await page.select('#username', 'Сергей');
  await page.type('input[type="password"]', 'ratipa2026', { delay: 10 });
  await page.evaluate(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/войти/i.test(x.textContent)); if(b) b.click(); });
  await sleep(3000);
  await page.evaluate(() => { const e=Array.from(document.querySelectorAll('*')).find(x=>x.childNodes.length===1&&(x.textContent||'').trim()==='База'); if(e) e.click(); });
  await sleep(2500);

  await page.evaluate(() => { const r=document.querySelector('tbody tr'); if(r) r.click(); });
  await sleep(1500);

  // TYPE a date into first date input (Прибыл на базу)
  const typed = await page.evaluate(() => {
    const d = document.querySelector('input[type="date"]');
    if (!d) return 'NODATE';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(d, '2026-07-01');
    d.dispatchEvent(new Event('input',{bubbles:true}));
    d.dispatchEvent(new Event('change',{bubbles:true}));
    return d.value;
  });
  logs.push('TYPED:'+typed);
  await sleep(400);

  const before = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]')).map(i=>i.value));
  logs.push('BEFORE:'+JSON.stringify(before));

  // Open picker
  await page.evaluate(() => { const i=Array.from(document.querySelectorAll('input')).find(x=>/поиск сцепки|сцепк/i.test(x.placeholder||'')); if(i) i.click(); });
  await sleep(800);

  // Pick first portal dropdown item (button with position fixed)
  const picked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const item = btns.find(b => {
      const st = getComputedStyle(b.closest('div')||b);
      const txt=(b.textContent||'').trim();
      return b.offsetParent!==null && /[А-ЯA-Z]{1,3}\s?\d/i.test(txt) && txt.length<40 && !/войти|сохранить|рейс/i.test(txt);
    });
    if (item) { item.click(); return item.textContent.trim(); }
    return 'NONE; btns='+btns.slice(0,5).map(b=>b.textContent.trim().slice(0,20));
  });
  logs.push('PICKED:'+picked);
  await sleep(1000);

  const after = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]')).map(i=>i.value));
  logs.push('AFTER:'+JSON.stringify(after));
  logs.push('CLEARED:'+JSON.stringify(before.filter((v,i)=>v && !after[i])));

  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
