/**
 * Юнит-тесты «Истории CAN-пробега»:
 *   - разбор измерений object-stat-data / city-or-track (значения, времена,
 *     политика «0/null ≠ пробел 0»);
 *   - дедупликация по идентичности измерения (повтор API ≠ новая точка;
 *     одинаковое значение с новым временем = валидная точка; пересмотр);
 *   - сортировка поздних (догоняющих) измерений;
 *   - планирование бэкфилла (окна съёма, последние полные дни);
 *   - клиентский движок: слияние снимков и измерений, приросты (норма,
 *     сброс, разрыв), разрывы, прореживание с сохранением мин/макс, четыре
 *     состояния синхронизации.
 *
 * Запуск: npm run test:canseries
 */

import {
  measurementsFromStatItem,
  measurementsFromCityTrackItem,
  dedupeCanMeasurements,
  sortCanMeasurements,
  canMeasurementIdentity,
  canMeasurementNodeKey,
  coverageOfDay,
  missingStatWindows,
  recentFullDays,
  parseNavbyDottedDateTimeToMs,
  toCanNode,
  fromCanNode,
  type CanMeasurement,
} from '../server/navby/canHistory.ts';
import {
  mergeCanPoints,
  snapshotPointsFromSamples,
  buildCanGains,
  detectCanGaps,
  classifyCanSync,
  decimateCanPoints,
  canSeriesStats,
  normalizeCanRecord,
  canDayKey,
  dayBoundsFromKey,
  createPoint,
  type CanPoint,
} from '../src/components/modules/mileageComms/engine/canSeries.ts';
import { MC_CHECK_DEFAULTS } from '../src/components/modules/mileageComms/engine/params.ts';
import type { MeasureSample, Stop } from '../src/components/modules/mileageComms/engine/types.ts';

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}
function eq<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, `${name}${a === e ? '' : ` (получено ${a}, ожидалось ${e})`}`);
}

const TZ = 180 * 60_000;
const ms = (s: string) => Date.parse(s); // ISO UTC строка

console.log('─ canHistory: разбор object-stat-data ─');
{
  const ctx = { objectId: '5210757', imei: '352093080153272', receivedAt: '2026-10-11T12:00:00.000Z' };
  // Реальный живой пример: окно 06:00–07:00 05.10.2026 (+03).
  const pts = measurementsFromStatItem({ odom_start: 1128509, s_odo_dt: 1791169230, odom_finish: 1128573, e_odo_dt: 1791172714 }, ctx);
  eq(pts.length, 2, 'две границы окна → два измерения');
  eq(pts[0].valueKm, 1128509, 'значение — целые км (округление источника)');
  eq(pts[0].precision, 'km_int', 'точность помечена km_int');
  // 1791169230 = 2026-10-05T03:00:30Z (06:00:30 +03) — время реальное, не граница окна.
  eq(pts[0].measuredAtMs, 1791169230000, 'epoch-секунды → мс (реальное время измерения)');
  eq(pts[1].valueKm, 1128573, 'конец окна — значение e_odo_dt');
  eq(pts[0].source, 'navby.stat_window', 'источник — подтверждённый метод');
  // Политика нулей: стоящая машина в окне даёт 0/null — это НЕ измерение.
  const zero = measurementsFromStatItem({ odom_start: 0, s_odo_dt: null, odom_finish: 0, e_odo_dt: null }, ctx);
  eq(zero.length, 0, '0/null источника → пусто (не «ноль км»)');
  const halfZero = measurementsFromStatItem({ odom_start: 0, s_odo_dt: 1791169230, odom_finish: 1128573, e_odo_dt: 1791172714 }, ctx);
  eq(halfZero.length, 1, 'нулевая граница отброшена, валидная сохранена');
}

console.log('─ canHistory: разбор city-or-track ─');
{
  const ctx = { objectId: null, imei: '352093080153272', receivedAt: '2026-10-11T12:00:00.000Z' };
  const seg = (o: Record<string, unknown>) => measurementsFromCityTrackItem({ imei: '352093080153272', data: [o] }, ctx);
  const motion = seg({
    in_motion: 1, start_date: '05.10.2026 05:53:12', end_date: '05.10.2026 06:40:42',
    start_odometer: 1128500.865, end_odometer: 1128548.735,
  });
  eq(motion.length, 2, 'сегмент движения → две границы');
  eq(motion[0].valueKm, 1128500.865, 'float-значение сохраняется как есть');
  eq(motion[0].precision, 'km_3dec', 'точность km_3dec');
  eq(motion[0].measuredAtMs, 1791168792000, '«DD.MM.YYYY HH:MM:SS» (+03) → мс UTC');
  const stopSeg = seg({ in_motion: 0, start_date: '05.10.2026 00:19:35', end_date: '05.10.2026 05:53:12' });
  eq(stopSeg.length, 0, 'стоянка отчёта не содержит одометра → нет измерений');
  eq(parseNavbyDottedDateTimeToMs('НЕ дата'), null, 'кривая дата → null');
}

console.log('─ canHistory: дедупликация по идентичности измерения ─');
{
  const m = (t: number, v: number, src = 'navby.stat_window'): CanMeasurement => ({
    measuredAtMs: t, valueKm: v, source: src as CanMeasurement['source'],
    precision: 'km_int', receivedAt: '2026-10-11T12:00:00.000Z', objectId: '1', imei: '2',
  });
  // Повтор того же измерения из API — не новая точка.
  const twice = dedupeCanMeasurements([m(1000, 100), m(1000, 100), m(2000, 105)]);
  eq(twice.length, 2, 'повтор (источник+время+значение) схлопнут');
  // Одинаковое значение с новым достоверным временем — ВАЛИДНАЯ точка (нет изменения).
  const same = dedupeCanMeasurements([m(1000, 100), m(2000, 100)]);
  eq(same.length, 2, 'то же значение в новое время — две точки (фиксирует отсутствие изменения)');
  // Пересмотр: та же идентичность, другое значение — берётся свежее.
  const revised = dedupeCanMeasurements([m(1000, 100), m(1000, 101)]);
  eq(revised.length, 1, 'уточнение значения источником — одна точка');
  eq(revised[0].valueKm, 101, 'уточнённое значение побеждает');
  eq(canMeasurementIdentity('navby.stat_window', 1000), 'navby.stat_window|1000', 'идентичность = источник+время');
  // Разные источники — разные измерения (не дедуплицируются между собой).
  const cross = dedupeCanMeasurements([m(1000, 100), m(1000, 100, 'navby.city_segment')]);
  eq(cross.length, 2, 'измерения разных методов хранятся раздельно');
}

console.log('─ canHistory: сортировка поздних измерений и узлы RTDB ─');
{
  const list: CanMeasurement[] = [
    { measuredAtMs: 3000, valueKm: 30, source: 'navby.stat_window', precision: 'km_int', receivedAt: 'r', objectId: null, imei: null },
    { measuredAtMs: 1000, valueKm: 10, source: 'navby.city_segment', precision: 'km_3dec', receivedAt: 'r', objectId: null, imei: null },
    { measuredAtMs: 2000, valueKm: 20, source: 'navby.stat_window', precision: 'km_int', receivedAt: 'r', objectId: null, imei: null },
  ];
  const sorted = sortCanMeasurements(list);
  eq(sorted.map((x) => x.measuredAtMs), [1000, 2000, 3000], 'позднее (догоняющее) измерение встаёт на своё место');
  // Ключ узла содержит время (сортируется) и тег источника; тMs — epoch мс.
  const node = toCanNode(list[1]);
  eq(node.tMs, 1000, 'узел хранит время измерения');
  eq(node.u, 'km', 'единица — км');
  const key = canMeasurementNodeKey({ ...list[1], measuredAtMs: ms('2026-10-05T05:53:12.000Z') });
  ok(/^\d{9}_cs$/.test(key), `ключ узла «HHMMSSmmm_cs» (получено ${key})`);
  const back = fromCanNode('000000000_cs', { ...node, src: undefined });
  ok(back != null && back.source === 'navby.city_segment', 'разбор узла без src восстанавливает источник по тегу ключа');
  const cov = coverageOfDay([{ measuredAtMs: 1000, source: 'a' }, { measuredAtMs: 5000, source: 'b' }, { measuredAtMs: null, source: 'b' }]);
  eq(cov.points, 3, 'покрытие: количество точек');
  eq([cov.firstMs, cov.lastMs], [1000, 5000], 'покрытие: первое/последнее время (без null)');
}

console.log('─ canHistory: план бэкфилла ─');
{
  const hour = 3_600_000;
  const now = ms('2026-10-11T12:07:00.000Z');
  const win = missingStatWindows(null, now, 60, 3);
  ok(win.length >= 1 && win[win.length - 1].toMs === Math.floor(now / hour) * hour, 'окна догона заканчиваются началом текущего часа');
  ok(win.every((w) => w.toMs <= now && w.toMs > w.fromMs), 'окна не заходят в незакрытый час');
  const win2 = missingStatWindows(ms('2026-10-11T09:30:00.000Z'), now, 60, 3);
  eq(win2.length, 3, 'не более maxWindows окон за цикл (свежие в приоритете)');
  eq(win2[0].fromMs, ms('2026-10-11T09:30:00.000Z'), 'догон начинается с момента последнего съёма (частичное окно)');
  eq(win2[0].toMs, ms('2026-10-11T10:00:00.000Z'), 'частичное окно закрывается на границе часа');
  const days = recentFullDays(now, 2);
  eq(days.length, 2, 'догружаются последние N полных суток');
  eq(days[0].dayKey, '20261010', 'первый день — вчера (пояс +03)');
  eq(days[0].toMs - days[0].fromMs, 86_400_000 - 1, 'сутки целиком');
  ok(days[1].dayKey === '20261009', 'второй день — позавчера');
}

console.log('─ canSeries: снимки и слияние ─');
{
  const sample = (atMs: number, odoKm: number | null): MeasureSample => ({
    atMs, coordAt: null, lat: 55, lon: 37, posValid: true, speed: 0, odoKm,
    satellites: null, odoSource: 'navby.odom_can', receivedAtMs: atMs + 60_000,
  });
  const snaps = snapshotPointsFromSamples([sample(1000, 100), sample(2000, null), sample(3000, 0)]);
  eq(snaps.length, 1, 'снимок только с пригодным одометром (>0); null и 0 отброшены');
  eq(snaps[0].kind, 'snapshot', 'снимок помечен как snapshot (время измерения неизвестно)');
  eq(snaps[0].tMs, null, 'у снимка нет времени измерения');
  eq(snaps[0].coordAtMs, 1000, 'время координаты сохранено отдельно');

  // Слияние: измерение (float) и снимок в ту же секунду → одна точка, приоритет у измерения.
  const measured = createPoint({ xMs: 10_000, tMs: 10_000, valueKm: 100.5, source: 'city_segment' });
  const snapSame = createPoint({ xMs: 10_400, valueKm: 100.5, source: 'snapshot', coordAtMs: 10_400 });
  const merged = mergeCanPoints([snapSame, measured]);
  eq(merged.length, 1, 'одна физическая точка из измерения и снимка');
  eq(merged[0].kind, 'measured', 'приоритет у измерения с подтверждённым временем');
  ok((merged[0].mergedSources || []).length === 2, 'в подсказке остаются оба источника');

  // Округление object-stat-data (int) и точное значение (float) в ту же секунду — одна точка.
  const intPt = createPoint({ xMs: 20_000, tMs: 20_000, valueKm: 1128509, source: 'stat_window', precision: 'km_int' });
  const floatPt = createPoint({ xMs: 20_000, tMs: 20_000, valueKm: 1128509.665, source: 'city_segment' });
  const merged2 = mergeCanPoints([intPt, floatPt]);
  eq(merged2.length, 1, 'int-округление и float в одну секунду слиты');
  eq(merged2[0].valueKm, 1128509.665, 'в отображении точное float-значение');

  // Две точки в разные минуты с тем же значением НЕ сливаются (фиксируют простой).
  const a = createPoint({ xMs: 100_000, tMs: 100_000, valueKm: 100, source: 'stat_window' });
  const b = createPoint({ xMs: 400_000, tMs: 400_000, valueKm: 100, source: 'stat_window' });
  eq(mergeCanPoints([a, b]).length, 2, 'одинаковое значение в разные времена — две точки');
}

console.log('─ canSeries: приросты, разрывы, сбросы ─');
{
  const P = (xMs: number, v: number) => createPoint({ xMs, tMs: xMs, valueKm: v, source: 'stat_window' });
  const params = MC_CHECK_DEFAULTS;
  // норма / сброс / разрыв.
  const pts = [
    P(0, 100), P(30 * 60_000, 105),            // нормальный прирост 5 км за 30 мин
    P(60 * 60_000, 90),                         // сброс (−15 км)
    P(60 * 60_000 + 5 * 3_600_000, 92),         // через разрыв (5 ч > 60 мин)
  ];
  const gains = buildCanGains(pts, 0, pts[3].xMs, params, new Map());
  eq(gains.length, 3, 'три интервала между четырьмя точками');
  eq(gains[0].kind, 'normal', 'обычный прирост');
  eq(gains[1].kind, 'reset', 'отрицательное изменение — сброс (не скрывается)');
  ok((gains[1].deltaKm as number) < 0, 'прирост сброса отрицательный (виден на графике)');
  eq(gains[2].kind, 'gap', 'через разрыв — не «мгновенный скачок»');
  eq(gains[2].gapInside, true, 'признак разрыва внутри интервала');

  const gaps = detectCanGaps(pts, 0, pts[3].xMs, 60);
  eq(gaps.length, 1, 'разрыв найден один');
  eq(gaps[0].fromMs, 60 * 60_000, 'разрыв начинается от последней точки');
  eq(gaps[0].toMs, 60 * 60_000 + 5 * 3_600_000, 'разрыв кончается на следующей точке');

  // Стоянка: прирост внутри подтверждённой стоянки → stop_rise.
  const stop: Stop = {
    id: 'st1', method: 'navby_parking_report', category: 'confirmed',
    startMs: 3 * 3_600_000, endMs: 5 * 3_600_000, durationMin: 120, lat: null, lon: null,
    basis: 'тест', quality: { samplesInside: 2, maxGapMs: null, movingInside: 0, tags: [] },
  };
  const pts2 = [P(3 * 3_600_000, 200), P(4 * 3_600_000, 203)];
  const g2 = buildCanGains(pts2, 0, 6 * 3_600_000, params, new Map([[stop.id, stop]]));
  eq(g2[0].kind, 'stop_rise', 'прирост внутри стоянки ≥ порога — stop_rise');
  eq(g2[0].stopId, 'st1', 'интервал связан со стоянкой');
}

console.log('─ canSeries: прореживание (агрегация) ─');
{
  const pts: CanPoint[] = [];
  for (let i = 0; i < 2000; i += 1) pts.push(createPoint({ xMs: i * 60_000, tMs: i * 60_000, valueKm: 100 + i * 0.01, source: 'stat_window' }));
  // Внутри — резкий сброс и последующий рост (не должен исчезнуть).
  pts[1000] = createPoint({ xMs: 1000 * 60_000, tMs: 1000 * 60_000, valueKm: 50, source: 'stat_window' });
  pts[1500] = createPoint({ xMs: 1500 * 60_000, tMs: 1500 * 60_000, valueKm: 175, source: 'city_segment' });
  const dec = decimateCanPoints(pts, 200);
  ok(dec.length <= 400, `прореживание укладывается в лимит (${dec.length})`);
  const minV = Math.min(...dec.map((p) => p.valueKm));
  const maxV = Math.max(...dec.map((p) => p.valueKm));
  ok(minV === 50, 'минимум (точка сброса) сохранён при агрегации');
  ok(maxV === Math.max(...pts.map((p) => p.valueKm)), 'максимум периода сохранён');
  const sortedOk = dec.every((p, i) => i === 0 || dec[i - 1].xMs <= p.xMs);
  ok(sortedOk, 'порядок по времени после прореживания');
  const stats = canSeriesStats(pts);
  // Оба падения — сброс на 1000-й точке и обратный ход после выброса на 1500-й.
  eq(stats.resets, 2, 'сбросы/обратные ходы посчитаны (видимы в сводке)');
}

console.log('─ canSeries: три согласованных состояния загрузки ─');
{
  const now = ms('2026-10-11T18:00:00.000Z');
  const w = { fromMs: now - 12 * 3_600_000, toMs: now };
  const st = (points: CanPoint[], carHasOdometer: boolean | null, hasCoverage: boolean) =>
    classifyCanSync({ points, carHasOdometer, hasCoverage, window: w, nowMs: now, snapshotIntervalMs: 300_000 }).state;
  // (3) требует догрузки: нет точек, съём за период не выполнялся.
  eq(st([], null, false), 'not_loaded', 'нет точек и нет покрытия → «требует догрузки»');
  eq(st([], true, false), 'not_loaded', 'одометр есть, но съём не выполнялся → «требует догрузки» (не «новые не поступали»)');
  // (2) загружено, данных нет: съём выполнялся, источник вернул пусто (допустимо).
  eq(st([], true, true), 'no_new_measurements', 'съём выполнен, но пусто → «Загружено, данных нет»');
  eq(st([], null, true), 'no_new_measurements', 'съём выполнен, пусто → «Загружено, данных нет»');
  // Источник не даёт историю вовсе.
  eq(st([], false, true), 'source_no_history', 'одометр не передаётся → «источник не даёт историю»');
  // (1) загружено, данные есть.
  const fresh = [createPoint({ xMs: now - 5 * 60_000, tMs: now - 5 * 60_000, valueKm: 100, source: 'stat_window' }), createPoint({ xMs: now - 6 * 60_000, tMs: now - 6 * 60_000, valueKm: 100, source: 'stat_window' })];
  eq(st(fresh, true, true), 'no_change_fresh', 'свежие точки, значение не менялось → «CAN не менялся, измерения были»');
  const stale = [createPoint({ xMs: now - 6 * 3_600_000, tMs: now - 6 * 3_600_000, valueKm: 100, source: 'stat_window' }), createPoint({ xMs: now - 5 * 3_600_000, tMs: now - 5 * 3_600_000, valueKm: 110, source: 'stat_window' })];
  eq(st(stale, true, true), 'no_new_measurements', 'старые точки в текущем окне → «новые не поступали»');
  const changedFresh = [createPoint({ xMs: now - 40 * 60_000, tMs: now - 40 * 60_000, valueKm: 100, source: 'stat_window' }), createPoint({ xMs: now - 10 * 60_000, tMs: now - 10 * 60_000, valueKm: 105, source: 'stat_window' })];
  eq(st(changedFresh, true, true), 'ok', 'изменение в свежем окне → данные поступают');
  const label = classifyCanSync({ points: [], carHasOdometer: true, hasCoverage: false, window: w, nowMs: now, snapshotIntervalMs: 300_000 });
  ok(/требует догрузки/.test(label.label), 'подпись состояния (3) содержит «требует догрузки»');
  const label2 = classifyCanSync({ points: [], carHasOdometer: true, hasCoverage: true, window: w, nowMs: now, snapshotIntervalMs: 300_000 });
  ok(/Загружено, данных нет/.test(label2.label) && /не ошибка загрузки/.test(label2.hint), 'подпись состояния (2) объясняет пустоту (не ошибка загрузки)');
  // Закрытый прошлый день: отсутствие точек вечером — норма, не «нет новых измерений».
  const past = { fromMs: ms('2026-10-05T21:00:00.000Z'), toMs: ms('2026-10-06T20:59:59.000Z') };
  const stPast = classifyCanSync({
    points: [createPoint({ xMs: ms('2026-10-06T05:00:00.000Z'), tMs: ms('2026-10-06T05:00:00.000Z'), valueKm: 10, source: 'stat_window' }),
             createPoint({ xMs: ms('2026-10-06T18:00:00.000Z'), tMs: ms('2026-10-06T18:00:00.000Z'), valueKm: 360, source: 'stat_window' })],
    carHasOdometer: true, hasCoverage: true, window: past, nowMs: now, snapshotIntervalMs: 300_000,
  }).state;
  eq(stPast, 'ok', 'закрытый день с измерениями — ок (ночная стоянка не «ошибка»)');
}

console.log('─ canSeries: день и разбор узла ─');
{
  eq(canDayKey(ms('2026-10-05T20:30:00.000Z')), '20261005', '+03: 23:30 — ещё тот же день');
  eq(canDayKey(ms('2026-10-05T21:30:00.000Z')), '20261006', '+03: 00:30 — уже новый день');
  const b = dayBoundsFromKey('20261005')!;
  eq(b.fromMs, ms('2026-10-04T21:00:00.000Z'), 'начало дня 05.10 (+03) в UTC');
  eq(b.toMs - b.fromMs, 86_400_000 - 1, 'длина суток');
  const rec = normalizeCanRecord({ v: 1128500.865, tMs: 1791168792000, src: 'navby.city_segment', q: 'km_3dec', rAt: '2026-10-11T12:00:00.000Z' });
  ok(rec != null && rec.source === 'city_segment' && rec.kind === 'measured', 'узел RTDB → точка движка');
  eq(normalizeCanRecord({ v: 0, tMs: 1, src: 'navby.stat_window' }), null, 'нулевое значение узла не превращается в измерение');
  eq(normalizeCanRecord({ v: 100, tMs: 0 }), null, 'без времени источника узел непригоден');
}

console.log(`\nИтог: ${passed} OK, ${failed} FAILED`);
if (failed > 0) process.exit(1);
