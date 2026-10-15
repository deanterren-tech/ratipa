/**
 * Живая проверка переключения вкладок СТАТУСОВ в реестре «Учёт дозволов»
 * (http://127.0.0.1:3000, реальная база).
 *
 * Проверяется путь «клик по вкладке → состояние → фильтрация → строки таблицы»:
 *   1) последовательное переключение всех вкладок без перезагрузки страницы;
 *   2) в архив и обратно; 3) к «Использован»; 4) к утерянным/аннулированным
 *      (+ уточнение «Аннулирован» / «Утерян» / «Оба статуса»);
 *   5) быстрое многократное переключение (побеждает последняя вкладка);
 *   6) переключение при активном поиске и фильтре вида;
 *   7) переключение после «Показать ещё» (пагинация сбрасывается);
 *   8) пустая вкладка — корректное пустое состояние;
 *   9) изменение статуса → запись уходит из выборки, счётчики обновляются,
 *      переход в соответствующую вкладку показывает запись;
 *  10) вкладка сохраняется после переоткрытия (URL ?status=…);
 *  11) РЕГРЕССИЯ: клики по вкладкам меняют строки БЕЗ перезагрузки страницы —
 *      счётчик загрузок документа (init-script) и живая метка не меняются;
 *      события page.on('framenavigated') учитываются отдельно.
 *
 * Пробные данные ТОЛЬКО с префиксом probe-dozv-tab- (3 бланка типа RUS,
 * номера 999901..999903). После прогона бланки, следы истории и presence
 * удаляются, число бланков в реестре сверяется с исходным.
 *
 * Запуск:
 *   node scripts/qa-dozvola-tabs-live.cjs             — обычный прогон (все проверки должны пройти)
 *   node scripts/qa-dozvola-tabs-live.cjs --baseline  — прогон «до починки»: печатает числа, не валит процесс
 */
const admin = require('firebase-admin');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SA = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '/Users/sergei/Downloads/ratipa-portal-firebase-adminsdk-fbsvc-972ed8f69f.json';
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const APP_URL = process.env.RATIPA_URL || 'http://127.0.0.1:3000/';
const BASELINE = process.argv.includes('--baseline');

const UID = 'probe-dozv-tab';
const PROBE_IDS = ['probe-dozv-tab-1', 'probe-dozv-tab-2', 'probe-dozv-tab-3'];
const PROBE_MARK = '99990';
const SEARCH_INPUT = 'input[placeholder="Быстрый поиск по бланку, машине или комментарию..."]';

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(SA, 'utf8'))),
  databaseURL: DB_URL,
});
const db = admin.database();
const get = async (p) => (await db.ref(p).get()).val();
const set = (p, v) => db.ref(p).set(v);
const del = (p) => db.ref(p).remove();

const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const verKey = appVersion.replace(/[.#$/[\]]/g, '_');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '  PASS' : '✗ FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
};

const profile = {
  uid: UID,
  name: 'probe-dozv-tab',
  firstName: 'Пробный',
  lastName: 'Вкладки',
  email: `${UID}@probe.local`,
  role: 'root_admin',
  permissions: { dozvola: 'write' },
  customPermissions: {},
  createdAt: new Date().toISOString(),
  onboarding: { [verKey]: 'done' },
};

// ── Независимый пересчёт ожиданий из базы (правила вкладок) ────────────────
const isFinal = (s) => s === 'used' || s === 'expired' || s === 'office_return';
const matchesTab = (item, tab) => {
  const s = item.status || '';
  if (tab === 'archive') return s === 'used';
  if (tab === 'office_returns') return s === 'office_return';
  if (tab === 'lost_expired') return s === 'lost' || s === 'expired';
  return !isFinal(s); // 'all'
};
function expectedFor(dbVal, { type = 'all', tab, lostExp = 'all', search = '' } = {}) {
  let list = Object.values(dbVal || {}).filter((i) => type === 'all' || i.type === type);
  list = list.filter((i) => matchesTab(i, tab));
  if (tab === 'lost_expired' && lostExp !== 'all') list = list.filter((i) => i.status === lostExp);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((i) =>
      (i.number || i.permitNumber || '').toLowerCase().includes(q) ||
      (i.car || i.assignedVehicle || '').toLowerCase().includes(q) ||
      (i.comment || i.comments || '').toLowerCase().includes(q) ||
      (i.type || '').toLowerCase().includes(q));
  }
  return list;
}
const labelOf = (i) => `${i.type} ${i.number || i.permitNumber || ''}`.trim();

// ── DOM-хелперы Playwright ─────────────────────────────────────────────────
const TAB_TEXT = {
  all: 'Все статусы',
  archive: 'Архив',
  office_returns: 'Использован',
  lost_expired: 'Утерянные / аннулированные',
};

async function findStatusTab(page, key) {
  const byAttr = page.locator(`[data-ui="dozvola-status-tab"][data-tab-key="${key}"]`);
  if (await byAttr.count()) return byAttr.first();
  const text = TAB_TEXT[key];
  const candidates = page.locator('button', { hasText: text });
  const n = await candidates.count();
  for (let i = 0; i < n; i++) {
    const t = (await candidates.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    if (t === text || t.startsWith(text + ' ')) return candidates.nth(i);
  }
  throw new Error(`Не найдена вкладка статуса: ${text}`);
}

async function clickStatusTab(page, key) {
  const tab = await findStatusTab(page, key);
  await tab.click();
  await page.waitForTimeout(250); // кадр отрисовки; данных с сервера нет — фильтрация на клиенте
}

async function tabCount(page, key) {
  const t = (await (await findStatusTab(page, key)).innerText()).replace(/\s+/g, ' ').trim();
  const m = t.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : NaN;
}

async function tableMetrics(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[data-nav-item]'));
    const items = rows.map((tr) => {
      const tds = tr.querySelectorAll('td');
      return {
        label: (tds[1]?.innerText || '').replace(/\s+/g, ' ').trim(),
        status: (tds[2]?.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    });
    return { count: items.length, labels: items.map((i) => i.label), statuses: [...new Set(items.map((i) => i.status))] };
  });
}

async function activeTabs(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((b) => /^(Все статусы|Архив|Использован|Утерянные \/ аннулированные)\s*\d+$/.test((b.innerText || '').replace(/\s+/g, ' ').trim()))
      .filter((b) => b.className.includes('bg-[#121316]'))
      .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()));
}

// Видимая кнопка «Показать ещё» реестра (в скрытых модулях есть одноимённые кнопки).
const showMoreBtn = (page) => page.locator('button:visible', { hasText: 'Показать ещё' });
const hasShowMore = async (page) => (await showMoreBtn(page).count()) > 0;
const emptyStateVisible = async (page) => (await page.locator('text=Не найдено ни одного бланка дозвола по выбранным критериям').count()) > 0;

async function clickButtonExact(page, text) {
  const candidates = page.locator('button');
  const n = await candidates.count();
  for (let i = 0; i < n; i++) {
    const b = candidates.nth(i);
    const t = (await b.innerText()).replace(/\s+/g, ' ').trim();
    if (t === text) { await b.click(); await page.waitForTimeout(200); return true; }
  }
  throw new Error('Не найдена кнопка: ' + text);
}

async function setSearch(page, value) {
  await page.locator(SEARCH_INPUT).fill(value);
  await page.waitForTimeout(650); // дебаунс поиска 300 мс + запас
}

async function gotoApp(page, status) {
  await page.goto(`${APP_URL}#dozvola/registry${status ? `?status=${status}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="Загрузка Ratipa Portal"]', { state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForSelector('tr[data-nav-item], text=Не найдено ни одного бланка', { timeout: 20000 }).catch(() => {});
}

// ── Пробные данные ─────────────────────────────────────────────────────────
let browser;
let registryBefore = 0;

async function cleanupProbe() {
  for (const id of PROBE_IDS) await del(`dozvolsRegistryV4/${id}`).catch(() => {});
  const hist = (await get('dozvolsHistoryV4').catch(() => null)) || {};
  let removed = 0;
  for (const [key, val] of Object.entries(hist)) {
    const s = JSON.stringify(val || {});
    if (s.includes(PROBE_MARK) || s.includes(UID) || s.includes('Пробный Вкладки')) {
      await del(`dozvolsHistoryV4/${key}`).catch(() => {});
      removed += 1;
    }
  }
  await del(`ratipapresence/${UID}`).catch(() => {});
  return removed;
}

async function seedProbe() {
  const base = { type: 'RUS', comment: 'Проба вкладок статусов', isCopy: false };
  await set('dozvolsRegistryV4/probe-dozv-tab-1', { ...base, id: 'probe-dozv-tab-1', number: '999901', status: 'hand', car: 'AO 9999-7', issueDate: '2026-09-01' });
  await set('dozvolsRegistryV4/probe-dozv-tab-2', { ...base, id: 'probe-dozv-tab-2', number: '999902', status: 'used', car: 'AO 9998-7', issueDate: '2026-08-01' });
  await set('dozvolsRegistryV4/probe-dozv-tab-3', { ...base, id: 'probe-dozv-tab-3', number: '999903', status: 'lost', car: 'AO 9997-7', issueDate: '2026-07-01' });
}

(async () => {
  const removedHist = await cleanupProbe();
  if (removedHist) console.log(`  (остатки прошлого прогона: снято записей истории — ${removedHist})`);
  registryBefore = Object.keys((await get('dozvolsRegistryV4')) || {}).length;
  await seedProbe();
  const seeded = Object.keys((await get('dozvolsRegistryV4')) || {}).length;
  check('пробные бланки созданы (3)', seeded === registryBefore + 3, `реестр: ${registryBefore} → ${seeded}`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'ru-RU' });
  const pageErrors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)));
    p.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  });
  await ctx.addInitScript(({ prof, vk }) => {
    try {
      localStorage.setItem('ratipa_user_session', JSON.stringify(prof));
      localStorage.setItem(`ratipa_tour_seen_${vk}_${prof.uid}`, '1');
      localStorage.setItem(`pl_dohod_announce_${prof.uid}`, '1');
      localStorage.setItem('ratipa_last_module', 'dozvola');
      // Счётчик загрузок документа: растёт ТОЛЬКО при реальной перезагрузке
      // документа (localStorage переживает перезагрузку, hash-переходы — нет).
      const loads = Number(localStorage.getItem('probe_doc_loads') || 0) + 1;
      localStorage.setItem('probe_doc_loads', String(loads));
      window.__docLoads = loads;
    } catch { /* ignore */ }
  }, { prof: profile, vk: verKey });

  const navEvents = [];
  const page = await ctx.newPage();
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navEvents.push(frame.url()); });

  const dbNow = async () => (await get('dozvolsRegistryV4')) || {};
  const docLoads = () => page.evaluate(() => window.__docLoads);

  await gotoApp(page, '');
  await page.waitForFunction(() => document.querySelectorAll('tr[data-nav-item]').length > 0, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { window.__probeAlive = 'yes'; });
  const loads0 = await docLoads();

  // ── Шаг 0: стартовое состояние ──────────────────────────────────────────
  let dbVal = await dbNow();
  let exp = expectedFor(dbVal, { tab: 'all' });
  let m = await tableMetrics(page);
  check('старт: активна «Все статусы», строки соответствуют выборке вкладки',
    (await activeTabs(page)).some((t) => t.startsWith('Все статусы')) &&
    m.count === Math.min(50, exp.length) && m.labels.every((l) => exp.some((i) => labelOf(i) === l)),
    `rows=${m.count}, ожидание=${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);

  // ── Шаг 1: последовательно все вкладки без перезагрузки ─────────────────
  for (const key of ['archive', 'office_returns', 'lost_expired', 'all']) {
    await clickStatusTab(page, key);
    dbVal = await dbNow();
    exp = expectedFor(dbVal, { tab: key });
    m = await tableMetrics(page);
    const act = await activeTabs(page);
    const okActive = act.length === 1 && act[0].startsWith(TAB_TEXT[key]);
    const okRows = m.count === Math.min(50, exp.length) && m.labels.every((l) => exp.some((i) => labelOf(i) === l));
    check(`живой переход → «${TAB_TEXT[key]}»: выделение и строки соответствуют вкладке`,
      okActive && okRows,
      `активно="${act.join('|') || '—'}", rows=${m.count}, ожидание=${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);
  }
  const loads1 = await docLoads();
  const alive1 = await page.evaluate(() => window.__probeAlive);
  check('РЕГРЕССИЯ (зачётная): все клики по вкладкам — без перезагрузки страницы',
    loads1 === loads0 && alive1 === 'yes',
    `загрузок документа: ${loads0} → ${loads1}; живая метка=${alive1}; framenavigated-событий=${navEvents.length}`);

  // ── Шаг 2: счётчики вкладок согласованы с правилами полей ───────────────
  dbVal = await dbNow();
  const rawAll = Object.values(dbVal);
  const cntArch = await tabCount(page, 'archive');
  const cntRet = await tabCount(page, 'office_returns');
  const cntLostExp = await tabCount(page, 'lost_expired');
  const expArch = rawAll.filter((i) => i.status === 'used').length;
  const expRet = rawAll.filter((i) => i.status === 'office_return').length;
  const expLostExp = rawAll.filter((i) => i.status === 'lost' || i.status === 'expired').length;
  check('счётчики вкладок согласованы: архив=«Сдан в ТИ», использован=office_return, утерянные=lost+expired',
    cntArch === expArch && cntRet === expRet && cntLostExp === expLostExp,
    `UI: архив=${cntArch}/база=${expArch}, исп=${cntRet}/${expRet}, ут=${cntLostExp}/${expLostExp}`);

  // ── Шаг 3: прицельные переходы при фильтре вида RUS ─────────────────────
  await clickButtonExact(page, 'RUS');
  await clickStatusTab(page, 'archive');
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'archive' });
  m = await tableMetrics(page);
  check('«Архив» + вид RUS: только «Сдан в ТИ», включая пробный 999902',
    m.count === Math.min(50, exp.length) && m.statuses.every((s) => s.startsWith('Сдан в ТИ')) && m.labels.some((l) => l.includes('999902')),
    `rows=${m.count}/${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);

  await clickStatusTab(page, 'office_returns');
  m = await tableMetrics(page);
  check('«Использован» + вид RUS: только «Использован»',
    m.count > 0 && m.statuses.every((s) => s.startsWith('Использован')),
    `rows=${m.count}, статусы=${m.statuses.join(',')}`);

  await clickStatusTab(page, 'lost_expired');
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'lost_expired' });
  m = await tableMetrics(page);
  check('«Утерянные / аннулированные» + RUS: «Утерян» и «Аннулирован» (в т.ч. пробный 999903)',
    m.count === Math.min(50, exp.length) && m.statuses.every((s) => s === 'Утерян' || s === 'Аннулирован') && m.labels.some((l) => l.includes('999903')),
    `rows=${m.count}/${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);

  // Уточнения внутри «Утерянные / аннулированные»
  const clickSub = async (label) => {
    const b = page.locator('button', { hasText: label });
    const n = await b.count();
    for (let i = 0; i < n; i++) {
      const t = (await b.nth(i).innerText()).replace(/\s+/g, ' ').trim();
      if (t.startsWith(label + ' ·') || t === label) { await b.nth(i).click(); await page.waitForTimeout(250); return; }
    }
    throw new Error('Не найдено уточнение: ' + label);
  };
  await clickSub('Аннулирован');
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'lost_expired', lostExp: 'expired' });
  m = await tableMetrics(page);
  check('уточнение «Аннулирован»: только аннулированные RUS',
    m.count === Math.min(50, exp.length) && m.statuses.every((s) => s === 'Аннулирован'),
    `rows=${m.count}, ожидание=${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);
  await clickSub('Утерян');
  m = await tableMetrics(page);
  check('уточнение «Утерян»: только утерянные (пробный 999903)',
    m.count === 1 && m.labels[0].includes('999903'),
    `rows=${m.count}, labels=${m.labels.join(',')}`);
  await clickSub('Оба статуса');

  // ── Шаг 4: быстрое многократное переключение ────────────────────────────
  for (const key of ['all', 'office_returns', 'lost_expired', 'archive', 'all', 'lost_expired']) {
    await (await findStatusTab(page, key)).click(); // без пауз между кликами
  }
  await page.waitForTimeout(700);
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'lost_expired' });
  m = await tableMetrics(page);
  const actQuick = await activeTabs(page);
  check('быстрое переключение: побеждает ПОСЛЕДНЯЯ вкладка («Утерянные / аннулированные»)',
    actQuick.length === 1 && actQuick[0].startsWith('Утерянные / аннулированные') &&
    m.count === Math.min(50, exp.length) && m.statuses.every((s) => s === 'Утерян' || s === 'Аннулирован'),
    `активно="${actQuick.join('|')}", rows=${m.count}, ожидание=${Math.min(50, exp.length)}, статусы=${m.statuses.join(',')}`);
  const labelsQuick = m.labels.slice();

  // ── Шаг 4б: выделение строк не переносится на другую вкладку ────────────
  await clickStatusTab(page, 'all');
  await page.waitForTimeout(250);
  const bulkPanel = page.locator('[aria-label="Массовые действия над выбранными дозволами"]');
  await page.locator('tr[data-nav-item] input[type="checkbox"]').first().click();
  await page.waitForTimeout(250);
  const panelBefore = await bulkPanel.count();
  await clickStatusTab(page, 'archive');
  await page.waitForTimeout(300);
  const panelAfter = await bulkPanel.count();
  const checkedAfter = await page.locator('tr[data-nav-item] input[type="checkbox"]:checked').count();
  check('выделение строк предыдущей выборки очищается при смене вкладки',
    panelBefore === 1 && panelAfter === 0 && checkedAfter === 0,
    `панель массовых действий: ${panelBefore} → ${panelAfter}, отмеченных строк=${checkedAfter}`);

  // ── Шаг 5: пустая вкладка ───────────────────────────────────────────────
  await clickButtonExact(page, 'CHN 2');
  await clickStatusTab(page, 'all');         // базовая вкладка (клик по активной «all» идемпотентен)
  await clickStatusTab(page, 'lost_expired'); // у вида CHN 2 нет утерянных/аннулированных
  await page.waitForTimeout(250);
  m = await tableMetrics(page);
  const emptyVisible = await emptyStateVisible(page);
  check('пустая вкладка: строк предыдущей выборки нет, показано пустое состояние',
    m.count === 0 && emptyVisible && labelsQuick.length > 0,
    `rows=${m.count}, пустое состояние=${emptyVisible}, предыдущая выборка была ${labelsQuick.length} строк`);

  // ── Шаг 6: поиск и вид сохраняются при переключении вкладок ─────────────
  await clickButtonExact(page, 'RUS');
  await setSearch(page, '999');
  await clickStatusTab(page, 'archive');
  const searchVal = await page.locator(SEARCH_INPUT).inputValue();
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'archive', search: '999' });
  m = await tableMetrics(page);
  check('активный поиск при переключении: строки = архив ∩ RUS ∩ «999»',
    searchVal === '999' && m.count === Math.min(50, exp.length) && m.labels.every((l) => exp.some((i) => labelOf(i) === l)) && m.labels.some((l) => l.includes('999902')),
    `search="${searchVal}", rows=${m.count}, ожидание=${Math.min(50, exp.length)}, labels=${m.labels.slice(0, 5).join(',')}`);

  await clickStatusTab(page, 'lost_expired');
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'lost_expired', search: '999' });
  m = await tableMetrics(page);
  check('поиск сохраняется и на другой вкладке «Утерянные / аннулированные»',
    m.count === Math.min(50, exp.length) && m.labels.every((l) => exp.some((i) => labelOf(i) === l)) && m.labels.some((l) => l.includes('999903')),
    `rows=${m.count}, ожидание=${Math.min(50, exp.length)}, labels=${m.labels.join(',')}`);
  const typeActive = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === 'RUS' && b.className.includes('bg-[#121316]')));
  check('фильтр вида RUS остался активным после переключений вкладок', typeActive, `typeActive=${typeActive}`);

  // ── Шаг 6б: согласование фильтра «Статус» (выпадающий список) с вкладкой ─
  const filterSelect = page.locator('select:visible').filter({ hasText: 'Сдана копия (CHN 2/3)' });
  await setSearch(page, '');
  await clickStatusTab(page, 'all');
  await filterSelect.selectOption('office');
  await page.waitForTimeout(300);
  m = await tableMetrics(page);
  check('фильтр «В офисе» сужает выборку вкладки «Все статусы»',
    m.count > 0 && m.statuses.every((s) => s === 'В офисе'),
    `rows=${m.count}, статусы=${m.statuses.join(',')}`);
  await clickStatusTab(page, 'archive');
  await page.waitForTimeout(300);
  const filterAfter = await filterSelect.inputValue();
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'archive' });
  m = await tableMetrics(page);
  check('несовместимый фильтр «В офисе» сброшен при переходе в «Архив» — строки вкладки не заблокированы',
    filterAfter === 'all' && m.count === Math.min(50, exp.length) && m.statuses.every((s) => s.startsWith('Сдан в ТИ')),
    `фильтр=${filterAfter}, rows=${m.count}, ожидание=${Math.min(50, exp.length)}`);
  await filterSelect.selectOption('copy_no');
  await page.waitForTimeout(300);
  await clickStatusTab(page, 'lost_expired');
  await page.waitForTimeout(300);
  const filterKept = await filterSelect.inputValue();
  check('совместимый фильтр («Нет копии») сохраняется при переключении вкладки', filterKept === 'copy_no', `фильтр=${filterKept}`);
  await filterSelect.selectOption('all');
  await page.waitForTimeout(250);

  // ── Шаг 7: пагинация: «Показать ещё» и сброс при смене вкладки ──────────
  await setSearch(page, '');
  await clickStatusTab(page, 'archive');
  await page.waitForTimeout(250);
  const hasMoreArchive = await hasShowMore(page);
  const cntBeforeMore = (await tableMetrics(page)).count;
  if (hasMoreArchive) {
    await showMoreBtn(page).first().click();
    await page.waitForTimeout(350);
  }
  const cntAfterMore = (await tableMetrics(page)).count;
  check('«Показать ещё» расширяет выборку архива', hasMoreArchive && cntAfterMore > cntBeforeMore, `было=${cntBeforeMore}, стало=${cntAfterMore}`);

  await clickStatusTab(page, 'all');   // промежуточная вкладка
  await clickStatusTab(page, 'archive'); // возврат: пагинация должна начаться с первой страницы
  await page.waitForTimeout(250);
  dbVal = await dbNow();
  exp = expectedFor(dbVal, { type: 'RUS', tab: 'archive' });
  m = await tableMetrics(page);
  check('возврат на «Архив» после «Показать ещё»: пагинация сброшена к первой странице',
    m.count === Math.min(50, exp.length) && (await hasShowMore(page)),
    `rows=${m.count}, ожидание=${Math.min(50, exp.length)}, (до переключения показывалось ${cntAfterMore})`);

  // ── Шаг 8: смена статуса → выборка и счётчики без перезагрузки ──────────
  await clickStatusTab(page, 'all');
  await page.waitForTimeout(250);
  const cntArchBefore = await tabCount(page, 'archive');
  const rowsBeforeChange = (await tableMetrics(page)).count;
  const row = page.locator('tr[data-nav-item]', { hasText: '999901' });
  check('пробный 999901 виден на вкладке «Все статусы» (в рейсе)', (await row.count()) === 1, `строк на вкладке=${rowsBeforeChange}`);
  await row.locator('select').selectOption('used');
  const dlg = page.locator('[data-ratipa-dialog]');
  await dlg.waitFor({ timeout: 5000 });
  await dlg.locator('button', { hasText: 'Перевести в «Сдан в ТИ»' }).click();
  await page.waitForTimeout(900);
  const stillVisible = (await page.locator('tr[data-nav-item]', { hasText: '999901' }).count()) > 0;
  m = await tableMetrics(page);
  check('после смены статуса запись ушла из текущей выборки без перезагрузки',
    !stillVisible && m.count === rowsBeforeChange - 1,
    `до=${rowsBeforeChange}, после=${m.count}, запись видна=${stillVisible}`);
  const cntArchAfter = await tabCount(page, 'archive');
  check('счётчик архива обновился без перезагрузки', cntArchAfter === cntArchBefore + 1, `${cntArchBefore} → ${cntArchAfter}`);
  const loadsStatus = await docLoads();
  check('смена статуса произошла без перезагрузки страницы', loadsStatus === loads0, `загрузок документа=${loadsStatus}`);

  await clickStatusTab(page, 'archive');
  await page.waitForTimeout(250);
  m = await tableMetrics(page);
  check('переход в «Архив» показывает изменённую запись 999901 со статусом «Сдан в ТИ»',
    m.labels.some((l) => l.includes('999901')) && m.statuses.every((s) => s.startsWith('Сдан в ТИ')),
    `rows=${m.count}, есть 999901=${m.labels.some((l) => l.includes('999901'))}`);

  // ── Шаг 9: вкладка переживает переоткрытие страницы ─────────────────────
  const beforeReload = await tableMetrics(page);
  const loadsBeforeF5 = await docLoads();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[aria-label="Загрузка Ratipa Portal"]', { state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForSelector('tr[data-nav-item]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  const afterReload = await tableMetrics(page);
  const loadsAfterF5 = await docLoads();
  const actReload = await activeTabs(page);
  check('вкладка «Архив» сохранилась после переоткрытия и наполнена теми же строками',
    actReload.some((t) => t.startsWith('Архив')) && afterReload.count === beforeReload.count && afterReload.statuses.every((s) => s.startsWith('Сдан в ТИ')),
    `до F5 rows=${beforeReload.count}, после F5 rows=${afterReload.count}, активно="${actReload.join('|')}"`);
  check('перезагрузка в этом шаге ровно одна (документ грузился заново только из-за F5)',
    loadsAfterF5 === loadsBeforeF5 + 1, `загрузок документа: ${loadsBeforeF5} → ${loadsAfterF5}`);
  // ── Итог ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  framenavigated-события (допустимы: hash-переходы в том же документе): ${navEvents.length}`);
  if (pageErrors.length) console.log(`  Ошибки страницы (${pageErrors.length}): ${pageErrors.slice(0, 5).join(' | ')}`);
  const runnerErrors = pageErrors.filter((e) => !/favicon|Failed to load resource/.test(e));
  check('в ходе прогона не было ошибок страницы', runnerErrors.length === 0, runnerErrors.slice(0, 3).join(' | ') || 'нет');

  await ctx.close();
  await browser.close();
  browser = null;

  const removed = await cleanupProbe();
  const registryAfter = Object.keys((await get('dozvolsRegistryV4')) || {}).length;
  const histLeft = Object.values((await get('dozvolsHistoryV4').catch(() => null)) || {}).filter((h) => JSON.stringify(h || {}).includes(PROBE_MARK)).length;
  const presenceLeft = (await get(`ratipapresence/${UID}`)) !== null && (await get(`ratipapresence/${UID}`)) !== undefined;
  console.log(`  уборка: снято записей истории=${removed}, следов probe в истории=${histLeft}, реестр ${registryBefore} → ${registryAfter}, presence остался=${presenceLeft}`);
  check('пробные данные удалены, число бланков в реестре вернулось к исходному', registryAfter === registryBefore && histLeft === 0, `${registryBefore} → ${registryAfter}, следов=${histLeft}`);

  const failedFinal = results.filter((r) => !r.ok);
  console.log(`\nИТОГО: ${results.length - failedFinal.length}/${results.length} проверок пройдено${failedFinal.length ? '; провалы: ' + failedFinal.map((f) => f.name).join('; ') : ''}`);
  process.exit(BASELINE || failedFinal.length === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('КРИТИЧЕСКАЯ ОШИБКА:', (e && e.stack) || e);
  try { if (browser) await browser.close(); } catch {}
  try { await cleanupProbe(); } catch {}
  process.exit(2);
});
