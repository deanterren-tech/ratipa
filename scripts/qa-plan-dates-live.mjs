/**
 * qa-plan-dates-live — ЖИВАЯ проверка синхронизации плановых дат (Playwright,
 * локальный портал http://127.0.0.1:3000). Вспомогательный dev-харнесс задания
 * «синхронизация дат» (часть 3); в прод-сборку не входит.
 *
 * Проверяет на пробных записях (префикс probe-, удаляются в конце):
 *  1. окно рейса: правка плановых дат связанного рейса уходит в trips_dashboard/
 *     <planId>/dateStart|dateEnd (одна запись), легаси-оверрайд tripMeta очищается;
 *  2. изменение дат через pdService.updateTrip (тот же сервис, что у «Плана
 *     дохода») сразу видно в таймлайне и согласовано после F5;
 *  3. смена кругов не сбрасывает даты; даты не сбрасывают машину/заметку;
 *  4. фактические даты (факт этапов) и ветка baza не меняются;
 *  5. перетаскивание полосы: допустимое сохраняется в запись плана;
 *     конфликтующее — блокируется проверкой периодов (toast, полоса на месте);
 *  6. повторная синхронизация не создаёт дубликаты (счётчики до/после).
 *
 * Запуск: node scripts/qa-plan-dates-live.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';

const OUT = '/Users/sergei/.hermes/cache/scratch/qa-plan-dates';
fs.mkdirSync(OUT, { recursive: true });
const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';
const P1 = 'probe-plandates-1';
const P2 = 'probe-plandates-2';
const KEY1 = `pd:${P1}`;

const profile = {
  uid: 'probe-user',
  name: 'probe-user',
  firstName: 'Пробный',
  lastName: 'Проверка',
  role: 'root_admin',
  permissions: { tripTimeline: 'write', planDohod: 'write' },
  onboarding: { '2_0_0': 'done' },
  tlGuide: { version: '1.3.0' },
};
const init = `try {
  localStorage.setItem('ratipa_user_session', ${JSON.stringify(JSON.stringify(profile))});
  localStorage.setItem('pl_dohod_announce_probe-user', '1');
  localStorage.setItem('ratipa_tlguide_1.3.0_probe-user', '1');
} catch (e) {}`;

const restGet = async (p) => (await fetch(`${DB}/${p}.json`)).json();
const restHash = async (p) => crypto.createHash('md5').update(await (await fetch(`${DB}/${p}.json`)).text()).digest('hex');
/** Хэш ветки без пробных записей (соседний агент параллельно добавляет/убирает свои
 *  probe-* записи — сравнение «реальных» записей не должно зависеть от их churn). */
const restHashReal = async (p) => {
  const all = (await restGet(p)) || {};
  const filtered = Object.fromEntries(Object.entries(all).filter(([k]) => !/probe/i.test(k)));
  return crypto.createHash('md5').update(JSON.stringify(filtered)).digest('hex');
};

const checks = [];
const check = (name, cond, info = '') => {
  checks.push({ name, ok: !!cond, info });
  console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name}${info !== '' ? ` :: ${String(info).slice(0, 220)}` : ''}`);
};
/** Какие поля записи отличаются (для точечности правок). */
const diffKeys = (a, b) => Object.keys({ ...(a || {}), ...(b || {}) }).filter((k) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null));
const log = (...a) => console.log(...a);

const toasts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-ui="toast"]')).map((t) => t.innerText.trim()));
const waitToast = async (page, re, timeout = 9000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const list = await toasts(page);
    const hit = list.find((t) => re.test(t));
    if (hit) return hit;
    await page.waitForTimeout(250);
  }
  return null;
};
/** Опорный день измерения (16/10/2026): позиция полосы считается ОТ ячейки дня,
 *  поэтому не зависит от горизонтальной прокрутки полотна и F5. */
const REF_DAY = Math.round(Date.UTC(2026, 9, 16) / 86400000);
const barRect = (page, tripKey) =>
  page.evaluate(
    ({ key, ref }) => {
      const el = document.querySelector(`[data-bar="plan"][data-trip="${key}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const cell = document.querySelector(`[data-day="${ref}"]`) || document.querySelector('[data-day]');
      const refLeft = cell ? cell.getBoundingClientRect().left : 0;
      const b = el.getBoundingClientRect();
      return { rel: Math.round(b.left - refLeft), left: Math.round(b.left), width: Math.round(b.width), drag: el.getAttribute('data-plan-drag') };
    },
    { key: tripKey, ref: REF_DAY },
  );
/** Открыть окно рейса: клик по полосе ВНЕ заливок этапов (45px от левого края). */
const openWindow = async (page) => {
  await page.locator(`[data-bar="plan"][data-trip="${KEY1}"]`).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(`[data-bar="plan"][data-trip="${KEY1}"]`).first().click({ position: { x: 45, y: 8 } });
  await page.waitForTimeout(1600);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(init);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200));
});

// ── Pre-состояние ────────────────────────────────────────────────────────
// ── SETUP: канонические пробные записи (идемпотентно, только probe-) ─────
const put = async (p, body) => fetch(`${DB}/${p}.json`, { method: 'PUT', body: JSON.stringify(body) });
await put(`trips_dashboard/${P1}`, { carNumber: 'PROBE 0001', tripNote: 'Пробный рейс синхронизации дат', dateStart: '2026-10-16', dateEnd: '2026-10-25', days: 10, logist: 'probe-user', isArchived: false, createdFrom: 'timeline', dispatcherId: 'probe-d1', dispatcherName: 'Пробный Диспетчер', driverName: 'Пробный Водитель', vehicleId: 'probe-vehicle' });
await put(`trips_dashboard/${P2}`, { carNumber: 'PROBE 0001', tripNote: 'Пробный второй рейс', dateStart: '2026-10-28', dateEnd: '2026-10-31', days: 4, logist: 'probe-user', isArchived: false, createdFrom: 'timeline' });
await put(`tripTimeline/tripStages/${P1}`, {
  s1: { id: 's1', type: 'load', label: '', plannedDate: '2026-10-17', actualDate: '2026-10-17', isCritical: false, order: 0, seq: 1 },
  s2: { id: 's2', type: 'unload', label: '', plannedDate: '2026-10-23', actualDate: '', isCritical: false, order: 1, seq: 2 },
});
await put(`tripTimeline/tripMeta/${KEY1}`, { planStart: '2026-10-15', planEnd: '2026-10-24', comment: 'пробный текст' });
await fetch(`${DB}/tripTimeline/tripHistory/${KEY1}.json`, { method: 'DELETE' });
await new Promise((r) => setTimeout(r, 500));

const preCounts = {
  trips: Object.keys((await restGet('trips_dashboard')) || {}).length,
  stages: Object.keys((await restGet('tripTimeline/tripStages')) || {}).length,
  meta: Object.keys((await restGet('tripTimeline/tripMeta')) || {}).length,
  tlTrips: Object.keys((await restGet('tripTimeline/trips')) || {}).length,
  history: Object.keys((await restGet('tripTimeline/tripHistory')) || {}).length,
  bazaHash: await restHashReal('baza'),
};
const probePresence = {
  p1: !!(await restGet(`trips_dashboard/${P1}`)),
  p2: !!(await restGet(`trips_dashboard/${P2}`)),
  stages: !!(await restGet(`tripTimeline/tripStages/${P1}`)),
  meta: !!(await restGet(`tripTimeline/tripMeta/${KEY1}`)),
};
log('PRE:', JSON.stringify(preCounts), JSON.stringify(probePresence));

await page.goto('http://127.0.0.1:3000/#tripTimeline', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const colW = await page.evaluate(() => Math.round(document.querySelector('[data-day]').getBoundingClientRect().width));
check('портал открылся, полосы пробных рейсов на полотне', (await barRect(page, KEY1)) != null && (await barRect(page, `pd:${P2}`)) != null, `colW=${colW}`);
const rect0 = await barRect(page, KEY1);
check('полоса связанного рейса помечена как перетаскиваемая (data-plan-drag=1)', rect0?.drag === '1', JSON.stringify(rect0));
await page.screenshot({ path: `${OUT}/01-timeline-before.png` });

// ── 1. Окно рейса: правка плановых дат → запись плана ───────────────────
await openWindow(page);
const valuesOf = () =>
  page.evaluate(() => ({
    start: document.querySelector('input[aria-label="Плановый старт рейса"]')?.value || '',
    end: document.querySelector('input[aria-label="Плановое возвращение рейса"]')?.value || '',
  }));
const v0 = await valuesOf();
check('окно показывает даты из ЕДИНОЙ записи (легаси-оверрайд tripMeta 15..24 отображается)', v0.start === '15/10/2026' && v0.end === '24/10/2026', JSON.stringify(v0));
await page.screenshot({ path: `${OUT}/02-window-open.png` });

await page.locator('input[aria-label="Плановый старт рейса"]').fill('17/10/2026');
await page.locator('input[aria-label="Плановое возвращение рейса"]').fill('27/10/2026');
await page.locator('[data-ui="trip-save"]').click();
const toast1 = await waitToast(page, /Плановые даты обновлены в плане дохода/);
check('успех подтверждён сообщением «Плановые даты обновлены в плане дохода»', !!toast1, toast1);
await page.waitForTimeout(1200);

const rec1 = await restGet(`trips_dashboard/${P1}`);
check('даты записались в trips_dashboard/<planId>/dateStart|dateEnd', rec1.dateStart === '2026-10-17' && rec1.dateEnd === '2026-10-27', JSON.stringify({ dS: rec1.dateStart, dE: rec1.dateEnd }));
{
  const keep = { carNumber: 'PROBE 0001', tripNote: 'Пробный рейс синхронизации дат', dispatcherId: 'probe-d1', dispatcherName: 'Пробный Диспетчер', driverName: 'Пробный Водитель', vehicleId: 'probe-vehicle', logist: 'probe-user' };
  const bad = Object.entries(keep).filter(([k, v]) => rec1[k] !== v).map(([k]) => k);
  check('правка дат из окна НЕ сбросила диспетчера/водителя/машину/заметку (точечные пути)', bad.length === 0, JSON.stringify({ bad, dispatcherName: rec1.dispatcherName, driverName: rec1.driverName }));
}
check('дни пересчитаны (17→27 включительно = 11)', rec1.days === 11, rec1.days);
const meta1 = await restGet(`tripTimeline/tripMeta/${KEY1}`);
check('легаси-оверрайд tripMeta очищен (planStart/planEnd удалены)', meta1 && meta1.planStart === undefined && meta1.planEnd === undefined, JSON.stringify(meta1));
check('текст tripMeta (comment) не потерян', meta1?.comment === 'пробный текст', JSON.stringify(meta1));
const tlTripsNow = Object.keys((await restGet('tripTimeline/trips')) || {}).length;
check('копия в tripTimeline/trips НЕ создана (второй записи дат нет)', tlTripsNow === preCounts.tlTrips, `tlTrips=${tlTripsNow}`);
const rect1 = await barRect(page, KEY1);
check('полоса в таймлайне сразу перестроилась по новой записи (+2 дня старт, +1 день длина)', rect1.rel - rect0.rel === 2 * colW && rect1.width - rect0.width === colW, JSON.stringify({ rect0, rect1 }));
await page.screenshot({ path: `${OUT}/03-after-window-save.png` });

// ── 2. «План дохода» (реальная форма записи) → таймлайн, затем F5 ────────
await page.goto('http://127.0.0.1:3000/#planDohod/trip/probe-plandates-1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const pdDlg = page.locator('div.fixed.inset-0').first();
const pdDatesIn = pdDlg.locator('input[type="date"]');
const pdVals = [await pdDatesIn.nth(0).inputValue(), await pdDatesIn.nth(1).inputValue()];
check('форма «Плана дохода» открыла ТУ ЖЕ запись (даты из неё: 17..27)', pdVals[0] === '2026-10-17' && pdVals[1] === '2026-10-27', JSON.stringify(pdVals));
await pdDatesIn.nth(0).fill('2026-10-18');
await pdDatesIn.nth(1).fill('2026-10-28');
await pdDlg.locator('button', { hasText: 'Сохранить' }).first().click();
let rec2 = null;
for (let i = 0; i < 30; i += 1) {
  rec2 = await restGet(`trips_dashboard/${P1}`);
  if (rec2?.dateStart === '2026-10-18' && rec2?.dateEnd === '2026-10-28') break;
  await page.waitForTimeout(400);
}
check('правка дат в форме «Плана дохода» записалась в запись плана', rec2?.dateStart === '2026-10-18' && rec2?.dateEnd === '2026-10-28', JSON.stringify({ dS: rec2?.dateStart, dE: rec2?.dateEnd }));
log(`INFO :: поля, изменённые сохранением формы «Плана дохода» (её собственные правила): ${JSON.stringify(diffKeys(rec1, rec2))}`);
await page.screenshot({ path: `${OUT}/04a-pd-form-edited.png` });

await page.goto('http://127.0.0.1:3000/#tripTimeline', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const rect2a = await barRect(page, KEY1);
check('таймлайн показывает даты, изменённые в «Плане дохода» (+1 день старт, та же длина)', rect2a.rel - rect1.rel === colW && rect2a.width === rect1.width, JSON.stringify({ rect1, rect2a }));
await page.screenshot({ path: `${OUT}/04b-timeline-after-pd-form.png` });

// 2b. Тот же сервис модуля (pdService.updateTrip) — живое обновление без перезагрузки.
const pdRes = await page.evaluate(async () => {
  const mod = await import('/src/api/index.ts');
  await mod.pdService.updateTrip('probe-plandates-1', { carNumber: 'PROBE 0001', dateStart: '2026-10-19', dateEnd: '2026-10-28', days: 10 }, 'probe-user', 'root_admin');
  return 'ok';
});
check('запись обновлена сервисом «Плана дохода» (pdService.updateTrip)', pdRes === 'ok');
await page.waitForTimeout(2500);
const rec2b = await restGet(`trips_dashboard/${P1}`);
check('запись плана: новые даты 19..28', rec2b.dateStart === '2026-10-19' && rec2b.dateEnd === '2026-10-28', JSON.stringify({ dS: rec2b.dateStart, dE: rec2b.dateEnd }));
const rect2 = await barRect(page, KEY1);
check('таймлайн ПОКАЗАЛ изменение сразу (без перезагрузки): +1 день старт, −1 день длина', rect2.rel - rect2a.rel === colW && rect2.width === rect2a.width - colW, JSON.stringify({ rect2a, rect2 }));
await page.screenshot({ path: `${OUT}/05-after-pd-service.png` });

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const rect2f = await barRect(page, KEY1);
check('после F5 полоса та же (согласовано с записью)', rect2f.rel === rect2.rel && rect2f.width === rect2.width, JSON.stringify({ rect2, rect2f }));
await openWindow(page);
const v2 = await valuesOf();
check('после F5 окно рейса показывает те же даты из записи', v2.start === '19/10/2026' && v2.end === '28/10/2026', JSON.stringify(v2));
await page.screenshot({ path: `${OUT}/05-after-reload-window.png` });

// ── 3. Круги/направление не сбрасывают даты; даты не трогают экипаж/заметку ─
const after3before = await restGet(`trips_dashboard/${P1}`);
await page.locator('[data-ui="circles-inc"]').click();
await page.waitForTimeout(300);
const dirOption = page.locator('[data-ui="direction-toggle"] [role="radio"]').first();
const dirName = (await dirOption.count()) ? ((await dirOption.innerText()).trim() || 'вариант') : '';
if (dirName) await dirOption.click();
await page.waitForTimeout(300);
await page.locator('[data-ui="trip-save"]').click();
const toast3 = await waitToast(page, /Рейс сохранён/);
check('сохранение кругов/направления подтверждено сообщением', !!toast3, toast3);
await page.waitForTimeout(1200);
const after3 = await restGet(`trips_dashboard/${P1}`);
check('круги записались (2)', after3.circles === 2, after3.circles);
if (dirName) check('направление записано в ту же запись', !!after3.direction && after3.direction !== after3before.direction, `${after3before.direction} → ${after3.direction}`);
check('круги/направление НЕ сбросили даты (19..28 на месте)', after3.dateStart === '2026-10-19' && after3.dateEnd === '2026-10-28', JSON.stringify({ dS: after3.dateStart, dE: after3.dateEnd }));
const sameField = (k) => JSON.stringify(after3[k] ?? null) === JSON.stringify(after3before[k] ?? null);
check(
  'точечная запись: диспетчер/водитель/машина/заметка/круги-поле не переписаны',
  ['carNumber', 'tripNote', 'dispatcherId', 'dispatcherName', 'driverName', 'vehicleId', 'logist', 'createdFrom'].every(sameField) &&
    after3.dateStart === after3before.dateStart &&
    after3.dateEnd === after3before.dateEnd &&
    after3.days === after3before.days,
  JSON.stringify({ carNumber: after3.carNumber, dispatcherName: after3.dispatcherName, driverName: after3.driverName, tripNote: after3.tripNote }),
);
const metaAfter3 = await restGet(`tripTimeline/tripMeta/${KEY1}`);
check('после всех правок дат в tripMeta нет planStart/planEnd (второго значения нет)', !metaAfter3 || (metaAfter3.planStart === undefined && metaAfter3.planEnd === undefined), JSON.stringify(metaAfter3));

// ── 4. Факт неприкосновенен ──────────────────────────────────────────────
const stages = await restGet(`tripTimeline/tripStages/${P1}`);
check('фактические даты этапов не тронуты (s1 факт 17/10, s2 факт пуст)', stages.s1.actualDate === '2026-10-17' && stages.s2.actualDate === '', JSON.stringify({ s1: stages.s1.actualDate, s2: stages.s2.actualDate }));
check('плановые даты этапов не тронуты (17/10 и 23/10)', stages.s1.plannedDate === '2026-10-17' && stages.s2.plannedDate === '2026-10-23');
const bazaHashNow = await restHashReal('baza');
check('«Учёт выезда» (baza, без probe-* записей соседнего агента) не изменён ни одной операцией дат', bazaHashNow === preCounts.bazaHash, `${bazaHashNow} (полный md5=${await restHash('baza')})`);

// ── 5. Перетаскивание: допустимое сохраняется ────────────────────────────
const dragBy = async (dxPx, edge) => {
  await page.locator(`[data-bar="plan"][data-trip="${KEY1}"]`).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const r = await page.evaluate((key) => {
    const b = document.querySelector(`[data-bar="plan"][data-trip="${key}"]`).getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, KEY1);
  const cy = r.y + r.h / 2;
  // Точка захвата «переноса» — 0.7 ширины: вне заливок этапов (17/10 и 23/10).
  const cx = edge === 'right' ? r.x + r.w - 3 : r.x + Math.round(r.w * 0.7);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dxPx, cy, { steps: 14 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(1600);
};
const recBeforeDrag = await restGet(`trips_dashboard/${P1}`);
await dragBy(-2 * colW, null);
const t5 = await waitToast(page, /Плановые даты обновлены в записи «Плана дохода»/, 6000);
check('допустимое перетаскивание сохранено (сообщение об успехе)', !!t5, t5);
const rec5 = await restGet(`trips_dashboard/${P1}`);
check('перетаскивание записало НОВЫЕ даты в запись плана (19..28 → 17..26)', rec5.dateStart === '2026-10-17' && rec5.dateEnd === '2026-10-26', JSON.stringify({ dS: rec5.dateStart, dE: rec5.dateEnd }));
check(
  'перетаскивание точечно: изменены ТОЛЬКО даты записи и служебные поля (не диспетчер/водитель/машина/заметка)',
  diffKeys(recBeforeDrag, rec5).every((k) => ['dateStart', 'dateEnd', 'days', 'updatedAt', 'updatedBy'].includes(k)),
  JSON.stringify({ diff: diffKeys(recBeforeDrag, rec5), driverName: rec5.driverName, vehicleId: rec5.vehicleId }),
);
const rect5 = await barRect(page, KEY1);
check('полоса встала по новым датам', rect5.rel === rect2.rel - 2 * colW && rect5.width === rect2.width, JSON.stringify({ rect2, rect5 }));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/06-after-allowed-drag.png` });

// ── 6. Перетаскивание: конфликт блокируется проверкой периодов ───────────
await dragBy(+4 * colW, 'right');
const t6 = await waitToast(page, /занята|пересекается|нельзя/i, 8000);
check('конфликтующее перетаскивание отбито — человек видит причину', !!t6, t6);
check('сообщение называет машину и период', /PROBE\s?0001/.test(t6 || '') && /28\/10\/2026/.test(t6 || ''), t6);
const rec6 = await restGet(`trips_dashboard/${P1}`);
check('запись НЕ изменена конфликтующим перетаскиванием', rec6.dateStart === '2026-10-17' && rec6.dateEnd === '2026-10-26', JSON.stringify({ dS: rec6.dateStart, dE: rec6.dateEnd }));
const rect6 = await barRect(page, KEY1);
check('полоса вернулась на место (та же геометрия)', rect6.rel === rect5.rel && rect6.width === rect5.width, JSON.stringify({ rect5, rect6 }));
const ghost = await page.evaluate(() => !!document.querySelector('[data-ui="tl-plan-drag-ghost"]'));
check('призрак перетаскивания убран', ghost === false);
await page.screenshot({ path: `${OUT}/07-conflict-drag-rejected.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ── 7. Итог: дубликаты/счётчики, согласованность после F5 ────────────────
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const rect7 = await barRect(page, KEY1);
check('после F5 полоса совпадает с записью (17..26)', rect7.rel === rect5.rel && rect7.width === rect5.width, JSON.stringify({ rect5, rect7 }));
const p2rec = await restGet(`trips_dashboard/${P2}`);
check('соседний рейс не тронут (28..31)', p2rec.dateStart === '2026-10-28' && p2rec.dateEnd === '2026-10-31');
const probeKeys = async () => ({
  trips: Object.keys((await restGet('trips_dashboard')) || {}).filter((k) => k.startsWith('probe-plandates')).length,
  stages: Object.keys((await restGet('tripTimeline/tripStages')) || {}).filter((k) => k.startsWith('probe-plandates')).length,
  meta: Object.keys((await restGet('tripTimeline/tripMeta')) || {}).filter((k) => k.includes('probe-plandates')).length,
});
const postProbe = await probeKeys();
check(
  'повторные синхронизации не создали дубликатов: моих пробных записей ровно 2 (рейс/второй) и 1 этап/1 meta',
  postProbe.trips === 2 && postProbe.stages === 1 && postProbe.meta === 1,
  JSON.stringify(postProbe),
);
const barNodes = await page.evaluate((key) => document.querySelectorAll(`[data-bar="plan"][data-trip="${key}"]`).length, KEY1);
check('на полотне ровно одна полоса этого рейса (без копий)', barNodes === 1, barNodes);
const tlTripsPost = Object.keys((await restGet('tripTimeline/trips')) || {}).length;
check('в tripTimeline/trips за всю сессию ничего не появилось (ручных копий нет)', tlTripsPost === 0, tlTripsPost);
const postCounts = {
  trips: Object.keys((await restGet('trips_dashboard')) || {}).length,
  stages: Object.keys((await restGet('tripTimeline/tripStages')) || {}).length,
  meta: Object.keys((await restGet('tripTimeline/tripMeta')) || {}).length,
};

// ── 8. Уборка пробных записей + следов ───────────────────────────────────
const del = async (p) => fetch(`${DB}/${p}.json`, { method: 'DELETE' });
await Promise.all([
  del(`trips_dashboard/${P1}`),
  del(`trips_dashboard/${P2}`),
  del(`tripTimeline/tripStages/${P1}`),
  del(`tripTimeline/tripMeta/${KEY1}`),
  del(`tripTimeline/tripHistory/${KEY1}`),
]);
// Следы в журналах (auditLogs / appErrors / уведомления) — только записи, где встречается probe id.
for (const branch of ['auditLogs', 'appErrors', 'ratipa_notifications', 'broadcastNotifications']) {
  const all = (await restGet(branch)) || {};
  for (const [k, v] of Object.entries(all)) {
    const s = JSON.stringify(v || {});
    if (s.includes('probe-plandates') || s.includes('PROBE 0001') || s.includes('PROBE0001')) await del(`${branch}/${k}`);
  }
}
await page.waitForTimeout(1000);
const finalProbe = await probeKeys();
check('мои пробные записи удалены (в touched-ветках не осталось probe-plandates)', finalProbe.trips === 0 && finalProbe.stages === 0 && finalProbe.meta === 0, JSON.stringify(finalProbe));
const bazaProbe = await page.evaluate(async (db) => {
  const all = await (await fetch(`${db}/baza.json`)).json() || {};
  return Object.entries(all).filter(([k, v]) => /probe-plandates/i.test(k) || /probe-plandates|PROBE\s?0001/.test(JSON.stringify(v))).length;
}, DB);
check('в «Учёте выезда» (baza) нет записей с МОИМИ пробными id (мои операции в baza не пишут)', bazaProbe === 0, bazaProbe);
log(`INFO :: md5(baza) до=${preCounts.bazaHash} после=${await restHash('baza')} — ветка baza моими операциями не трогается (см. юнит-тест); при параллельной работе другого агента хэш может меняться извне`);
log(`INFO :: счётчики веток: pre=${JSON.stringify({ trips: preCounts.trips, stages: preCounts.stages, meta: preCounts.meta })} post=${JSON.stringify(postCounts)}`);

check('ошибок JS на странице нет (pageerror/console.error)', errs.length === 0, errs.slice(0, 6).join(' | '));

const failed = checks.filter((c) => !c.ok);
log(`\nИТОГО ЖИВЫХ ПРОВЕРОК: ${checks.length - failed.length}/${checks.length}`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ checks, errs }, null, 1));
await browser.close();
process.exit(failed.length ? 1 : 0);
