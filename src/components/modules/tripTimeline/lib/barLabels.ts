/**
 * РАСКЛАДКА ПОДПИСЕЙ ПОЛОС — единое правило: подпись «обтекает» этапы.
 *
 * Подпись полосы не должна лежать под клетками этапов (они всегда выше полос)
 * и не должна обрезаться их краем. Алгоритм:
 *   1) для полосы собираются занятые интервалы — клетки этапов в видимой
 *      области (с учётом долей ячейки дня: если день поделён на половины,
 *      занятой считается ВСЯ ячейка дня), однодневные отметки базы/ремонта,
 *      маркеры стыков и служебные зоны краёв полосы (кружок, чип направления);
 *   2) из них вычитаются свободные сегменты полосы с отступом LABEL_GAP
 *      (4–6 px) от краёв;
 *   3) подпись размещается в самом широком свободном сегменте, приоритет —
 *      сегмент в видимой части экрана; при прокрутке подпись «переезжает» в
 *      другой свободный сегмент (см. BarLabelsSweep в TimelineGrid);
 *   4) если подпись не помещается — сокращение по ступеням: полный текст →
 *      короткий вариант → иконка/первое слово с многоточием → без подписи
 *      (полный текст всегда остаётся в подсказке полосы и её событий).
 *
 * Метрика текста: 8px/600, ~4.7 px на символ (та же оценка, что в
 * planBarLabelText и в подборе вариантов подписей базы/ремонта — единая).
 * Геометрия не меняется: маркеры этапов не смещаются и не уменьшаются —
 * подстраивается только подпись.
 */

export interface BarObstacle {
  /** Левый/правый край занятой зоны в координатах строки (px). */
  left: number;
  right: number;
}

export interface BarLabelSegment {
  index: number;
  /** Координаты сегмента ВНУТРИ полосы (px от её левого края). */
  left: number;
  right: number;
  width: number;
}

/** Отступ подписи от краёв занятых зон (px). */
export const LABEL_GAP = 5;
/** Метрика текста подписи (8px semibold): px на символ. */
export const LABEL_CHAR_W = 4.7;
/** Минимальная ширина сегмента, который вообще считается свободным. */
const MIN_SEG = 18;

/** Оценка ширины подписи: иконка (если есть) + текст + внутренние отступы. */
export const estimateLabelWidth = (text: string, hasIcon: boolean): number =>
  (hasIcon ? 14 : 0) + Math.round((text || '').length * LABEL_CHAR_W) + 10;

/**
 * Свободные сегменты полосы: полоса [0..barWidth] минус занятые зоны с
 * отступом LABEL_GAP по краям. Зоны обрезаются по полосе и сливаются при
 * пересечении. Сегменты уже LABEL-минимальной ширины отбрасываются.
 */
export const barLabelSegments = (barWidth: number, obstacles: BarObstacle[]): BarLabelSegment[] => {
  const zones = obstacles
    .map((o) => ({
      left: Math.max(0, Math.min(o.left, o.right) - LABEL_GAP),
      right: Math.min(barWidth, Math.max(o.left, o.right) + LABEL_GAP),
    }))
    .filter((z) => z.right > z.left && z.right > 0 && z.left < barWidth)
    .sort((a, b) => a.left - b.left);
  const merged: Array<{ left: number; right: number }> = [];
  zones.forEach((z) => {
    const last = merged[merged.length - 1];
    if (last && z.left <= last.right) last.right = Math.max(last.right, z.right);
    else merged.push({ ...z });
  });
  const segs: BarLabelSegment[] = [];
  let cur = 0;
  merged.forEach((z) => {
    if (z.left - cur >= MIN_SEG) segs.push({ index: segs.length, left: cur, right: z.left, width: z.left - cur });
    cur = Math.max(cur, z.right);
  });
  if (barWidth - cur >= MIN_SEG) segs.push({ index: segs.length, left: cur, right: barWidth, width: barWidth - cur });
  return segs;
};

/**
 * Какой свободный сегмент считать активным: самый широкий ВИДИМЫЙ кусок
 * (приоритет — видимая часть экрана), при полном отсутствии видимых —
 * самый широкий сегмент полосы.
 */
export const pickActiveSegment = (segs: BarLabelSegment[], viewLeft: number, viewRight: number, minVisible = 28): number => {
  if (!segs.length) return -1;
  let bestVis = -1;
  let bestVisIdx = -1;
  let widest = -1;
  let widestVisible = -1;
  let widestIdx = 0;
  segs.forEach((s, i) => {
    const vis = Math.min(s.right, viewRight) - Math.max(s.left, viewLeft);
    if (s.width > widest || (s.width === widest && vis > widestVisible)) {
      widest = s.width;
      widestVisible = vis;
      widestIdx = i;
    }
    if (vis >= minVisible && vis > bestVis) {
      bestVis = vis;
      bestVisIdx = i;
    }
  });
  return bestVisIdx !== -1 ? bestVisIdx : widestIdx;
};

/** Ступень сокращения подписи по ширине свободного сегмента. */
export type LabelVariant = 'full' | 'short' | 'icon' | 'none';

export const labelVariantFor = (
  segWidth: number,
  fullText: string,
  shortText: string,
  hasIcon: boolean,
): LabelVariant => {
  if (!fullText) return 'none';
  if (segWidth >= estimateLabelWidth(fullText, hasIcon)) return 'full';
  const short = shortText && shortText !== fullText ? shortText : fullText;
  if (segWidth >= estimateLabelWidth(short, hasIcon)) return 'short';
  // «иконка/первое слово с многоточием»
  const firstWord = (short.split(/[\s·/]+/).filter(Boolean)[0] || short || '').slice(0, 12) + '…';
  if (segWidth >= estimateLabelWidth(firstWord, hasIcon)) return 'icon';
  if (!hasIcon && segWidth >= estimateLabelWidth('…', false)) return 'icon';
  return 'none';
};

/** Текст для ступени сокращения. */
export const labelTextFor = (variant: LabelVariant, fullText: string, shortText: string): string => {
  if (variant === 'full') return fullText;
  const short = shortText && shortText !== fullText ? shortText : fullText;
  if (variant === 'short') return short;
  if (variant === 'icon') return (short.split(/[\s·/]+/).filter(Boolean)[0] || short || '').slice(0, 12) + '…';
  return '';
};

/**
 * Занятые зоны строки от клеток этапов/отметок: для каждого дня с этапом —
 * либо его доля, либо ВСЯ ячейка дня, если день поделён на половины
 * (спецификация: «если в ячейке два события — занятой считается вся ячейка»).
 */
export const obstaclesFromFills = (
  fills: Array<{ day: number; section: number; sections: number }>,
  daySlots: (day: number) => number,
  dayToX: (day: number) => number,
  colW: number,
): BarObstacle[] =>
  fills.map((f) => {
    const l = dayToX(f.day);
    if (daySlots(f.day) > 1) return { left: l, right: l + colW };
    return { left: l + Math.round((f.section * colW) / f.sections), right: l + Math.round(((f.section + 1) * colW) / f.sections) };
  });
