/**
 * Живая проверка окна «Дата рождения водителя» на локальном портале
 * (http://127.0.0.1:3000).
 *
 * Что проверяется:
 *  1) у диспетчера при входе возникает окно с его водителем без правдоподобной
 *     даты; без даты/с неправдоподобной — понятная ошибка, окно не закрывается;
 *     правильная дата сохраняется в реестр существующим путём (drivers/{id});
 *     остальные поля записи и след правки не портятся;
 *  2) «Позже» закрывает окно и ничего не пишет, но при следующем входе окно
 *     возвращается (не «навсегда»);
 *  3) сотрудник без права правки реестра (бухгалтер) окна не видит;
 *  4) другой диспетчер окна по чужим водителям не видит (охват — свои + root);
 *  5) мобильный 390px: окно, кнопки ≥44px, сохранение;
 *  6) существующая форма водителя не сломана (сохранение через «Настройки»).
 *
 * Пробные данные ТОЛЬКО с префиксом probe- (водители probe-birth-1…3 и
 * probe-form-1, пробные профили в localStorage), после прогона всё удаляется,
 * счётчики сверяются. Реальные записи не читаются и не меняются.
 *
 * Запуск: NODE_PATH=$PWD/node_modules node qa_birth_prompt_live.cjs
 */
const admin = require('firebase-admin');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SA = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '/Users/sergei/Downloads/ratipa-portal-firebase-adminsdk-fbsvc-972ed8f69f.json';
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const APP_URL = process.env.RATIPA_URL || 'http://127.0.0.1:3000/';
const SHOT_DIR = path.join(ROOT, 'qa-screenshots');

const UID = 'probe-birth-uid';
const UID_OTHER = 'probe-birth-other';
const FORM_UID = 'probe-form-uid';
const PROBE_IDS = ['probe-birth-1', 'probe-birth-2', 'probe-birth-3', 'probe-form-1'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '  PASS' : '✗ FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
};

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(SA, 'utf8'))),
  databaseURL: DB_URL,
});
const db = admin.database();
const get = async (p) => (await db.ref(p).get()).val();
const set = (p, v) => db.ref(p).set(v);
const del = (p) => db.ref(p).remove();

const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const verKey = appVersion.replace(/[.#$/\[\]]/g, '_');

const profileOf = (uid, role, permissions, extra = {}) => ({
  uid,
  name: role === 'dispatcher' ? 'Проба Диспетчер' : 'Проба Бухгалтер',
  email: `${uid}@probe.local`,
  role,
  permissions,
  customPermissions: {},
  createdAt: new Date().toISOString(),
  onboarding: { [verKey]: 'done' },
  ...extra,
});

let browser;
let driversBefore = 0;

async function cleanupProbe() {
  for (const id of PROBE_IDS) await del(`drivers/${id}`).catch(() => {});
  for (const uid of [UID, UID_OTHER, FORM_UID]) {
    await del(`users_list/${uid}`).catch(() => {});
    await del(`ratipapresence/${uid}`).catch(() => {});
  }
  const logs = (await get('auditLogs').catch(() => null)) || {};
  for (const [key, val] of Object.entries(logs)) {
    const s = JSON.stringify(val || {});
    if (PROBE_IDS.some((id) => s.includes(id)) || s.includes(UID) || s.includes(UID_OTHER) || s.includes(FORM_UID)) {
      await del(`auditLogs/${key}`).catch(() => {});
    }
  }
}

async function seedProbe() {
  const common = { lastNameRu: 'Проба', dispatcherName: 'Проба Диспетчер', dispatcherId: UID };
  await set('drivers/probe-birth-1', { ...common, id: 'probe-birth-1', name: 'Проба Альфа', firstNameRu: 'Альфа', shortNameRu: 'Проба А.', phones: [{ id: 'p1', number: '+375 29 000-00-01', isPrimary: true }], phone: '+375 29 000-00-01', birthDate: '', passport: 'PROBE0001' });
  await set('drivers/probe-birth-2', { ...common, id: 'probe-birth-2', name: 'Проба Бета', firstNameRu: 'Бета', phones: [{ id: 'p1', number: '+375 29 000-00-02', isPrimary: true }], phone: '+375 29 000-00-02', birthDate: '01.01.1930' });
  await set('drivers/probe-birth-3', { ...common, id: 'probe-birth-3', name: 'Проба Гамма', firstNameRu: 'Гамма', birthDate: '31.02.1990' });
  await set('drivers/probe-form-1', { id: 'probe-form-1', name: 'Проба Форма', lastNameRu: 'Проба', firstNameRu: 'Форма', birthDate: '1980-01-01', dispatcherId: FORM_UID, dispatcherName: 'Проба Форма Диспетчер', comment: '' });
}

/** Контекст с пробным профилем в localStorage (реальные пользователи не тронуты). */
async function newProbeContext(profile, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ru-RU' });
  const errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  });
  await ctx.addInitScript(({ prof, vk }) => {
    try {
      localStorage.setItem('ratipa_user_session', JSON.stringify(prof));
      localStorage.setItem(`ratipa_tour_seen_${vk}_${prof.uid}`, '1');
      localStorage.setItem(`pl_dohod_announce_${prof.uid}`, '1');
      localStorage.setItem('ratipa_last_module', 'dashboard');
    } catch { /* ignore */ }
  }, { prof: profile, vk: verKey });
  return { ctx, errors };
}

const MODAL = '[data-ui="bd-modal"]';
const DIALOG = '[role="dialog"][aria-label="Дата рождения водителя"]';

async function openApp(ctx) {
  const page = await ctx.newPage();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="Загрузка Ratipa Portal"]', { state: 'detached', timeout: 30000 }).catch(() => {});
  return page;
}

async function waitModal(page, timeout = 30000) {
  await page.waitForSelector(MODAL, { timeout });
  return page.locator(DIALOG);
}

/** Ввод даты в скрытый date-инпут (то же поле, что открывает календарь). */
async function fillDate(page, iso) {
  const sel = '#picker-bd-birth';
  try {
    await page.fill(sel, iso, { timeout: 4000 });
  } catch {
    await page.$eval(sel, (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, iso);
  }
  return page.locator('#bd-date-text').inputValue();
}

async function reloadApp(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="Загрузка Ratipa Portal"]', { state: 'detached', timeout: 30000 }).catch(() => {});
}

(async () => {
  await cleanupProbe();
  driversBefore = Object.keys((await get('drivers')) || {}).length;
  await seedProbe();
  const seeded = Object.keys((await get('drivers')) || {}).length;
  check('пробные записи созданы (4)', seeded === driversBefore + 4, `${driversBefore} → ${seeded}`);

  browser = await chromium.launch();
  const dispatcherProfile = profileOf(UID, 'dispatcher', { settings: 'write', dashboard: 'read' });

  // ── 1. Диспетчер: окно, ошибки ввода, сохранение, «Позже» ───────────────
  const { ctx: ctx1, errors: err1 } = await newProbeContext(dispatcherProfile, { width: 1280, height: 900 });
  const page1 = await openApp(ctx1);
  const dlg1 = await waitModal(page1);
  check('окно открылось у диспетчера при входе', true);
  const progress1 = (await dlg1.locator('[data-ui="bd-progress"]').innerText()).trim();
  check('прогресс списка «1 из 3»', progress1 === '1 из 3', progress1);
  const name1 = (await dlg1.locator('[data-ui="bd-driver-name"]').innerText()).trim();
  check('первый водитель — по ФИО (Проба Альфа)', name1 === 'Проба Альфа', name1);
  check('телефон водителя показан', (await dlg1.locator('[data-ui="bd-driver-phone"]').innerText()).includes('+375 29 000-00-01'));
  const reason1 = await dlg1.locator('[data-ui="bd-reason"]').innerText();
  check('подсказка «зачем» (для документов)', reason1.includes('документ'));
  check('причина у пустой даты', reason1.includes('не заполнена'), reason1.slice(0, 70));
  check('честная подсказка про «Позже»', (await dlg1.innerText()).includes('следующего входа'));

  await dlg1.locator('[data-ui="bd-save"]').click();
  await page1.waitForSelector('[data-ui="bd-error"]', { timeout: 5000 }).catch(() => {});
  const errEmpty = await page1.locator('[data-ui="bd-error"]').innerText().catch(() => '');
  check('без даты — понятная ошибка, окно не закрылось', errEmpty.includes('не заполнена') && (await page1.locator(MODAL).count()) === 1, errEmpty);
  check('без даты запись не тронута', !(await get('drivers/probe-birth-1')).birthDate);

  const shownBad = await fillDate(page1, '2015-01-01');
  check('поле показывает введённую дату (ДД/ММ/ГГГГ)', shownBad === '01/01/2015', shownBad);
  await dlg1.locator('[data-ui="bd-save"]').click();
  await page1.waitForTimeout(600);
  const errBad = await page1.locator('[data-ui="bd-error"]').innerText().catch(() => '');
  check('неправдоподобная дата отклонена с причиной', errBad.includes('18'), errBad);
  check('неправдоподобная дата не записана', !(await get('drivers/probe-birth-1')).birthDate);

  const shownGood = await fillDate(page1, '1980-03-04');
  check('правильная дата в поле', shownGood === '04/03/1980', shownGood);
  await dlg1.locator('[data-ui="bd-save"]').click();
  await page1.waitForFunction(() => {
    const nl = document.querySelector('[data-ui="bd-progress"]');
    const nm = document.querySelector('[data-ui="bd-driver-name"]');
    return !!nl && !!nm && /2 из 3/.test(nl.textContent) && /Бета/.test(nm.textContent);
  }, { timeout: 20000 }).catch(() => {});
  const progress2 = (await dlg1.locator('[data-ui="bd-progress"]').innerText().catch(() => '')).trim();
  check('после сохранения — следующий водитель, прогресс «2 из 3»', progress2 === '2 из 3', progress2);
  const saved1 = await get('drivers/probe-birth-1');
  check('дата сохранена в реестр в ISO', saved1.birthDate === '1980-03-04', JSON.stringify(saved1.birthDate));
  check('остальные поля записи не затёрты', saved1.name === 'Проба Альфа' && saved1.dispatcherId === UID && saved1.passport === 'PROBE0001', `name=${saved1.name} disp=${saved1.dispatcherId}`);
  check('след правки (updatedAt/updatedBy)', saved1.updatedBy === 'Проба Диспетчер' && !!saved1.updatedAt, `updatedBy=${saved1.updatedBy}`);
  check('телефоны записи не потеряны', Array.isArray(saved1.phones) && saved1.phones[0].number === '+375 29 000-00-01');

  await dlg1.locator('[data-ui="bd-later"]').click();
  await page1.waitForSelector(MODAL, { state: 'detached', timeout: 5000 }).catch(() => {});
  check('«Позже» закрыло окно', (await page1.locator(MODAL).count()) === 0);
  check('«Позже» ничего не записало', (await get('drivers/probe-birth-2')).birthDate === '01.01.1930');

  await reloadApp(page1);
  const dlg1b = await waitModal(page1);
  const progress3 = (await dlg1b.locator('[data-ui="bd-progress"]').innerText()).trim();
  const name3 = (await dlg1b.locator('[data-ui="bd-driver-name"]').innerText()).trim();
  check('после перезагрузки окно вернулось («Позже» не навсегда)', progress3 === '1 из 2' && name3 === 'Проба Бета', `${progress3} / ${name3}`);
  const current3 = await dlg1b.locator('[data-ui="bd-driver-current"]').innerText().catch(() => '');
  check('текущее значение из карточки показано', current3.includes('01.01.1930'), current3);
  const reason3 = await dlg1b.locator('[data-ui="bd-reason"]').innerText();
  check('причина — год раньше порога', reason3.includes('1940'), reason3.slice(0, 55));
  await fillDate(page1, '1990-05-06');
  await dlg1b.locator('[data-ui="bd-save"]').click();
  await page1.waitForFunction(() => {
    const nm = document.querySelector('[data-ui="bd-driver-name"]');
    return !!nm && /Гамма/.test(nm.textContent);
  }, { timeout: 20000 }).catch(() => {});
  check('неправдоподобная дата заменена на правильную', (await get('drivers/probe-birth-2')).birthDate === '1990-05-06');
  const reason4 = await page1.locator('[data-ui="bd-reason"]').innerText().catch(() => '');
  check('несуществующая дата помечена причиной', reason4.includes('не существует'), reason4.slice(0, 55));
  await page1.locator(`${DIALOG} [data-ui="bd-later"]`).click();
  await page1.waitForSelector(MODAL, { state: 'detached', timeout: 5000 }).catch(() => {});
  check('«Позже» на несуществующей дате — ничего не записано', (await get('drivers/probe-birth-3')).birthDate === '31.02.1990');
  check('0 ошибок JS (диспетчер, десктоп)', err1.length === 0, err1.slice(0, 4).join(' | '));
  await ctx1.close();

  // ── 2. Права: бухгалтер без права правки окна не видит ──────────────────
  const accountant = profileOf(UID, 'accountant', { settings: 'none', dashboard: 'read' });
  const { ctx: ctx2, errors: err2 } = await newProbeContext(accountant, { width: 1280, height: 900 });
  const page2 = await openApp(ctx2);
  await page2.waitForTimeout(12000);
  const dialogs2 = await page2.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute('aria-label') || '(без метки)'));
  check('активный профиль — пробный бухгалтер', (await page2.locator('body').innerText()).includes('Проба Бухгалтер'));
  check('бухгалтер без права правки окна не видит', (await page2.locator(MODAL).count()) === 0, `диалоги: ${JSON.stringify(dialogs2)}`);
  check('0 ошибок JS (бухгалтер)', err2.length === 0, err2.slice(0, 4).join(' | '));
  await ctx2.close();

  // ── 3. Охват: другой диспетчер чужих водителей не видит ─────────────────
  const otherDispatcher = profileOf(UID_OTHER, 'dispatcher', { settings: 'write', dashboard: 'read' });
  const { ctx: ctx3, errors: err3 } = await newProbeContext(otherDispatcher, { width: 1280, height: 900 });
  const page3 = await openApp(ctx3);
  await page3.waitForTimeout(12000);
  check('чужой диспетчер окна не видит (свой у него один)', (await page3.locator(MODAL).count()) === 0);
  check('0 ошибок JS (чужой диспетчер)', err3.length === 0, err3.slice(0, 4).join(' | '));
  await ctx3.close();

  // ── 4. Мобильный 390px: окно, кнопки 44px, сохранение ───────────────────
  const { ctx: ctx4, errors: err4 } = await newProbeContext(dispatcherProfile, { width: 390, height: 844 });
  const page4 = await openApp(ctx4);
  const dlg4 = await waitModal(page4);
  check('мобильный 390px: окно открылось', true);
  const saveBox = await dlg4.locator('[data-ui="bd-save"]').boundingBox();
  const laterBox = await dlg4.locator('[data-ui="bd-later"]').boundingBox();
  check('кнопка «Сохранить» не ниже 44px', !!saveBox && saveBox.height >= 44, saveBox && saveBox.height);
  check('кнопка «Позже» не ниже 44px', !!laterBox && laterBox.height >= 44, laterBox && laterBox.height);
  const overflow = await page4.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('нет горизонтального переполнения', overflow <= 1, overflow);
  await page4.screenshot({ path: path.join(SHOT_DIR, 'driver-birth-prompt-mobile.png') });
  await fillDate(page4, '1995-02-03');
  await dlg4.locator('[data-ui="bd-save"]').click();
  await page4.waitForSelector(MODAL, { state: 'detached', timeout: 20000 }).catch(() => {});
  check('мобильный: дата сохранена', (await get('drivers/probe-birth-3')).birthDate === '1995-02-03');
  check('мобильный: окно закрылось после последнего водителя', (await page4.locator(MODAL).count()) === 0);
  await reloadApp(page4);
  await page4.waitForTimeout(9000);
  check('повторный вход без окна (все даты внесены)', (await page4.locator(MODAL).count()) === 0);
  check('0 ошибок JS (мобильный)', err4.length === 0, err4.slice(0, 4).join(' | '));
  await ctx4.close();

  // ── 5. Регрессия: существующая форма водителя работает ─────────────────
  const formProfile = profileOf(FORM_UID, 'dispatcher', { settings: 'write', dashboard: 'read' }, { name: 'Проба Форма Диспетчер' });
  const { ctx: ctx5, errors: err5 } = await newProbeContext(formProfile, { width: 1440, height: 900 });
  const page5 = await openApp(ctx5);
  await page5.waitForTimeout(8000);
  check('форма: окно даты не мешает (дата правдоподобна)', (await page5.locator(MODAL).count()) === 0);
  // Реестр водителей живёт в модуле «Справочники» (ключ appSettings), вкладка «База водителей»
  await page5.goto(`${APP_URL}#appSettings`, { waitUntil: 'domcontentloaded' });
  await page5.locator('button[role="tab"]', { hasText: 'База водителей' }).first().click({ timeout: 25000 });
  const row = page5.locator('[data-ui="driver-row"]', { hasText: 'Проба Форма' }).first();
  await row.locator('button[aria-label="Изменить"]').click({ timeout: 20000 });
  const formDialog = page5.locator('[role="dialog"][aria-label="Редактировать водителя"]');
  await formDialog.locator('input[placeholder*="второй водитель"]').fill('проба формы');
  await formDialog.locator('[data-ui="driver-save"]').click();
  await page5.waitForSelector('[role="dialog"][aria-label="Редактировать водителя"]', { state: 'detached', timeout: 20000 }).catch(() => {});
  const afterForm = await get('drivers/probe-form-1');
  check('форма водителя: правка сохранилась', afterForm && afterForm.comment === 'проба формы', JSON.stringify(afterForm && afterForm.comment));
  check('форма водителя: дата рождения цела', afterForm && afterForm.birthDate === '1980-01-01', JSON.stringify(afterForm && afterForm.birthDate));
  check('форма водителя: ФИО и диспетчер целы', afterForm && afterForm.lastNameRu === 'Проба' && afterForm.dispatcherId === FORM_UID);
  check('0 ошибок JS (форма водителя)', err5.length === 0, err5.slice(0, 4).join(' | '));
  await ctx5.close();

  // ── Уборка и сверка ─────────────────────────────────────────────────────
  await browser.close();
  browser = null;
  await cleanupProbe();
  const driversAfter = Object.keys((await get('drivers')) || {}).length;
  check('счётчик drivers восстановлен', driversAfter === driversBefore, `${driversBefore} → ${driversAfter}`);
  for (const id of PROBE_IDS) check(`drivers/${id} удалён`, (await get(`drivers/${id}`)) === null);
  for (const uid of [UID, UID_OTHER, FORM_UID]) {
    check(`users_list/${uid} удалён`, (await get(`users_list/${uid}`)) === null);
    check(`ratipapresence/${uid} удалён`, (await get(`ratipapresence/${uid}`)) === null);
  }
})().then(() => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} проверок пройдено`);
  if (failed.length) {
    console.log('ПРОВАЛЫ:');
    failed.forEach((f) => console.log(`  · ${f.name} ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}).catch(async (e) => {
  console.error('ОШИБКА ПРОГОНА:', e && e.stack ? e.stack : e);
  try { if (browser) await browser.close(); } catch { /* ignore */ }
  try { await cleanupProbe(); } catch { /* ignore */ }
  console.error(`после уборки drivers: ${Object.keys((await get('drivers').catch(() => ({}))) || {}).length} (до прогона ${driversBefore})`);
  process.exit(1);
});
