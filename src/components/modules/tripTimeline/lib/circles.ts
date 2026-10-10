/**
 * «Круги» рейса — единое правило хранения и отображения.
 *
 * Круги относятся к РЕЙСУ (не к машине): целое число от 1, по умолчанию 1.
 * Единственное место хранения — запись самого рейса (`circles`):
 *   - связанные рейсы («План дохода»): trips_dashboard/<planId>/circles;
 *   - ручные рейсы модуля: tripTimeline/trips/<id>/circles.
 * Правка из таймлайна и из «Плана дохода» — это одна и та же запись, копий нет.
 *
 * Привязка отдельных ЭТАПОВ к кругу — опциональное поле этапа `circle`
 * (номер круга 1..N). Этапы без привязки остаются общими — ничего не
 * досочиняется.
 *
 * МИГРАЦИЯ: у существующих записей поля нет — читатели нормализуют его в 1
 * (normalizeCircles); старые записи НЕ пересчитываются и не переписываются.
 * Прежний расчёт кругов «по машине» удалён полностью.
 *
 * Отображение на полосе рейса (ПЛАН и ФАКТ): бейдж «×2»/«×3» в начале полосы
 * (для одного круга не показывается) и тонкие засечки с номерами между
 * кругами — только если этапы распределены по кругам и даты вычислимы.
 * Засечка ставится на середине промежутка между последним днём предыдущего
 * круга и первым днём следующего (дни не выдумываются). Подсказка — число
 * кругов и даты каждого круга. Функции чистые, данные не меняют.
 */
import type { TimelineStage } from '../../../../types';
import { dayNum, fmtDM } from './timeline';

/** Количество кругов: целое от 1; отсутствие/мусор = 1 (миграция без пересчёта). */
export const normalizeCircles = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/** Привязка этапа к кругу — целое 1..count; иначе привязки нет. */
export const stageCircleOf = (stage: TimelineStage, count: number): number | null => {
  const n = Math.floor(Number(stage?.circle));
  return Number.isFinite(n) && n >= 1 && n <= count ? n : null;
};

export interface TripCircleTick {
  /** Номер круга, который начинается за засечкой (2, 3, …). */
  n: number;
  /** Координата засечки в «днях» (дробная — между днями, не выдуманная дата). */
  at: number;
  /** Подсказка засечки: номер круга и его даты (если вычислимы). */
  title: string;
}

export interface TripCircleRange {
  n: number;
  a: number | null;
  b: number | null;
}

export interface TripCircleMarks {
  /** Количество кругов рейса (поле записи, нормализованное). */
  count: number;
  /** Бейдж «×N» — только для двух и более кругов. */
  badge: string | null;
  /** Засечки между кругами (пусто — этапы не распределены по кругам). */
  ticks: TripCircleTick[];
  /** Даты каждого круга по датам этапов («plan» — плановые, «fact» — фактические). */
  ranges: TripCircleRange[];
  /** Строка для подсказки полосы: число кругов и даты каждого круга. */
  title: string;
}

/**
 * Видимые засечки кругов при заданном масштабе: засечка НЕ рисуется, если её
 * позиция попадает в бейдж «×N» или ближе minGapPx к уже показанной засечке —
 * иначе на мелком масштабе (день узкий) метки наезжают друг на друга.
 * Позиции не сдвигаются: засечка либо стоит на своей координате, либо скрыта
 * (её данные остаются в подсказке полосы — даты кругов).
 */
export const visibleCircleTicks = (
  cm: TripCircleMarks | null | undefined,
  offsetPxOf: (tick: TripCircleTick) => number,
  opts?: { badgePx?: number; minGapPx?: number },
): Array<{ tick: TripCircleTick; x: number }> => {
  if (!cm || !cm.ticks.length) return [];
  const badgePx = opts?.badgePx ?? 22;
  const minGapPx = opts?.minGapPx ?? 16;
  const out: Array<{ tick: TripCircleTick; x: number }> = [];
  let lastX = cm.badge ? badgePx : Number.NEGATIVE_INFINITY;
  cm.ticks.forEach((tick) => {
    const x = offsetPxOf(tick);
    if (x < lastX + minGapPx) return;
    out.push({ tick, x });
    lastX = x;
  });
  return out;
};

const rangeText = (r: TripCircleRange, mode: 'plan' | 'fact'): string => {
  if (r.a == null || r.b == null) return 'даты не указаны';
  const kind = mode === 'plan' ? 'план' : 'факт';
  return r.b > r.a ? `${kind} ${fmtDM(r.a)}–${fmtDM(r.b)}` : `${kind} ${fmtDM(r.a)}`;
};

/**
 * Разметка кругов рейса для полосы: бейдж, засечки, даты кругов и подсказка.
 * mode: «plan» — по плановым датам этапов, «fact» — по фактическим.
 * Возвращает null, если показывать нечего (один круг и нет засечек) —
 * полоса не получает ни бейджа, ни засечек, ни служебных зон подписи.
 */
export const tripCircleMarksOf = (
  circles: unknown,
  stages: TimelineStage[] | undefined,
  mode: 'plan' | 'fact',
): TripCircleMarks | null => {
  const count = normalizeCircles(circles);
  const dayOf = (s: TimelineStage): number | null => dayNum(mode === 'plan' ? s.plannedDate : s.actualDate);
  const byCircle = new Map<number, number[]>();
  (stages || []).forEach((s) => {
    const n = stageCircleOf(s, count);
    if (n == null) return;
    const day = dayOf(s);
    if (day == null) return;
    const arr = byCircle.get(n);
    if (arr) arr.push(day);
    else byCircle.set(n, [day]);
  });
  const ranges: TripCircleRange[] = [];
  for (let n = 1; n <= count; n += 1) {
    const days = byCircle.get(n);
    if (!days || !days.length) {
      ranges.push({ n, a: null, b: null });
      continue;
    }
    ranges.push({ n, a: Math.min(...days), b: Math.max(...days) });
  }
  const boundDays = (from: number, to: number): number[] => {
    const out: number[] = [];
    byCircle.forEach((days, n) => {
      if (n >= from && n <= to) out.push(...days);
    });
    return out;
  };
  const ticks: TripCircleTick[] = [];
  for (let k = 2; k <= count; k += 1) {
    const left = boundDays(1, k - 1);
    const right = boundDays(k, count);
    if (!left.length || !right.length) continue; // одну сторону не выдумываем
    const lastLeft = Math.max(...left);
    const firstRight = Math.min(...right);
    // Середина промежутка между последним днём круга k−1 и первым днём круга k.
    const at = (lastLeft + firstRight + 1) / 2;
    const r = ranges[k - 1];
    ticks.push({
      n: k,
      at,
      title: `Круг ${k} из ${count}${r && (r.a != null || r.b != null) ? ` · ${rangeText(r, mode)}` : ': даты не указаны'}`,
    });
  }
  if (count <= 1 && !ticks.length) return null;
  const withDates = ranges.filter((r) => r.a != null && r.b != null);
  const datesText = withDates.length
    ? withDates.map((r) => `круг ${r.n}: ${rangeText(r, mode)}`).join('; ')
    : 'этапы по кругам не распределены';
  return {
    count,
    badge: count >= 2 ? `×${count}` : null,
    ticks,
    ranges,
    title: `Круги рейса: ${count} — ${datesText}`,
  };
};
