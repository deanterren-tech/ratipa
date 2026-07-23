const puppeteer = require('puppeteer');

(async () => {
  const BASE = 'http://localhost:3100';
  const OUT = '/tmp/ratipa-qa';
  require('fs').mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('== Navigate ==');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Select user "Сергей" in the dropdown
  const userSel = '#username';
  await page.waitForSelector(userSel, { timeout: 10000 });
  const hasSergei = await page.evaluate(() => {
    const sel = document.querySelector('#username');
    for (const opt of sel.options) {
      if (opt.value.toLowerCase().includes('сергей')) { sel.value = opt.value; return true; }
    }
    return false;
  });
  console.log('hasSergeiOption=', hasSergei);
  // If not present, fallback: type won't work (it's a select). Use password fallback anyway.
  await page.type('#password', 'ratipa2026');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 2500));

  const afterLogin = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasShell: !!document.querySelector('nav, aside, [class*="sidebar"], [class*="Sidebar"]'),
    bodyLen: document.body.innerText.length,
    sample: document.body.innerText.slice(0, 200),
  }));
  console.log('afterLogin=', JSON.stringify(afterLogin, null, 2));

  await page.screenshot({ path: `${OUT}/01_after_login.png`, fullPage: false });
  console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors.slice(0, 20));
  console.log('PAGE_ERRORS:', pageErrors.length, pageErrors.slice(0, 20));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
