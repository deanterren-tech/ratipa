/**
 * test-tl-guards — юнит-проверки ЧИСТОЙ логики аудита таймлайна
 * (scripts/tl-audit-core.ts), которой пользуются scripts/audit-timeline-dups.ts
 * и scripts/migrate-directions.ts:
 *
 *  · правило пересечений ТЗ (s <= e0 && e >= s0): конфликт / стык 1 день /
 *    нет пересечения, открытые периоды (конец = +∞), два открытых;
 *  · ремонт внутри периода базы и пограничные случаи ремонта;
 *  · нормализация кодов направлений (примеры ТЗ: CNH-RUS/HN-RUS → CHN-RUS,
 *    RUS-By → RUS-BY, BY-AM → BY-ARM) + идемпотентность и неизвестные токены;
 *  · разбор дат (ISO / DD.MM.YYYY / DD/MM/YYYY), ключ машины (раскладка),
 *    симуляция детерминированных ID и детектор коллизий, карта город→страна.
 *
 * Запуск: npm run test:tl-guards   (или npx tsx scripts/test-tl-guards.ts)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import {
  CITY_COUNTRY,
  cityCountryOf,
  classifyPair,
  classifyRepairPlacement,
  collisionsOf,
  eventKeySim,
  fnv1a32,
  hashEventText,
  looksProbe,
  normText,
  normalizeCountryToken,
  normalizeDirectionCode,
  numStats,
  parseLooseDate,
  periodKeySim,
  stageKeySim,
  vehicleKey,
  type CountryCode,
  type IntervalRef,
} from './tl-audit-core.ts';

let checks = 0;
const fails: string[] = [];

const eq = <T>(actual: T, expected: T, name: string): void => {
  checks += 1;
  if (actual !== expected) fails.push(`${name}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
};
const ok = (cond: boolean, name: string): void => {
  checks += 1;
  if (!cond) fails.push(name);
};
const deepEq = (actual: unknown, expected: unknown, name: string): void => {
  checks += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fails.push(`${name}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
};

const day = (iso: string): number => {
  const d = parseLooseDate(iso);
  if (!d) throw new Error(`тестовая дата битая: ${iso}`);
  return d.day;
};

/** Интервал для тестов правила пересечений. */
const iv = (id: string, startIso: string | null, endIso: string | null, kind: IntervalRef['kind'] = 'base'): IntervalRef => ({
  id,
  branch: kind === 'trip' ? 'trips_dashboard' : 'baza',
  kind,
  carNumber: 'ТЕСТ',
  carKey: 'ТЕСТ',
  startDay: startIso ? day(startIso) : null,
  endDay: endIso ? day(endIso) : null,
  openEnd: endIso == null,
  archived: false,
  probe: false,
  label: id,
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Правило пересечений ТЗ
// ─────────────────────────────────────────────────────────────────────────
{
  const c1 = classifyPair(iv('a', '2026-01-01', '2026-01-10'), iv('b', '2026-01-05', '2026-01-15'));
  eq(c1.verdict, 'conflict', 'пересечение 5..10 — конфликт');
  eq(c1.overlapDays, 6, 'пересечение 5..10 — 6 дней');

  const c2 = classifyPair(iv('a', '2026-01-01', '2026-01-10'), iv('b', '2026-01-10', '2026-01-20'));
  eq(c2.verdict, 'styk', 'день стыка (конец = начало) — стык, не конфликт');
  eq(c2.overlapDays, 1, 'день стыка — ровно 1 день');

  const c3 = classifyPair(iv('a', '2026-01-01', '2026-01-10'), iv('b', '2026-01-11', '2026-01-20'));
  eq(c3.verdict, 'none', 'соседние дни без общего — не пересечение');

  const c4 = classifyPair(iv('a', '2026-01-01', '2026-01-10'), iv('b', '2026-01-05', '2026-01-05'));
  eq(c4.verdict, 'styk', 'однодневный интервал внутри — ровно 1 общий день = стык');

  const c5 = classifyPair(iv('a', '2026-01-01', '2026-01-31'), iv('b', '2026-01-10', '2026-01-15', 'trip'));
  eq(c5.verdict, 'conflict', 'рейс целиком внутри простоя — конфликт (>1 дня)');
  eq(c5.overlapDays, 6, 'рейс внутри простоя — 6 дней');

  const c6 = classifyPair(iv('a', '2026-01-01', '2026-01-10'), iv('b', '2026-01-01', '2026-01-10'));
  eq(c6.verdict, 'conflict', 'идентичные интервалы — конфликт');

  // Открытые периоды
  const o1 = classifyPair(iv('open', '2026-01-20', null), iv('trip', '2026-01-15', '2026-01-19'));
  eq(o1.verdict, 'none', 'открытый стартует 20, рейс закончился 19 — не пересечение');

  const o2 = classifyPair(iv('open', '2026-01-20', null), iv('trip', '2026-01-20', '2026-01-25', 'trip'));
  eq(o2.verdict, 'conflict', 'открытый с 20 и рейс 20..25 — конфликт');
  eq(o2.overlapDays, 6, 'открытый с 20 и рейс 20..25 — 6 дней');

  const o3 = classifyPair(iv('open', '2026-01-20', null), iv('trip', '2026-01-10', '2026-01-20', 'trip'));
  eq(o3.verdict, 'styk', 'рейс закончился в день начала открытого — стык');
  eq(o3.overlapDays, 1, 'стык открытого — 1 день');

  const o4 = classifyPair(iv('open1', '2026-01-01', null), iv('open2', '2026-02-01', null));
  eq(o4.verdict, 'conflict', 'два открытых периода — конфликт');
  eq(o4.overlapDays, null, 'два открытых — пересечение бесконечно');

  const o5 = classifyPair(iv('open1', '2026-01-01', null), iv('closed', '2025-12-01', '2025-12-31'));
  eq(o5.verdict, 'none', 'закрытый до начала открытого — не пересечение');

  const o6 = classifyPair(iv('open1', '2026-01-05', null), iv('closed', '2025-12-30', '2026-01-05'));
  eq(o6.verdict, 'styk', 'закрытый закончился в день старта открытого — стык');

  // Без даты начала
  const n1 = classifyPair(iv('nos', null, '2026-01-10'), iv('b', '2026-01-05', '2026-01-15'));
  eq(n1.verdict, 'no-start', 'без даты начала — пара пропускается');

  // Коммутативность (правило симметрично)
  const a = iv('a', '2026-03-01', '2026-03-10');
  const b = iv('b', '2026-03-08', '2026-03-20');
  deepEq(classifyPair(a, b), classifyPair(b, a), 'правило симметрично');
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Ремонт внутри периода базы
// ─────────────────────────────────────────────────────────────────────────
{
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-01-31'), day('2026-01-05'), day('2026-01-20')), 'inside-own-base', 'ремонт внутри базы — штатно');
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-01-31'), day('2026-01-01'), day('2026-01-31')), 'inside-own-base', 'ремонт во весь период — внутри');
  eq(classifyRepairPlacement(day('2026-01-01'), null, day('2026-01-05'), null), 'open-repair', 'ремонт без конца и без выезда — открытый');
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-02-28'), day('2026-01-05'), null), 'capped-by-departure', 'ремонт без конца, выезд есть — до выезда');
  eq(classifyRepairPlacement(day('2026-01-05'), day('2026-01-31'), day('2026-01-01'), day('2026-01-10')), 'before-arrival', 'ремонт начался до приезда');
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-01-20'), day('2026-01-05'), day('2026-01-25')), 'after-departure', 'ремонт закончился после выезда');
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-01-20'), null, day('2026-01-10')), 'end-without-start', 'конец ремонта без начала');
  eq(classifyRepairPlacement(day('2026-01-01'), day('2026-01-20'), null, null), 'no-repair', 'ремонта нет');
  eq(classifyRepairPlacement(null, null, day('2026-01-05'), day('2026-01-10')), 'inside-own-base', 'ремонт без границ базы — не отклонение');
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Нормализация кодов направлений (ТЗ)
// ─────────────────────────────────────────────────────────────────────────
{
  const n1 = normalizeDirectionCode('CNH-RUS');
  eq(n1.code, 'CHN-RUS', 'ТЗ: CNH-RUS → CHN-RUS');
  ok(n1.changed, 'ТЗ: CNH-RUS помечен как изменённый');
  eq(n1.unknown.length, 0, 'ТЗ: CNH-RUS без неизвестных токенов');

  eq(normalizeDirectionCode('HN-RUS').code, 'CHN-RUS', 'ТЗ: HN-RUS → CHN-RUS');
  eq(normalizeDirectionCode('RUS-By').code, 'RUS-BY', 'ТЗ: RUS-By → RUS-BY');
  eq(normalizeDirectionCode('BY-AM').code, 'BY-ARM', 'ТЗ: BY-AM → BY-ARM');

  eq(normalizeDirectionCode('by-arm').code, 'BY-ARM', 'нижний регистр нормализуется');
  eq(normalizeDirectionCode('  CNH_RUS  ').code, 'CHN-RUS', 'пробелы и подчёркивание — разделители');
  eq(normalizeDirectionCode('CHN–RUS').code, 'CHN-RUS', 'тире-минус и en-dash равнозначны');
  eq(normalizeDirectionCode('ru/rus').code, 'RUS-RUS', 'слэш — разделитель, RU→RUS');

  const idem = normalizeDirectionCode('CHN-RUS');
  eq(idem.code, 'CHN-RUS', 'идемпотентность: CHN-RUS остаётся CHN-RUS');
  eq(idem.changed, false, 'идемпотентность: без изменений');

  const unk = normalizeDirectionCode('XYZ-RUS');
  eq(unk.code, null, 'неизвестный токен — код не выдумывается');
  deepEq(unk.unknown, ['XYZ'], 'неизвестный токен попадает в список');

  const single = normalizeDirectionCode('CHN');
  eq(single.code, 'CHN', 'одиночный код нормализуется');
  ok(single.notes.length > 0, 'одиночный код — с пометкой');

  const empty = normalizeDirectionCode('   ');
  eq(empty.code, null, 'пустая строка — кода нет');

  eq(normalizeCountryToken('by'), 'BY', 'токен BY (нижний регистр)');
  eq(normalizeCountryToken('KZ'), 'KAZ', 'KZ → KAZ (трёхбуквенный канон)');
  eq(normalizeCountryToken('Am'), 'ARM', 'Am → ARM');
  eq(normalizeCountryToken('—'), null, 'пустой токен — null');
  deepEq(Object.keys(CITY_COUNTRY).length > 50, true, 'карта городов не пустая');
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Даты и ключ машины
// ─────────────────────────────────────────────────────────────────────────
{
  const iso = parseLooseDate('2026-10-12');
  const dot = parseLooseDate('12.10.2026');
  const slash = parseLooseDate('12/10/2026');
  ok(iso != null && dot != null && slash != null, 'три формата дат разбираются');
  eq(iso?.day === dot?.day && dot?.day === slash?.day, true, 'три формата — один календарный день');
  eq(iso?.iso, '2026-10-12', 'ISO дата сохраняется');
  eq(parseLooseDate('')?.day ?? null, null, 'пустая дата — null');
  eq(parseLooseDate('2026-13-01')?.day ?? null, null, 'месяц 13 — null');
  eq(parseLooseDate('2026-02-30')?.day ?? null, null, 'несуществующая дата — null');
  eq(parseLooseDate('вчера')?.day ?? null, null, 'мусор — null');

  const k1 = vehicleKey('АВ 9271-7 / A 2416 E-7');
  const k2 = vehicleKey('AB 9271-7');
  eq(k1, 'AB92717', 'кириллица АВ сворачивается в AB, первый сегмент');
  eq(k1 === k2, true, 'разные записи одного тягача — один ключ');
  eq(vehicleKey('O269ХЕ31') === vehicleKey('О269ХЕ31'), true, 'латинская/кириллическая О — один ключ');
  eq(vehicleKey('ПР 0011-7') === vehicleKey('ПР0011-7'), true, 'пробелы не влияют');
  eq(normText(' ТО  ёмкость ') , 'то емкость', 'normText: регистр, ё→е, пробелы');
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Симуляция детерминированных ID + коллизии
// ─────────────────────────────────────────────────────────────────────────
{
  eq(periodKeySim('v1', 'base', '2026-01-01'), 'v1_base_2026-01-01', 'период: vehicleId_type_startDate');
  eq(periodKeySim('v1', 'base', ''), null, 'период без даты — ключ не собирается');
  eq(periodKeySim('', 'base', '2026-01-01'), null, 'период без машины — ключ не собирается');

  eq(stageKeySim('t1', 'load', '2026-01-01', 2), 't1_load_2026-01-01_2', 'этап: departureId_type_date_seq');
  eq(stageKeySim('t1', 'load', '2026-01-01', undefined), null, 'этап без seq — ключ не собирается');
  eq(stageKeySim('t1', '', '2026-01-01', 1), null, 'этап без типа — ключ не собирается');

  const e1 = eventKeySim('p1', '2026-01-05', 'to', 'ТО-2');
  const e2 = eventKeySim('p1', '2026-01-05', 'to', '  то-2 ');
  eq(e1 != null && e1 === e2, true, 'событие: текст нормализуется (регистр/пробелы) — ключ стабилен');
  ok(eventKeySim('p1', '2026-01-05', 'to', 'Мойка') !== e1, 'разный текст — разный ключ');
  eq(eventKeySim('', '2026-01-05', 'to', 'x'), null, 'событие без периода — ключ не собирается');

  eq(fnv1a32('') , '811c9dc5', 'FNV-1a: пустая строка — базовое значение');
  eq(hashEventText('ТО') === hashEventText(' то '), true, 'hashEventText нормализует текст');
  ok(fnv1a32('a') !== fnv1a32('b'), 'FNV-1a: разные входы — разные хэши');

  const list = ['k1', 'k1', 'k2', 'k1', 'k3'];
  const cols = collisionsOf(list, (x) => x);
  eq(cols.length, 1, 'детектор коллизий: одна группа на k1');
  eq(cols[0].items.length, 3, 'детектор коллизий: 3 записи в группе');
  eq(collisionsOf(['a', 'b'], (x) => x).length, 0, 'детектор коллизий: уникальные — 0 групп');
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Города и статистика
// ─────────────────────────────────────────────────────────────────────────
{
  eq(cityCountryOf('Минск'), 'BY', 'Минск → BY');
  eq(cityCountryOf('минск (красная горка)'), 'BY', 'скобки отбрасываются — Минск');
  eq(cityCountryOf('Алашенкоу'), 'CHN', 'опечатка Алашенкоу → Алашанькоу → CHN');
  eq(cityCountryOf('Ереван'), 'ARM', 'Ереван → ARM');
  eq(cityCountryOf('Стамбул (Сарпи)'), 'TUR', 'Стамбул со скобкой → TUR');
  eq(cityCountryOf('Минск+Гомель'), null, 'составной маршрут — страна не определяется');
  eq(cityCountryOf('Уральск - Ереван'), null, 'составной маршрут с дефисом — null');
  eq(cityCountryOf('UnknownCity'), null, 'неизвестный город — null (не выдумываем)');
  eq(cityCountryOf(''), null, 'пустой город — null');

  const st = numStats([1, 2, 3, 4]);
  eq(st.n, 4, 'numStats: n');
  eq(st.mean, 2.5, 'numStats: среднее');
  eq(st.median, 2.5, 'numStats: медиана чётного');
  eq(numStats([5]).median, 5, 'numStats: медиана нечётного');
  eq(numStats([]).n, 0, 'numStats: пустой список');
  eq(numStats([1, NaN, null, undefined, 3]).n, 2, 'numStats: мусор отбрасывается');

  eq(looksProbe(['probe-st2-1', '', '']), true, 'probe-признак в id');
  eq(looksProbe(['обычная', 'запись', '']), false, 'обычная запись — не probe');
}

// ─────────────────────────────────────────────────────────────────────────
const countrySet: Set<CountryCode> = new Set(['BY', 'RUS', 'CHN', 'TUR', 'KAZ', 'UZB', 'TJK', 'KGZ', 'MNG', 'IRN', 'GEO', 'ARM', 'AZE', 'LT', 'PL']);
ok(Object.values(CITY_COUNTRY).every((c) => countrySet.has(c)), 'все страны карты городов — из канонического набора');

if (fails.length) {
  console.error(`[test-tl-guards] ПРОВАЛЫ (${fails.length}):`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  console.error(`[test-tl-guards] проверок: ${checks}, провалов: ${fails.length}`);
  process.exit(1);
} else {
  console.log(`[test-tl-guards] все проверки прошли: ${checks} ✓`);
  process.exit(0);
}
