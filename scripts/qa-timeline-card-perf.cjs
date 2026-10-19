// Проверка окна рейса: замер открытия (первое и тёплое) + работа подсказок городов.
// Ничего не сохраняет: подсказку выбираем в черновике и окно не сохраняем.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/sergei/ratipa-fresh-rewrite/package.json');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '/Users/sergei/.hermes/cache/scratch/tl-lag';
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: String(detail) }); console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' });
const errors = [];
ctx.on('page', (p) => {
  p.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ratipa_user_session', JSON.stringify({ uid: 'probe-lag-main', name: 'probe-lag-main', firstName: 'Пробный', lastName: 'Лаг', email: 'p@p.local', role: 'root_admin', permissions: {}, customPermissions: {}, onboarding: { x: 'done' } }));
    localStorage.setItem('ratipa_last_module', 'tripTimeline');
    localStorage.setItem('pl_dohod_announce_probe-lag-main', '1');
    localStorage.setItem('ratipa_tour_seen_x_probe-lag-main', '1');
  } catch { /* ignore */ }
  window.__perf = { long: [], frames: [] };
  try {
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); });
    po.observe({ entryTypes: ['longtask'] });
  } catch { /* ignore */ }
  let last = performance.now();
  const tick = () => { const n = performance.now(); window.__perf.frames.push(Math.round(n - last)); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const page = await ctx.newPage();
await page.goto(process.env.PORTAL_URL || 'http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-ui="timeline-scroll"]', { timeout: 45000 });
await page.waitForFunction(() => {
  const sc = document.querySelector('[data-ui="timeline-scroll"]');
  if (!sc) return false;
  const r = sc.getBoundingClientRect();
  return [...document.querySelectorAll('[role="button"]')].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 40 && b.height > 6 && b.x > r.x + 200 && b.y > r.y && b.y < r.y + r.height;
  }).length >= 5;
}, { timeout: 90000 });
await sleep(3000);

const barsOn = () => page.evaluate(() => {
  const sc = document.querySelector('[data-ui="timeline-scroll"]');
  const r = sc.getBoundingClientRect();
  return [...document.querySelectorAll('[role="button"]')].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 40 && b.height > 6 && b.x > r.x + 200 && b.y > r.y && b.y < r.y + r.height;
  }).length;
});

const openTrip = async (index) => {
  const res = await page.evaluate((i) => {
    window.__perf.long.length = 0; window.__perf.frames.length = 0;
    const sc = document.querySelector('[data-ui="timeline-scroll"]');
    const r = sc.getBoundingClientRect();
    const cands = [...document.querySelectorAll('[role="button"]')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 40 && b.height > 6 && b.x > r.x + 200 && b.y > r.y && b.y < r.y + r.height;
    });
    const el = cands[Math.min(i, cands.length - 1)];
    if (!el) return { ok: false };
    const t0 = performance.now();
    el.click();
    return new Promise((resolve) => {
      const find = () => [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'fixed' && d.getBoundingClientRect().width > 600 && d.querySelector('[data-ui="trip-history"]'));
      const dl = performance.now() + 8000;
      const poll = () => {
        const card = find();
        if (card || performance.now() > dl) {
          const tCard = card ? Math.round(performance.now() - t0) : null;
          setTimeout(() => {
            const f = window.__perf.frames.slice();
            const s = [...f].sort((a, b) => b - a);
            const long = window.__perf.long.slice();
            resolve({ ok: !!card, tCard, longCount: long.length, longTotal: long.reduce((a, x) => a + x.dur, 0), longMax: Math.max(0, ...long.map((x) => x.dur)), worst: s.slice(0, 3), frames: f.length, longTop: long.map((x) => x.dur) });
          }, 1600);
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    });
  }, index);
  return res;
};

const closeCard = async () => {
  await page.keyboard.press('Escape');
  await sleep(400);
  let closed = !(await page.evaluate(() => !!document.querySelector('[data-ui="trip-history"]')));
  if (!closed) {
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).position === 'fixed' && d.getBoundingClientRect().width > 600 && d.querySelector('[data-ui="trip-history"]'));
      const btn = card ? [...card.querySelectorAll('button')].find((b) => /закрыть/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || '')) : null;
      if (btn) btn.click();
    });
    await sleep(400);
    closed = !(await page.evaluate(() => !!document.querySelector('[data-ui="trip-history"]')));
  }
  return closed;
};

console.log('=== открытие окна рейса ===');
const first = await openTrip(1);
check('окно открылось (первое)', first.ok, `до появления окна: ${first.tCard} мс`);
check('первое открытие: нет фриза > 1000 мс', first.longMax < 1000, `самая длинная задача: ${first.longMax} мс (суммарно ${first.longTotal}, задач ${first.longCount})`);
console.log('    провалы кадров:', first.worst?.join(', '), '| кадров:', first.frames);
const closed1 = await closeCard();
check('окно закрывается по Escape', closed1, String(closed1));

const second = await openTrip(3);
check('окно открылось (тёплое)', second.ok, `до появления окна: ${second.tCard} мс`);
check('тёплое открытие: нет фриза > 600 мс', second.longMax < 600, `самая длинная задача: ${second.longMax} мс (суммарно ${second.longTotal})`);
console.log('    провалы кадров:', second.worst?.join(', '), '| кадров:', second.frames);

// --- подсказки городов в открытом окне ---
const cityInput = page.locator('[data-ui="city-input"]').first();
const inputs = await page.locator('[data-ui="city-input"]').count();
check('поля города в окне есть', inputs > 0, `полей: ${inputs}`);
if (inputs > 0) {
  const t0 = Date.now();
  await cityInput.click();
  await page.waitForSelector('[data-ui="city-suggestion"]', { timeout: 8000 }).catch(() => {});
  const tDrop = Date.now() - t0;
  const count = await page.locator('[data-ui="city-suggestion"]').count();
  check('список подсказок открывается по фокусу', count > 0, `подсказок: ${count}, за ${tDrop} мс (пустое поле, полный список по рангу)`);
  const names = await page.locator('[data-ui="city-suggestion"]').allInnerTexts();
  console.log('    первые подсказки:', names.slice(0, 3).map((s) => s.split('\n')[0]).join(' | '));
  // живой поиск: «минс» → Минск
  await cityInput.fill('');
  await cityInput.pressSequentially('минс', { delay: 90 });
  await sleep(400);
  const searchNames = await page.locator('[data-ui="city-suggestion"]').allInnerTexts();
  const hasMinsk = searchNames.some((s) => s.includes('Минск'));
  check('живой поиск находит Минск по «минс»', hasMinsk, `подсказок: ${searchNames.length}, первые: ${searchNames.slice(0, 3).map((s) => s.split('\n')[0]).join(' | ')}`);
  // выбор подсказки подставляет значение в поле
  const target = page.locator('[data-ui="city-suggestion"]', { hasText: 'Минск' }).first();
  if (await target.count()) {
    await target.click();
    await sleep(300);
    const val = await cityInput.inputValue();
    check('выбор подсказки подставляет название', /Минск/.test(val), `значение поля: «${val}»`);
  } else {
    check('выбор подсказки подставляет название', false, 'подсказки с Минском нет');
  }
  await cityInput.fill('');
  await cityInput.pressSequentially('Алашанькоу', { delay: 40 });
  await sleep(500);
  const translitNames = await page.locator('[data-ui="city-suggestion"]').allInnerTexts();
  check('транслит-терпимость жива (Алашанькоу)', translitNames.length > 0, `подсказок: ${translitNames.length}, первые: ${translitNames.slice(0, 2).map((s) => s.split('\n')[0]).join(' | ')}`);
  await page.screenshot({ path: `${OUT}/card-city.png` });
}
check('ошибок JS нет', errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : '0');
console.log(`\nИТОГО: ${checks.filter((c) => c.ok).length}/${checks.length}`);
fs.writeFileSync(`${OUT}/report-card.json`, JSON.stringify({ first, second, checks, errors }, null, 1));
await browser.close();
if (checks.some((c) => !c.ok)) process.exit(1);
