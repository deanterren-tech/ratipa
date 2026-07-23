const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const logs = [];
  page.on('console', m => { const t=m.text(); if(/error|warn|firebase/i.test(t)) logs.push('CON:'+t.slice(0,160)); });
  page.on('pageerror', e => logs.push('ERR:'+e.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  await page.select('#username', 'Сергей');
  await page.type('input[type="password"]', 'ratipa2026', { delay: 10 });
  await page.evaluate(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/войти/i.test(x.textContent)); if(b) b.click(); });
  await sleep(3000);

  const inApp = await page.evaluate(() => /баз|автомоб|учет/i.test(document.body.textContent) && !/войти в систему/i.test(document.body.textContent));
  logs.push('IN_APP:'+inApp);
  if (!inApp) { console.log(logs.join('\n')); await browser.close(); return; }

  // Find all elements whose text matches tab labels
  const tabs = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const out = [];
    els.forEach(e => {
      const t = (e.childNodes.length===1 && e.textContent||'').trim();
      if (/учет выезда|автомобили на базе|автомобил/i.test(t)) out.push({tag:e.tagName, cls:e.className?.toString().slice(0,40), txt:t});
    });
    return out.slice(0,10);
  });
  logs.push('TABS:'+JSON.stringify(tabs));

  // Click the "Учет выезда" tab
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const t = els.find(e => (e.childNodes.length===1 && (e.textContent||'').trim()==='Учет выезда'));
    if (t) t.click();
  });
  await sleep(2000);

  // Dump what's visible: count of rows/cards and any 9694 text
  const view = await page.evaluate(() => {
    return {
      has9694: /9694/i.test(document.body.textContent),
      trCount: document.querySelectorAll('tr').length,
      cardLike: document.querySelectorAll('[class*="card"]').length,
      dateInputs: document.querySelectorAll('input[type="date"]').length,
      bodySnippet: document.body.textContent.replace(/\s+/g,' ').slice(0,400)
    };
  });
  logs.push('VIEW:'+JSON.stringify(view));

  console.log(logs.join('\n'));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
