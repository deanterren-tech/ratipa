/**
 * Движок «Истории CAN-пробега»: чистые функции для карточки автомобиля.
 *
 * На входе — измерения двух видов (одна и та же история по машине):
 *  - 'measured' — измерения с подтверждённым временем источника (методы
 *    Nav.by: object-stat-data / city-or-track / parking-movement-report),
 *  - 'snapshot' — снимки портала (telemetry_history/current): значение
 *    одометра есть, но время измерения в API отсутствует — время координаты
 *    показывается как время снимка, честно помечается «время измерения
 *    неизвестно».
 *
 * Правила (по уточнённой спецификации):
 *  - дедупликация по идентичности измерения; одинаковое значение с новым
 *    достоверным временем — валидная точка (показывает отсутствие изменения);
 *  - отсутствующее значение не превращается в ноль;
 *  - отрицательные изменения и сбросы НЕ скрываются;
 *  - интервалы с разрывом данных не сглаживаются (разрыв > порога — 'gap').
 */

import type { GainInterval, GainKind, Interval, MeasureSample, Stop } from './types';
import type { CheckParams } from './params';

export type CanSourceKind = 'stat_window' | 'city_segment' | 'parking_segment' | 'snapshot';
export type CanPrecision = 'km_3dec' | 'km_int';

export interface CanPoint {
  /** Время измерения в источнике (мс); null — время измерения неизвестно. */
  tMs: number | null;
  /** Позиция на шкале времени: tMs ?? coordAtMs (для снимков — время координаты). */
  xMs: number;
  valueKm: number;
  kind: 'measured' | 'snapshot';
  source: CanSourceKind;
  precision: CanPrecision;
  /** Время получения порталом (мс), null — нет данных. */
  receivedAtMs: number | null;
  /** Время координаты (мс) — только для снимков. */
  coordAtMs: number | null;
  /** Источник пересматривал значение (rAt2) — показываем в подсказке. */
  revised: boolean;
  /** Метки объединённых источников (после merge — какие точки слиты). */
  mergedSources?: CanSourceKind[];
}

export const CAN_SOURCE_LABEL: Record<CanSourceKind, string> = {
  stat_window: 'оконное измерение Nav.by',
  city_segment: 'граница сегмента Nav.by',
  parking_segment: 'граница интервала стоянка/движение',
  snapshot: 'снимок портала',
};

export const CAN_SOURCE_SHORT: Record<CanSourceKind, string> = {
  stat_window: 'окно',
  city_segment: 'сегмент',
  parking_segment: 'стоянка',
  snapshot: 'снимок',
};

/** Ключ дня YYYYMMDD в поясе +03 (как сервер). */
export function canDayKey(ms: number): string {
  const shifted = new Date(ms + 180 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${p(shifted.getUTCMonth() + 1)}${p(shifted.getUTCDate())}`;
}

/** Конструктор точки (тесты и построение проекций). */
export function createPoint(input: {
  xMs: number;
  tMs?: number | null;
  valueKm: number;
  source: CanSourceKind;
  precision?: CanPrecision;
  coordAtMs?: number | null;
  receivedAtMs?: number | null;
  revised?: boolean;
}): CanPoint {
  const kind: CanPoint['kind'] = input.source === 'snapshot' ? 'snapshot' : 'measured';
  const tMs = input.tMs ?? null;
  return {
    tMs,
    xMs: input.xMs,
    valueKm: input.valueKm,
    kind,
    source: input.source,
    precision: input.precision ?? (input.source === 'stat_window' ? 'km_int' : 'km_3dec'),
    receivedAtMs: input.receivedAtMs ?? null,
    coordAtMs: input.coordAtMs ?? (kind === 'snapshot' ? input.xMs : null),
    revised: input.revised ?? false,
  };
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Разбор узла telemetry_can_history в точку; null — непригодный узел. */
export function normalizeCanRecord(raw: Record<string, unknown> | null | undefined): CanPoint | null {
  if (!raw) return null;
  const value = numOrNull(raw.v);
  if (value == null || value <= 0) return null; // 0/пусто = «нет данных», не пробег 0
  const tMs = numOrNull(raw.tMs);
  if (tMs == null || tMs <= 0) return null;
  const src = typeof raw.src === 'string' ? raw.src : '';
  const source: CanSourceKind =
    src === 'navby.stat_window' ? 'stat_window'
    : src === 'navby.city_segment' ? 'city_segment'
    : src === 'navby.parking_segment' ? 'parking_segment'
    : src === 'navby.current_position' ? 'snapshot'
    : 'stat_window';
  const receivedAtMs = typeof raw.rAt === 'string' ? Date.parse(raw.rAt) : NaN;
  const precision: CanPrecision = raw.q === 'km_int' ? 'km_int' : 'km_3dec';
  return {
    tMs,
    xMs: tMs,
    valueKm: value,
    kind: source === 'snapshot' ? 'snapshot' : 'measured',
    source,
    precision,
    receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null,
    coordAtMs: null,
    revised: typeof raw.rAt2 === 'string',
  };
}

/** Проекция снимков из измерений портала (telemetry_history/current): только с одометром. */
export function snapshotPointsFromSamples(samples: MeasureSample[]): CanPoint[] {
  const out: CanPoint[] = [];
  for (const s of samples) {
    if (s.odoKm == null || !(s.odoKm > 0)) continue;
    out.push({
      tMs: null,
      xMs: s.atMs,
      valueKm: s.odoKm,
      kind: 'snapshot',
      source: 'snapshot',
      precision: 'km_3dec',
      receivedAtMs: s.receivedAtMs,
      coordAtMs: s.atMs,
      revised: false,
    });
  }
  return out;
}

/**
 * Объединение и дедупликация точек для отображения.
 * Слияние считает одну физическую точку измеренной, если она пришла из
 * нескольких источников/снимков: время в пределах ±5 с и значения
 * равны (float-точно или с учётом округления km_int до 1 км).
 * При равных кандидатах приоритет: измерение > снимок; km_3dec > km_int.
 */
export function mergeCanPoints(points: CanPoint[]): CanPoint[] {
  const sorted = [...points].sort((a, b) => a.xMs - b.xMs || priority(b) - priority(a));
  const out: CanPoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(p.xMs - last.xMs) <= 5_000 && sameValue(last, p)) {
      const merged: CanPoint = priority(p) > priority(last) ? { ...p } : { ...last };
      merged.mergedSources = Array.from(new Set([...(last.mergedSources || [last.source]), p.source]));
      merged.xMs = Math.min(last.xMs, p.xMs);
      if (merged.kind === 'snapshot' && p.kind === 'measured') merged.kind = p.kind;
      out[out.length - 1] = merged;
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

function priority(p: CanPoint): number {
  const kindScore = p.kind === 'measured' ? 100 : 0;
  const precScore = p.precision === 'km_3dec' ? 10 : 0;
  return kindScore + precScore;
}

function sameValue(a: CanPoint, b: CanPoint): boolean {
  const d = Math.abs(a.valueKm - b.valueKm);
  if (d <= 0.02) return true;
  // Округление object-stat-data до целых км: сравниваем с допуском < 1 км.
  if ((a.precision === 'km_int' || b.precision === 'km_int') && d < 0.75) return true;
  return false;
}

/** Точки в окне ± контекст за границами. */
export function sliceCanPoints(points: CanPoint[], fromMs: number, toMs: number, padMs = 0): { inWindow: CanPoint[]; before: CanPoint | null; after: CanPoint | null } {
  const inWindow: CanPoint[] = [];
  let before: CanPoint | null = null;
  let after: CanPoint | null = null;
  for (const p of points) {
    if (p.xMs < fromMs - padMs) before = p;
    else if (p.xMs > toMs + padMs) {
      if (!after) after = p;
    } else inWindow.push(p);
  }
  return { inWindow, before, after };
}

/**
 * Прирост между последовательными точками — формат GainInterval (второй
 * график, компонент GainChart переиспользуется как есть). Разрыв данных
 * делает интервал kind 'gap' (НЕ «мгновенный скачок»); сброс — отрицательное
 * изменение больше порога.
 */
export function buildCanGains(
  points: CanPoint[],
  fromMs: number,
  toMs: number,
  params: CheckParams,
  stopsById: Map<string, Stop>,
): GainInterval[] {
  const out: GainInterval[] = [];
  const gapMs = params.dataGapMin * 60_000;
  const slack = 6 * 3_600_000;
  const relevant = points.filter((p) => p.xMs >= fromMs - slack && p.xMs <= toMs + slack);
  for (let i = 1; i < relevant.length; i += 1) {
    const prev = relevant[i - 1];
    const cur = relevant[i];
    if (cur.xMs < fromMs || prev.xMs > toMs) continue;
    const dtMs = cur.xMs - prev.xMs;
    if (dtMs <= 0) continue;
    const delta = Math.round((cur.valueKm - prev.valueKm) * 1000) / 1000;
    const rate = dtMs > 0 ? delta / (dtMs / 3_600_000) : null;
    const gapInside = dtMs > gapMs;
    const mid = (prev.xMs + cur.xMs) / 2;
    let stopId: string | null = null;
    for (const stop of stopsById.values()) {
      if (mid >= stop.startMs && mid <= stop.endMs) { stopId = stop.id; break; }
    }
    let kind: GainKind = 'normal';
    let quality: GainInterval['quality'] = 'ok';
    if (delta < -0.5) {
      kind = 'reset';
      quality = 'reset';
    } else if (gapInside) {
      kind = 'gap';
      quality = 'gap';
    } else if (stopId && delta >= params.riseEventKm) {
      kind = 'stop_rise';
    } else if (
      !stopId
      && delta >= params.resumeMinDeltaKm
      && delta / (dtMs / 3_600_000) <= params.resumeMaxKmh
    ) {
      // Прирост при возобновлении: начинается у стоянки (в пределах пост-окна).
      const nearStop = [...stopsById.values()].some((s) => prev.xMs >= s.startMs && prev.xMs <= s.endMs + params.postWindowMin * 60_000);
      if (nearStop) kind = 'resume';
    }
    out.push({
      fromMs: prev.xMs,
      toMs: cur.xMs,
      durationMin: dtMs / 60_000,
      fromOdoKm: prev.valueKm,
      toOdoKm: cur.valueKm,
      deltaKm: delta,
      rateKmh: rate,
      kind,
      stopId,
      gapInside,
      invalid: false,
      quality,
    });
  }
  return out;
}

/** Разрывы данных внутри окна (между точками и от границ) — как dataGaps, но для точек истории. */
export function detectCanGaps(points: CanPoint[], fromMs: number, toMs: number, gapMin: number): Interval[] {
  const gapMs = Math.max(1, gapMin) * 60_000;
  const inWindow = points.filter((p) => p.xMs >= fromMs && p.xMs <= toMs);
  const out: Interval[] = [];
  if (!inWindow.length) {
    if (toMs > fromMs) out.push({ fromMs, toMs });
    return out;
  }
  if (inWindow[0].xMs - fromMs > gapMs) out.push({ fromMs, toMs: inWindow[0].xMs });
  for (let i = 1; i < inWindow.length; i += 1) {
    if (inWindow[i].xMs - inWindow[i - 1].xMs > gapMs) out.push({ fromMs: inWindow[i - 1].xMs, toMs: inWindow[i].xMs });
  }
  const last = inWindow[inWindow.length - 1];
  if (toMs - last.xMs > gapMs) out.push({ fromMs: last.xMs, toMs });
  return out;
}

export interface CanSeriesStats {
  count: number;
  measuredCount: number;
  snapshotCount: number;
  firstMs: number | null;
  lastMs: number | null;
  /** Медианный интервал между измерениями (мс), null — менее двух. */
  medianIntervalMs: number | null;
  maxIntervalMs: number | null;
  bySource: Partial<Record<CanSourceKind, number>>;
  minKm: number | null;
  maxKm: number | null;
  /** Сбросы (отрицательные изменения > 0.5 км) и заметные скачки. */
  resets: number;
  lastReceivedAtMs: number | null;
  firstReceivedAtMs: number | null;
}

export function canSeriesStats(points: CanPoint[]): CanSeriesStats {
  const sorted = [...points].sort((a, b) => a.xMs - b.xMs);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) intervals.push(sorted[i].xMs - sorted[i - 1].xMs);
  intervals.sort((a, b) => a - b);
  const bySource: Partial<Record<CanSourceKind, number>> = {};
  let resets = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    bySource[sorted[i].source] = (bySource[sorted[i].source] || 0) + 1;
    if (i > 0 && sorted[i].valueKm < sorted[i - 1].valueKm - 0.5) resets += 1;
  }
  const measured = sorted.filter((p) => p.kind === 'measured');
  const received = sorted.map((p) => p.receivedAtMs).filter((v): v is number => v != null);
  return {
    count: sorted.length,
    measuredCount: measured.length,
    snapshotCount: sorted.length - measured.length,
    firstMs: sorted.length ? sorted[0].xMs : null,
    lastMs: sorted.length ? sorted[sorted.length - 1].xMs : null,
    medianIntervalMs: intervals.length ? intervals[Math.floor(intervals.length / 2)] : null,
    maxIntervalMs: intervals.length ? intervals[intervals.length - 1] : null,
    bySource,
    minKm: sorted.length ? sorted[0].valueKm : null,
    maxKm: sorted.length ? sorted[sorted.length - 1].valueKm : null,
    resets,
    lastReceivedAtMs: received.length ? Math.max(...received) : null,
    firstReceivedAtMs: received.length ? Math.min(...received) : null,
  };
}

/** Состояние синхронизации данных — четыре различимых случая + «есть данные». */
export type CanSyncState = 'ok' | 'no_change_fresh' | 'no_new_measurements' | 'not_loaded' | 'source_no_history' | 'no_odometer';

export interface CanSyncInput {
  points: CanPoint[];
  /** Есть ли у машины одометр вообще (текущее состояние/снимки/история). */
  carHasOdometer: boolean | null;
  /** Есть ли запись покрытия дня (сбор что-то запрашивал) либо любая история машины. */
  hasCoverage: boolean;
  window: { fromMs: number; toMs: number };
  nowMs: number;
  /** Минимальное ожидаемое расстояние между снимками (мс) — для оценки свежести. */
  snapshotIntervalMs: number;
}

export function classifyCanSync(input: CanSyncInput): { state: CanSyncState; label: string; hint: string } {
  const { points, carHasOdometer, hasCoverage, window, nowMs, snapshotIntervalMs } = input;
  const flat = points.length === 0;
  if (flat) {
    if (carHasOdometer === false) {
      return { state: 'source_no_history', label: 'Источник не даёт историю', hint: 'У этой машины одометр в Nav.by не передаётся — история измерений недоступна.' };
    }
    // Три различимых состояния без «покрыт, но пусто без объяснения»:
    //  - съём за период не выполнялся → «требует догрузки»;
    //  - съём выполнялся, источник вернул пусто → «загружено, данных нет» (это
    //    допустимо: машина не двигалась; измерения одометра при простое не
    //    поступают вовсе — это не «ноль км» и не ошибка загрузки).
    if (!hasCoverage) {
      return { state: 'not_loaded', label: 'История ещё не загружена (требует догрузки)', hint: 'Измерения за этот период не запрашивались. Нажмите «Догрузить историю за период» — запросы выполняет сервер.' };
    }
    return { state: 'no_new_measurements', label: 'Загружено, данных нет', hint: 'Съём за период выполнен, но источник не отдал ни одного измерения одометра (машина не двигалась или данные не пришли) — это не ошибка загрузки.' };
  }
  const sorted = [...points].sort((a, b) => a.xMs - b.xMs);
  const measured = sorted.filter((p) => p.kind === 'measured');
  const lastX = sorted[sorted.length - 1].xMs;
  const firstValue = sorted[0].valueKm;
  const changed = sorted.some((p) => Math.abs(p.valueKm - firstValue) > 0.02);
  const coversNow = window.toMs >= nowMs - 60_000;
  if (coversNow) {
    const freshThreshold = Math.max(snapshotIntervalMs * 3, 20 * 60_000);
    const fresh = nowMs - lastX <= freshThreshold;
    if (!fresh) {
      return { state: 'no_new_measurements', label: 'Новые измерения не поступали', hint: `Последнее доступное измерение — ${Math.round((nowMs - lastX) / 60_000)} мин назад; фон сбора мог не получить новые данные.` };
    }
    if (!changed) {
      return { state: 'no_change_fresh', label: 'CAN не менялся, измерения поступали', hint: 'Свежие данные есть, показание не изменялось (стоит или данные повторяются — это не «ноль»).' };
    }
    return { state: 'ok', label: 'Данные поступают', hint: 'Есть измерения с изменением показания в текущем периоде.' };
  }
  // Закрытый период: разрыв до конца окна не «ошибка» — машина может стоять.
  if (!changed) {
    return { state: 'no_change_fresh', label: 'CAN не менялся в этом периоде', hint: 'Измерения за период есть, показатель не изменялся.' };
  }
  return { state: 'ok', label: 'Измерения за период есть', hint: `${measured.length} измерений(я) с подтверждённым временем; для дня с ночной стоянкой отсутствие измерений вечером/ночью — норма.` };
}

/** Прореживание точек истории для длинных периодов (мин/макс бакета сохраняются). */
export function decimateCanPoints(points: CanPoint[], maxPoints: number): CanPoint[] {
  if (points.length <= maxPoints || maxPoints <= 2) return points;
  const sorted = [...points].sort((a, b) => a.xMs - b.xMs);
  const bucket = Math.ceil(sorted.length / maxPoints);
  const out: CanPoint[] = [];
  for (let i = 0; i < sorted.length; i += bucket) {
    const chunk = sorted.slice(i, i + bucket);
    if (chunk.length <= 2) { out.push(...chunk); continue; }
    let min = chunk[0];
    let max = chunk[0];
    for (const p of chunk) {
      if (p.valueKm < min.valueKm) min = p;
      if (p.valueKm > max.valueKm) max = p;
    }
    if (min === max) out.push(chunk[chunk.length - 1]);
    else if (min.xMs <= max.xMs) out.push(min, max);
    else out.push(max, min);
  }
  return out;
}

/** Дни (ключи), которые надо прочитать для диапазона (пояс +03). */
export function canDayKeysInRange(fromMs: number, toMs: number, maxDays = 100): string[] {
  const keys: string[] = [];
  for (let t = fromMs; t <= toMs + 86_400_000 && keys.length < maxDays; t += 12 * 3_600_000) {
    const k = canDayKey(Math.min(t, toMs));
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Границы дня (мс) в поясе +03 по ключу YYYYMMDD. */
export function dayBoundsFromKey(key: string): { fromMs: number; toMs: number } | null {
  if (!/^\d{8}$/.test(key)) return null;
  const fromMs = Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8)) - 180 * 60_000;
  return { fromMs, toMs: fromMs + 86_400_000 - 1 };
}
