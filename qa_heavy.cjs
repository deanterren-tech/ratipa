const puppeteer = require('puppeteer');
const fs = require('fs');

const MODULES = ['planZagruzok','currentPlanning','baza','dozvola','disposition','settings','admin','vehicleDriverData'];

(async () => {
  const BASE = 'http://localhost:3100';
  const OUT = '/tmp/ratipa-qa';
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const allConsoleErrors = [];
  const allPageErrors = [];
  page.on('console', (msg) => { if (msg.type()==='error') allConsoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => allPageErrors.push(err.message));

  const log = (s) => { console.log(s); fs.appendFileSync(`${OUT}/qa2.log`, s+'\n'); };

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r=>setTimeout(r,1200));
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.evaluate(() => {
    const sel = document.querySelector('#username');
    for (const opt of sel.options) if (opt.value.toLowerCase().includes('сергей')) { sel.value = opt.value; break; }
  });
  await page.type('#password', 'ratipa2026');
  await page.click('button[type="submit"]');
  await new Promise(r=>setTimeout(r,2500));

  for (const mod of MODULES) {
    const before = allConsoleErrors.length + allPageErrors.length;
    await page.evaluate((m) => { window.location.hash = m; }, mod);
    // wait up to 8s for content (not spinner)
    let settled = false;
    for (let i=0;i<16;i++){
      await new Promise(r=>setTimeout(r,500));
      const st = await page.evaluate(() => {
        const txt = document.body.innerText;
        const spinner = /загрузк|loading|подождит/i.test(txt.slice(0,200));
        const len = txt.length;
        const h = document.querySelector('h1,h2');
        return { len, spinner, heading: h?h.innerText.trim():'' , tables: document.querySelectorAll('table').length, cards: document.querySelectorAll('[class*="card"], [class*="Card"]').length };
      });
      if (!st.spinner && st.len > 400) { settled = true; break; }
    }
    const info = await page.evaluate(() => {
      const h = document.querySelector('h1,h2');
      return {
        title: document.title,
        heading: h ? h.innerText.trim() : '(no h1/h2)',
        bodyLen: document.body.innerText.length,
        btns: document.querySelectorAll('button').length,
        tables: document.querySelectorAll('table').length,
        inputs: document.querySelectorAll('input,select,textarea').length,
        sample: document.body.innerText.replace(/\s+/g,' ').slice(0,160),
      };
    });
    await page.screenshot({ path: `${OUT}/${mod}.png` });
    const delta = allConsoleErrors.length + allPageErrors.length - before;
    log(`[${settled?'OK ':'STUCK'}] ${mod.padEnd(18)} heading="${info.heading}" body=${info.bodyLen} btns=${info.btns} tbl=${info.tables} errs=+${delta}`);
    log(`     sample: ${info.sample}`);
  }

  log('\n--- ERRORS for these modules ---');
  allConsoleErrors.forEach((e,i)=>log(`  CE${i}: ${e.slice(0,200)}`));
  allPageErrors.forEach((e,i)=>log(`  PE${i}: ${e.slice(0,200)}`));
  await browser.close();
  log('DONE');
})().catch((e) => { fs.appendFileSync('/tmp/ratipa-qa/qa2.log','FATAL '+e+'\n'); process.exit(1); });
