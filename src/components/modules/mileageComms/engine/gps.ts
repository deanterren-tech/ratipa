/**
 * Геометрия и GPS-пробег для движка проверки пробега.
 * GPS-пробег считается ТОЛЬКО по пригодным парам соседних измерений
 * (не реже gpsMaxGapMin, скорость пары не выше gpsMaxSegmentKmh) и никогда
 * не экстраполируется на разрывы.
 */

import type { GainKind, Interval, MeasureSample } from './types';
import type { CheckParams } from './params';

const EARTH_R = 6_371_000;

/** Расстояние между координатами, метры (haversine). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Медиана координат набора измерений (для «места» стоянки). */
export function medianPosition(samples: MeasureSample[]): { lat: number; lon: number } | null {
  const lats = samples.filter((s) => s.posValid && s.lat != null && s.lon != null).map((s) => s.lat as number).sort((a, b) => a - b);
  const lons = samples.filter((s) => s.posValid && s.lon != null && s.lat != null).map((s) => s.lon as number).sort((a, b) => a - b);
  if (!lats.length || !lons.length) return null;
  const mid = Math.floor(lats.length / 2);
  return { lat: lats[mid], lon: lons[mid] };
}

/** Пригодна ли пара соседних измерений для GPS-пробега. */
export function gpsPairOk(a: MeasureSample, b: MeasureSample, params: CheckParams): boolean {
  if (!a.posValid || !b.posValid || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return false;
  const dtMs = b.atMs - a.atMs;
  if (dtMs <= 0 || dtMs > params.gpsMaxGapMin * 60_000) return false;
  const m = distanceMeters(a.lat, a.lon, b.lat, b.lon);
  const kmh = (m / 1000) / (dtMs / 3_600_000);
  return kmh <= params.gpsMaxSegmentKmh;
}

export interface GpsSegmentResult {
  /** Сумма GPS-пробега по пригодным парам, км. */
  km: number;
  /** Сколько пар вошло. */
  pairs: number;
  /** Сколько пар исключено (разрыв/выброс). */
  excludedPairs: number;
  /** Непрерывные интервалы покрытия (для подписи области сравнения). */
  intervals: Interval[];
}

/** GPS-пробег по измерениям в интервале [fromMs, toMs]. */
export function gpsKmInRange(samples: MeasureSample[], fromMs: number, toMs: number, params: CheckParams): GpsSegmentResult {
  const inRange = samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
  let km = 0;
  let pairs = 0;
  let excluded = 0;
  let intervalStart: number | null = null;
  let prev: MeasureSample | null = null;
  const intervals: Interval[] = [];
  const closeInterval = (endMs: number) => {
    if (intervalStart != null) {
      intervals.push({ fromMs: intervalStart, toMs: endMs });
      intervalStart = null;
    }
  };
  for (const s of inRange) {
    if (prev && s.atMs > prev.atMs && s.atMs - prev.atMs <= params.gpsMaxGapMin * 60_000) {
      if (gpsPairOk(prev, s, params)) {
        km += distanceMeters(prev.lat as number, prev.lon as number, s.lat as number, s.lon as number) / 1000;
        pairs += 1;
        if (intervalStart == null) intervalStart = prev.atMs;
      } else {
        excluded += 1;
        closeInterval(prev.atMs);
      }
    } else if (prev) {
      closeInterval(prev.atMs);
    }
    prev = s;
  }
  if (prev && intervalStart != null) closeInterval(prev.atMs);
  return { km, pairs, excludedPairs: excluded, intervals };
}

/** Пробег по одометру между двумя измерениями (null, если что-то не пригодно). */
export function odoDelta(a: MeasureSample | null, b: MeasureSample | null): number | null {
  if (!a || !b || a.odoKm == null || b.odoKm == null) return null;
  const d = b.odoKm - a.odoKm;
  return Number.isFinite(d) ? d : null;
}

/** Скорость по координатам пары, км/ч (null — нет пригодных координат). */
export function pairSpeedKmh(a: MeasureSample, b: MeasureSample): number | null {
  if (!a.posValid || !b.posValid || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const dtMs = b.atMs - a.atMs;
  if (dtMs <= 0) return null;
  return (distanceMeters(a.lat, a.lon, b.lat, b.lon) / 1000) / (dtMs / 3_600_000);
}

/** Скорость пары для оценки темпа прироста одометра, км/ч. */
export function odoRateKmh(a: MeasureSample, b: MeasureSample): number | null {
  const d = odoDelta(a, b);
  if (d == null) return null;
  const dtMs = b.atMs - a.atMs;
  if (dtMs <= 0) return null;
  return d / (dtMs / 3_600_000);
}

/** Классификация интервала для второго графика. */
export function classifyGain(params: {
  deltaKm: number | null;
  rateKmh: number | null;
  gapInside: boolean;
  invalid: boolean;
  stopId: string | null;
  stopEventKind: 'A' | 'B' | null;
  reset: boolean;
}): { kind: GainKind; quality: 'ok' | 'no_odo' | 'reset' | 'gap' } {
  const { deltaKm, gapInside, invalid, stopId, stopEventKind, reset } = params;
  if (reset) return { kind: 'reset', quality: 'reset' };
  if (deltaKm == null) return { kind: invalid ? 'gps_gap' : 'normal', quality: 'no_odo' };
  if (gapInside) return { kind: 'gap', quality: 'gap' };
  if (stopId && stopEventKind === 'A') return { kind: 'stop_rise', quality: 'ok' };
  if (stopId && stopEventKind === 'B') return { kind: 'resume', quality: 'ok' };
  return { kind: 'normal', quality: 'ok' };
}
