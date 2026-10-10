/**
 * Юнит-тесты движка проверки пробега по рейсу (этап 2): привязка измерений,
 * стоянки, три сценария, сводка. Синтетические серии — живые данные не нужны.
 * Запуск: npm run test:mileage (или npx tsx scripts/test-mileage-engine.ts)
 *
 * Покрываются все 11 случаев п.10 уточнённого ТЗ:
 *  1) целый рейс с нормальными показаниями;
 *  2) рост одометра во время подтверждённой стоянки (А);
 *  3) скачок сразу после стоянки при частых измерениях (Б);
 *  4) большой прирост после длительного отсутствия данных (В);
 *  5) первая точка после стоянки получена уже в движении;
 *  6) устаревшая координата на границе;
 *  7) текущий незавершённый рейс;
 *  8) изменение границ рейса;
 *  9) замена автомобиля/трекера;
 * 10) сброс счётчика;
 * 11) позднее поступление исторических данных.
 */

import { analyzeTrip } from '../src/components/modules/mileageComms/engine/compose';
import { MC_CHECK_DEFAULTS, type CheckParams } from '../src/components/modules/mileageComms/engine/params';
import { resolveTripWindow, tripsForCar, factDaysOfStages, type TripCandidate } from '../src/components/modules/mileageComms/engine/binding';
import { normalizeParkingItems } from '../server/navby/parking';
import type {
  MeasureSample, ParkingIntervalRaw, TripWindow,
} from '../src/components/modules/mileageComms/engine/types';

let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/* Время в поясе портала (+03): D(2026,10,5,8,0) → мс epoch. */
const TZ = 180 * 60_000;
const D = (y: number, m: number, d: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, d, h, mi) - TZ;
const M = 60_000;
const H = 3_600_000;

const P: CheckParams = { ...MC_CHECK_DEFAULTS };

interface SampleOpts {
  odoKm?: number | null;
  speed?: number | null;
  lat?: number;
  lon?: number;
  stale?: boolean;
  source?: string;
  noPos?: boolean;
}

const sample = (ms: number, o: SampleOpts = {}): MeasureSample => {
  const lat = o.noPos ? null : (o.lat ?? 53.9);
  const lon = o.noPos ? null : (o.lon ?? 27.6);
  return {
    atMs: ms,
    coordAt: null,
    lat,
    lon,
    posValid: lat != null && lon != null,
    speed: o.speed ?? 0,
    odoKm: o.odoKm === undefined ? null : o.odoKm,
    satellites: 10,
    odoSource: o.source ?? 'navby.odom_can',
    receivedAtMs: o.stale ? ms + 4 * 60 * M : ms + M,
    ...(o.stale ? { staleOnArrival: true } : {}),
  };
};

const mkWindow = (fromMs: number, toMs: number, patch: Partial<TripWindow> = {}): TripWindow => ({
  carKey: 'car:test',
  tripKey: 'pd:test',
  fromMs,
  toMs,
  fromPrecision: 'minute',
  toPrecision: 'minute',
  source: 'manual',
  ongoing: false,
  fromLabel: '—',
  toLabel: '—',
  sourceLabel: 'тест',
  warnings: [],
  ...patch,
});

const basePlan = { planKm: 1000, factKm: 1040, sourceLabel: 'План дохода' };

const runTrip = (window: TripWindow, samples: MeasureSample[], extra: Partial<Parameters<typeof analyzeTrip>[0]> = {}) =>
  analyzeTrip({
    window,
    samples,
    reportIntervals: null,
    reportMeta: { available: false, reason: 'тест: отчёт недоступен', fetchedAt: null },
    mappingHistory: [],
    techMarks: [],
    resolvedEventIds: [],
    plan: basePlan,
    params: P,
    ...extra,
  });

const iv = (startMs: number, endMs: number, inMotion: boolean, patch: Partial<ParkingIntervalRaw> = {}): ParkingIntervalRaw => ({
  inMotion,
  startMs,
  endMs,
  startLat: 53.9,
  startLon: 27.6,
  endLat: 53.9,
  endLon: 27.6,
  avgSpeedKmh: inMotion ? 40 : 0,
  maxSpeedKmh: inMotion ? 60 : 0,
  startOdoKm: null,
  endOdoKm: null,
  ...patch,
});

console.log('1) Целый рейс с нормальными показаниями (расчёт портала, отчёт недоступен)');
{
  const from = D(2026, 10, 5, 8);
  const to = D(2026, 10, 5, 18);
  const samples: MeasureSample[] = [];
  let odo = 100000;
  // 8:00–9:00 стоянка у базы (стоит), затем едет 8 часов по 70 км/ч (шаг 30 мин)
  samples.push(sample(from, { odoKm: odo, speed: 0 }));
  for (let t = from + 30 * M; t < from + 60 * M; t += 30 * M) samples.push(sample(t, { odoKm: odo, speed: 0 }));
  for (let t = from + 60 * M; t <= to; t += 30 * M) {
    odo += 35; // 70 км/ч * 0.5 ч
    samples.push(sample(t, { odoKm: odo, speed: 70 }));
  }
  const res = runTrip(mkWindow(from, to), samples);
  check('прирост одометра за рейс вычислен', res.summary.odoGainKm != null && Math.abs((res.summary.odoGainKm as number) - (odo - 100000)) < 0.01, String(res.summary.odoGainKm));
  check('место определения стоянок — расчёт портала (отчёт недоступен)', res.report.available === false && res.stops.every((s) => s.stop.method === 'portal_sequence'));
  check('найдена стоянка у базы', res.stops.length === 1 && res.stops[0].stop.category === 'confirmed', `стоянок: ${res.stops.length}`);
  check('событий нет', res.events.length === 0, JSON.stringify(res.events.map((e) => e.title)));
  check('сводка без «ущерба»: подпись отмеченного прироста нейтральная', /Не является подтверждённым завышением/.test(res.summary.flaggedNote));
  check('полнота данных посчитана', res.summary.dataCompletenessPct > 90, String(res.summary.dataCompletenessPct));
}

console.log('2) Рост одометра во время подтверждённой стоянки (сценарий А)');
{
  const from = D(2026, 10, 6, 8);
  const to = D(2026, 10, 6, 14);
  const stopStart = D(2026, 10, 6, 9);
  const stopEnd = D(2026, 10, 6, 12);
  const samples: MeasureSample[] = [
    sample(stopStart - 30 * M, { odoKm: 500000, speed: 0 }),
    sample(stopStart, { odoKm: 500000.5, speed: 0 }),
    sample(stopStart + 20 * M, { odoKm: 500001, speed: 0 }),
    sample(stopStart + 40 * M, { odoKm: 500001.4, speed: 0 }),
    sample(stopStart + 60 * M, { odoKm: 500002.0, speed: 0 }),
    sample(stopStart + 80 * M, { odoKm: 500003.2, speed: 0 }),
    sample(stopEnd, { odoKm: 500003.6, speed: 0 }),
    sample(stopEnd + 30 * M, { odoKm: 500003.7, speed: 20 }),
    sample(to, { odoKm: 500050, speed: 70 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const a = res.stops.find((s) => s.analysis.scenario === 'A');
  check('найден сценарий А', !!a, JSON.stringify(res.stops.map((s) => s.analysis.scenario)));
  check('прирост внутри стоянки ≥ порога', !!a && (a.analysis.riseWithinStopKm as number) >= P.riseEventKm, String(a?.analysis.riseWithinStopKm));
  check('основание названо: подтверждённая стоянка', !!a && /подтверждают отсутствие движения/.test(a.analysis.rule || ''));
  check('событие попало в список', res.events.some((e) => e.kind === 'stop_A'));
}

console.log('3) Скачок сразу после стоянки при частых измерениях (сценарий Б)');
{
  const from = D(2026, 10, 7, 6);
  const to = D(2026, 10, 7, 12);
  const stopStart = D(2026, 10, 7, 7);
  const stopEnd = D(2026, 10, 7, 9);
  const samples: MeasureSample[] = [
    sample(stopStart - 30 * M, { odoKm: 700000, speed: 0 }),
    sample(stopStart + 20 * M, { odoKm: 700000, speed: 0 }),
    sample(stopStart + 60 * M, { odoKm: 700000.2, speed: 0 }),
    sample(stopEnd - 5 * M, { odoKm: 700000.2, speed: 0 }),
    // первое измерение после стоянки: +60 км за 30 минут → 120 км/ч (нереально)
    sample(stopEnd + 30 * M, { odoKm: 700060, speed: 85 }),
    sample(stopEnd + 60 * M, { odoKm: 700105, speed: 88 }),
    sample(to, { odoKm: 700180, speed: 85 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const b = res.stops.find((s) => s.analysis.scenario === 'B');
  check('найден сценарий Б', !!b, JSON.stringify(res.stops.map((s) => s.analysis.scenario)));
  check('названо несоответствие темпа', !!b && /не соответствует наблюдаемому интервалу/.test(b.analysis.rule || ''));
  check('первое измерение после стоянки в движении — так и указано', !!b && b.analysis.resumeAlreadyMoving);
  check('событие Б в списке', res.events.some((e) => e.kind === 'stop_B'));
  check('тот же интервал не продублирован событием в движении', !res.events.some((e) => e.kind === 'move_rate'), JSON.stringify(res.events.map((e) => e.kind)));
}

console.log('4) Большой прирост после длительного отсутствия данных (сценарий В)');
{
  const from = D(2026, 10, 8, 6);
  const to = D(2026, 10, 8, 20);
  const samples: MeasureSample[] = [
    // вечерняя стоянка у базы (измерения идут), затем данные пропали на 6,5 часов
    sample(from + 30 * M, { odoKm: 1000000, speed: 0 }),
    sample(from + 60 * M, { odoKm: 1000000.1, speed: 0 }),
    sample(from + 90 * M, { odoKm: 1000000.2, speed: 0 }),
    // первое измерение после разрыва: уже в пути, прирост большой
    sample(from + 8 * H, { odoKm: 1000500, speed: 80 }),
    sample(from + 10 * H, { odoKm: 1000640, speed: 80 }),
    sample(to, { odoKm: 1000900, speed: 80 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const c = res.stops.find((s) => s.analysis.scenario === 'C') || null;
  const cEvent = res.events.find((e) => e.kind === 'gap_rise');
  check('событие В в списке', !!cEvent, JSON.stringify(res.events.map((e) => e.title)));
  check('название «Прирост через разрыв — требуется проверка»', !!cEvent && cEvent.title === 'Прирост через разрыв — требуется проверка', cEvent?.title);
  check('НЕ названо «скачком на стоянке»', !!cEvent && !/скачок/i.test(cEvent.title));
  check('в пояснении указана неизвестность момента', !!cEvent && /момент и обстоятельства изменения неизвестны/.test(`${cEvent.rule} ${cEvent.explanation.join(' ')}`));
  check('сценарий C у стоянки', !!c && c.analysis.scenario === 'C', JSON.stringify(res.stops.map((s) => s.analysis.scenario)));
}

console.log('5) Первая точка после стоянки получена уже в движении — прирост не приписан стоянке');
{
  const from = D(2026, 10, 9, 6);
  const to = D(2026, 10, 9, 12);
  const stopStart = D(2026, 10, 9, 7);
  const stopEnd = D(2026, 10, 9, 10);
  const samples: MeasureSample[] = [
    sample(stopStart - 90 * M, { odoKm: 299980, speed: 50, lat: 53.95, lon: 27.65 }),
    sample(stopStart - 30 * M, { odoKm: 300000, speed: 0 }),
    sample(stopStart + 30 * M, { odoKm: 300000, speed: 0 }),
    sample(stopStart + 90 * M, { odoKm: 300000.1, speed: 0 }),
    sample(stopEnd - 30 * M, { odoKm: 300000.1, speed: 0 }),
    sample(stopEnd + 10 * M, { odoKm: 300015, speed: 80 }), // уже в движении
    sample(stopEnd + 40 * M, { odoKm: 300050, speed: 80 }),
    sample(stopEnd + 80 * M, { odoKm: 300080, speed: 80 }),
    sample(to, { odoKm: 300110, speed: 80 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const stop = res.stops[0];
  check('стоянка найдена', !!stop && res.stops.length === 1, `стоянок: ${res.stops.length}`);
  check('сценарий А НЕ выставлен (прирост не внутри стоянки)', !!stop && stop.analysis.scenario !== 'A', JSON.stringify(stop?.analysis.scenario));
  check('первое «после» отмечено как движущееся', !!stop && stop.analysis.resumeAlreadyMoving === true);
  check('прирост при возобновлении учтён отдельно (~14,9 км)', !!stop && stop.analysis.riseResumeKm != null && Math.abs((stop.analysis.riseResumeKm as number) - 14.9) < 0.05, String(stop?.analysis.riseResumeKm));
  check('прирост внутри стоянки мал (0,1 км) и событием не стал', !!stop && stop.analysis.riseWithinStopKm != null && stop.analysis.riseWithinStopKm < P.riseEventKm && res.events.length === 0, `событий: ${res.events.length}`);
  check('пояснение отделяет прирост от стоянки', !!stop && stop.analysis.explanation.some((l) => /Прирост одометра между измерением до и после стоянки/.test(l)));
}

console.log('6) Устаревшая координата на границе — не подтверждает стоянку');
{
  const from = D(2026, 10, 10, 6);
  const to = D(2026, 10, 10, 12);
  const samples: MeasureSample[] = [
    sample(from, { odoKm: 200000, speed: 0 }),
    sample(from + 30 * M, { odoKm: 200000, speed: 0 }),
    // координата, пришедшая на 4 часа позже времени измерения, затем «молчание»
    sample(from + 60 * M, { odoKm: 200000, speed: 0, stale: true }),
    sample(to, { odoKm: 200050, speed: 60 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const stop = res.stops[0];
  check('стоянка найдена и помечена', !!stop);
  check('в качестве границы отмечена устаревшая координата', !!stop && stop.stop.quality.tags.some((t) => /устарел/.test(t)), JSON.stringify(stop?.stop.quality.tags));
  // разрыв больше порога: «молчание» после устаревшей точки — неизвестный период, не стоянка
  check('период тишины отмечен как неизвестный (портал не собирал)', res.unknowns.length >= 1, JSON.stringify(res.unknowns.map((u) => [u.fromMs, u.toMs])));
}

console.log('7) Текущий незавершённый рейс — границы по план + до сейчас');
{
  const nowMs = D(2026, 10, 10, 12);
  const candidate: TripCandidate = tripsForCar(
    [{ id: 'T1', carNumber: 'АР 8339-7', dateStart: '2026-10-08', dateEnd: '2026-10-25', totalKm: 5000, factKm: null }],
    'car:8339',
    'АР 8339-7',
  )[0];
  check('рейс сопоставлен по номеру (варианты раскладки)', !!candidate, 'кандидат не найден');
  const res = resolveTripWindow({ candidate, carKey: 'car:8339', factDays: [], override: null, nowMs });
  check('окно построено', !!res.window, res.needClarification || '');
  check('предварительный статус и источник «plan_current»', !!res.window && res.window.ongoing && res.window.source === 'plan_current');
  check('окончание — текущий момент', !!res.window && res.window.toMs === nowMs);
  check('предупреждение о предварительности', !!res.window && res.window.warnings.some((w) => /не завершён/.test(w)));
}

console.log('8) Изменение границ рейса — уточнение и пересчёт');
{
  const nowMs = D(2026, 10, 10, 12);
  const candidate: TripCandidate = tripsForCar(
    [{ id: 'T2', carNumber: 'АР 8339-7', dateStart: '2026-10-01', dateEnd: '2026-10-05', totalKm: 1000, factKm: 0 }],
    'car:8339',
    'АР 8339-7',
  )[0];
  const base = resolveTripWindow({ candidate, carKey: 'car:8339', factDays: [], override: null, nowMs });
  check('базовое окно по плановым границам', !!base.window && base.window.source === 'plan');
  const override = { fromMs: D(2026, 10, 2, 6), toMs: D(2026, 10, 4, 18), by: 'Инженер', at: '2026-10-10T12:00:00Z' };
  const refined = resolveTripWindow({ candidate, carKey: 'car:8339', factDays: [], override, nowMs });
  check('окно уточнено вручную', !!refined.window && refined.window.source === 'manual' && refined.window.fromMs === override.fromMs && refined.window.toMs === override.toMs);
  check('история изменения сохранена в предупреждениях (кто уточнил)', !!refined.window && refined.window.warnings.some((w) => /уточнены вручную/.test(w) && /Инженер/.test(w)), JSON.stringify(refined.window?.warnings));

  // Пересчёт по новым границам: прирост меняется вместе с окном.
  const samples = [
    sample(D(2026, 10, 1, 8), { odoKm: 10, speed: 0 }),
    sample(D(2026, 10, 2, 8), { odoKm: 110, speed: 60 }),
    sample(D(2026, 10, 3, 8), { odoKm: 210, speed: 60 }),
    sample(D(2026, 10, 5, 8), { odoKm: 410, speed: 60 }),
  ];
  const r1 = runTrip(base.window as TripWindow, samples);
  const r2 = runTrip(refined.window as TripWindow, samples);
  check('пересчёт по новым границам меняет прирост', r1.summary.odoGainKm !== r2.summary.odoGainKm, `${r1.summary.odoGainKm} vs ${r2.summary.odoGainKm}`);
  check('прирост уточнённого окна: 100 → 310', r2.summary.odoGainKm != null && Math.abs((r2.summary.odoGainKm as number) - 200) < 0.01, String(r2.summary.odoGainKm));
}

console.log('9) Замена трекера/автомобиля — разделение участков, не склейка счётчиков');
{
  const from = D(2026, 10, 3, 6);
  const to = D(2026, 10, 3, 20);
  const samples: MeasureSample[] = [
    sample(from, { odoKm: 400000, speed: 0 }),
    sample(from + 2 * H, { odoKm: 400100, speed: 60 }),
    sample(from + 4 * H, { odoKm: 500500, speed: 0, source: 'navby.odo_new' }), // новый трекер/счётчик
    sample(from + 6 * H, { odoKm: 500600, speed: 60, source: 'navby.odo_new' }),
  ];
  const res = runTrip(mkWindow(from, to), samples, {
    mappingHistory: [{ atMs: from + 4 * H, action: 'rebind', comment: 'Заменён трекер по обращению' }],
  });
  check('участки разделены (смена источника)', res.segments.length === 2, JSON.stringify(res.segments.map((s) => s.breakReason)));
  check('прирост за рейс честно не вычислен', res.summary.odoGainKm === null && /участков/.test(res.summary.odoGainReason || ''), res.summary.odoGainReason || '');
  check('техсобытие смены источника отмечено', res.techEvents.some((t) => t.kind === 'source_change'));
  check('техсобытие смены привязки отмечено (из истории)', res.techEvents.some((t) => t.kind === 'rebind' && /Заменён трекер/.test(t.detail || '')));
}

console.log('10) Сброс счётчика');
{
  const from = D(2026, 10, 4, 6);
  const to = D(2026, 10, 4, 20);
  const samples: MeasureSample[] = [
    sample(from, { odoKm: 800000, speed: 0 }),
    sample(from + 2 * H, { odoKm: 800120, speed: 60 }),
    sample(from + 4 * H, { odoKm: 340, speed: 0 }), // сброс счётчика
    sample(from + 6 * H, { odoKm: 400, speed: 60 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  check('техсобытие сброса отмечено', res.techEvents.some((t) => t.kind === 'reset'));
  check('прирост за рейс не вычислен (сброс)', res.summary.odoGainKm === null, String(res.summary.odoGainKm));
  check('участки разделены', res.segments.length === 2);
  check('столбик сброса помечен на графике приростов', res.gains.some((g) => g.kind === 'reset' && g.quality === 'reset'));
}

console.log('11) Позднее поступление исторических данных');
{
  const from = D(2026, 10, 5, 6);
  const to = D(2026, 10, 5, 20);
  const sorted: MeasureSample[] = [
    sample(from, { odoKm: 600000, speed: 0 }),
    sample(from + 2 * H, { odoKm: 600050, speed: 60 }),
    sample(from + 4 * H, { odoKm: 600120, speed: 60 }),
  ];
  // «Позднее» измерение пришло последним, но относится к середине периода; плюс дубль метки.
  const late = [
    ...sorted,
    sample(from + 3 * H, { odoKm: 600090, speed: 60 }),
    sample(from + 2 * H, { odoKm: 600050, speed: 60 }),
  ];
  const a = runTrip(mkWindow(from, to), sorted);
  const b = runTrip(mkWindow(from, to), late);
  check('позднее измерение не меняет прирост за рейс', a.summary.odoGainKm === b.summary.odoGainKm, `${a.summary.odoGainKm} vs ${b.summary.odoGainKm}`);
  check('прирост между измерениями встал на своё место по времени', b.gains.length === 3 && b.gains[1].fromMs === from + 2 * H && b.gains[1].toMs === from + 3 * H, JSON.stringify(b.gains.map((g) => [g.fromMs - from, g.toMs - from])));
  check('дубль метки времени не удваивает измерения', b.gains.length === 3, String(b.gains.length));
}

console.log('Дополнительно: отчёт Nav.by — склейка дрожания, фильтры, приоритет метода');
{
  const from = D(2026, 10, 6, 0);
  const to = D(2026, 10, 6, 24);
  // Реальная картина парковки из живого отчёта: стоянка, дрожание (10 мин, 0.1 км/ч, ~10 м), снова стоянка…
  const intervals: ParkingIntervalRaw[] = [
    iv(from + 60 * M, from + 180 * M, false),
    iv(from + 180 * M, from + 200 * M, true, { avgSpeedKmh: 0.1, maxSpeedKmh: 0, endLat: 53.90009, endLon: 27.60009 }),
    iv(from + 200 * M, from + 300 * M, false),
    iv(from + 300 * M, from + 310 * M, true, { avgSpeedKmh: 0.1, maxSpeedKmh: 0, endLat: 53.90009, endLon: 27.60009 }),
    iv(from + 310 * M, from + 420 * M, false),
    iv(from + 480 * M, from + 540 * M, true, { avgSpeedKmh: 50, maxSpeedKmh: 80, endLat: 54.2, endLon: 28.0 }),
    iv(from + 540 * M, from + 600 * M, false),
  ];
  const samples: MeasureSample[] = [
    sample(from + 30 * M, { odoKm: 900000, speed: 0 }),
    sample(from + 100 * M, { odoKm: 900000.1, speed: 0 }),
    sample(from + 250 * M, { odoKm: 900000.2, speed: 0 }),
    sample(from + 350 * M, { odoKm: 900000.3, speed: 0 }),
    sample(from + 450 * M, { odoKm: 900000.4, speed: 0 }),
    sample(from + 520 * M, { odoKm: 900020, speed: 70 }),
    sample(from + 570 * M, { odoKm: 900070, speed: 70 }),
    sample(from + 590 * M, { odoKm: 900070.5, speed: 0 }),
  ];
  const res = runTrip(mkWindow(from, to), samples, {
    reportIntervals: intervals,
    reportMeta: { available: true, reason: null, fetchedAt: '2026-10-10T12:00:00Z' },
  });
  const first = res.stops.find((s) => s.stop.startMs === from + 60 * M);
  check('метод — отчёт Nav.by', res.stops.every((s) => s.stop.method === 'navby_parking_report'));
  check('дрожание склеено: стоянка 60 → 420 мин одним интервалом', !!first && first.stop.endMs === from + 420 * M, `${first?.stop.startMs} → ${first?.stop.endMs}`);
  check('через реальное движение стоянки не склеиваются', res.stops.length === 2, String(res.stops.length));
  check('вторая стоянка после движения найдена', res.stops.some((s) => s.stop.startMs === from + 540 * M));
  check('ошибка «скачка» на дрожании не появляется', !res.events.some((e) => /скач/i.test(e.title)));
}

console.log('Дополнительно: перекрывающиеся события не суммируются дважды');
{
  const from = D(2026, 10, 7, 0);
  const to = D(2026, 10, 7, 24);
  const samples: MeasureSample[] = [
    sample(from + 2 * H, { odoKm: 100, speed: 0 }),
    sample(from + 10 * H, { odoKm: 150, speed: 60 }), // разрыв + большой прирост
    sample(from + 20 * H, { odoKm: 620, speed: 60 }),
  ];
  const res = runTrip(mkWindow(from, to), samples);
  const gain = res.summary.flaggedGainKm;
  check('событий прироста два (два интервала без данных)', res.events.filter((e) => e.kind === 'gap_rise').length === 2, String(res.events.length));
  check('отмеченный прирост без пересечений = 520 км', gain != null && Math.abs(gain - 520) < 0.01, String(gain));
}

console.log('Дополнительно: разбор отчёта Nav.by (server) — невалидные записи отбрасываются');
{
  const items = [
    {
      imei: '352093080881393',
      data: [
        { in_motion: 0, date_start: '2026-10-09 21:48:14', date_end: '2026-10-10 09:47:21', start_latitude: 53.8, start_longitude: 27.7, end_latitude: 53.8, end_longitude: 27.7, avg_speed: 0, max_speed: 0, s_odo_can: 916904.595, e_odo_can: 916904.595 },
        { in_motion: 1, date_start: '2026-10-10 10:00:00', date_end: '2026-10-10 09:00:00' }, // конец раньше
        { in_motion: null, date_start: 'x', date_end: 'y' }, // мусор
        { in_motion: 1, date_start: '2026-10-10 10:00:00', date_end: '2026-10-10 11:00:00', s_odo_can: 0, e_odo_can: null },
      ],
    },
  ];
  const rep = normalizeParkingItems(items);
  check('валидная запись разобрана', rep.intervals.length === 2, String(rep.intervals.length));
  check('невалидные отброшены и посчитаны', rep.discarded === 2, String(rep.discarded));
  check('одометр 0 трактуется как «нет данных», не 0 км', rep.intervals[1].startOdoKm === null && rep.intervals[1].endOdoKm === null);
  check('imei извлечён', rep.imei === '352093080881393');
}

console.log('Дополнительно: фактический старт (этапы) и его дни');
{
  const stageDays = factDaysOfStages(
    { p1: { s1: { actualDate: '2026-10-02' }, s2: { actualDate: '2026-10-05' } } },
    'p1',
  );
  check('фактические дни этапов собраны', stageDays.length === 2 && Math.min(...stageDays) === Math.floor((Date.UTC(2026, 9, 2) / 86400000)) );
  const candidate: TripCandidate = tripsForCar(
    [{ id: 'T3', carNumber: 'AP 9692-7', dateStart: '2026-10-01', dateEnd: '2026-10-10', totalKm: 9000, factKm: 8700 }],
    'car:9692',
    'АР 9692-7',
  )[0];
  check('кириллица/латиница в номере сопоставлены', !!candidate);
  const res = resolveTripWindow({ candidate, carKey: 'car:9692', factDays: stageDays, override: null, nowMs: D(2026, 10, 11, 12) });
  check('использованы фактические границы этапов', !!res.window && res.window.source === 'fact' && res.window.toMs === Math.floor((Date.UTC(2026, 9, 6) / 86400000)) * 86400000 - TZ - 1, res.window ? `${res.window.source} ${res.window.fromLabel} → ${res.window.toLabel}` : '');
}

console.log('');
if (failed) {
  console.error(`ПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log('Все проверки движка пройдены.');
