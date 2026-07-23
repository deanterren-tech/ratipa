const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const logs = [];

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

  // TYPE a date
  await page.evaluate(() => {
    const d = document.querySelector('input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(d, '2026-07-01');
    d.dispatchEvent(new Event('input',{bubbles:true}));
    d.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await sleep(400);

  // Open picker
  await page.evaluate(() => { const i=Array.from(document.querySelectorAll('input')).find(x=>/поиск сцепки|сцепк/i.test(x.placeholder||'')); if(i) i.click(); });
  await sleep(800);

  // Dump dropdown structure
  const dd = await page.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div')).filter(d => {
      const s = getComputedStyle(d);
      return s.position==='fixed' && parseInt(s.zIndex) >= 9000;
    });
    if (!fixed.length) return 'NO_FIXED_DROPDOWN';
    const d = fixed[0];
    return {
      childCount: d.children.length,
      buttons: Array.from(d.querySelectorAll('button')).slice(0,5).map(b=>({txt:b.textContent.trim().slice(0,30), cls:b.className?.toString().slice(0,50)}))
    };
  });
  logs.push('DROPDOWN:'+JSON.stringify(dd));

  // Click the FIRST button in the dropdown
  const picked = await page.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div')).filter(d => {
      const s = getComputedStyle(d);
      return s.position==='fixed' && parseInt(s.zIndex) >= 9000;
    });
    if (!fixed.length) return 'NO_DROPDOWN';
    const btn = fixed[0].querySelector('button');
    if (btn) { btn.click(); return btn.textContent.trim().slice(0,30); }
    return 'NO_BTN';
  });
  logs.push('PICKED:'+picked);
  await sleep(1000);

  const after = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]')).map(i=>i.value));
  const carLabel = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(x=>/выберите сцепку/i.test(x.textContent||'')).length );
  logs.push('AFTER:'+JSON.stringify(after));
  logs.push('STILL_TYPED:'+after[0]);

  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
