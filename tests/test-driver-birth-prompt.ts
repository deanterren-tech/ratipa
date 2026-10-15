/**
 * test-driver-birth-prompt — юнит-проверки ЧИСТОГО слоя окна «Дата рождения
 * водителя» (src/utils/driverBirthPrompt.ts):
 *
 *  · пороги правдоподобия (пусто / не разбирается / не существует в календаре /
 *    будущее / раньше 1940 / позже 2010 / младше 18 лет);
 *  · разбор и нормализация всех встречающихся форматов (ISO, ДД/ММ/ГГГГ,
 *    ДД.ММ.ГГГГ, двузначный год) в ISO;
 *  · выбор кандидатов «кто смотрит»: право правки реестра (resolvePermission),
 *    свои водители у диспетчера, все — у администратора, служебные и архивные
 *    записи мимо; телефон/машина/текущее значение в кандидате;
 *  · «один раз за запуск»: ключ ratipa_birth_prompt_<uid> и метка сессии.
 *
 * Запуск: npm run test:birth-prompt   (или npx tsx tests/test-driver-birth-prompt.ts)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import {
  BIRTH_MIN_AGE,
  BIRTH_PROMPT_STORAGE_PREFIX,
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  birthDateProblemLabel,
  birthPromptProgress,
  birthPromptQueue,
  birthPromptStorageKey,
  birthPromptTitle,
  birthSaveBlockLabel,
  birthSaveBlockReason,
  canEditDriverRegistry,
  checkBirthDate,
  isResponsibleDispatcher,
  markBirthPromptShown,
  needsBirthDate,
  normalizeBirthDate,
  selectBirthPromptCandidates,
  todayISO,
  wasBirthPromptShown,
  type BirthPromptDriverLike,
  type BirthPromptStorage,
  type BirthPromptViewer,
} from '../src/utils/driverBirthPrompt.ts';
import {
  buildDriverDataQualityRows,
  driverDataIssueLabel,
} from '../src/utils/driverDataQuality.ts';
import type { DriverRecord } from '../src/utils/driverRegistry.ts';

let checks = 0;
const fails: string[] = [];

const ok = (cond: boolean, name: string): void => {
  checks += 1;
  if (!cond) fails.push(name);
};
const eq = <T>(actual: T, expected: T, name: string): void => {
  checks += 1;
  if (actual !== expected) fails.push(`${name}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
};

/** Дата «сегодня» для проверок — фиксированная, чтобы возраст был предсказуем. */
const NOW = new Date(2026, 6, 15); // 15 июля 2026

const viewer = (over: Partial<BirthPromptViewer> & { role: string }): BirthPromptViewer => ({
  uid: 'u-1',
  name: 'Тест Тестов',
  permissions: {},
  customPermissions: {},
  ...over,
});

const driver = (over: Partial<BirthPromptDriverLike> & { id: string }): BirthPromptDriverLike => ({
  name: 'Иванов Иван Иванович',
  lastNameRu: 'Иванов',
  firstNameRu: 'Иван',
  middleNameRu: 'Иванович',
  dispatcherId: 'u-1',
  ...over,
});

/* ── 1. Пороги и причины ────────────────────────────────────────────────── */

eq(BIRTH_YEAR_MIN, 1940, 'порог «раньше» = 1940');
eq(BIRTH_YEAR_MAX, 2010, 'порог «позже» = 2010');
eq(BIRTH_MIN_AGE, 18, 'минимальный возраст = 18');
eq(todayISO(NOW), '2026-07-15', 'todayISO собирает локальную дату');

eq(checkBirthDate('', NOW).problem, 'empty', 'пустая строка — «не заполнена»');
eq(checkBirthDate(undefined, NOW).problem, 'empty', 'undefined — «не заполнена»');
eq(checkBirthDate('   ', NOW).problem, 'empty', 'пробелы — «не заполнена»');
eq(checkBirthDate(null, NOW).needsInput, true, 'null — требуется ввод');

ok(checkBirthDate('14/07/1991', NOW).needsInput === false, 'правдоподобная дата не требует ввода');
eq(checkBirthDate('14/07/1991', NOW).iso, '1991-07-14', 'ISO собирается из ДД/ММ/ГГГГ');
eq(checkBirthDate('14.07.1991', NOW).iso, '1991-07-14', 'разбор ДД.ММ.ГГГГ');
eq(checkBirthDate('14/07/1991', NOW).problem, null, 'правдоподобная дата без причины');

eq(normalizeBirthDate('14.07.1991'), '1991-07-14', 'нормализация ДД.ММ.ГГГГ → ISO');
eq(normalizeBirthDate('1.7.1991'), '1991-07-01', 'однозначные день/месяц дополняются нулями');
eq(normalizeBirthDate('14/07/91'), '1991-07-14', 'двузначный год 91 → 1991');
eq(normalizeBirthDate('14.07.05'), '2005-07-14', 'двузначный год 05 → 2005');
eq(normalizeBirthDate('1991-07-14T00:00:00.000Z'), '1991-07-14', 'ISO со временем разбирается');
eq(normalizeBirthDate('не дата'), '', 'текст не дата → пусто');
eq(normalizeBirthDate('31/02/1990'), '', 'несуществующая дата не нормализуется');

eq(checkBirthDate('31/02/1990', NOW).problem, 'invalid-calendar', '30 февраля — «такой даты нет»');
eq(checkBirthDate('сегодня', NOW).problem, 'unparsable', 'неразбираемый текст — «дата не распознана»');
eq(checkBirthDate('1991-13-45', NOW).problem, 'unparsable', 'месяц 13 — не распознано');
eq(checkBirthDate('1939-05-05', NOW).problem, 'too-old', 'год 1939 — раньше порога');
ok(checkBirthDate('1940-01-01', NOW).needsInput === false, 'год 1940 — уже правдоподобно');
eq(checkBirthDate('1940-01-01', NOW).iso, '1940-01-01', 'год 1940 проходит');
eq(checkBirthDate('2011-05-05', NOW).problem, 'too-young', 'год 2011 — позже порога');
eq(checkBirthDate('2010-05-05', NOW).problem, 'too-young', 'год 2010 (16 лет) — младше 18');
eq(checkBirthDate('2009-07-14', NOW).problem, 'too-young', '2009 год (17 лет) — младше 18 лет');
ok(checkBirthDate('2009-07-14', NOW).needsInput === true, '2009 год (17 лет) требует ввода');
ok(checkBirthDate('2008-07-16', NOW).needsInput === true, 'за день до 18-летия — требует ввода');
ok(checkBirthDate('2008-07-15', NOW).needsInput === false, 'ровно 18 лет сегодня — ввод не требуется');
ok(checkBirthDate('2008-07-01', NOW).needsInput === false, '18 лет уже исполнилось — ввод не требуется');
eq(checkBirthDate('2026-07-16', NOW).problem, 'future', 'дата в будущем');
eq(checkBirthDate('2026-07-15', NOW).problem, 'too-young', 'сегодняшняя дата — младше 18');
ok(checkBirthDate('2025-12-31', NOW).problem === 'too-young', '2025 год — младше 18 (правило возраста)');
eq(needsBirthDate('14.07.1991', NOW), false, 'needsBirthDate: правдоподобная — не требуется');
eq(needsBirthDate('', NOW), true, 'needsBirthDate: пустая — требуется');
eq(birthDateProblemLabel('empty'), 'Дата рождения не заполнена', 'подпись причины «пусто»');
ok(birthDateProblemLabel('too-old').includes(String(BIRTH_YEAR_MIN)), 'подпись «too-old» содержит порог');
ok(birthDateProblemLabel('too-young').length > 0, 'подпись «too-young» не пуста');
ok(birthDateProblemLabel(null) === '', 'без причины подписи нет');
// Возраст считается от «сегодня», а не от текущей даты машины.
eq(checkBirthDate('2005-01-01', new Date(2020, 0, 10)).problem, 'too-young', 'возраст считается от переданной даты (2020)');
ok(checkBirthDate('2005-01-01', new Date(2030, 0, 10)).needsInput === false, 'к 2030 году та же дата правдоподобна');

/* ── 2. Право правки реестра водителей (resolvePermission) ──────────────── */

ok(canEditDriverRegistry(viewer({ role: 'dispatcher', permissions: { settings: 'write' } })), 'диспетчер с правом settings=write — правка разрешена');
ok(canEditDriverRegistry(viewer({ role: 'dispatcher', customPermissions: { settings: 'write' } })), 'право settings=write через customPermissions');
ok(!canEditDriverRegistry(viewer({ role: 'mechanic', permissions: { settings: 'none', vehicleDriverData: 'none' } })), 'механик без прав — окно не его');
ok(!canEditDriverRegistry(viewer({ role: 'accountant' })), 'бухгалтер без права settings — окно не его');
ok(!canEditDriverRegistry(viewer({ role: 'viewer' })), 'наблюдатель без прав — окно не его');
ok(canEditDriverRegistry(viewer({ role: 'root_admin', permissions: {} })), 'root_admin — право есть');
ok(!canEditDriverRegistry(null), 'без профиля окна нет');
ok(canEditDriverRegistry(viewer({ role: 'admin', permissions: {} })), 'роль admin — право на реестр есть');
// Боевая ловушка: право vehicleDriverData выдано бухгалтеру, но реестр водителей
// он не ведёт — окно по нему открываться НЕ должно.
ok(!canEditDriverRegistry(viewer({ role: 'accountant', permissions: { settings: 'none' }, customPermissions: { vehicleDriverData: 'write' } })), 'vehicleDriverData=write без settings — окна нет');
ok(!canEditDriverRegistry(viewer({ role: 'accountant' }), { accountant: { settings: 'none', vehicleDriverData: 'write' } }), 'боевые права роли: бухгалтер (vehicleDriverData=write) окна не видит');
ok(canEditDriverRegistry(viewer({ role: 'dispatcher' }), { dispatcher: { settings: 'write', vehicleDriverData: 'write' } }), 'боевые права роли: диспетчер (settings=write) окно видит');
// Явные права роли из настроек имеют приоритет над базовыми.
ok(!canEditDriverRegistry(viewer({ role: 'dispatcher' }), { dispatcher: { settings: 'none', vehicleDriverData: 'none' } }), 'права роли из настроек: settings=none — окна нет');
ok(canEditDriverRegistry(viewer({ role: 'logist' }), { logist: { settings: 'write' } }), 'права роли из настроек: settings=write — окно есть');
// Адресность: ответственный — СТРОГО по стабильному id записи (drivers.dispatcherId),
// не по имени и не по праву: settings=write даёт лишь возможность СОХРАНИТЬ.
ok(isResponsibleDispatcher(viewer({ uid: 'u-1', role: 'dispatcher' }), { id: 'd', dispatcherId: 'u-1' }), 'ответственный совпадает по id');
ok(!isResponsibleDispatcher(viewer({ uid: 'u-1', name: 'Матвей', role: 'dispatcher' }), { id: 'd', dispatcherId: 'u-2', dispatcherName: 'Матвей' }), 'совпадение по имени — не ответственный (только id)');
ok(!isResponsibleDispatcher(viewer({ uid: 'u-1', role: 'dispatcher' }), { id: 'd', dispatcherId: '' }), 'пустой ответственный — никто не ответственный');
ok(!isResponsibleDispatcher(viewer({ uid: '', role: 'dispatcher' }), { id: 'd', dispatcherId: '' }), 'без uid ответственного нет');
ok(!isResponsibleDispatcher(null, { id: 'd', dispatcherId: 'u-1' }), 'без профиля ответственного нет');
ok(isResponsibleDispatcher(viewer({ uid: 'root-1', role: 'root_admin' }), { id: 'd', dispatcherId: 'root-1' }), 'root_admin — ответственный там, где прямо назначен (по id)');

/* ── 3. Выбор кандидатов ────────────────────────────────────────────────── */

const dispatcherViewer = viewer({ role: 'dispatcher', uid: 'u-1', permissions: { settings: 'write' } });
const DISP = [
  driver({ id: 'd-empty', name: 'Борисов Борис', birthDate: '' }),
  driver({ id: 'd-absent', name: 'Андреев Андрей', birthDate: undefined }),
  driver({ id: 'd-bad-year', name: 'Ветров Виктор', birthDate: '01.01.1930' }),
  driver({ id: 'd-ok', name: 'Гончаров Гена', birthDate: '14/07/1991' }),
  driver({ id: 'd-foreign', name: 'Дроздов Дмитрий', birthDate: '', dispatcherId: 'u-2' }),
  driver({ id: 'd-orphan', name: 'Ершов Егор', birthDate: '', dispatcherId: undefined, dispatcher: '' }),
  driver({ id: 'd-archived', name: 'Жуков Жан', birthDate: '', archived: true }),
  driver({ id: 'd-service', name: 'без В.', birthDate: '' }),
  driver({ id: 'd-phones', name: 'Зайцев Захар', birthDate: '', phones: [{ id: 'p1', number: '+375 11', isPrimary: false }, { id: 'p2', number: '+375 22', isPrimary: true }] }),
];

const own = selectBirthPromptCandidates(DISP, dispatcherViewer, { now: NOW });
eq(own.length, 4, 'диспетчер видит только своих без правдоподобной даты');
eq(own.map((c) => c.id).join(','), 'd-absent,d-empty,d-bad-year,d-phones', 'порядок — по ФИО (ru)');
eq(own.find((c) => c.id === 'd-empty')?.reason, birthDateProblemLabel('empty'), 'причина у кандидата — из проверки');
eq(own.find((c) => c.id === 'd-bad-year')?.current, '01.01.1930', 'текущее значение из карточки сохраняется');
eq(own.find((c) => c.id === 'd-phones')?.phone, '+375 22', 'основной телефон из phones');
eq(own.find((c) => c.id === 'd-empty')?.car, '', 'без сцепки машины нет');
ok(!own.some((c) => c.id === 'd-foreign'), 'чужой водитель в список не попадает');
ok(!own.some((c) => c.id === 'd-orphan'), 'водитель без ответственного в окно не попадает');
ok(!own.some((c) => c.id === 'd-archived'), 'архивная запись не мешает диспетчеру');
ok(!own.some((c) => c.id === 'd-service'), 'служебная запись («без В.») не человек');
ok(!own.some((c) => c.id === 'd-ok'), 'правдоподобная дата в окно не попадает');

const couplings = [
  { driverId: 'd-empty', carNumber: 'АА1234-5' },
  { driverId: 'd-phones', vehicleNumbers: 'ВВ0001-2' },
];
const withCar = selectBirthPromptCandidates(DISP, dispatcherViewer, { now: NOW, couplings });
eq(withCar.find((c) => c.id === 'd-empty')?.car, 'АА1234-5', 'машина берётся из сцепки (carNumber)');
eq(withCar.find((c) => c.id === 'd-phones')?.car, 'ВВ0001-2', 'машина берётся из сцепки (vehicleNumbers)');

// Адресность для ВСЕХ ролей: чужие записи и записи без ответственного не
// попадают в персональное окно ни у кого, включая root/администратора —
// они проверяют полноту данных отдельным административным инструментом.
const rootAll = selectBirthPromptCandidates(DISP, viewer({ role: 'root_admin', uid: 'root-1', permissions: {} }), { now: NOW });
eq(rootAll.length, 0, 'root_admin без назначенных водителей окна не получает');
ok(!rootAll.some((c) => c.id === 'd-foreign') && !rootAll.some((c) => c.id === 'd-orphan'), 'чужие и записи без ответственного не попадают и к root_admin');
const adminAll = selectBirthPromptCandidates(DISP, viewer({ role: 'admin', uid: 'adm-1', permissions: {} }), { now: NOW });
eq(adminAll.length, 0, 'роль admin без назначенных водителей окна не получает');
// Право settings=write — возможность СОХРАНИТЬ, а не охват: даже с полными
// правами (admin/vehicleDriverData=write) диспетчер видит только свои записи.
const wideRights = viewer({ role: 'dispatcher', uid: 'u-1', permissions: { settings: 'write' }, customPermissions: { admin: 'write', vehicleDriverData: 'write' } });
const wideOwn = selectBirthPromptCandidates(DISP, wideRights, { now: NOW });
eq(wideOwn.length, 4, 'settings=write не расширяет охват — только свои записи по id');
ok(!wideOwn.some((c) => c.id === 'd-foreign') && !wideOwn.some((c) => c.id === 'd-orphan'), 'права не дают видеть чужих и записи без ответственного');
// root_admin — ответственный по id: видит ровно свой водитель без даты (адресность, не роль).
const rootOwn = selectBirthPromptCandidates(
  [...DISP, driver({ id: 'd-root', name: 'Яров Ярослав', birthDate: '', dispatcherId: 'root-1' })],
  viewer({ role: 'root_admin', uid: 'root-1', permissions: {} }),
  { now: NOW },
);
eq(rootOwn.length, 1, 'root_admin как ответственный видит только своего водителя');
eq(rootOwn[0]?.id, 'd-root', 'адресность root_admin — по id, а не по роли');
// Переназначение ответственного пересчитывает очередь: у старого запись исчезает,
// у нового — появляется (это же повторяет живая подписка в окне).
const reassigned = DISP.map((d) => (d.id === 'd-empty' ? { ...d, dispatcherId: 'u-2' } : d));
const afterReassignA = selectBirthPromptCandidates(reassigned, dispatcherViewer, { now: NOW });
ok(!afterReassignA.some((c) => c.id === 'd-empty'), 'переназначение: запись ушла у старого ответственного');
const viewerB = viewer({ role: 'dispatcher', uid: 'u-2', permissions: { settings: 'write' } });
const afterReassignB = selectBirthPromptCandidates(reassigned, viewerB, { now: NOW });
ok(afterReassignB.some((c) => c.id === 'd-empty'), 'переназначение: запись пришла к новому ответственному');
ok(afterReassignB.some((c) => c.id === 'd-foreign') && !afterReassignB.some((c) => c.id === 'd-phones'), 'у нового ответственного — только его записи (u-2)');
ok(!afterReassignB.some((c) => c.id === 'd-orphan'), 'запись без ответственного не приходит никому и после переназначений');

// Без права правки окно не поднимается вообще.
eq(selectBirthPromptCandidates(DISP, viewer({ role: 'mechanic', uid: 'u-1', permissions: { settings: 'none' } }), { now: NOW }).length, 0, 'механик кандидатов не видит');
eq(selectBirthPromptCandidates(DISP, viewer({ role: 'dispatcher', uid: '' }), { now: NOW }).length, 0, 'без uid кандидатов нет');
eq(selectBirthPromptCandidates(null, dispatcherViewer, { now: NOW }).length, 0, 'пустой реестр — пустой список');
eq(selectBirthPromptCandidates([driver({ id: 'x', birthDate: '' })], null, { now: NOW }).length, 0, 'без профиля-смотрящего список пуст');
ok(selectBirthPromptCandidates(DISP, viewer({ role: 'dispatcher', permissions: { settings: 'read' }, uid: 'u-1' }), { now: NOW }).length === 0, 'права «read» для окна мало');

/* ── 4. «Один раз за запуск» ────────────────────────────────────────────── */

const store = (): BirthPromptStorage & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
};
eq(birthPromptStorageKey('u-1'), `${BIRTH_PROMPT_STORAGE_PREFIX}u-1`, 'ключ окна — на пользователя');

const s1 = store();
ok(!wasBirthPromptShown('u-1', s1, 'session-A'), 'до показа окна метки нет');
markBirthPromptShown('u-1', s1, 'session-A');
ok(wasBirthPromptShown('u-1', s1, 'session-A'), 'в том же запуске второй раз не показываем');
ok(!wasBirthPromptShown('u-1', s1, 'session-B'), 'в новом запуске окно вернётся («Позже» — не навсегда)');
ok(!wasBirthPromptShown('u-2', s1, 'session-A'), 'метка одного пользователя не гасит окно другого');
const broken = { getItem: () => '{не json', setItem: () => {} } as BirthPromptStorage;
ok(!wasBirthPromptShown('u-1', broken, 'session-A'), 'битое значение не ломает окно');
ok(!wasBirthPromptShown('u-1', null, 'session-A'), 'без хранилища (приватный режим) окно работает');

/* ── 5. Подписи окна ────────────────────────────────────────────────────── */

eq(birthPromptProgress(0, 3), '1 из 3', 'прогресс «1 из 3»');
eq(birthPromptProgress(2, 3), '3 из 3', 'прогресс «3 из 3»');
eq(birthPromptProgress(0, 1), '1 из 1', 'один водитель — «1 из 1»');
eq(birthPromptTitle(1), 'Дата рождения водителя', 'заголовок для одного');
eq(birthPromptTitle(3), 'Даты рождения водителей', 'заголовок для списка');

/* ── 6. Живая очередь и счётчик окна ────────────────────────────────────── */

// Очередь собирается из живых кандидатов (подписка реестра): счётчик окна =
// внесённые + остаток очереди; после сохранения прогресс растёт без перезагрузки.
const q0 = birthPromptQueue(own, {});
eq(q0.total, own.length, 'счётчик = длина очереди');
eq(q0.pos, 0, 'до сохранений прогресс с нуля');
eq(q0.pendingIds[0], 'd-absent', 'первый в очереди — первый по ФИО');
eq(q0.ids.length, own.length, 'сегментов прогресса — по числу записей');

const q1 = birthPromptQueue(own, { done: ['d-absent'] });
eq(q1.pos, 1, 'после сохранения прогресс сдвинулся');
eq(q1.total, own.length, 'счётчик эпизода не уменьшился после сохранения');
eq(q1.pendingIds[0], 'd-empty', 'очередь перешла к следующей записи');

// Подписка реестра убрала запись из кандидатов — успех остаётся учтённым,
// очередь и счётчик не «прыгают назад».
const q2 = birthPromptQueue(own.filter((c) => c.id !== 'd-absent'), { done: ['d-absent'] });
eq(q2.total, own.length, 'подписка убрала запись — счётчик успехов сохранился');
eq(q2.pendingIds.length, own.length - 1, 'в очереди на одну запись меньше');
ok(!q2.pendingIds.includes('d-absent'), 'внесённая запись не возвращается в очередь');

// Переназначение ответственного в живых данных: запись снята (dropped) или
// ушла из кандидатов — в счётчике её больше нет.
const q3 = birthPromptQueue(own, { dropped: ['d-absent'] });
eq(q3.total, own.length - 1, 'снятая с очереди запись уходит из счётчика');
ok(!q3.pendingIds.includes('d-absent'), 'снятая запись не показывается');
const q4 = birthPromptQueue(own.filter((c) => c.id !== 'd-bad-year'), {});
eq(q4.total, own.length - 1, 'переназначенная запись убирает счётчик у старого');
const q5 = birthPromptQueue([...own.filter((c) => c.id !== 'd-bad-year'), { ...own.find((c) => c.id === 'd-bad-year')!, id: 'd-moved' }], {});
eq(q5.total, own.length, 'у нового ответственного счётчик вырос на ту же запись');

// Полная очистка очереди — окно закрывается (в компоненте это эффект).
const q6 = birthPromptQueue([], { done: [] });
eq(q6.total, 0, 'пустая очередь — счётчик 0');
eq(q6.pendingIds.length, 0, 'пустая очередь — показывать нечего');

/* ── 7. Проверка права ЗАПИСИ в момент сохранения ───────────────────────── */

eq(birthSaveBlockReason(dispatcherViewer, driver({ id: 'd-1', birthDate: '', dispatcherId: 'u-1' }), { now: NOW }), null, 'свой водитель без даты — запись разрешена');
eq(birthSaveBlockReason(dispatcherViewer, driver({ id: 'd-2', birthDate: '', dispatcherId: 'u-2' }), { now: NOW }), 'not-responsible', 'чужой водитель — запись запрещена (переназначен)');
eq(birthSaveBlockReason(dispatcherViewer, driver({ id: 'd-3', birthDate: '1980-01-01', dispatcherId: 'u-1' }), { now: NOW }), 'already-filled', 'дата уже внесена параллельно — повторно не пишем');
eq(birthSaveBlockReason(dispatcherViewer, driver({ id: 'd-4', birthDate: '', dispatcherId: undefined }), { now: NOW }), 'not-responsible', 'без ответственного запись запрещена');
eq(birthSaveBlockReason(viewer({ role: 'accountant', uid: 'u-9' }), driver({ id: 'd-5', birthDate: '', dispatcherId: 'u-9' }), { now: NOW }), 'no-right', 'без права settings=write запись запрещена даже своему');
eq(birthSaveBlockReason(dispatcherViewer, null, { now: NOW }), 'not-found', 'запись исчезла — запись запрещена');
eq(birthSaveBlockReason(dispatcherViewer, driver({ id: 'd-6', birthDate: '01.01.1930', dispatcherId: 'u-1' }), { now: NOW }), null, 'неправдоподобная дата своего водителя — перезапись разрешена');
ok(birthSaveBlockLabel('not-responsible').includes('переназначен'), 'подпись отказа: переназначение');
ok(birthSaveBlockLabel('already-filled').includes('уже внесена'), 'подпись отказа: дата уже внесена');
ok(birthSaveBlockLabel('no-right').length > 0 && birthSaveBlockLabel('not-found').length > 0, 'подписи отказов не пусты');

/* ── 8. Административная проверка неполных данных ───────────────────────── */

// Персональное окно чужие записи не показывает — полноту реестра администратор
// проверяет отдельным инструментом (строки ниже — его чистый слой).
const USERS = [
  { uid: 'u-1', name: 'Виталий Козловский', role: 'dispatcher' },
  { uid: 'u-2', name: 'Матвей Солодкий', role: 'dispatcher' },
];
const QFIX: DriverRecord[] = [
  { id: 'q-1', lastNameRu: 'Альфа', firstNameRu: 'А', dispatcherId: 'u-1', birthDate: '' },
  { id: 'q-2', lastNameRu: 'Бета', firstNameRu: 'Б', dispatcherId: '', dispatcherName: 'Матвей Солодкий', birthDate: '1980-01-01' },
  { id: 'q-3', lastNameRu: 'Гамма', firstNameRu: 'Г', dispatcherId: '', birthDate: '' },
  { id: 'q-4', lastNameRu: 'Дельта', firstNameRu: 'Д', dispatcherId: 'u-9', birthDate: '1980-01-01' },
  { id: 'q-5', lastNameRu: 'Омега', firstNameRu: 'О', dispatcherId: 'u-2', birthDate: '14/07/1991' },
  { id: 'q-6', lastNameRu: 'без В.', firstNameRu: '', dispatcherId: '', birthDate: '' },
  { id: 'q-7', lastNameRu: 'Архив', firstNameRu: 'А', dispatcherId: '', birthDate: '', archived: true },
];
const qcouplings = [{ driverId: 'q-1', carNumber: 'АА0001-1' }];
const rows = buildDriverDataQualityRows(QFIX, { users: USERS, couplings: qcouplings, now: NOW });
eq(rows.length, 4, 'в проверку попадают только неполные записи (4 из 7)');
eq(rows.map((r) => r.id).join(','), 'q-1,q-2,q-3,q-4', 'порядок — по ФИО (ru), служебные/архивные мимо');
eq(rows.filter((r) => r.issues.includes('birth-date')).length, 2, 'счётчик «без даты рождения» = 2');
eq(rows.filter((r) => r.issues.includes('dispatcher') || r.issues.includes('dispatcher-unknown')).length, 3, 'счётчик «без ответственного» = 3');
const rowQ1 = rows.find((r) => r.id === 'q-1');
eq(rowQ1?.dispatcherName, 'Виталий Козловский', 'ответственный разрешается по стабильному id');
eq(rowQ1?.car, 'АА0001-1', 'машина берётся из сцепки');
const rowQ2 = rows.find((r) => r.id === 'q-2');
eq(rowQ2?.dispatcherId, '', 'без id ответственный не назначен, даже если в записи есть имя');
eq(rowQ2?.dispatcherText, 'Матвей Солодкий', 'устаревший текст ответственного виден как подсказка');
ok(rowQ2?.issues.includes('dispatcher') === true, 'причина: ответственный не назначен');
const rowQ3 = rows.find((r) => r.id === 'q-3');
ok(rowQ3?.issues.includes('birth-date') && rowQ3?.issues.includes('dispatcher'), 'у записи могут быть обе проблемы сразу');
ok((rowQ3?.birthReason || '').includes('не заполнена'), 'причина по дате берётся из общих правил');
const rowQ4 = rows.find((r) => r.id === 'q-4');
ok(rowQ4?.issues.includes('dispatcher-unknown') === true, 'id без учётки в users_list — битая связь');
eq(rowQ4?.dispatcherName, '', 'имя не выдумывается для неизвестной учётки');
ok(!rows.some((r) => r.id === 'q-5'), 'полная запись в проверку не попадает');
ok(!rows.some((r) => r.id === 'q-6') && !rows.some((r) => r.id === 'q-7'), 'служебная и архивная записи пропускаются');
// Пока список учёток не загружен, «неизвестная учётка» не выдумывается.
const rowsNoUsers = buildDriverDataQualityRows(QFIX, { now: NOW });
ok(!rowsNoUsers.some((r) => r.id === 'q-4'), 'без загруженных учёток связь не считается битой');
ok(driverDataIssueLabel('birth-date') === 'Дата рождения', 'подпись проблемы: дата рождения');
ok(driverDataIssueLabel('dispatcher') === 'Ответственный не назначен', 'подпись проблемы: нет ответственного');
ok(driverDataIssueLabel('dispatcher-unknown').includes('учётка'), 'подпись проблемы: битая связь');
eq(buildDriverDataQualityRows(null, { users: USERS }).length, 0, 'пустой реестр — пустая проверка');

/* ── Итог ───────────────────────────────────────────────────────────────── */

if (fails.length) {
  console.error(`[test-driver-birth-prompt] ПРОВАЛЫ (${fails.length} из ${checks}):`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log(`[test-driver-birth-prompt] Все проверки пройдены: ${checks}.`);
