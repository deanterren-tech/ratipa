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
  birthPromptStorageKey,
  birthPromptTitle,
  canEditDriverRegistry,
  checkBirthDate,
  markBirthPromptShown,
  needsBirthDate,
  normalizeBirthDate,
  selectBirthPromptCandidates,
  seesAllDriversInBirthPrompt,
  todayISO,
  wasBirthPromptShown,
  type BirthPromptDriverLike,
  type BirthPromptStorage,
  type BirthPromptViewer,
} from '../src/utils/driverBirthPrompt.ts';

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
ok(seesAllDriversInBirthPrompt(viewer({ role: 'root_admin' })), 'root_admin видит всех');
ok(seesAllDriversInBirthPrompt(viewer({ role: 'admin' })), 'администратор реестра видит всех');
ok(!seesAllDriversInBirthPrompt(viewer({ role: 'dispatcher', permissions: { settings: 'write' } })), 'диспетчер видит только своих');
ok(!seesAllDriversInBirthPrompt(null), 'без профиля — охвата нет');

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
ok(!own.some((c) => c.id === 'd-orphan'), 'водитель без диспетчера — только для администратора');
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

// Право есть, но водителей без диспетчера у диспетчера нет.
const all = selectBirthPromptCandidates(DISP, viewer({ role: 'root_admin', uid: 'root-1', permissions: {} }), { now: NOW });
eq(all.length, 6, 'администратор видит все записи, кроме служебной и архивной');
ok(all.some((c) => c.id === 'd-foreign') && all.some((c) => c.id === 'd-orphan'), 'администратору видны и «чужие», и записи без диспетчера');
const adminOwn = selectBirthPromptCandidates(DISP, viewer({ role: 'admin', uid: 'adm-1', permissions: {} }), { now: NOW });
eq(adminOwn.length, 6, 'роль admin — охват «все записи» (для проверки данных)');

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

/* ── Итог ───────────────────────────────────────────────────────────────── */

if (fails.length) {
  console.error(`[test-driver-birth-prompt] ПРОВАЛЫ (${fails.length} из ${checks}):`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log(`[test-driver-birth-prompt] Все проверки пройдены: ${checks}.`);
