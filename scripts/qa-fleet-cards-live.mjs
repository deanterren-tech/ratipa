/**
 * qa-fleet-cards-live — ЖИВАЯ проверка (Playwright, ТОЛЬКО ЧТЕНИЕ) результатов
 * миграции карточек автопарка (scripts/migrate-fleet-cards.ts).
 *
 * Проверяет на http://127.0.0.1:3000 (профиль probe-fleet2 из localStorage):
 *  1. модуль «Авто и Водители» открывается, 0 JS-ошибок;
 *  2. дубли-двойники исчезли: поиск по номеру даёт ровно одну карточку
 *     (АК 3186-7, АО 3920-7 и т.п.), починённый AP 8340-7 виден;
 *  3. карточка AP96967 показывает Бархатова, карточка AP96977 — без водителя
 *     и без следов Пешко; у BB40627 нет выдуманной даты рождения;
 *  4. тестовые карточки (ПР 9001-9 и т.п.) в интерфейсе не находятся;
 *  5. поиск по водителю в справочнике не показывает «без В.» / огрызки.
 *
 * Запуск: node scripts/qa-fleet-cards-live.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.PORTAL_URL || 'http://127.0.0.1:3000';
const OUT = '/Users/sergei/.hermes/cache/scratch/fleet-cards/live';
fs.mkdirSync(OUT, { recursive: true });

const profile = {
  uid: 'probe-fleet2', name: 'probe-fleet2', firstName: 'Пробный', lastName: 'Миграция',
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
const cardCount = async () => {
  const t = await bodyText();
  return (t.match(/ДЛЯ БУФЕРА ОБМЕНА/g) || []).length;
};
const dismissBirthPrompt = async () => {
  const later = page.locator('button', { hasText: /^Позже$/ }).first();
  if (await later.count() && await later.isVisible().catch(() => false)) {
    await later.click().catch(() => {});
    await page.waitForTimeout(400);
  }
};
const search = async (q) => {
  const inp = page.locator('input[placeholder*="Поиск по номерам"]').first();
  await inp.fill('');
  await inp.fill(q);
  await page.waitForTimeout(700);
};

// ── 1. открытие модуля ───────────────────────────────────────────────────
await page.goto(`${BASE}/#vehicleDriverData`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await dismissBirthPrompt();
let t = await bodyText();
check('«Авто и Водители» открыт', t.includes('Данные по авто и водителям'), `title=${await page.title()}`);
check('данные автопарка загружены (нет "Загрузка данных автопарка")', !t.includes('Загрузка данных автопарка'));
const total = (t.match(/Реестр автопарка и экипажей \((\d+)\)/) || [])[1];
check('в реестре указано число записей', !!total, `всего: ${total}`);
const fullCards = await cardCount();
check('список карточек отрисован', fullCards > 10, `карточек на странице: ${fullCards}`);
await page.screenshot({ path: `${OUT}/01-list.png` });

// ── 2. дубли исчезли, починённый ключ виден ───────────────────────────────
const oneCard = async (q, mustHaveAny = [], mustNotHave = []) => {
  await search(q);
  const tx = await bodyText();
  const n = await cardCount();
  const missing = mustHaveAny.filter((alts) => !alts.some((v) => tx.includes(v)));
  const found = mustNotHave.filter((m) => tx.includes(m));
  return { n, missing, found, tx };
};
let r = await oneCard('3186', [['AK 3186-7', 'АК 3186-7']], []);
check('поиск «3186» → одна карточка АК 3186-7', r.n === 1 && r.missing.length === 0, `карточек=${r.n}, нет полей=${r.missing.join(',')}`);
r = await oneCard('3920-7', [['AO 3920-7', 'АО 3920-7']]);
check('поиск «3920-7» → одна карточка АО 3920-7', r.n === 1, `карточек=${r.n}`);
r = await oneCard('8340', [['AP 8340-7']]);
check('поиск «8340» → одна починенная карточка AP 8340-7', r.n === 1, `карточек=${r.n}`);
r = await oneCard('9658', [['AH 9658-7', 'АН 9658-7']]);
check('поиск «9658» → одна карточка AH 9658-7', r.n === 1, `карточек=${r.n}`);
r = await oneCard('8806', [['AO 8806-7', 'АО 8806-7']]);
check('поиск «8806» → одна карточка AO 8806-7', r.n === 1, `карточек=${r.n}`);

// ── 3. тестовые карточки не находятся ────────────────────────────────────
r = await oneCard('9001');
check('поиск «9001» (тест ПР 9001-9) → ничего не найдено', r.n === 0, `карточек=${r.n}`);
r = await oneCard('PROBE');
check('поиск «PROBE» → ничего не найдено', r.n === 0, `карточек=${r.n}`);

// ── 4. карточка AP96967 — Бархатов ───────────────────────────────────────
await search('9696');
let tx = await bodyText();
check('поиск «9696» → одна карточка', (await cardCount()) === 1);
check('AP96967 показывает Бархатова', tx.includes('Бархатов Денис Владимирович'), '');
check('AP96967 без Чернявского', !tx.includes('Чернявский'), '');
// открыть карточку в редакторе
const editBtn = page.locator('button', { hasText: 'Редактировать' }).first();
if (await editBtn.count()) await editBtn.click();
await page.waitForTimeout(900);
const dialog = page.locator('[role="dialog"]');
let dlgOpen = (await dialog.count()) > 0;
check('карточка AP96967 открывается в редакторе', dlgOpen);
if (dlgOpen) {
  const nameVal = await page.locator('[data-ui="vdd-driver-name"]').first().inputValue().catch(() => '');
  check('в редакторе AP96967 ФИО = Бархатов', nameVal.includes('Бархатов'), `значение: «${nameVal}»`);
  await page.screenshot({ path: `${OUT}/02-ap96967-modal.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ── 5. карточка AP96977 — без водителя, без Пешко ────────────────────────
await search('9697');
tx = await bodyText();
check('поиск «9697» → одна карточка', (await cardCount()) === 1);
check('AP96977 без Пешко', !tx.includes('Пешко'));
check('AP96977 без «без В.»', !tx.includes('без В'));
check('AP96977 без паспорта KB2676977', !tx.includes('KB2676977'));
const editBtn2 = page.locator('button', { hasText: 'Редактировать' }).first();
if (await editBtn2.count()) await editBtn2.click();
await page.waitForTimeout(900);
dlgOpen = (await page.locator('[role="dialog"]').count()) > 0;
check('карточка AP96977 открывается в редакторе', dlgOpen);
if (dlgOpen) {
  const vals = await page.evaluate(() => {
    const out = {};
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return out;
    dlg.querySelectorAll('input, textarea').forEach((el) => {
      const key = el.getAttribute('data-ui') || el.getAttribute('placeholder') || el.id;
      if (key) out[key] = el.value;
    });
    return out;
  });
  const driverName = vals['vdd-driver-name'] ?? '';
  check('в редакторе AP96977 ФИО водителя пусто', driverName.trim() === '', `значение: «${driverName}»`);
  const joined = JSON.stringify(vals);
  check('в редакторе AP96977 нет данных Пешко', !joined.includes('Пешко') && !joined.includes('KB2676977') && !joined.includes('3310882M027PB0'));
  await page.screenshot({ path: `${OUT}/03-ap96977-modal.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ── 6. BB40627 без искажённой даты рождения ──────────────────────────────
await search('4062');
tx = await bodyText();
check('поиск «4062» → одна карточка (BB 4062-7)', (await cardCount()) === 1);
check('BB40627 без даты «10.07.2026»', !tx.includes('10.07.2026'));

// ── 7. справочник водителей: нет «без В.» и огрызков ─────────────────────
await page.goto(`${BASE}/#appSettings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await dismissBirthPrompt();
t = await bodyText();
check('«Справочники» открыты', t.includes('Справочники') && !t.includes('Страница не найдена'), t.slice(0, 120).replace(/\n/g, ' '));
// шаг «База водителей» внутри справочников
const driverNav = page.locator('button, [role="tab"], a').filter({ hasText: /База водителей|Водител/ }).first();
if (await driverNav.count()) { await driverNav.click().catch(() => {}); await page.waitForTimeout(1500); }
t = await bodyText();
check('в справочнике нет «без В.»', !t.includes('без В'));
check('в справочнике нет огрызков «Шерамет»/«Калинин» одной фамилией', !/«Шерамет»|«Калинин»/.test(t));
check('в базе водителей есть Бархатов', t.includes('Бархатов'), '');
await page.screenshot({ path: `${OUT}/04-directories.png` });

// ── 8. JS-ошибки ─────────────────────────────────────────────────────────
check('нет JS-ошибок за прогон', errs.length === 0, errs.slice(0, 3).join(' | '));

const report = { when: new Date().toISOString(), base: BASE, checks, errs, total, fullCards };
fs.writeFileSync(`${OUT}/live-report.json`, JSON.stringify(report, null, 2), 'utf8');
console.log(`\nИтог: PASS ${checks.filter((c) => c.ok).length}/${checks.length}; JS-ошибок: ${errs.length}`);
console.log(`Отчёт: ${OUT}/live-report.json`);
await browser.close();
