/**
 * Определение стоянок.
 *
 * Основной источник — отчёт Nav.by «Стоянка-движение» (метод
 * navby_parking_report; подтверждён живым вызовом). Отчёт даёт интервалы
 * in_motion=0/1, но содержит «дрожание» GPS: короткие «движения» с нулевой
 * скоростью внутри стоянки. Их склеиваем со стоянкой по порогам (длительность,
 * max_speed, смещение границ) — способ и пороги сохраняются в описании.
 *
 * Если отчёт недоступен — запасной расчёт портала (portal_sequence) по
 * последовательности пригодных координат и скоростей: одиночные точки и
 * выбросы исключаются, отсутствие сообщений стоянкой НЕ считается,
 * устаревшая координата на границе не подтверждает границу стоянки.
 */

import type { MeasureSample, ParkingIntervalRaw, Stop, StopMethod, StopQuality } from './types';
import type { CheckParams } from './params';
import { distanceMeters, medianPosition } from './gps';
import { maxGapBetween } from './samples';
import { fmtDMYHM, fmtDuration } from './format';

export interface StopsResult {
  stops: Stop[];
  method: StopMethod;
  /** Причина запасного расчёта (null для основного источника). */
  fallbackReason: string | null;
}

const clipInterval = (iv: ParkingIntervalRaw, fromMs: number, toMs: number): ParkingIntervalRaw | null => {
  const startMs = Math.max(iv.startMs, fromMs);
  const endMs = Math.min(iv.endMs, toMs);
  if (endMs <= startMs) return null;
  return { ...iv, startMs, endMs };
};

const positionsSpreadM = (iv: ParkingIntervalRaw): number | null => {
  if (iv.startLat == null || iv.startLon == null || iv.endLat == null || iv.endLon == null) return null;
  return distanceMeters(iv.startLat, iv.startLon, iv.endLat, iv.endLon);
};

/** Качество по измерениям портала внутри интервала [a,b]. */
function qualityInside(samples: MeasureSample[], aMs: number, bMs: number, params: CheckParams): StopQuality {
  const inside = samples.filter((s) => s.atMs >= aMs && s.atMs <= bMs);
  const moving = inside.filter((s) => s.speed != null && s.speed > params.stopSpeedKmh);
  const tags: string[] = [];
  const gap = maxGapBetween(inside);
  if (!inside.length) tags.push('в истории портала измерений внутри нет');
  if (gap != null && gap > params.dataGapMin * 60_000) tags.push('внутри стоянки есть разрыв данных портала');
  if (inside.some((s) => s.staleOnArrival)) tags.push('есть устаревшие на момент получения координаты');
  return { samplesInside: inside.length, maxGapMs: gap, movingInside: moving.length, tags };
}

/**
 * Обработка интервалов отчёта Nav.by: склейка дрожания, отсечение коротких
 * стоянок, категория «подтверждённая».
 */
export function processReportIntervals(
  intervals: ParkingIntervalRaw[],
  fromMs: number,
  toMs: number,
  params: CheckParams,
  samples: MeasureSample[],
): StopsResult {
  const clipped = intervals
    .map((iv) => clipInterval(iv, fromMs, toMs))
    .filter((iv): iv is ParkingIntervalRaw => iv != null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  interface OpenStop { startMs: number; endMs: number; parts: number; jitterMerged: number }
  let open: OpenStop | null = null;
  const raw: OpenStop[] = [];

  for (const iv of clipped) {
    const dur = iv.endMs - iv.startMs;
    if (!iv.inMotion) {
      if (open) {
        open.endMs = iv.endMs;
        open.parts += 1;
      } else {
        open = { startMs: iv.startMs, endMs: iv.endMs, parts: 1, jitterMerged: 0 };
      }
      continue;
    }
    // Интервал движения: дрожание — короткое, с нулевой скоростью и почти без смещения.
    const disp = positionsSpreadM(iv);
    const isJitter =
      dur <= params.moveMergeMaxMin * 60_000 &&
      (iv.maxSpeedKmh ?? 0) <= params.jitterMaxKmh &&
      (disp == null || disp <= params.jitterMaxM);
    if (open && isJitter) {
      open.endMs = iv.endMs;
      open.jitterMerged += 1;
    } else if (open) {
      raw.push(open);
      open = null;
    }
    // Дрожание без открытой стоянки (или реальное движение) — в стоянки не попадает.
  }
  if (open) raw.push(open);

  const stops: Stop[] = [];
  for (const r of raw) {
    const durationMin = (r.endMs - r.startMs) / 60_000;
    if (durationMin < params.stopMinMin) continue;
    const q = qualityInside(samples, r.startMs, r.endMs, params);
    const basisParts = [
      'Интервал стоянки отчёта Nav.by «Стоянка-движение» (in_motion=0)',
      `длительность ${fmtDuration(r.endMs - r.startMs)}`,
    ];
    if (r.jitterMerged > 0) {
      basisParts.push(
        `присоединено коротких «движений» отчёта: ${r.jitterMerged} (дрожание GPS: до ${params.moveMergeMaxMin} мин, скорость ≤ ${params.jitterMaxKmh} км/ч, смещение ≤ ${params.jitterMaxM} м)`,
      );
    }
    if (q.movingInside > 0) basisParts.push(`в измерениях портала внутри есть движение: ${q.movingInside}`);
    stops.push({
      id: `nb:${r.startMs}:${r.endMs}`,
      method: 'navby_parking_report',
      category: 'confirmed',
      startMs: r.startMs,
      endMs: r.endMs,
      durationMin,
      lat: null,
      lon: null,
      basis: basisParts.join('; ') + '.',
      quality: q,
    });
  }
  return { stops, method: 'navby_parking_report', fallbackReason: null };
}

interface PortalRun {
  members: MeasureSample[];
  excluded: number;
}

/**
 * Запасной расчёт стоянок порталом по последовательности измерений.
 * Условие стояния: смещение от предыдущего пригодного измерения ≤ stopMoveM
 * И скорость ≤ stopSpeedKmh (когда скорость есть). Разрыв данных разрывает
 * серию. Одиночные точки не образуют стоянку.
 */
export function detectPortalStops(
  samples: MeasureSample[],
  fromMs: number,
  toMs: number,
  params: CheckParams,
): StopsResult {
  const inWindow = samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs && s.posValid && s.lat != null && s.lon != null);
  const gapMs = params.dataGapMin * 60_000;
  const runs: PortalRun[] = [];
  let run: MeasureSample[] = [];
  let excluded = 0;

  const flush = () => {
    if (run.length) runs.push({ members: run, excluded });
    run = [];
    excluded = 0;
  };

  for (const s of inWindow) {
    if (!run.length) {
      // Серию может начать только «стоящая» точка (скорость неизвестна — допускаем).
      if (s.speed == null || s.speed <= params.stopSpeedKmh) {
        run = [s];
        excluded = 0;
      }
      continue;
    }
    const prev = run[run.length - 1];
    const dt = s.atMs - prev.atMs;
    if (dt > gapMs) {
      flush();
      if (s.speed == null || s.speed <= params.stopSpeedKmh) run = [s];
      continue;
    }
    const disp = distanceMeters(prev.lat as number, prev.lon as number, s.lat as number, s.lon as number);
    const slow = s.speed == null || s.speed <= params.stopSpeedKmh;
    if (disp <= params.stopMoveM && slow) {
      run.push(s);
    } else {
      flush();
      // Точка движения сама серию не начинает — иначе она попала бы в стоянку.
      if (slow) run = [s];
    }
  }
  flush();

  // Склейка соседних серий, если их разделяет лишь короткий промежуток и почти нет смещения.
  const merged: PortalRun[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last) {
      const gapBetween = r.members[0].atMs - last.members[last.members.length - 1].atMs;
      const a = last.members[last.members.length - 1];
      const b = r.members[0];
      const disp = distanceMeters(a.lat as number, a.lon as number, b.lat as number, b.lon as number);
      if (gapBetween <= params.moveMergeMaxMin * 60_000 && disp <= params.jitterMaxM) {
        last.members = last.members.concat(r.members);
        last.excluded += r.excluded;
        continue;
      }
    }
    merged.push({ members: [...r.members], excluded: r.excluded });
  }

  const stops: Stop[] = [];
  for (const r of merged) {
    if (r.members.length < 2) continue; // одиночная точка стоянкой не является
    const first = r.members[0];
    const last = r.members[r.members.length - 1];
    const durationMin = (last.atMs - first.atMs) / 60_000;
    if (durationMin < params.stopMinMin) continue;

    // Исключение выбросов: позиции дальше радиуса от медианы не подтверждают стоянку.
    const med = medianPosition(r.members);
    let members = r.members;
    let excludedOutliers = 0;
    if (med) {
      members = r.members.filter((s) => distanceMeters(med.lat, med.lon, s.lat as number, s.lon as number) <= params.stopRadiusM);
      excludedOutliers = r.members.length - members.length;
      if (members.length < 2) continue;
    }

    const insideForQuality = members;
    const gap = maxGapBetween(insideForQuality);
    const moving = insideForQuality.filter((s) => s.speed != null && s.speed > params.stopSpeedKmh);
    const tags: string[] = [];
    if (excludedOutliers > 0) tags.push(`исключено выбросов координат: ${excludedOutliers}`);
    if (first.staleOnArrival || last.staleOnArrival) {
      tags.push('координата на границе устарела на момент получения — граница стоянки неточна');
    }
    const enoughData =
      insideForQuality.length >= params.minDuringSamples &&
      (gap == null || gap <= params.confirmMaxGapMin * 60_000);
    if (!enoughData) tags.push('мало измерений для подтверждения — стоянка предполагаемая');
    const med2 = medianPosition(members) || med;
    const startMs = members[0].atMs;
    const endMs = members[members.length - 1].atMs;
    stops.push({
      id: `ps:${startMs}:${endMs}`,
      method: 'portal_sequence',
      category: enoughData ? 'confirmed' : 'presumed',
      startMs,
      endMs,
      durationMin: (endMs - startMs) / 60_000,
      lat: med2?.lat ?? null,
      lon: med2?.lon ?? null,
      basis:
        `Расчёт портала по последовательности измерений: смещение ≤ ${params.stopMoveM} м и скорость ≤ ${params.stopSpeedKmh} км/ч в течение ${fmtDuration(endMs - startMs)} ` +
        `(${fmtDMYHM(startMs)} → ${fmtDMYHM(endMs)}); измерений в серии: ${members.length}.`,
      quality: { samplesInside: insideForQuality.length, maxGapMs: gap, movingInside: moving.length, tags },
    });
  }

  return { stops, method: 'portal_sequence', fallbackReason: null };
}

/** Итоговый выбор стоянок: отчёт Nav.by, при недоступности — расчёт портала. */
export function pickStops(params: {
  reportAvailable: boolean;
  reportReason: string | null;
  intervals: ParkingIntervalRaw[];
  samples: MeasureSample[];
  fromMs: number;
  toMs: number;
  params: CheckParams;
}): StopsResult {
  const { reportAvailable, reportReason, intervals, samples, fromMs, toMs } = params;
  if (reportAvailable && intervals.length) {
    return processReportIntervals(intervals, fromMs, toMs, params.params, samples);
  }
  const fallback = detectPortalStops(samples, fromMs, toMs, params.params);
  fallback.fallbackReason = reportAvailable
    ? 'Отчёт Nav.by «Стоянка-движение» за период пуст — применён расчёт портала'
    : reportReason || 'Отчёт Nav.by недоступен — применён расчёт портала';
  return fallback;
}
