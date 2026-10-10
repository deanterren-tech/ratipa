/**
 * Заливки этапов на таймлайне: этап показывается ЦВЕТНОЙ ЗАЛИВКОЙ ЯЧЕЙКИ ДНЯ
 * (не тонкой полоской). Плановые даты — в подстроке «План», фактические — в
 * «Факт». Несколько этапов в одном дне делят ячейку на цветные секции — цвета
 * не смешиваются; каждая секция кликабельна и открывает рейс с выделением
 * этапа.
 *
 * Даты не пересчитываются: заливка — только способ отображения. Этап с одной
 * датой закрашивает ровно свой день; последующие дни без данных не закрашиваются
 * (дата не выдумывается). Если в записи есть явный интервал (поля вида
 * plannedDateEnd/actualDateEnd из внешних источников), закрашиваются все дни
 * интервала — без изменения длительности.
 */
import type { TimelineStage, TimelineStageType } from '../../../../types';
import { dayNum, fmtDM, stageDeviation, stageStateOf } from './timeline';

export interface StageColor {
  /** Мягкая заливка секции. */
  bg: string;
  /** Рамка секции (та же гамма, темнее). */
  border: string;
  /** Цвет текста внутри секции. */
  text: string;
}

/**
 * Цвета типов этапов: мягкие пастельные заливки, читаемый текст и сетка.
 * Незнакомые/расширяемые типы получают стабильный цвет из резервного набора
 * (по ключу — один и тот же всегда, цвета соседних секций не сливаются).
 */
const TYPE_COLORS: Record<string, StageColor> = {
  load: { bg: '#DBEAFE', border: '#93C5FD', text: '#1E40AF' },
  cust_out: { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
  border: { bg: '#EDE9FE', border: '#C4B5FD', text: '#5B21B6' },
  cust_in: { bg: '#CCFBF1', border: '#5EEAD4', text: '#115E59' },
  reserve: { bg: '#FFE4E6', border: '#FDA4AF', text: '#9F1239' },
  unl: { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
  other: { bg: '#E5E7EB', border: '#9CA3AF', text: '#374151' },
};

/** Резервная палитра для новых (расширяемых) типов этапов. */
const FALLBACK_COLORS: StageColor[] = [
  { bg: '#DBEAFE', border: '#93C5FD', text: '#1E40AF' },
  { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
  { bg: '#EDE9FE', border: '#C4B5FD', text: '#5B21B6' },
  { bg: '#CCFBF1', border: '#5EEAD4', text: '#115E59' },
  { bg: '#FFE4E6', border: '#FDA4AF', text: '#9F1239' },
  { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' },
];

export const stageColorOf = (typeKey: string): StageColor => {
  const key = String(typeKey || '');
  const known = TYPE_COLORS[key];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
};

/**
 * Интервал заливки этапа на подстроке «План»/«Факт»: первая и последняя дата
 * (включительно). Интервал берётся из явных полей записи, если они есть;
 * одиночная дата — интервал из одного дня. Даты не изменяются.
 */
const rangeFrom = (start: string | undefined, end?: unknown): { a: number; b: number } | null => {
  const a = dayNum(start);
  if (a == null) return null;
  const b = dayNum(typeof end === 'string' ? end : '');
  return { a, b: b != null && b >= a ? b : a };
};

/** Интервал плановой заливки этапа (Plan). */
export const stagePlanRange = (s: TimelineStage): { a: number; b: number } | null =>
  rangeFrom(s.plannedDate, (s as unknown as Record<string, unknown>).plannedDateEnd);

/** Интервал фактической заливки этапа (Факт). */
export const stageFactRange = (s: TimelineStage): { a: number; b: number } | null =>
  rangeFrom(s.actualDate, (s as unknown as Record<string, unknown>).actualDateEnd);

export interface StageFillInput {
  tripKey: string;
  stage: TimelineStage;
  archived: boolean;
}

export interface StageFillSection {
  /** День (номер дня), который закрашивает секция. */
  day: number;
  tripKey: string;
  stage: TimelineStage;
  archived: boolean;
  /** Номер секции в дне (0..sections-1) и их общее число (единая раскладка дня). */
  section: number;
  sections: number;
  /** Порядок этапа среди этапов этого дня (стабильный тай-брейкер). */
  order: number;
}

/**
 * Раскладка заливок этапов по дням окна. Порядок долей дня — ЕДИНОЕ правило
 * `layoutDaySlots` (lib/dayCellSections): слева предыдущее событие дня, справа
 * следующее, с учётом якорей дня смены (база/ремонт ↔ рейс). Здесь этап только
 * получает свою долю дня через переданный `slotOf` — собственной арифметики
 * секций нет (старое правило «заявки слева, этапы справа» удалено).
 */
export const layoutStageFills = (
  inputs: StageFillInput[],
  kind: 'plan' | 'fact',
  vs: number,
  ve: number,
  /** Доля дня для этапа (день × рейс × этап) — из единой раскладки дня. */
  slotOf?: (day: number, tripKey: string, stageId: string) => { section: number; sections: number } | null,
): StageFillSection[] => {
  const out: StageFillSection[] = [];
  inputs.forEach((it) => {
    const r = kind === 'plan' ? stagePlanRange(it.stage) : stageFactRange(it.stage);
    if (!r) return;
    for (let day = Math.max(r.a, vs); day <= Math.min(r.b, ve); day += 1) {
      const slot = slotOf ? slotOf(day, it.tripKey, it.stage.id) : null;
      out.push({
        day,
        tripKey: it.tripKey,
        stage: it.stage,
        archived: it.archived,
        section: slot ? slot.section : 0,
        sections: slot ? slot.sections : 1,
        order: Number(it.stage.order) || 0,
      });
    }
  });
  return out;
};

/** Краткое имя этапа для текста внутри секции (тип + место, если есть место). */
export const stageShortName = (types: TimelineStageType[], s: TimelineStage): string => {
  const t = types.find((x) => x.key === s.type);
  const name = t ? t.name : s.type || 'Этап';
  const short = name.replace(/\s*\(.*\)\s*$/, '');
  return s.label ? `${short} · ${s.label}` : short;
};

/**
 * Кратчайшая подпись события дня для строки «в этот день также» (доли ячейки):
 * если у этапа есть собственное место — оно и есть подпись, иначе тип.
 * Без дублирования («Выгрузка · Выгрузка» → «Выгрузка»).
 */
export const stageNeighborLabel = (types: TimelineStageType[], s: TimelineStage): string => {
  const t = types.find((x) => x.key === s.type);
  const name = (t ? t.name : s.type || 'Этап').replace(/\s*\(.*\)\s*$/, '');
  const label = (s.label || '').trim();
  return label || name || 'этап';
};

/**
 * Полная подсказка секции: тип, место, плановые/фактические даты, отклонение,
 * состояние и приглашение к переходу. Точность — календарные дни; время в
 * данных этапов не хранится и не выдумывается.
 */
export const stageFillTitle = (types: TimelineStageType[], s: TimelineStage, day: number, today: number): string => {
  const t = types.find((x) => x.key === s.type);
  const typeName = t ? t.name : s.type || 'Этап';
  const dev = stageDeviation(s);
  const st = stageStateOf(s, today);
  const parts: string[] = [`${typeName}${s.label ? ` — место: ${s.label}` : ''}`];
  parts.push(`план: ${s.plannedDate ? fmtDM(dayNum(s.plannedDate)) : 'не указан'}`);
  parts.push(`факт: ${s.actualDate ? fmtDM(dayNum(s.actualDate)) : 'не указан'}`);
  if (dev != null) parts.push(dev > 0 ? `позже плана на ${dev} дн` : dev < 0 ? `раньше плана на ${-dev} дн` : 'по плану');
  else parts.push(st.label);
  if (dayNum(s.plannedDate) == null && dayNum(s.actualDate) != null) parts.push('плановая дата не указана');
  if (dayNum(s.actualDate) == null && dayNum(s.plannedDate) != null) parts.push('выезд / факт не указан — последующие дни не закрашены');
  if (s.isCritical) parts.push('КРИТИЧЕСКИЙ СРОК');
  parts.push('клик — открыть рейс и выделить этап в карточке');
  return parts.join(' · ');
};
