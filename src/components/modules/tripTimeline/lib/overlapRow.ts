/**
 * Разрешение наложений на уровне СТРОКИ МАШИНЫ (план или факт отдельно) —
 * единственная точка, которой пользуются основной таймлайн (TimelineGrid) и
 * встроенный таймлайн карточки (TripCard → CarMiniTimeline).
 *
 * Здесь интервалы источника превращаются в интервалы подстроки:
 *  - ПЛАН: полоса рейса — плановые даты; база — «приезд → срок готовности»;
 *  - ФАКТ: полоса рейса — фактические даты, а без них — те же плановые
 *    (та самая полоса «Факт не указан»); база — «приезд → фактический выезд /
 *    сегодня» (открытый период).
 * Для каждой записи «Учёта выезда» вызывается ЕДИНАЯ функция resolveOverlaps;
 * результаты нескольких записей сливаются (базы — по ключу записи, правки
 * рейсов — консервативно, маркеры и предупреждения — без дублей).
 *
 * Данные и расчёты источников не меняются: результат — только геометрия
 * отображения (срезы дня смены, укорочение простоя, штриховки, маркеры).
 */
import {
  baseBarRange,
  readyBarRange,
  type BasePeriod,
} from './sources';
import {
  resolveOverlaps,
  waitGapsOf,
  type OverlapBase,
  type OverlapInterval,
  type ResolvedMarker,
  type ResolvedWarning,
  type WaitGap,
} from './overlap';

export interface RowTripInterval extends OverlapInterval {}
export type RowKind = 'plan' | 'fact';

export interface RowTripAdjust {
  fracA: number;
  fracB: number;
  cutA: boolean;
  cutB: boolean;
  overlap: boolean;
}

export interface RowBaseAdjust {
  a: number;
  b: number;
  fracA: number;
  fracB: number;
  cutA: boolean;
  cutB: boolean;
  /** На сколько дней раньше учётного конца X выехала машина (0 — нет/неизвестно). */
  truncatedDays: number;
  open: boolean;
}

export interface RowOverlapResolution {
  /** Правки полос рейсов (срезы дня смены, штриховка конфликта) по ключу рейса. */
  tripAdjust: Map<string, RowTripAdjust>;
  /** Правки полос простоя (укорочение и срезы) по ключу записи «Учёта выезда». */
  baseAdjust: Map<string, RowBaseAdjust>;
  markers: ResolvedMarker[];
  warnings: ResolvedWarning[];
  /** Промежутки «Ожидание выезда» с привязкой к записи учёта. */
  waitGaps: Array<WaitGap & { periodKey: string }>;
}

const EMPTY: RowOverlapResolution = {
  tripAdjust: new Map(),
  baseAdjust: new Map(),
  markers: [],
  warnings: [],
  waitGaps: [],
};

/** База подстроки из записи «Учёта выезда»: план — до срока готовности, факт — до выезда/сегодня. */
export const rowBaseOf = (p: BasePeriod, kind: RowKind, today: number): OverlapBase | null => {
  if (kind === 'plan') {
    const rdy = readyBarRange(p);
    if (!rdy) return null;
    return { key: p.key, a: rdy.a, b: rdy.b, xEnd: p.plannedReadyDay, xKind: 'plan', open: false };
  }
  const rb = baseBarRange(p, today);
  if (!rb) return null;
  const xEnd = p.departureDay ?? p.plannedReadyDay;
  const xKind: OverlapBase['xKind'] = p.departureDay != null ? 'fact' : p.plannedReadyDay != null ? 'plan' : null;
  return { key: p.key, a: rb.a, b: rb.b, xEnd, xKind, open: rb.open };
};

/**
 * Разрешение наложений строки машины. Периоды — из «Учёта выезда» (уже
 * отфильтрованные вызывающим по видимости/архиву), рейсы — интервалы,
 * ОТОБРАЖАЕМЫЕ в этой подстроке (см. модуль выше).
 */
export const resolveRowOverlaps = (
  periods: BasePeriod[],
  trips: RowTripInterval[],
  kind: RowKind,
  today: number,
  fmt: (d: number) => string,
  carLabel?: string,
): RowOverlapResolution => {
  // Рейсы без учётных записей: единая функция всё равно применяется —
  // ловит пересечения рейс↔рейс (два пересекающихся рейса — конфликт данных).
  if (!trips.length) return EMPTY;
  const tripAdjust = new Map<string, RowTripAdjust>();
  const baseAdjust = new Map<string, RowBaseAdjust>();
  const markers: ResolvedMarker[] = [];
  const warnings: ResolvedWarning[] = [];
  const waitGaps: Array<WaitGap & { periodKey: string }> = [];
  const seenMarker = new Set<string>();
  const seenWarn = new Set<string>();

  const bases: OverlapBase[] = [];
  periods.forEach((p) => {
    const b = rowBaseOf(p, kind, today);
    if (b) bases.push(b);
  });

  const calls: Array<{ base: OverlapBase | null; trips: RowTripInterval[] }> = bases.length
    ? bases.map((b) => ({ base: b, trips }))
    : [{ base: null, trips }];

  calls.forEach(({ base, trips: tr }) => {
    const res = resolveOverlaps({ base, trips: tr, carLabel }, fmt);
    // Для «Ожидания выезда»: чужие полосы этой машины, чтобы не штриховать занятое.
    const others = bases
      .filter((b) => b !== base)
      .map((b) => ({ a: b.a, b: b.b }));
    res.segments.forEach((seg) => {
      if (seg.kind === 'trip') {
        if (seg.fracA !== 0 || seg.fracB !== 1 || seg.overlap) {
          const prev = tripAdjust.get(seg.key);
          tripAdjust.set(seg.key, {
            fracA: Math.max(prev?.fracA ?? 0, seg.fracA),
            fracB: Math.min(prev?.fracB ?? 1, seg.fracB),
            cutA: (prev?.cutA ?? false) || seg.cutA,
            cutB: (prev?.cutB ?? false) || seg.cutB,
            overlap: (prev?.overlap ?? false) || !!seg.overlap,
          });
        }
      } else {
        const prev = baseAdjust.get(seg.key);
        // Одна запись — одна база; при повторном вызове берём более короткую.
        if (!prev || seg.b - seg.a < prev.b - prev.a) {
          baseAdjust.set(seg.key, {
            a: seg.a,
            b: seg.b,
            fracA: seg.fracA,
            fracB: seg.fracB,
            cutA: seg.cutA,
            cutB: seg.cutB,
            truncatedDays: seg.truncatedDays ?? 0,
            open: !!seg.open,
          });
        }
      }
    });
    res.markers.forEach((m) => {
      const key = `${m.kind}|${m.day}|${m.frac}|${m.periodKey || ''}|${m.tripKey || ''}`;
      if (seenMarker.has(key)) return;
      seenMarker.add(key);
      markers.push(m);
    });
    res.warnings.forEach((w) => {
      if (seenWarn.has(w.title)) return;
      seenWarn.add(w.title);
      warnings.push(w);
    });
    const gaps = waitGapsOf(base, tr, fmt, others);
    gaps.forEach((g) => {
      if (base) waitGaps.push({ ...g, periodKey: base.key });
    });
  });

  return { tripAdjust, baseAdjust, markers, warnings, waitGaps };
};
