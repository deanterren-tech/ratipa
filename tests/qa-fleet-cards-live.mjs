/**
 * qa-fleet-cards-live — ЖИВАЯ проверка единых полных карточек автомобиля и
 * водителя (Playwright + реальная RTDB). Пункты 6–12 задания:
 *
 *   6. Автомобиль из справочника («Автопарк и Водители») и из «Данных по авто и
 *      водителям» открывает ОДНУ полную карточку с одинаковыми значениями.
 *   7. Карточка содержит все существующие пользовательские поля автомобиля;
 *      пустое поле показано как «Не указано».
 *   8. Переход к основному и второму водителю открывает верные записи; закрытие
 *      карточки водителя возвращает к автомобилю.
 *   9. Водитель из базы и из автомобиля — один компонент (driver-card) с
 *      одинаковыми данными.
 *  10. Поля водителя берутся из правильных источников: телефоны из phones
 *      (основной — первым), диспетчер — из справочника по id, паспорт/дата
 *      рождения/ВУ/комментарий — из записи `drivers`.
 *  11. Изменение данных через существующую форму видно во всех разделах после
 *      сохранения (год выпуска: модуль → карточка из справочника).
 *  12. Нет дублей карточек, нет сброса остальных полей, права соблюдены
 *      (профиль «только чтение» не видит кнопок редактирования), битая ссылка
 *      на водителя показана явно и НЕ создаёт запись.
 *
 * ПРОБНЫЕ ДАННЫЕ: probe-записи (PROBEQA1..3 / PROBEDRV1..2) создаются в начале и
 * ПОЛНОСТЬЮ удаляются в finally; до/после сверяются счётчики веток и отсутствие
 * созданной служебной ветки vehicleBrands/PROBEBRAND.
 *
 * Запуск: node tests/qa-fleet-cards-live.mjs
 *   PORTAL_URL=http://127.0.0.1:3000 node tests/qa-fleet-cards-live.mjs
 * Нужен запущенный dev-сервер портала (npm run dev). Скрипт ПИШЕТ пробные
 * записи в RTDB и удаляет их; боевые записи не изменяются.
 * Код выхода: 0 — все проверки прошли и данные убраны; 1 — есть провалы.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.PORTAL_URL || 'http://127.0.0.1:3000';
const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const OUT = '/Users/sergei/.hermes/cache/scratch/fleet-cards-live';
fs.mkdirSync(OUT, { recursive: true });

const CAR = 'PROBEQA1';
const CAR_BROKEN = 'PROBEQA2';
const CAR_NODRIVER = 'PROBEQA3';
const DRV1 = 'PROBEDRV1';
const DRV2 = 'PROBEDRV2';
const DRV_MISSING = 'PROBEDRV-MISSING';
const DISPATCHER_ID = 'user_1785754183352';   // Максим Половиков (isDispatcher: true)
const DISPATCHER_NAME = 'Максим Половиков';
const PROBE_BRAND = 'PROBEBRAND';
const PROBE_TRAILER_BRAND = 'PROBETRAILER';

const checks = [];
const check = (name, ok, info = '') => {
  checks.push({ name, ok: !!ok, info: String(info).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name}${info !== '' ? ` :: ${String(info).slice(0, 220)}` : ''}`);
};

// ── RTDB REST (пробные данные) ───────────────────────────────────────────
const dbUrl = (p) => `${DB}/${p}.json`;
const dbGet = async (p) => (await fetch(dbUrl(p))).json().catch(() => null);
const dbPatch = async (p, body) => {
  const res = await fetch(dbUrl(p), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${p}: HTTP ${res.status}`);
};
const dbDelete = async (p) => {
  const res = await fetch(dbUrl(p), { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${p}: HTTP ${res.status}`);
};
const countKeys = async (branch) => {
  const v = await dbGet(branch);
  return v && typeof v === 'object' ? Object.keys(v).length : 0;
};

const probePaths = [
  `tractors/${CAR}`, `couplings/${CAR}`,
  `tractors/${CAR_BROKEN}`, `couplings/${CAR_BROKEN}`,
  `tractors/${CAR_NODRIVER}`, `couplings/${CAR_NODRIVER}`,
  `drivers/${DRV1}`, `drivers/${DRV2}`,
  `directories/vehicleBrands/${PROBE_BRAND}`, `directories/trailerBrands/${PROBE_TRAILER_BRAND}`,
];

const baseline = { tractors: 0, couplings: 0, drivers: 0, driverKeys: [] };
let probeWritten = false;
/** Ключи водителей, не относящиеся к пробным прогонам (в т.ч. параллельным). */
const stableDriverKeys = (map) => Object.keys(map && typeof map === 'object' ? map : {})
  .filter((k) => !/probe|qa/i.test(k))
  .sort();

async function cleanupProbes() {
  for (const p of probePaths) {
    await dbDelete(p).catch((e) => console.warn('[cleanup]', p, e.message));
  }
  await dbDelete(`drivers/${DRV_MISSING}`).catch(() => {});
}

async function writeProbes() {
  await dbPatch(`tractors/${CAR}`, {
    id: CAR,
    carNumber: 'QA 7777-9', vehicleNumbers: 'QA 7777-9',
    couplingId: CAR, tractorId: CAR,
    brand: PROBE_BRAND, brandModel: PROBE_BRAND, brands: PROBE_BRAND,
    trailerBrand: PROBE_TRAILER_BRAND, trailerMake: PROBE_TRAILER_BRAND, trailerNumber: 'QA-TR-77',
    vehicleType: 'Тенты QA', weight: '20т', year: '2018',
    status: 'base',
    driverId: DRV1, driverName: 'Иванов Иван Иванович', driverNameRu: 'Иванов Иван Иванович',
    driver2Id: DRV2, driver2: 'Петров Пётр Петрович',
    driverPhone: '+375 29 700-00-01',
    birthDate: '02.02.1980', passportNumber: 'QA1234567', personalId: 'QA-PERSON-1',
    passportStart: '01.01.2020', passportEnd: '01.01.2030', passportIssuedBy: 'QA ОВД',
    phones: [{ id: 'phone_1', number: '+375 29 700-00-01', isPrimary: true }],
    dispatcherId: DISPATCHER_ID, dispatcherName: DISPATCHER_NAME, dispatcher: DISPATCHER_NAME,
    rateGroupId: 'c2', rate: 0.125,
    lastPassportVerificationYear: 2026,
  });
  await dbPatch(`couplings/${CAR}`, {
    id: CAR, carNumber: 'QA 7777-9', vehicleNumbers: 'QA 7777-9', tractorId: CAR,
    trailerNumber: 'QA-TR-77', trailerBrand: PROBE_TRAILER_BRAND,
    brand: PROBE_BRAND, vehicleType: 'Тенты QA', weight: '20т',
    driverId: DRV1, driverName: 'Иванов Иван Иванович', driverNameRu: 'Иванов Иван Иванович',
    driver2Id: DRV2, driver2: 'Петров Пётр Петрович',
    dispatcher: DISPATCHER_NAME, dispatcherName: DISPATCHER_NAME, dispatcherId: DISPATCHER_ID,
    rateGroupId: 'c2', rate: 0.125, status: 'base',
  });
  // Битая ссылка: driverId указывает на несуществующую запись
  await dbPatch(`tractors/${CAR_BROKEN}`, {
    id: CAR_BROKEN, carNumber: 'QA 8888-8', vehicleNumbers: 'QA 8888-8', couplingId: CAR_BROKEN, tractorId: CAR_BROKEN,
    brand: PROBE_BRAND, status: 'base', driverId: DRV_MISSING, driverName: 'Пропавший Водитель',
  });
  await dbPatch(`couplings/${CAR_BROKEN}`, {
    id: CAR_BROKEN, carNumber: 'QA 8888-8', vehicleNumbers: 'QA 8888-8', tractorId: CAR_BROKEN,
    brand: PROBE_BRAND, status: 'base', driverId: DRV_MISSING, driverName: 'Пропавший Водитель',
  });
  // Водитель не назначен вовсе
  await dbPatch(`tractors/${CAR_NODRIVER}`, {
    id: CAR_NODRIVER, carNumber: 'QA 9999-9', vehicleNumbers: 'QA 9999-9', couplingId: CAR_NODRIVER, tractorId: CAR_NODRIVER,
    brand: PROBE_BRAND, status: 'base', driverId: '', driverName: '',
  });
  await dbPatch(`couplings/${CAR_NODRIVER}`, {
    id: CAR_NODRIVER, carNumber: 'QA 9999-9', vehicleNumbers: 'QA 9999-9', tractorId: CAR_NODRIVER,
    brand: PROBE_BRAND, status: 'base', driverId: '', driverName: '',
  });
  await dbPatch(`drivers/${DRV1}`, {
    id: DRV1, name: 'Иванов Иван Иванович',
    lastNameRu: 'Иванов', firstNameRu: 'Иван', middleNameRu: 'Иванович',
    shortNameRu: 'Иванов И.И.', nameLat: 'IVANOV IVAN',
    phones: [
      { id: 'phone_1', number: '+375 29 700-00-01', isPrimary: true },
      { id: 'phone_2', number: '+375 29 700-00-02', isPrimary: false },
    ],
    passport: 'QA1234567', passportIssued: 'QA ОВД',
    passportStart: '01.01.2020', passportEnd: '01.01.2030',
    personalId: 'QA-PERSON-1', licenseNumber: 'QA-LIC-1', license: 'QA-LIC-1',
    birthDate: '02.02.1980',
    dispatcherId: DISPATCHER_ID, dispatcherName: DISPATCHER_NAME, dispatcher: DISPATCHER_NAME,
    rateGroupId: 'c2', comment: 'QA probe driver',
  });
  await dbPatch(`drivers/${DRV2}`, {
    id: DRV2, name: 'Петров Пётр Петрович',
    lastNameRu: 'Петров', firstNameRu: 'Пётр', middleNameRu: 'Петрович',
    shortNameRu: 'Петров П.П.',
    phones: [{ id: 'phone_1', number: '+375 29 700-00-03', isPrimary: true }],
    birthDate: '03.03.1981',
    dispatcherId: DISPATCHER_ID, dispatcherName: DISPATCHER_NAME,
    rateGroupId: 'c2', comment: 'QA probe driver 2',
  });
  probeWritten = true;
}

// ── браузерные помощники ─────────────────────────────────────────────────
const session = (uid, name, role, permissions) => ({
  uid, name, firstName: name, lastName: '',
  role, permissions, onboarding: { '2_0_0': 'done' },
});
const initScript = (profile) => `
  try {
    localStorage.setItem('ratipa_user_session', ${JSON.stringify(JSON.stringify(profile))});
    localStorage.setItem('ratipa_tour_seen_2_0_0_probe-cardqa', '1');
    localStorage.setItem('ratipa_tour_seen_2_0_0_probe-cardqa-ro', '1');
    localStorage.setItem('pl_dohod_announce_probe-cardqa', '1');
    localStorage.setItem('pl_dohod_announce_probe-cardqa-ro', '1');
    localStorage.setItem('ratipa_birth_prompt_probe-cardqa', String(Date.now()));
    localStorage.setItem('ratipa_birth_prompt_probe-cardqa-ro', String(Date.now()));
  } catch (e) {}
`;

const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function dismissOverlays(page) {
  for (const label of ['Позже', 'Пропустить', 'Понятно', 'Начать работу']) {
    const btn = page.locator('button', { hasText: new RegExp(`^${label}$`) }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

/** Значения полей открытой полной карточки автомобиля (по data-ui). */
async function readVehicleCard(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-ui="vehicle-card"]');
    if (!root) return null;
    const fields = {};
    root.querySelectorAll('[data-ui^="vehicle-field-"]').forEach((el) => {
      fields[el.getAttribute('data-ui').replace('vehicle-field-', '')] = el.textContent.trim();
    });
    const emptyCount = root.querySelectorAll('[data-empty="1"]').length;
    const main = root.querySelector('[data-ui="vehicle-card-driver-main"]');
    const second = root.querySelector('[data-ui="vehicle-card-driver-second"]');
    return {
      fields,
      emptyCount,
      main: main ? { text: main.textContent.trim(), status: main.getAttribute('data-link-status'), clickable: main.tagName === 'BUTTON', driverId: main.getAttribute('data-driver-id') } : null,
      second: second ? { text: second.textContent.trim(), status: second.getAttribute('data-link-status'), clickable: second.tagName === 'BUTTON', driverId: second.getAttribute('data-driver-id') } : null,
      title: document.querySelector('[role="dialog"] [id]')?.textContent || '',
    };
  });
}

/** Значения полей открытой карточки водителя. */
async function readDriverCard(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-ui="driver-card"]');
    if (!root) return null;
    const fields = {};
    root.querySelectorAll('[data-ui^="driver-field-"]').forEach((el) => {
      fields[el.getAttribute('data-ui').replace('driver-field-', '')] = el.textContent.trim();
    });
    return { fields, driverId: root.getAttribute('data-driver-id') };
  });
}

async function openModuleAndSearch(page, query) {
  await page.goto(`${BASE}/#vehicleDriverData`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);
  const inp = page.locator('input[placeholder*="Поиск по номерам"]').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await inp.fill('');
  await inp.fill(query);
  await page.waitForTimeout(1200);
}

async function openFleetTabAndSearch(page, query) {
  await page.goto(`${BASE}/#appSettings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await dismissOverlays(page);
  const tab = page.locator('[role="tab"], button').filter({ hasText: 'Автопарк и Водители' }).first();
  if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(2500); }
  const inp = page.locator('input[placeholder*="Поиск по тягачу"]').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await inp.fill('');
  await inp.fill(query);
  await page.waitForTimeout(1200);
}

async function openDriversTabAndSearch(page, query) {
  await page.goto(`${BASE}/#appSettings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await dismissOverlays(page);
  const tab = page.locator('[role="tab"], button').filter({ hasText: 'База водителей' }).first();
  if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(2500); }
  const inp = page.locator('input[placeholder*="Поиск по ФИО"]').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await inp.fill('');
  await inp.fill(query);
  await page.waitForTimeout(1200);
  // Свежий контекст браузера: общие подписки холодные — ждём строки до 25 c.
  await page.waitForFunction(
    () => document.querySelectorAll('tr[data-ui="driver-row"]').length > 0,
    null,
    { timeout: 25000 },
  ).catch(() => {});
}

// ── прогон ───────────────────────────────────────────────────────────────
const errors = [];
let browser;
try {
  baseline.tractors = await countKeys('tractors');
  baseline.couplings = await countKeys('couplings');
  baseline.drivers = await countKeys('drivers');
  baseline.driverKeys = stableDriverKeys(await dbGet('drivers'));
  const preTractor = await dbGet(`tractors/${CAR}`);
  check('до прогона пробных записей в базе нет', preTractor === null, `tractors/${CAR}=${JSON.stringify(preTractor)}`);

  await writeProbes();
  const probeCoupling = await dbGet(`couplings/${CAR}`);
  check('пробные данные записаны в RTDB', !!probeCoupling && probeCoupling.carNumber === 'QA 7777-9');
  check('служебной ветки vehicleBrands/PROBEBRAND до правок нет', (await dbGet(`directories/vehicleBrands/${PROBE_BRAND}`)) === null);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  await ctx.addInitScript(initScript(session('probe-cardqa', 'Пробный Карточки', 'root_admin', {})));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240)); });

  // ── 6a. карточка из справочника («Автопарк и Водители») ────────────────
  await openFleetTabAndSearch(page, '7777');
  const fleetRows = page.locator('table tbody tr').filter({ hasText: '7777' });
  check('6. справочник: строка пробного авто найдена', (await fleetRows.count()) >= 1, `строк=${await fleetRows.count()}`);
  // Клик по ячейке номера (середина строки попадает в кнопку водителя — это её собственный переход)
  await fleetRows.first().locator('td').filter({ hasText: '7777' }).first().click();
  await page.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  const fromFleet = await readVehicleCard(page);
  check('6. из справочника открылась ПОЛНАЯ карточка (секции + поля)', !!fromFleet && !!fromFleet.fields.carNumber, JSON.stringify(Object.keys(fromFleet?.fields || {})).slice(0, 200));
  await page.screenshot({ path: `${OUT}/01-card-from-fleet.png` });

  // ── 7. полнота пользовательских полей автомобиля ───────────────────────
  const expectFields = ['carNumber', 'brandModel', 'trailerBrand', 'trailerNumber', 'vehicleType', 'year', 'dimensions', 'weight', 'status', 'dispatcher', 'rateGroup', 'rate'];
  const missingFields = expectFields.filter((f) => !(f in (fromFleet?.fields || {})));
  check('7. карточка содержит все группы полей автомобиля', missingFields.length === 0, `нет: ${missingFields.join(',')}`);
  check('7. марка тягача — из записи', fromFleet.fields.brandModel === PROBE_BRAND, fromFleet.fields.brandModel);
  check('7. марка/номер прицепа — из записи', fromFleet.fields.trailerBrand === PROBE_TRAILER_BRAND && fromFleet.fields.trailerNumber === 'QA-TR-77', `${fromFleet.fields.trailerBrand} / ${fromFleet.fields.trailerNumber}`);
  check('7. год выпуска виден', fromFleet.fields.year === '2018', fromFleet.fields.year);
  check('7. пустое поле (габариты) показано как «Не указано»', fromFleet.fields.dimensions === 'Не указано', fromFleet.fields.dimensions);
  check('7. счётчик незаполненных полей виден интерфейсу', fromFleet.emptyCount >= 1, `empty=${fromFleet.emptyCount}`);
  check('7. диспетчер — по id из справочника', fromFleet.fields.dispatcher === DISPATCHER_NAME, fromFleet.fields.dispatcher);
  check('7. группа ставок и ставка', fromFleet.fields.rateGroup.includes('0.125') && fromFleet.fields.rate.startsWith('0.125'), `${fromFleet.fields.rateGroup} / ${fromFleet.fields.rate}`);
  check('7. служебные id не выводятся как сведения', !JSON.stringify(fromFleet.fields).includes('tractorId') && !JSON.stringify(fromFleet.fields).includes('mergedFrom'));

  // ── 8. переходы к водителям и возврат ──────────────────────────────────
  check('8. основной водитель — верная запись', !!fromFleet.main && fromFleet.main.text.includes('Иванов Иван Иванович') && fromFleet.main.driverId === DRV1, JSON.stringify(fromFleet.main));
  check('8. второй водитель — верная запись', !!fromFleet.second && fromFleet.second.text.includes('Петров Пётр Петрович') && fromFleet.second.driverId === DRV2, JSON.stringify(fromFleet.second));
  check('8. телефон основного водителя из реестра', fromFleet.main.text.includes('+375 29 700-00-01'), fromFleet.main.text);

  await page.locator('[data-ui="vehicle-card-driver-main"]').click();
  await page.waitForSelector('[data-ui="driver-card"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const drvFromCar = await readDriverCard(page);
  check('8. переход открыл карточку ОСНОВНОГО водителя', drvFromCar?.driverId === DRV1 && drvFromCar.fields.fullName === 'Иванов Иван Иванович', JSON.stringify({ id: drvFromCar?.driverId, name: drvFromCar?.fields.fullName }));
  await page.screenshot({ path: `${OUT}/02-driver-from-car.png` });
  await page.locator('[data-ui="driver-card-close"]').click();
  await page.waitForTimeout(600);
  const backVisible = await page.locator('[data-ui="vehicle-card"]').isVisible().catch(() => false);
  const backData = await readVehicleCard(page);
  check('8. закрытие карточки водителя вернуло к автомобилю без потери контекста', backVisible && !!backData && backData.fields.year === '2018', JSON.stringify(backData?.fields?.year));

  await page.locator('[data-ui="vehicle-card-driver-second"]').click();
  await page.waitForSelector('[data-ui="driver-card"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const drv2FromCar = await readDriverCard(page);
  check('8. переход открыл карточку ВТОРОГО водителя', drv2FromCar?.driverId === DRV2 && drv2FromCar.fields.fullName === 'Петров Пётр Петрович', JSON.stringify({ id: drv2FromCar?.driverId, name: drv2FromCar?.fields.fullName }));
  await page.locator('[data-ui="driver-card-close"]').click();
  await page.waitForTimeout(600);

  // ── 10. поля водителя из правильных источников ─────────────────────────
  await page.locator('[data-ui="vehicle-card-driver-main"]').click();
  await page.waitForSelector('[data-ui="driver-card"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const dm = await readDriverCard(page);
  check('10. ФИО из реестра', dm.fields.fullName === 'Иванов Иван Иванович', dm.fields.fullName);
  check('10. паспорт из записи drivers', dm.fields.passport === 'QA1234567', dm.fields.passport);
  check('10. дата рождения в формате ДД/ММ/ГГГГ', dm.fields.birthDate === '02/02/1980', dm.fields.birthDate);
  check('10. основной телефон — первым и из phones', dm.fields.phone_primary === '+375 29 700-00-01', dm.fields.phone_primary);
  check('10. второй телефон из phones', dm.fields['phone_2'] === '+375 29 700-00-02', dm.fields['phone_2']);
  check('10. диспетчер — из справочника по id', dm.fields.dispatcher === DISPATCHER_NAME, dm.fields.dispatcher);
  check('10. ВУ и комментарий из записи', dm.fields.license === 'QA-LIC-1' && dm.fields.comment === 'QA probe driver', `${dm.fields.license} / ${dm.fields.comment}`);
  check('10. группа ставок водителя', (dm.fields.rateGroup || '').includes('0.125'), dm.fields.rateGroup);
  await page.screenshot({ path: `${OUT}/03-driver-fields.png` });
  await page.locator('[data-ui="driver-card-close"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-ui="vehicle-card-close"]').click();
  await page.waitForTimeout(500);

  // ── 9. водитель из базы — тот же компонент и те же данные ──────────────
  const fleetSnapshot = { ...fromFleet };
  await openDriversTabAndSearch(page, 'Иванов Иван');
  const drvRows = page.locator('tr[data-ui="driver-row"]').filter({ hasText: 'Иванов Иван Иванович' });
  check('9. в базе водителей строка пробного водителя найдена', (await drvRows.count()) === 1, `строк=${await drvRows.count()}`);
  await drvRows.first().locator('td').filter({ hasText: 'Иванов Иван Иванович' }).first().click();
  await page.waitForSelector('[data-ui="driver-card"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const dmFromBase = await readDriverCard(page);
  const sameDriverData = dmFromBase?.driverId === drvFromCar?.driverId
    && dmFromBase.fields.fullName === drvFromCar.fields.fullName
    && dmFromBase.fields.passport === drvFromCar.fields.passport
    && dmFromBase.fields.phone_primary === drvFromCar.fields.phone_primary
    && dmFromBase.fields.dispatcher === drvFromCar.fields.dispatcher
    && dmFromBase.fields.rateGroup === drvFromCar.fields.rateGroup;
  check('9. водитель из базы и из автомобиля — один компонент с одинаковыми данными', sameDriverData, JSON.stringify({ base: dmFromBase?.fields, car: drvFromCar?.fields }).slice(0, 300));
  await page.screenshot({ path: `${OUT}/04-driver-from-base.png` });
  await page.locator('[data-ui="driver-card-close"]').click();
  await page.waitForTimeout(500);

  // ── 6b. та же полная карточка из «Данных по авто и водителям» ──────────
  await openModuleAndSearch(page, '7777');
  const moduleCards = page.locator('[data-ui^="vehicle-open-card-"]').filter({ hasText: '7777' });
  check('6. модуль: карточка пробного авто в списке', (await moduleCards.count()) === 1, `карточек=${await moduleCards.count()}`);
  // Клик по номеру в шапке карточки (внутри карточки есть элементы со своим поведением)
  await moduleCards.first().getByText('QA 7777-9', { exact: false }).first().click();
  await page.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  const fromModule = await readVehicleCard(page);
  const comparable = ['carNumber', 'brandModel', 'trailerBrand', 'trailerNumber', 'vehicleType', 'year', 'dimensions', 'weight', 'status', 'dispatcher', 'rateGroup', 'rate'];
  const diffs = comparable.filter((k) => (fromFleet.fields[k] || '') !== (fromModule.fields[k] || ''));
  check('6. одна и та же полная карточка из двух разделов (значения совпадают)', diffs.length === 0, `различия: ${diffs.join(',')}`);
  check('6. из модуля — тоже полная карточка, а не строка списка', !!fromModule.fields.year && fromModule.fields.dimensions === 'Не указано');
  await page.screenshot({ path: `${OUT}/05-card-from-module.png` });

  // ── 11. правка через существующую форму видна во всех разделах ─────────
  const editBtn = page.locator('[data-ui="vehicle-card-edit"]');
  check('11. кнопка существующей формы доступна из полной карточки', (await editBtn.count()) === 1);
  await editBtn.click();
  await page.waitForTimeout(900);
  // Форма редактирования модуля (страхуемся от выбора карточки: она тоже role=dialog)
  const dlg = page.locator('[role="dialog"][aria-label="Редактировать запись"]');
  const yearInput = dlg.locator('label', { hasText: /^Год выпуска$/ }).locator('xpath=following-sibling::input[1]');
  await yearInput.fill('2021');
  const saveBtn = dlg.locator('button', { hasText: 'Сохранить изменения' });
  await saveBtn.click();
  await page.waitForTimeout(2200);
  const afterSave = await readVehicleCard(page);
  check('11. сохранённый год сразу виден в открытой карточке', afterSave?.fields?.year === '2021', JSON.stringify(afterSave?.fields?.year));
  check('11. остальные поля не сброшены (марка/прицеп/диспетчер)', afterSave.fields.brandModel === PROBE_BRAND && afterSave.fields.trailerNumber === 'QA-TR-77' && afterSave.fields.dispatcher === DISPATCHER_NAME, JSON.stringify({ b: afterSave.fields.brandModel, t: afterSave.fields.trailerNumber }));
  check('11. телефон водителя не сброшен', afterSave.main.text.includes('+375 29 700-00-01'));
  await page.screenshot({ path: `${OUT}/06-after-save.png` });
  await page.locator('[data-ui="vehicle-card-close"]').click();
  await page.waitForTimeout(500);

  const dbTractor = await dbGet(`tractors/${CAR}`);
  check('11. год сохранён в основную запись tractors', String(dbTractor?.year) === '2021', `year=${dbTractor?.year}`);
  const dbDriver = await dbGet(`drivers/${DRV1}`);
  check('11. сохранение машины не стёрло телефоны/паспорт водителя', (dbDriver?.phones || []).length === 2 && dbDriver?.passport === 'QA1234567', JSON.stringify(dbDriver?.phones));

  await openFleetTabAndSearch(page, '7777');
  const fleetRows2 = page.locator('table tbody tr').filter({ hasText: '7777' });
  check('12. справочник: ровно одна строка пробного авто (без дублей)', (await fleetRows2.count()) === 1, `строк=${await fleetRows2.count()}`);
  await fleetRows2.first().locator('td').filter({ hasText: '7777' }).first().click();
  await page.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  const refetch = await readVehicleCard(page);
  check('11. изменение видно и при открытии из справочника', refetch?.fields?.year === '2021', JSON.stringify(refetch?.fields?.year));
  await page.locator('[data-ui="vehicle-card-close"]').click();
  await page.waitForTimeout(400);

  // ── 12. битая ссылка и «не назначен» ───────────────────────────────────
  await openFleetTabAndSearch(page, '8888');
  await page.locator('table tbody tr').filter({ hasText: '8888' }).first().locator('td').filter({ hasText: '8888' }).first().click();
  await page.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const broken = await readVehicleCard(page);
  const brokenMissing = !!broken && broken.main && broken.main.status === 'missing' && broken.main.text.includes('отсутствует в справочнике') && !broken.main.clickable;
  check('12. битая ссылка на водителя показана явно и не открывается', brokenMissing, JSON.stringify(broken?.main).slice(0, 250));
  check('12. запись «пропавшего» водителя НЕ создана', (await dbGet(`drivers/${DRV_MISSING}`)) === null);
  await page.screenshot({ path: `${OUT}/07-broken-link.png` });
  await page.locator('[data-ui="vehicle-card-close"]').click();
  await page.waitForTimeout(400);

  await openFleetTabAndSearch(page, '9999');
  await page.locator('table tbody tr').filter({ hasText: '9999' }).first().locator('td').filter({ hasText: '9999' }).first().click();
  await page.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const noDriver = await readVehicleCard(page);
  check('12. неназначенный водитель показан как «Не назначен»', !!noDriver && noDriver.main && noDriver.main.status === 'empty' && noDriver.main.text.includes('Не назначен'), JSON.stringify(noDriver?.main).slice(0, 200));
  await page.locator('[data-ui="vehicle-card-close"]').click();
  await page.waitForTimeout(400);

  // ── 12. права: профиль «только чтение» ─────────────────────────────────
  const roCtx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  await roCtx.addInitScript(initScript(session('probe-cardqa-ro', 'Пробный Чтение', 'dispatcher', {
    dashboard: 'read', settings: 'read', vehicleDriverData: 'read', dozvola: 'read', baza: 'read',
  })));
  const roPage = await roCtx.newPage();
  roPage.on('pageerror', (e) => errors.push('RO PAGEERROR ' + e.message));
  await openFleetTabAndSearch(roPage, '7777');
  const roBadge = await bodyText(roPage);
  check('12. профиль чтения: раздел справочников в режиме «Только чтение»', roBadge.includes('Только чтение'), '');
  const roRow = roPage.locator('table tbody tr').filter({ hasText: '7777' });
  if (await roRow.count()) {
    await roRow.first().locator('td').filter({ hasText: '7777' }).first().click();
    await roPage.waitForSelector('[data-ui="vehicle-card"]', { timeout: 15000 });
    await roPage.waitForTimeout(600);
    const roCard = await readVehicleCard(roPage);
    check('12. профиль чтения: полная карточка открывается (просмотр разрешён)', !!roCard && !!roCard.fields.carNumber);
    check('12. профиль чтения: кнопки редактирования в карточке нет', (await roPage.locator('[data-ui="vehicle-card-edit"]').count()) === 0);
    await roPage.screenshot({ path: `${OUT}/08-readonly-card.png` });
    await roPage.locator('[data-ui="vehicle-card-close"]').click();
    await roPage.waitForTimeout(400);
  } else {
    check('12. профиль чтения: строка пробного авто найдена', false, 'строка не найдена');
  }
  // Водитель для проверки берётся из ЖИВОЙ базы в этот момент: параллельные
  // пробные прогоны других агентов могут менять состав ветки drivers.
  const driversNow = (await dbGet('drivers')) || {};
  const probeAlive = !!driversNow[DRV1] && String(driversNow[DRV1]?.name || '').includes('Иванов');
  let roTargetName = probeAlive
    ? 'Иванов Иван Иванович'
    : String(Object.values(driversNow).map((d) => String((d && d.name) || '')).find((n) => n.length > 5) || '');
  const roQuery = probeAlive ? 'Иванов Иван' : (roTargetName.split(' ')[0] || 'а');
  await openDriversTabAndSearch(roPage, roQuery);
  const roDrvRow = roPage.locator('tr[data-ui="driver-row"]').filter({ hasText: roTargetName });
  let roDrvCount = await roDrvRow.count();
  if (roDrvCount < 1 && probeAlive) {
    // Параллельный прогон мог удалить пробную запись уже после входа — тогда
    // проверяем на реальном водителе, взятом из базы прямо сейчас.
    const fallbackName = String(Object.values(driversNow).map((d) => String((d && d.name) || '')).find((n) => n.length > 5) || '');
    if (fallbackName) {
      await openDriversTabAndSearch(roPage, fallbackName.split(' ')[0] || 'а');
      const fbRow = roPage.locator('tr[data-ui="driver-row"]').filter({ hasText: fallbackName });
      roDrvCount = await fbRow.count();
      roTargetName = fallbackName;
    }
  }
  await roDrvRow.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  const roDrvDiag = await roPage.evaluate(() => ({
    activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || '',
    rows: document.querySelectorAll('tr[data-ui="driver-row"]').length,
    text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500),
  })).catch(() => ({ activeTab: '?', rows: -1, text: '' }));
  if (roDrvCount < 1) await roPage.screenshot({ path: `${OUT}/09-ro-drivers-fail.png` }).catch(() => {});
  check('12. профиль чтения: база водителей доступна на просмотр', roDrvCount >= 1, `водитель=«${roTargetName}»; строк=${roDrvCount}; вкладка=${roDrvDiag.activeTab}; всего строк=${roDrvDiag.rows}; ${roDrvDiag.text.slice(0, 160)}`);
  if (roDrvCount >= 1) {
    const roClickRow = roPage.locator('tr[data-ui="driver-row"]').filter({ hasText: roTargetName });
    await roClickRow.first().locator('td').filter({ hasText: roTargetName.split(' ')[0] }).first().click();
    await roPage.waitForSelector('[data-ui="driver-card"]', { timeout: 15000 });
    await roPage.waitForTimeout(500);
    check('12. профиль чтения: карточка водителя без кнопки редактирования', (await roPage.locator('[data-ui="driver-card-edit"]').count()) === 0);
    await roPage.locator('[data-ui="driver-card-close"]').click();
  }
  await roCtx.close();

  check('12. JS-ошибок за прогон нет', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) {
  check('прогон завершился без исключений', false, e?.stack || String(e));
} finally {
  try {
    if (browser) await browser.close().catch(() => {});
  } catch { /* ignore */ }
  if (probeWritten) {
    await cleanupProbes();
    // контроль уборки
    const left = [];
    for (const p of probePaths) {
      if ((await dbGet(p)) !== null) left.push(p);
    }
    if ((await dbGet(`drivers/${DRV_MISSING}`)) !== null) left.push(`drivers/${DRV_MISSING}`);
    checks.push({ name: 'уборка: пробные записи удалены полностью', ok: left.length === 0, info: left.join(',') });
    console.log(`${left.length === 0 ? 'PASS' : 'FAIL'} :: уборка: пробные записи удалены полностью${left.length ? ' :: ' + left.join(',') : ''}`);
    const after = { tractors: await countKeys('tractors'), couplings: await countKeys('couplings'), drivers: await countKeys('drivers') };
    // tractors/couplings — точное равенство. drivers может дрейфовать из-за
    // ПАРАЛЛЕЛЬНОГО пробного прогона другого агента: сравниваем множества
    // НЕпробных ключей (их прогон не трогает).
    const afterDriverKeys = stableDriverKeys(await dbGet('drivers'));
    const fleetOk = after.tractors === baseline.tractors && after.couplings === baseline.couplings;
    const driversOk = afterDriverKeys.join(',') === baseline.driverKeys.join(',');
    const countsOk = fleetOk && driversOk;
    checks.push({ name: 'уборка: состояние веток вернулось к исходному', ok: countsOk, info: JSON.stringify({ before: {t: baseline.tractors, c: baseline.couplings, d: baseline.drivers}, after, driversOk }) });
    console.log(`${countsOk ? 'PASS' : 'FAIL'} :: уборка: состояние веток вернулось к исходному :: ${JSON.stringify({ before: {t: baseline.tractors, c: baseline.couplings, d: baseline.drivers}, after, driversOk })}`);
  }

  const failed = checks.filter((c) => !c.ok);
  const report = { when: new Date().toISOString(), base: BASE, checks, errors, baseline };
  fs.writeFileSync(`${OUT}/live-report.json`, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nИтог: PASS ${checks.length - failed.length}/${checks.length}; JS-ошибок: ${errors.length}`);
  console.log(`Отчёт: ${OUT}/live-report.json`);
  if (failed.length > 0) {
    console.error('Провалы:');
    for (const f of failed) console.error('  ✗ ' + f.name + (f.info ? ` :: ${f.info}` : ''));
  }
  process.exit(failed.length === 0 ? 0 : 1);
}
