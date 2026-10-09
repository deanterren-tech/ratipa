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

/**
 * Полоса для общей раскладки заливок по дням: интервал в днях + стабильный
 * порядок секций в дне (order, затем tie). Один механизм для этапов и отметок
 * базы/ремонта: раскладка не зависит от порядка входных данных.
 */
export interface DaySectionSpan {
  a: number;
  b: number;
  /** Базовый порядок секции в дне. */
  order: number;
  /** Тай-брейкер внутри одного order (стабильный ключ, не зависящий от данных). */
  tie: string;
}

export interface PlacedDaySection<T extends DaySectionSpan> {
  span: T;
  /** День (номер дня), который покрывает секция. */
  day: number;
  /** Номер секции в дне (0..sections-1) и их общее число. */
  section: number;
  sections: number;
}

/**
 * Раскладка интервалов по дням окна: каждый день получает секции ВСЕХ
 * покрывающих его интервалов. Несколько отметок в одном дне делят ячейку на
 * sections цветных секций, друг друга не скрывают; порядок секций стабилен
 * (order, tie), поэтому обновление данных не переставляет цвета местами.
 * За пределами окна интервалы обрезаются — горизонтальная геометрия считается
 * только из дат (день × colW), как у шапки и полос.
 */
export const layoutDaySections = <T extends DaySectionSpan>(spans: T[], vs: number, ve: number): Array<PlacedDaySection<T>> => {
  const clipped = spans
    .filter((sp) => sp.b >= vs && sp.a <= ve)
    .map((sp) => ({ ...sp, a: Math.max(sp.a, vs), b: Math.min(sp.b, ve) }));
  if (!clipped.length) return [];
  const byDay = new Map<number, typeof clipped>();
  clipped.forEach((sp) => {
    for (let d = sp.a; d <= sp.b; d += 1) {
      const arr = byDay.get(d);
      if (arr) arr.push(sp);
      else byDay.set(d, [sp]);
    }
  });
  const out: Array<PlacedDaySection<T>> = [];
  Array.from(byDay.keys())
    .sort((a, b) => a - b)
    .forEach((d) => {
      const list = byDay.get(d) as typeof clipped;
      list.sort((x, y) => x.order - y.order || x.tie.localeCompare(y.tie));
      list.forEach((sp, i) => {
        out.push({ span: sp, day: d, section: i, sections: list.length });
      });
    });
  return out;
};

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
  /** Номер секции в дне (0..sections-1) и их общее число. */
  section: number;
  sections: number;
  /** Индекс этапа среди заливок дня — стабильный порядок секций. */
  order: number;
}

/**
 * Раскладка заливок этапов по дням окна (общий механизм layoutDaySections):
 * каждая секция — (день × этап); несколько этапов в одном дне делят ячейку на
 * цветные секции, порядок стабилен (по order этапа, затем по id).
 */
export const layoutStageFills = (
  inputs: StageFillInput[],
  kind: 'plan' | 'fact',
  vs: number,
  ve: number,
): StageFillSection[] => {
  const spans = inputs
    .map((it) => {
      const r = kind === 'plan' ? stagePlanRange(it.stage) : stageFactRange(it.stage);
      if (!r) return null;
      return {
        a: r.a,
        b: r.b,
        order: Number(it.stage.order) || 0,
        tie: `${it.tripKey}|${it.stage.id}`,
        tripKey: it.tripKey,
        stage: it.stage,
        archived: it.archived,
      };
    })
    .filter((sp): sp is NonNullable<typeof sp> => sp != null);
  return layoutDaySections(spans, vs, ve).map((p) => ({
    day: p.day,
    tripKey: p.span.tripKey,
    stage: p.span.stage,
    archived: p.span.archived,
    section: p.section,
    sections: p.sections,
    order: p.span.order,
  }));
};

/** Краткое имя этапа для текста внутри секции (тип + место, если есть место). */
export const stageShortName = (types: TimelineStageType[], s: TimelineStage): string => {
  const t = types.find((x) => x.key === s.type);
  const name = t ? t.name : s.type || 'Этап';
  const short = name.replace(/\s*\(.*\)\s*$/, '');
  return s.label ? `${short} · ${s.label}` : short;
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
