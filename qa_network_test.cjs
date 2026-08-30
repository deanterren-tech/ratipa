/**
 * RATIPA Portal — Network Throttling QA v6 (FIXED LOGIN)
 * 
 * Login race condition fix: wait for users to load from Firebase
 * before setting the select value.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'http://localhost:3000';
const REPORT = '/Users/sergei/ratipa-fresh-rewrite/QA_FIREBASE_NETWORK_REPORT.md';

const PAGES = [
  { hash: '#dohod', label: 'Калькуляция (Доход)' },
  { hash: '#vehicleDriverData', label: 'Авто и Водители (Fleet)' },
  { hash: '#planZagruzok', label: 'План Дохода (Загрузки)' },
  { hash: '#dozvola', label: 'Дозволы' },
];

const PRESETS = {
  baseline: { label: 'Baseline', lat: 0, down: -1, up: -1 },
  fast3g:   { label: 'Fast 3G',  lat: 150, down: (1.5*1024*1024/8)|0, up: (750*1024/8)|0 },
  slow3g:   { label: 'Slow 3G',  lat: 400, down: (400*1024/8)|0, up: (200*1024/8)|0 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browserOpts = { headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] };

/** Login: wait for users to load, THEN set values */
async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Wait for React to finish auto-selecting first user (value !== '')
  for (let i = 0; i < 30; i++) {
    const val = await page.evaluate(() => {
      const s = document.querySelector('select');
      return s ? s.value : '';
    });
    if (val !== '') break;
    await sleep(200);
  }
  
  // NOW select Сергей (after React auto-select has fired)
  await page.evaluate(() => {
    const s = document.querySelector('select');
    if (!s) return;
    // Find Сергей option
    for (let i = 0; i < s.options.length; i++) {
      if (s.options[i].value === 'Сергей' || s.options[i].text === 'Сергей') {
        s.selectedIndex = i;
        s.value = 'Сергей';
        break;
      }
    }
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(200);
  
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.click(); await pw.type('ratipa2026', { delay: 5 }); }
  await sleep(200);
  
  // Click login — the SPA will update React state and navigate via hash
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /войти/i.test(b.textContent));
    if (btn) btn.click();
  });
  
  // Wait for dashboard to appear (SPA navigation, not full page nav)
  for (let i = 0; i < 30; i++) {
    const body = await page.evaluate(() => document.body.innerText || '');
    if (body.includes('Доброго') || body.includes('ТЕКУЩЕЕ') || body.includes('Добро пожаловать')) {
      return true;
    }
    await sleep(300);
  }
  
  const body = await page.evaluate(() => document.body.innerText || '');
  return body.length > 300 && !body.includes('ВЫБЕРИТЕ');
}

/** Test one page under a condition */
async function testPage(page, pi, preset) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: preset.lat,
    downloadThroughput: preset.down, uploadThroughput: preset.up,
  });

  // Navigate via hash (SPA)
  await page.evaluate(h => { window.location.hash = h; }, pi.hash);
  await sleep(300);

  // Poll for content
  const startBody = await page.evaluate(() => (document.body.innerText || '').length);
  const pollStart = Date.now();
  let state = null, timedOut = false;

  for (;;) {
    const elapsed = Date.now() - pollStart;
    if (elapsed > 30000) { timedOut = true; break; }
    
    state = await page.evaluate((startLen) => {
      const m = document.querySelector('main');
      const body = document.body.innerText || '';
      const mKids = m ? m.children.length : 0;
      const spinners = document.querySelectorAll('.animate-spin, [class*="spinner"], [class*="loading"], svg[class*="animate"]');
      const tables = !!document.querySelector('table, [role="table"]');
      const textGrew = body.length > startLen + 100;
      const ready = (mKids > 0 && textGrew) || tables || mKids > 2;
      return { textLen: body.length, mKids, spinners: spinners.length, tables, ready };
    }, startBody);
    
    if (state.ready) break;
    if (state.spinners === 0 && elapsed > 8000) break;
    await sleep(300);
  }

  const appearMs = Date.now() - pollStart;
  
  // Restore no-throttle
  try { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch(e) {}

  const final = await page.evaluate(() => {
    const m = document.querySelector('main');
    return {
      mKids: m ? m.children.length : 0,
      bodyLen: (document.body.innerText || '').length,
      spinners: document.querySelectorAll('.animate-spin, [class*="spinner"], [class*="loading"]').length,
      tables: document.querySelectorAll('table, [role="table"]').length,
    };
  });

  return { page: pi.label, preset: preset.label, appearMs, timedOut, loaded: state?.ready, state, final };
}

async function testPreset(key) {
  const preset = PRESETS[key];
  console.log(`\n========== ${preset.label} ==========`);
  const browser = await puppeteer.launch(browserOpts);
  const page = await browser.newPage();
  
  let loginOk = false;
  try { loginOk = await login(page); } catch(e) { console.error(`  Login err: ${e.message}`); }
  console.log(`  Login: ${loginOk ? '✅' : '❌'}`);

  const results = [];
  for (const pi of PAGES) {
    try {
      const r = await testPage(page, pi, preset);
      results.push(r);
      console.log(`  → ${pi.label}: ${r.appearMs}ms loaded=${r.loaded} spinners=${r.final.spinners} tables=${r.final.tables}`);
    } catch(e) {
      console.log(`  → ${pi.label}: ERROR ${e.message.substring(0, 60)}`);
    }
  }
  
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  return results;
}

async function wsCapture() {
  console.log(`\n========== WebSocket / Firebase ==========`);
  const browser = await puppeteer.launch(browserOpts);
  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');

  const wsEvents = [], fbHttp = [];
  let firstFrame = null;

  cdp.on('Network.webSocketCreated', p => wsEvents.push({ e:'created', url:(p.url||'').substr(0,130), ts:Date.now() }));
  cdp.on('Network.webSocketFrameReceived', p => {
    const len = p.response?.payloadData?.length || 0;
    if (!firstFrame) firstFrame = { ts: Date.now(), size: len };
    wsEvents.push({ e:'data', len, ts:Date.now() });
  });
  cdp.on('Network.requestWillBeSent', p => {
    const url = p.request?.url || '';
    if (url.includes('firebaseio.com') || /firebase/i.test(url)) {
      fbHttp.push({ url: url.substring(0, 120), method: p.request?.method || 'GET' });
    }
  });

  try {
    await login(page);
    await page.evaluate(() => { window.location.hash = '#vehicleDriverData'; });
    await sleep(5000);
    await page.evaluate(() => { window.location.hash = '#dohod'; });
    await sleep(5000);
    
    const globals = await page.evaluate(() => ({
      firebase: typeof firebase !== 'undefined',
      database: typeof database !== 'undefined',
      app: typeof app !== 'undefined',
      fbSdkMod: !!document.querySelector('script[src*="firebase"]'),
    }));

    await page.close(); await browser.close();
    console.log(`  WS: ${wsEvents.length}, HTTP: ${fbHttp.length}, First frame: ${firstFrame ? new Date(firstFrame.ts).toISOString().substr(11,19) : 'N/A'}`);
    return { wsEvents, fbHttp, firstFrame, globals };
  } catch(e) {
    console.error(`  WS err: ${e.message}`);
    await page.close().catch(()=>{}); await browser.close().catch(()=>{});
    return { wsEvents:[], fbHttp:[], firstFrame:null, globals:null, error: e.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('RATIPA PORTAL — NETWORK LOADING QA');
  console.log('='.repeat(70));

  const [baseline, fast3g, slow3g, ws] = await Promise.all([
    testPreset('baseline'),
    testPreset('fast3g'),
    testPreset('slow3g'),
    wsCapture(),
  ]);

  // ===== REPORT =====
  console.log('\n--- Building Report ---');
  
  let md = `# QA Report: Firebase Network Loading Performance

**Date:** ${new Date().toISOString().split('T')[0]}
**Time:** ${new Date().toISOString().substr(11, 8)}
**App:** RATIPA Portal (localhost:3000)
**Tool:** Puppeteer headless Chromium + CDP Network Emulation

## 1. Network Conditions

| Condition | Download | Upload | Latency |
|-----------|----------|--------|---------|
| Baseline  | Unlimited | Unlimited | 0 ms |
| Fast 3G   | 1.5 Mbps (187 KB/s) | 750 Kbps (94 KB/s) | 150 ms |
| Slow 3G   | 400 Kbps (50 KB/s) | 200 Kbps (25 KB/s) | 400 ms |

## 2. Page Loading Timings

### 2.1 Baseline

| Page | Content (ms) | Data Loaded | Spinners | Tables |
|------|:-----------:|:----------:|:--------:|:-----:|
`;
  function row(r) {
    if (!r) return `| — | — | ❌ | — | — |\n`;
    return `| **${r.page}** | ${r.appearMs | 0} | ${r.loaded ? '✅' : '❌'} | ${r.final?.spinners | 0} | ${r.final?.tables | 0} |\n`;
  }
  for (const p of PAGES) { md += row((baseline||[]).find(x => x.page === p.label)); }

  md += `\n### 2.2 Fast 3G\n\n| Page | Content (ms) | Data Loaded | Spinners | Tables |\n|------|:-----------:|:----------:|:--------:|:-----:|\n`;
  for (const p of PAGES) { md += row((fast3g||[]).find(x => x.page === p.label)); }

  md += `\n### 2.3 Slow 3G\n\n| Page | Content (ms) | Data Loaded | Spinners | Tables |\n|------|:-----------:|:----------:|:--------:|:-----:|\n`;
  for (const p of PAGES) { md += row((slow3g||[]).find(x => x.page === p.label)); }

  md += `\n## 3. Loading States & Spinners\n\n`;
  md += `| Page | Baseline | Fast 3G | Slow 3G | Notes |\n|------|:-------:|:------:|:-------:|-------|\n`;
  for (const p of PAGES) {
    const b = (baseline||[]).find(x=>x.page===p.label);
    const f = (fast3g||[]).find(x=>x.page===p.label);
    const s = (slow3g||[]).find(x=>x.page===p.label);
    const bS = b?.final?.spinners ? '✅' : '❌';
    const fS = f?.final?.spinners ? '✅' : '❌';
    const sS = s?.final?.spinners ? '✅' : '❌';
    const n = (!bS && !fS && !sS) ? '❌ Спиннер отсутствует' : (bS === '✅' || fS === '✅' || sS === '✅' ? 'Спиннер есть (иногда)' : '');
    md += `| **${p.label}** | ${bS} | ${fS} | ${sS} | ${n} |\n`;
  }

  md += `\n### Timing Comparison\n\n| Page | Baseline | Fast 3G | Slow 3G | Slow/Baseline |\n|------|:--------:|:------:|:-------:|:-------------:|\n`;
  for (const p of PAGES) {
    const b = (baseline||[]).find(x=>x.page===p.label);
    const f = (fast3g||[]).find(x=>x.page===p.label);
    const s = (slow3g||[]).find(x=>x.page===p.label);
    const bT = b?.appearMs ?? '—'; const fT = f?.appearMs ?? '—'; const sT = s?.appearMs ?? '—';
    let ratio = '—';
    if (b?.appearMs && s?.appearMs && b.appearMs > 0) ratio = (s.appearMs / b.appearMs).toFixed(1) + 'x';
    md += `| ${p.label} | ${bT}ms | ${fT}ms | ${sT}ms | ${ratio} |\n`;
  }

  md += `\n## 4. WebSocket & Firebase\n\n`;

  if (ws?.wsEvents?.length) {
    const fbWs = ws.wsEvents.find(e => e.e === 'created' && e.url?.includes('firebaseio'));
    const fbCount = ws.wsEvents.filter(e => e.url?.includes('firebaseio')).length;
    md += `**Firebase RTDB WebSocket:** ${fbWs ? '✅' : '❌'}\n`;
    if (fbWs) {
      md += `- URL: \`${fbWs.url}\`\n`;
      md += `- Событий: ${fbCount} (из ${ws.wsEvents.length} всего)\n`;
    }
    if (ws.firstFrame) {
      const t = new Date(ws.firstFrame.ts);
      md += `- Первый фрейм: ${t.toISOString().substr(11, 8)}.${String(t.getMilliseconds()).padStart(3,'0')} (${ws.firstFrame.size} байт)\n`;
    }
  } else {
    md += `- Firebase WebSocket: не обнаружен\n`;
  }
  if (ws?.fbHttp?.length) {
    md += `\n**HTTP to Firebase:** ${ws.fbHttp.length} запросов\n`;
    for (const r of ws.fbHttp.slice(0, 10)) md += `- \`${r.method}\` ${r.url}\n`;
    if (ws.fbHttp.length > 10) md += `- ...и ещё ${ws.fbHttp.length - 10}\n`;
  }

  md += `\n## 5. Issues\n\n`;
  md += `| Issue | Severity | Pages | Detail |\n|-------|----------|-------|--------|\n`;

  const issues = [];
  for (const p of PAGES) {
    const b = (baseline||[]).find(x=>x.page===p.label);
    const f = (fast3g||[]).find(x=>x.page===p.label);
    const s = (slow3g||[]).find(x=>x.page===p.label);
    if (b && !b.loaded) issues.push(`| 🟡 Данные не загружены | ${p.label} | ${b.appearMs}ms — пустая страница |`);
    if (s?.timedOut) issues.push(`| 🔴 Таймаут Slow 3G | ${p.label} | >30s |`);
    if (!b?.final?.spinners && !f?.final?.spinners && !s?.final?.spinners)
      issues.push(`| 🟡 Нет спиннера | ${p.label} | UX: пустой экран при загрузке |`);
  }
  if (issues.length === 0) issues.push(`| ✅ Все OK | Все | — |`);
  
  for (const iss of issues) md += iss + '\n';

  md += `\n## 6. Recommendations\n\n`;
  md += `1. Добавить skeleton/spinner на страницы без индикатора загрузки.\n`;
  md += `2. Использовать \`shallow=true\` для больших списков Firebase.\n`;
  md += `3. React.lazy + Suspense для крупных модулей.\n`;
  md += `4. Кэширование в localStorage/IndexedDB.\n`;
  md += `\n---\n*${new Date().toISOString()}*`;

  fs.writeFileSync(REPORT, md, 'utf-8');
  console.log(`\n✅ ${REPORT} (${md.length} chars)`);
  
  // Console summary
  console.log('\n=== SUMMARY ===');
  for (const [label, data] of Object.entries({ baseline, fast3g, slow3g })) {
    for (const r of (data||[])) {
      console.log(`${label.padEnd(10)} ${r.page.padEnd(30)} ${r.appearMs}ms loaded=${r.loaded} spinners=${r.final?.spinners}`);
    }
  }
  if (ws?.wsEvents) {
    console.log(`\nWS fb events: ${ws.wsEvents.filter(e=>e.url?.includes('firebaseio')).length}`);
    console.log(`First frame: ${ws.firstFrame ? new Date(ws.firstFrame.ts).toISOString().substr(11,8) + ' ('+ws.firstFrame.size+'B)' : 'N/A'}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message, e.stack?.substring(0, 300)); process.exit(1); });