const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const logs = [];

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);

  // Seed vehicleFleet into localStorage fallback so the picker dropdown has items
  await page.evaluate(() => {
    const seed = [
      { id:'c_seed1', carNumber:'АО 4452-7', vehicleNumbers:'АО 4452-7', trailerNumber:'А 0635 Е-7', driverNameRu:'Кашмель Игорь', driverName:'Кашмель Игорь' },
      { id:'c_seed2', carNumber:'АХ 6266-3', vehicleNumbers:'АХ 6266-3', trailerNumber:'А 1234 В-7', driverNameRu:'Гайкович Петр', driverName:'Гайкович Петр' },
      { id:'c_seed3', carNumber:'АР 9694-7', vehicleNumbers:'АР 9694-7', trailerNumber:'А 1604 Е-7', driverNameRu:'Веренько Андрей', driverName:'Веренько Андрей' },
    ];
    localStorage.setItem('ratipa_vehicle_fleet', JSON.stringify(seed));
  });
  await page.reload({ waitUntil: 'networkidle2' });
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
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]')).map(i=>i.value));
  logs.push('BEFORE:'+JSON.stringify(before));

  // Open picker (now seeded)
  await page.evaluate(() => { const i=Array.from(document.querySelectorAll('input')).find(x=>/поиск сцепки|сцепк/i.test(x.placeholder||'')); if(i) i.click(); });
  await sleep(800);

  const dd = await page.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div')).filter(d => { const s=getComputedStyle(d); return s.position==='fixed'&&parseInt(s.zIndex)>=9000; });
    return fixed.length ? fixed[0].querySelectorAll('button').length : 'NONE';
  });
  logs.push('DROPDOWN_BTNS:'+dd);

  // Click first dropdown button
  const picked = await page.evaluate(() => {
    const fixed = Array.from(document.querySelectorAll('div')).filter(d => { const s=getComputedStyle(d); return s.position==='fixed'&&parseInt(s.zIndex)>=9000; });
    if(!fixed.length) return 'NO_DD';
    const btn = fixed[0].querySelector('button');
    if(btn){ btn.click(); return btn.textContent.trim().slice(0,30);}
    return 'NO_BTN';
  });
  logs.push('PICKED:'+picked);
  await sleep(1000);

  const after = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="date"]')).map(i=>i.value));
  logs.push('AFTER:'+JSON.stringify(after));
  logs.push('CLEARED:'+JSON.stringify(before.filter((v,i)=>v && !after[i])));

  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
