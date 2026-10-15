/**
 * qa-fleet-cards-live3 — ЖИВАЯ проверка (Playwright, ТОЛЬКО ЧТЕНИЕ) результатов
 * фазы 3 миграции «приводим к общему» (scripts/migrate-fleet-cards.ts --phase3).
 *
 * Проверяет на http://127.0.0.1:3000 (профиль probe-mig3 из localStorage):
 *  1. «Справочники → Автопарк и Водители» открывается, таблица сцепок отрисована, 0 JS-ошибок;
 *  2. по номерам AC02497 / AC33927 / X229TE31 / O271XE31 / AO88077 / AC54487 —
 *     ровно по одной строке-карточке, прицеп / марки / водитель / диспетчер на месте;
 *  3. неканоничные ключи (AS5448…, 1787136789859) в списке не находятся;
 *  4. строка AC54487 открывает карточку авто (мягкая проверка).
 *
 * Запуск: node scripts/qa-fleet-cards-live3.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.PORTAL_URL || 'http://127.0.0.1:3000';
const OUT = '/Users/sergei/.hermes/cache/scratch/fleet-cards/live3';
fs.mkdirSync(OUT, { recursive: true });

const profile = {
  uid: 'probe-mig3', name: 'probe-mig3', firstName: 'Пробный', lastName: 'Миграция3',
  role: 'root_admin', permissions: { directories: 'write' }, onboarding: { '2_0_0': 'done' },
};
const init = `try { localStorage.setItem('ratipa_user_session', ${JSON.stringify(JSON.stringify(profile))}); } catch (e) {}`;

const checks = [];
const check = (name, ok, info = '') => {
  checks.push({ name, ok: !!ok, info: String(info).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${info !== '' ? ` :: ${String(info).slice(0, 200)}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(init);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 240)); });

const bodyText = () => page.evaluate(() => document.body.innerText);
const dismissBirthPrompt = async () => {
  const later = page.locator('button', { hasText: /^Позже$/ }).first();
  if (await later.count() && await later.isVisible().catch(() => false)) {
    await later.click().catch(() => {});
    await page.waitForTimeout(400);
  }
};
const rows = () => page.locator('tbody tr[data-nav-item]');
const search = async (q) => {
  const inp = page.locator('input[placeholder*="Поиск по тягачу"]').first();
  await inp.fill('');
  await inp.fill(q);
  await page.waitForTimeout(600);
};

// ── 1. открытие «Справочники → Автопарк и Водители» ─────────────────────
await page.goto(`${BASE}/#appSettings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await dismissBirthPrompt();
let t = await bodyText();
check('«Справочники» открыты', t.includes('Справочники') && !t.includes('Страница не найдена'), `title=${await page.title()}`);
check('вкладка «Автопарк и Водители» активна', t.includes('Автопарк и Водители'));
const totalRows = await rows().count();
check('таблица сцепок отрисована', totalRows > 10, `строк на странице: ${totalRows}`);
await page.screenshot({ path: `${OUT}/01-fleet-tab.png` });

// ── 2. шесть машин — ровно по одной строке, поля на месте ────────────────
const vehicles = [
  { q: '0249', plateDigits: '0249', driver: 'Высоцкий', dispatcher: 'Матвей Солодкий', trailerDigits: '1632', brand: 'mercedes' },
  { q: '3392', plateDigits: '3392', driver: 'Гавриш', dispatcher: 'Матвей Солодкий', trailerDigits: '3957', brand: 'kogel' },
  { q: '229TE31', plateDigits: '229', driver: 'Врублевский', dispatcher: 'Юрий Токарев', trailerDigits: '832931', brand: 'kazberer' },
  { q: '271XE31', plateDigits: '271', driver: 'Сафонов', dispatcher: 'Юрий Токарев', trailerDigits: '923731', brand: 'koegel' },
  { q: '8807', plateDigits: '8807', driver: 'Калинин', dispatcher: 'Виталий Козловский', trailerDigits: '1086', brand: 'schwarzmuller' },
  { q: '5448', plateDigits: '5448', driver: 'Турсунов', dispatcher: 'Виталий Козловский', trailerDigits: '3911', brand: 'koegel' },
];
for (const v of vehicles) {
  await search(v.q);
  const n = await rows().count();
  const texts = (await rows().allInnerTexts()).join(' ¶ ');
  const low = texts.toLowerCase();
  const parts = {
    row: n === 1,
    driver: low.includes(v.driver.toLowerCase()),
    dispatcher: low.includes(v.dispatcher.toLowerCase()),
    trailer: low.includes(v.trailerDigits),
    brand: low.includes(v.brand),
    plate: low.includes(v.plateDigits),
  };
  const bad = Object.entries(parts).filter(([, ok]) => !ok).map(([k]) => k);
  check(`«${v.q}» → ровно одна карточка (${v.plateDigits})`, n === 1, `строк=${n}`);
  check(`«${v.q}»: водитель/диспетчер/прицеп/марка на месте`, bad.length === 0, `нет: ${bad.join(',') || '—'} | текст: ${texts.slice(0, 150)}`);
}

// ── 3. неканоничные ключи не находятся ───────────────────────────────────
for (const q of ['AS5448', '1787136789859', 'rec_1787']) {
  await search(q);
  const n = await rows().count();
  check(`неканоничное «${q}» в списке не найдено`, n === 0, `строк=${n}`);
}

// ── 4. строка AC54487 открывает карточку (мягкая проверка) ───────────────
await search('5448');
await rows().first().click().catch(() => {});
await page.waitForTimeout(1200);
t = await bodyText();
const cardOpen = t.includes('Турсунов') && t.includes('5448');
check('карточка AC54487 открывается и содержит водителя', cardOpen, t.slice(0, 120).replace(/\n/g, ' '));
await page.screenshot({ path: `${OUT}/02-ac54487-card.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ── 5. JS-ошибки ─────────────────────────────────────────────────────────
check('нет JS-ошибок за прогон', errs.length === 0, errs.slice(0, 3).join(' | '));

const report = { when: new Date().toISOString(), base: BASE, profile: profile.uid, checks, errs, totalRows };
fs.writeFileSync(`${OUT}/live-report.json`, JSON.stringify(report, null, 2), 'utf8');
console.log(`\nИтог: PASS ${checks.filter((c) => c.ok).length}/${checks.length}; JS-ошибок: ${errs.length}`);
console.log(`Отчёт: ${OUT}/live-report.json`);
await browser.close();
