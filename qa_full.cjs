const puppeteer = require('puppeteer');
const fs = require('fs');

const MODULES = ['dashboard','dohod','salary','planDohod','planZagruzok','currentPlanning','baza','dozvola','disposition','settings','admin','documents','vehicleDriverData'];

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

  const log = (s) => { console.log(s); fs.appendFileSync(`${OUT}/qa.log`, s+'\n'); };

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
  log('LOGGED IN; title=' + (await page.title()));

  const perModuleErrors = {};
  for (const mod of MODULES) {
    const before = allConsoleErrors.length + allPageErrors.length;
    const t0 = Date.now();
    try {
      await page.evaluate((m) => { window.location.hash = m; }, mod);
      await new Promise(r=>setTimeout(r, 2200));
      const info = await page.evaluate(() => {
        const h = document.querySelector('h1,h2');
        return {
          title: document.title,
          heading: h ? h.innerText.trim() : '(no h1/h2)',
          bodyLen: document.body.innerText.length,
          btns: document.querySelectorAll('button').length,
          tables: document.querySelectorAll('table').length,
          inputs: document.querySelectorAll('input,select,textarea').length,
          emptyState: /нет данных|не найдено|пусто|nothing|empty/i.test(document.body.innerText.slice(0,3000)),
        };
      });
      await page.screenshot({ path: `${OUT}/${mod}.png` });
      const delta = allConsoleErrors.length + allPageErrors.length - before;
      perModuleErrors[mod] = delta;
      log(`[OK] ${mod.padEnd(18)} heading="${info.heading}" body=${info.bodyLen} btns=${info.btns} tbl=${info.tables} errs=+${delta} (${Date.now()-t0}ms)`);
    } catch (e) {
      log(`[FAIL] ${mod}: ${String(e).slice(0,150)}`);
      try { await page.screenshot({ path: `${OUT}/${mod}_error.png` }); } catch {}
    }
  }

  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({
    consoleErrors: allConsoleErrors, pageErrors: allPageErrors,
    perModuleErrors,
  }, null, 2));

  log('\n===== TOTALS =====');
  log('console errors: ' + allConsoleErrors.length);
  log('page errors: ' + allPageErrors.length);
  allConsoleErrors.slice(0,30).forEach((e,i)=>log(`  CE${i}: ${e.slice(0,200)}`));
  allPageErrors.slice(0,30).forEach((e,i)=>log(`  PE${i}: ${e.slice(0,200)}`));

  await browser.close();
  log('DONE');
})().catch((e) => { fs.appendFileSync('/tmp/ratipa-qa/qa.log','FATAL '+e+'\n'); process.exit(1); });
