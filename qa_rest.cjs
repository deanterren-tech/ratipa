const puppeteer = require('puppeteer');
const fs = require('fs');

const MODULES = ['disposition','settings','admin','vehicleDriverData'];

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT '+label)), ms))
]);

(async () => {
  const BASE = 'http://localhost:3100';
  const OUT = '/tmp/ratipa-qa';
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR: '+e.message));
  const log = s => { console.log(s); fs.appendFileSync(`${OUT}/qa3.log`, s+'\n'); };

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r=>setTimeout(r,1000));
  await page.waitForSelector('#username', { timeout: 10000 });
  await page.evaluate(() => { const s=document.querySelector('#username'); for(const o of s.options) if(o.value.toLowerCase().includes('сергей')){s.value=o.value;break;} });
  await page.type('#password','ratipa2026');
  await page.click('button[type="submit"]');
  await new Promise(r=>setTimeout(r,2500));

  for (const mod of MODULES) {
    const before = errs.length;
    try {
      await withTimeout(page.evaluate(m => { window.location.hash = m; }, mod), 5000, 'nav '+mod);
      await new Promise(r=>setTimeout(r,4000)); // give it time
      const info = await withTimeout(page.evaluate(() => {
        const h = document.querySelector('h1,h2');
        return { heading: h?h.innerText.trim():'(none)', bodyLen: document.body.innerText.length, btns: document.querySelectorAll('button').length, tables: document.querySelectorAll('table').length, inputs: document.querySelectorAll('input,select,textarea').length, iframes: document.querySelectorAll('iframe').length, sample: document.body.innerText.replace(/\s+/g,' ').slice(0,150) };
      }), 5000, 'eval '+mod);
      await page.screenshot({ path: `${OUT}/${mod}.png` });
      const delta = errs.length - before;
      log(`[OK] ${mod.padEnd(18)} heading="${info.heading}" body=${info.bodyLen} btns=${info.btns} tbl=${info.tables} ifr=${info.iframes} errs=+${delta}`);
      log(`     ${info.sample}`);
    } catch (e) {
      log(`[FAIL] ${mod}: ${String(e).slice(0,120)}`);
      try { await page.screenshot({ path: `${OUT}/${mod}_err.png` }); } catch {}
    }
  }
  log('--- ERRORS ---');
  errs.forEach((e,i)=>log(`  ${i}: ${e.slice(0,200)}`));
  await browser.close();
  log('DONE');
})().catch(e => { fs.appendFileSync('/tmp/ratipa-qa/qa3.log','FATAL '+e+'\n'); process.exit(1); });
