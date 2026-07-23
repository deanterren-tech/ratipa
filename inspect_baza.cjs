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

  // Click "База" tab
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const t = els.find(e => e.childNodes.length===1 && (e.textContent||'').trim()==='База');
    if (t) t.click();
  });
  await sleep(2500);

  const view = await page.evaluate(() => ({
    has9694: /9694/i.test(document.body.textContent),
    trCount: document.querySelectorAll('tr').length,
    cards: document.querySelectorAll('[class*="card"]').length,
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    bodySnippet: document.body.textContent.replace(/\s+/g,' ').slice(0,500)
  }));
  logs.push('BAZA_VIEW:'+JSON.stringify(view));
  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
