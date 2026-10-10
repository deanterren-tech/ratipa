/**
 * Разбор отчёта Nav.by «Стоянка-движение» (parking-movement-report).
 *
 * Метод и поля ПОДТВЕРЖДЕНЫ живым вызовом 10.10.2026 (см. отчёт этапа 2):
 * интервалы in_motion 0|1 с датами, координатами границ, средней/максимальной
 * скоростью и показаниями одометра на границах (s_odo_can/e_odo_can).
 * Для объектов без данных одометра тот же отчёт отдаёт null/0 — не выдумываем.
 *
 * Чистые функции без сети и БД: покрываются scripts/test-navby.ts.
 */

import { parseNavbyDateTimeToMs } from './config.ts';
import { toNum } from './parse.ts';

export interface ParkingInterval {
  /** true — интервал движения, false — интервал стоянки (как в отчёте). */
  inMotion: boolean;
  startMs: number;
  endMs: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  /** Одометр на начало интервала (км); null — не передаётся для объекта. */
  startOdoKm: number | null;
  /** Одометр на окончание интервала (км); null — не передаётся. */
  endOdoKm: number | null;
}

const coord = (v: unknown, limit: number): number | null => {
  const n = toNum(v);
  // 0 координаты в отчёте = «нет данных» (как и в current-position: 0,0 — не позиция).
  if (n == null || n === 0) return null;
  return Math.abs(n) <= limit ? n : null;
};

/** Разбор одного интервала отчёта; null — запись непригодна (нет дат/типа). */
export function normalizeParkingInterval(raw: Record<string, unknown>): ParkingInterval | null {
  const motionNum = toNum(raw.in_motion);
  if (motionNum == null) return null;
  const startMs = parseNavbyDateTimeToMs(raw.date_start);
  const endMs = parseNavbyDateTimeToMs(raw.date_end);
  if (startMs == null || endMs == null || endMs < startMs) return null;

  const startOdoRaw = toNum(raw.s_odo_can);
  const endOdoRaw = toNum(raw.e_odo_can);

  return {
    inMotion: motionNum === 1,
    startMs,
    endMs,
    startLat: coord(raw.start_latitude, 90),
    startLon: coord(raw.start_longitude, 180),
    endLat: coord(raw.end_latitude, 90),
    endLon: coord(raw.end_longitude, 180),
    avgSpeedKmh: toNum(raw.avg_speed),
    maxSpeedKmh: toNum(raw.max_speed),
    // 0 одометра в отчёте = «данных нет» (объекты без CAN), не пробег 0.
    startOdoKm: startOdoRaw != null && startOdoRaw > 0 ? startOdoRaw : null,
    endOdoKm: endOdoRaw != null && endOdoRaw > 0 ? endOdoRaw : null,
  };
}

export interface ParkingReport {
  imei: string | null;
  intervals: ParkingInterval[];
  /** Сколько записей отброшено как непригодные (наблюдаемость). */
  discarded: number;
}

/**
 * Разбор ответа parking-movement-report: items = [{imei, data:[{...}]}].
 * Возвращает интервалы всех items, отсортированные по времени начала.
 */
export function normalizeParkingItems(items: unknown[]): ParkingReport {
  let imei: string | null = null;
  const intervals: ParkingInterval[] = [];
  let discarded = 0;
  for (const raw of items || []) {
    const item = (raw || {}) as Record<string, unknown>;
    if (imei == null && typeof item.imei === 'string' && item.imei.trim()) imei = item.imei.trim();
    else if (imei == null && item.imei != null) imei = String(item.imei);
    const data = Array.isArray(item.data) ? item.data : [];
    for (const entry of data) {
      const iv = normalizeParkingInterval((entry || {}) as Record<string, unknown>);
      if (iv) intervals.push(iv);
      else discarded += 1;
    }
  }
  intervals.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { imei, intervals, discarded };
}
