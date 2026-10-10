/**
 * Нормализация измерений портала и работа с разрывами данных.
 * Измерения приходят из telemetry_history (серверный поллер) и, для «хвоста»,
 * из telemetry_current. Отсутствующее значение не превращается в ноль;
 * повторная метка времени не даёт двух измерений.
 */

import type { Interval, MeasureSample } from './types';
import type { CheckParams } from './params';

export interface HistoryNodeRaw {
  coordAtMs?: unknown;
  coordAt?: unknown;
  lat?: unknown;
  lon?: unknown;
  speed?: unknown;
  odoKm?: unknown;
  satellites?: unknown;
  odoSource?: unknown;
  receivedAt?: unknown;
}

export const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const isoToMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Разбор узла истории/текущего состояния в измерение; null — непригодно. */
export function normalizeSample(raw: HistoryNodeRaw | null | undefined): MeasureSample | null {
  if (!raw) return null;
  const atMs = numOrNull(raw.coordAtMs);
  if (atMs == null || atMs <= 0) return null;
  const lat = numOrNull(raw.lat);
  const lon = numOrNull(raw.lon);
  const posValid = lat != null && lon != null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const odoRaw = numOrNull(raw.odoKm);
  // 0 одометра = «данных нет» (как в парсере поллера), не пробег 0.
  const odoKm = odoRaw != null && odoRaw > 0 ? odoRaw : null;
  return {
    atMs,
    coordAt: typeof raw.coordAt === 'string' ? raw.coordAt : null,
    lat: posValid ? (lat as number) : null,
    lon: posValid ? (lon as number) : null,
    posValid,
    speed: numOrNull(raw.speed),
    odoKm,
    satellites: numOrNull(raw.satellites),
    odoSource: typeof raw.odoSource === 'string' ? raw.odoSource : null,
    receivedAtMs: isoToMs(raw.receivedAt),
  };
}

/** Сортировка и дедупликация по метке времени (первая запись с меткой важнее). */
export function sortDedupeSamples(list: MeasureSample[]): MeasureSample[] {
  const sorted = [...list].sort((a, b) => a.atMs - b.atMs);
  const out: MeasureSample[] = [];
  let lastMs: number | null = null;
  for (const s of sorted) {
    if (lastMs != null && s.atMs === lastMs) continue;
    out.push(s);
    lastMs = s.atMs;
  }
  return out;
}

/** Пометка «координата устарела на момент получения» (не подтверждает стоянку на границе). */
export function markStale(samples: MeasureSample[], params: CheckParams): MeasureSample[] {
  return samples.map((s) => {
    if (s.receivedAtMs == null) return s;
    const lag = s.receivedAtMs - s.atMs;
    return lag > params.staleCoordMin * 60_000 ? { ...s, staleOnArrival: true } : s;
  });
}

/** Измерения окна + ближайшие до/после (для базовой линии и «первого после»). */
export function sliceWindow(
  samples: MeasureSample[],
  fromMs: number,
  toMs: number,
): { inWindow: MeasureSample[]; before: MeasureSample | null; after: MeasureSample | null } {
  const inWindow: MeasureSample[] = [];
  let before: MeasureSample | null = null;
  let after: MeasureSample | null = null;
  for (const s of samples) {
    if (s.atMs < fromMs) before = s;
    else if (s.atMs > toMs) {
      if (!after) after = s;
    } else inWindow.push(s);
  }
  return { inWindow, before, after };
}

/**
 * Разрывы данных: интервалы внутри окна, где между соседними измерениями
 * (или от края окна до первого/последнего измерения) прошло больше порога.
 * Отсутствие сообщений не считается стоянкой — это «неизвестный период».
 */
export function dataGaps(samples: MeasureSample[], fromMs: number, toMs: number, params: CheckParams): Interval[] {
  const gapMs = params.dataGapMin * 60_000;
  const inWindow = samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
  const out: Interval[] = [];
  if (!inWindow.length) {
    if (toMs > fromMs) out.push({ fromMs, toMs });
    return out;
  }
  if (inWindow[0].atMs - fromMs > gapMs) out.push({ fromMs, toMs: inWindow[0].atMs });
  for (let i = 1; i < inWindow.length; i += 1) {
    if (inWindow[i].atMs - inWindow[i - 1].atMs > gapMs) {
      out.push({ fromMs: inWindow[i - 1].atMs, toMs: inWindow[i].atMs });
    }
  }
  const last = inWindow[inWindow.length - 1];
  if (toMs - last.atMs > gapMs) out.push({ fromMs: last.atMs, toMs });
  return out;
}

/** Максимальный разрыв между соседними измерениями набора (мс). */
export function maxGapBetween(samples: MeasureSample[]): number | null {
  let max: number | null = null;
  for (let i = 1; i < samples.length; i += 1) {
    const d = samples[i].atMs - samples[i - 1].atMs;
    if (max == null || d > max) max = d;
  }
  return max;
}

/** Есть ли разрыв больше порога внутри интервала [a, b] по измерениям. */
export function hasGapInside(samples: MeasureSample[], aMs: number, bMs: number, params: CheckParams): boolean {
  const gapMs = params.dataGapMin * 60_000;
  const inside = samples.filter((s) => s.atMs >= aMs && s.atMs <= bMs);
  if (!inside.length) return bMs - aMs > gapMs;
  if (inside[0].atMs - aMs > gapMs) return true;
  for (let i = 1; i < inside.length; i += 1) {
    if (inside[i].atMs - inside[i - 1].atMs > gapMs) return true;
  }
  return bMs - inside[inside.length - 1].atMs > gapMs;
}

/**
 * Пересекает ли отрезок [a, b] разрыв данных (учитываются и промежутки от
 * границ отрезка до ближайших измерений — именно так выглядит «прирост через
 * разрыв» между двумя измерениями).
 */
export function intervalCrossesGap(samples: MeasureSample[], aMs: number, bMs: number, params: CheckParams): boolean {
  const gapMs = params.dataGapMin * 60_000;
  if (bMs <= aMs) return false;
  const inside = samples.filter((s) => s.atMs >= aMs && s.atMs <= bMs);
  let prev = aMs;
  for (const s of inside) {
    if (s.atMs - prev > gapMs) return true;
    prev = s.atMs;
  }
  return bMs - prev > gapMs;
}

/** Сумма «покрытого» времени: интервалы между соседними измерениями не шире порога. */
export function coveredMs(samples: MeasureSample[], fromMs: number, toMs: number, params: CheckParams): number {
  const gapMs = params.dataGapMin * 60_000;
  const inWindow = samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
  let sum = 0;
  for (let i = 1; i < inWindow.length; i += 1) {
    const d = inWindow[i].atMs - inWindow[i - 1].atMs;
    if (d <= gapMs) sum += d;
  }
  return sum;
}
