/**
 * qa-branches-smoke-live — живой smoke после чистки веток (только чтение):
 * «Справочники», «Авто и Водители», «Пробег и связь», «Учет Дозволов».
 * Проверяет: модуль открылся, данные подгрузились, 0 JS-ошибок.
 *
 * Запуск: node scripts/qa-branches-smoke-live.mjs
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
const check = (name, ok, info = '') => { checks.push({ name, ok: !!ok, info: String(info).slice(0, 240) }); console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${info ? ` :: ${String(info).slice(0, 160)}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(init);
const page = await ctx.newPage();
let errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)); });
const bodyText = () => page.evaluate(() => document.body.innerText);
const dismissBirthPrompt = async () => {
  const later = page.locator('button', { hasText: /^Позже$/ }).first();
  if (await later.count() && await later.isVisible().catch(() => false)) { await later.click().catch(() => {}); await page.waitForTimeout(300); }
};

const modules = [
  { hash: 'vehicleDriverData', name: 'Авто и Водители', markers: [/Реестр автопарка и экипажей \((\d+)\)/], min: 40 },
  { hash: 'appSettings', name: 'Справочники', markers: [/Справочник|Настройки|Групп/i], min: 100 },
  { hash: 'mileageComms', name: 'Пробег и связь', markers: [/Пробег и связь|CAN|обновлен/i], min: 100 },
  { hash: 'dozvola', name: 'Учет Дозволов', markers: [/[Дд]озвол|Реестр|пермит/i], min: 100 },
];

for (const m of modules) {
  errs = [];
  await page.goto(`${BASE}/#${m.hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  await dismissBirthPrompt();
  await page.waitForTimeout(1000);
  const t = await bodyText();
  const markerOk = m.markers.some((re) => re.test(t));
  const errPage = t.includes('Страница не найдена') || t.includes('Ошибка приложения');
  check(`${m.name}: модуль открылся`, t.length > m.min && !errPage, `len=${t.length}`);
  check(`${m.name}: данные на месте`, markerOk, '');
  check(`${m.name}: 0 JS-ошибок`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${OUT}/smoke-${m.hash}.png` });
}

const report = { when: new Date().toISOString(), base: BASE, checks };
fs.writeFileSync(`${OUT}/smoke-report.json`, JSON.stringify(report, null, 2), 'utf8');
console.log(`\nИтог: PASS ${checks.filter((c) => c.ok).length}/${checks.length}`);
console.log(`Отчёт: ${OUT}/smoke-report.json`);
await browser.close();
