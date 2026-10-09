/**
 * Сегменты ЦВЕТА ФАКТА рейса (визуализация отставания по участкам).
 *
 * Правила (авторитетная спецификация владельца):
 *  - ПЛАН рейса красится целиком в акцентный цвет приложения — без индикации
 *    сроков (см. PLAN_ACCENT в TimelineGrid).
 *  - ФАКТ рейса — сегменты по состоянию участка:
 *      зелёный  — участок выполнен в срок или раньше плана;
 *      жёлтый   — опоздание 1–2 дня относительно плана;
 *      оранжевый— опоздание больше 2 дней;
 *      красный  — критический дедлайн нарушен / просрочка (срок прошёл, а этап
 *                 не выполнен — включая пропущенный этап позади фронта).
 *  - Если этапов нет — полоса делится плановой датой окончания: до неё зелёная,
 *    после — по числу дней просрочки (жёлтая, затем оранжевая).
 *  - Рейс ещё идёт: растущий хвост до сегодня — по текущему состоянию (жёлтый →
 *    оранжевый), красный — только при критическом дедлайне.
 *  - Плановых данных нет — нейтральный цвет, подсказка «План не указан»,
 *    зелёный НЕ ставится.
 *
 * Источник «критического дедлайна»: существующее поле этапа `isCritical`
 * (TimelineStage.isCritical, src/types.ts) — «критический срок этапа»; та же
 * семантика, что у getDeadlineStatus/criticalStages (lib/timeline). Новых полей
 * не заводим, данные не меняем — только отображение.
 *
 * Пороги — ОДНО место: FACT_LAG_YELLOW_MAX_DAYS / FACT_LAG_ORANGE_FROM_DAYS.
 * Цвета — ОДНО место: FACT_SEGMENT_COLORS (текст на фоне — WCAG AA ≥ 4.5:1,
 * проверяется тестом scripts/test-fact-segments.ts).
 */
import { dayNum, tripFactEnd, tripSpan } from './timeline';
import type { TimelineStage, TimelineTrip } from '../../../../types';

/** Цвет сегмента факта. */
export type FactSegColor = 'green' | 'yellow' | 'orange' | 'red' | 'neutral';

/** ПОРОГИ (календарные дни опоздания). Одно место на весь модуль. */
export const FACT_LAG_YELLOW_MAX_DAYS = 2; // 1–2 дня — жёлтый
export const FACT_LAG_ORANGE_FROM_DAYS = 3; // > 2 дней — оранжевый

export interface FactSegColorStyle {
  /** Мягкая заливка сегмента. */
  bg: string;
  /** Обводка (та же гамма, темнее). */
  border: string;
  /** Цвет текста/иконки внутри сегмента (AA на bg). */
  text: string;
  /** Подпись состояния для легенды. */
  label: string;
  /** Короткая подпись для подсказок. */
  short: string;
}

/** Палитра сегментов факта (единая, не меняется по месту вывода). */
export const FACT_SEGMENT_COLORS: Record<FactSegColor, FactSegColorStyle> = {
  green: { bg: '#E4F4EC', border: '#7FC2A5', text: '#145C41', label: 'в срок или раньше плана', short: 'в срок' },
  yellow: { bg: '#FBEFD4', border: '#DDAE42', text: '#7C5109', label: 'опоздание 1–2 дня', short: '+1–2 дн' },
  orange: { bg: '#FDE2CB', border: '#EA9450', text: '#8A3A0A', label: 'опоздание больше 2 дней', short: '+3 дн и более' },
  red: { bg: '#FDEBEE', border: '#EFA3B1', text: '#9F1239', label: 'критический дедлайн / просрочка', short: 'просрочка' },
  neutral: { bg: '#EAECF0', border: '#A6ADBA', text: '#444B57', label: 'план не указан', short: 'без плана' },
};

/** Цвет по числу дней опоздания (без критичности). */
export const factSegmentColorOfLag = (lag: number): FactSegColor => {
  if (lag <= 0) return 'green';
  if (lag <= FACT_LAG_YELLOW_MAX_DAYS) return 'yellow';
  return lag >= FACT_LAG_ORANGE_FROM_DAYS ? 'orange' : 'yellow';
};

export interface FactSegment {
  /** Ключ этапа, если сегмент привязан к этапу (для подсветки/тестов). */
  stageId?: string;
  /** Первый/последний день сегмента (включительно), номера дней. */
  a: number;
  b: number;
  color: FactSegColor;
  /** Этап сегмента (человекочитаемо). */
  stageLabel?: string;
  /** Плановая дата завершения этапа (номер дня) и фактическая (номер дня). */
  planDay?: number | null;
  factDay?: number | null;
  /** Отставание в календарных днях (факт − план); null — пары дат нет. */
  lagDays?: number | null;
  /** Этап критического срока — красный при нарушении. */
  critical?: boolean;
  /** Понятная причина цвета — в подсказку сегмента. */
  reason: string;
}

export interface FactSegmentsInput {
  stages: TimelineStage[];
  /** Плановые границы рейса (день-номера) — из существующего spanOverride/tripSpan. */
  planFrom: number | null;
  planTo: number | null;
  /** Границы полосы факта (уже посчитанные вызывающим, как раньше). */
  factFrom: number;
  factTo: number;
  /** Рейс не завершён по факту (хвост до сегодня — открытый край). */
  ongoing: boolean;
  today: number;
}

export interface FactSegmentsResult {
  segments: FactSegment[];
  /** Есть ли плановые данные (даты этапов или плановые границы рейса). */
  planKnown: boolean;
  /** Пропущенные этапы: срок прошёл, факт не внесён. */
  missed: Array<{ label: string; planDay: number; critical: boolean }>;
  /** Полоса заканчивается открытым (продолжающимся) краем. */
  openTail: boolean;
  /** Плана нет вовсе — полоса нейтральная, «План не указан». */
  noPlan: boolean;
}

const fmt = (n: number): string => {
  const d = new Date(n * 86400000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
};

const stageName = (s: TimelineStage): string => String(s.label || s.type || 'этап').trim() || 'этап';

const byOrder = (a: TimelineStage, b: TimelineStage): number =>
  (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.plannedDate || '').localeCompare(String(b.plannedDate || ''));

/**
 * ЧИСТАЯ функция: рейс (этапы + плановые/фактические границы) → сегменты факта.
 * Ничего не читает и не пишет, кроме входных данных; today — параметр.
 */
export const factSegmentsOf = (input: FactSegmentsInput): FactSegmentsResult => {
  const { factFrom, factTo, ongoing, today } = input;
  const stages = [...input.stages].sort(byOrder);
  const plannedStages = stages.filter((s) => dayNum(s.plannedDate) != null);
  const planKnown = plannedStages.length > 0 || input.planFrom != null || input.planTo != null;

  // 4) Плановых данных нет — нейтральная полоса, зелёный не ставим.
  if (!planKnown) {
    return {
      segments: [
        {
          a: factFrom,
          b: factTo,
          color: 'neutral',
          reason: 'План не указан: у рейса нет ни плановых дат этапов, ни плановых границ.',
        },
      ],
      planKnown: false,
      missed: [],
      openTail: ongoing,
      noPlan: true,
    };
  }

  const segments: FactSegment[] = [];
  const missed: FactSegmentsResult['missed'] = [];
  /** Первый ещё не покрытый день полосы факта. */
  let cursor = factFrom;
  /** Пропущенные этапы, ожидающие «своего» следующего фактического участка. */
  let skippedAhead: Array<{ label: string; planDay: number; critical: boolean }> = [];

  // 1) Участки по этапам: отставание = фактическая дата завершения − плановая.
  // День завершения этапа закрывает участок; следующий начинается со следующего дня.
  for (const s of stages) {
    const f = dayNum(s.actualDate);
    const p = dayNum(s.plannedDate);
    if (f == null) {
      if (p != null && today > p) {
        const rec = { label: stageName(s), planDay: p, critical: !!s.isCritical };
        missed.push(rec);
        skippedAhead.push(rec);
      }
      continue;
    }
    if (f < cursor) continue; // дата уже покрыта предыдущими участками (пересечение фактов)
    const end = f;
    const behind = skippedAhead;
    skippedAhead = [];
    if (behind.length) {
      // Просрочка: срок прошёл, этап не выполнен, а рейс продолжился дальше.
      segments.push({
        a: cursor,
        b: end,
        color: 'red',
        stageLabel: stageName(s),
        planDay: p,
        factDay: f,
        lagDays: p != null ? f - p : null,
        critical: behind.some((m) => m.critical),
        reason: `Пропущен этап «${behind.map((m) => m.label).join('», «')}»: срок (${behind
          .map((m) => fmt(m.planDay))
          .join(', ')}) прошёл, факта нет — рейс продолжился дальше.`,
      });
    } else {
      const lag = p != null ? f - p : null;
      const criticalViolated = !!s.isCritical && lag != null && lag > 0;
      const color: FactSegColor = criticalViolated ? 'red' : lag == null ? 'neutral' : factSegmentColorOfLag(lag);
      segments.push({
        stageId: s.id,
        a: cursor,
        b: end,
        color,
        stageLabel: stageName(s),
        planDay: p,
        factDay: f,
        lagDays: lag,
        critical: !!s.isCritical,
        reason:
          lag == null
            ? `Этап «${stageName(s)}»: плановая дата не указана — отставание не рассчитано (нейтрально).`
            : criticalViolated
              ? `Критический срок этапа «${stageName(s)}» нарушен: план ${fmt(p as number)}, факт ${fmt(f)}, +${lag} дн.`
              : lag > 0
                ? `Этап «${stageName(s)}»: план ${fmt(p as number)}, факт ${fmt(f)} — опоздание ${lag} дн.`
                : `Этап «${stageName(s)}»: план ${fmt(p as number)}, факт ${fmt(f)} — в срок${lag < 0 ? ' (раньше плана)' : ''}.`,
      });
    }
    cursor = end + 1;
  }

  // 2) Этапов нет — делим плановой датой окончания: до плана зелёный, после — по просрочке.
  if (!stages.length) {
    const planEnd = input.planTo ?? input.planFrom;
    if (planEnd == null) {
      return {
        segments: [
          { a: factFrom, b: factTo, color: 'neutral', reason: 'План не указан: плановая дата окончания неизвестна.' },
        ],
        planKnown: true,
        missed: [],
        openTail: ongoing,
        noPlan: true,
      };
    }
    const greenTo = Math.min(planEnd, factTo);
    if (factFrom <= greenTo) {
      segments.push({
        a: factFrom,
        b: greenTo,
        color: 'green',
        planDay: planEnd,
        reason: `До плановой даты окончания (${fmt(planEnd)}) — в срок.`,
      });
    }
    if (factTo > planEnd) {
      const lag = factTo - planEnd;
      const color = factSegmentColorOfLag(lag);
      segments.push({
        a: Math.max(factFrom, planEnd + 1),
        b: factTo,
        color,
        planDay: planEnd,
        lagDays: lag,
        reason: `После плановой даты окончания (${fmt(planEnd)}) — опоздание ${lag} дн.${
          ongoing ? ' (рейс ещё идёт — отставание считается до сегодня)' : ''
        }.`,
      });
    }
    return { segments, planKnown: true, missed: [], openTail: ongoing, noPlan: false };
  }

  // 3) Хвост (рейс идёт или остаток полосы после последнего факта).
  if (cursor <= factTo) {
    const current = stages.find((s) => dayNum(s.actualDate) == null);
    const tailA = cursor;
    const tailB = factTo;
    if (current) {
      const p = dayNum(current.plannedDate);
      const isCritical = !!current.isCritical;
      let color: FactSegColor;
      let reason: string;
      let lag: number | null = null;
      const behindCritical = skippedAhead.some((m) => m.critical);
      if (p == null) {
        color = 'neutral';
        reason = `Этап «${stageName(current)}»: плановая дата не указана — отставание не рассчитано.`;
      } else {
        lag = tailB - p;
        if (isCritical || behindCritical) {
          color = 'red';
          reason =
            lag > 0
              ? `Критический дедлайн: план этапа «${stageName(current)}» ${fmt(p)} прошёл, этап не завершён — отставание ${lag} дн.`
              : `Критический дедлайн этапа «${stageName(current)}»: план ${fmt(p)}, сейчас ${fmt(tailB)} — в срок.`;
        } else if (lag <= 0) {
          color = 'green';
          reason = `Этап «${stageName(current)}»: план ${fmt(p)}, сейчас ${fmt(tailB)} — в срок.`;
        } else {
          color = factSegmentColorOfLag(lag);
          reason = `Этап «${stageName(current)}» не завершён: план ${fmt(p)} прошёл — опоздание ${lag} дн.${
            ongoing ? ' (хвост растёт до сегодня)' : ''
          }.`;
        }
      }
      segments.push({
        stageId: current.id,
        a: tailA,
        b: tailB,
        color,
        stageLabel: stageName(current),
        planDay: p,
        factDay: null,
        lagDays: lag,
        critical: isCritical || behindCritical,
        reason,
      });
    } else {
      // Все этапы с фактом, но полоса длиннее последнего этапа (edge): продолжаем по плану окончания рейса.
      const planEnd = input.planTo ?? input.planFrom;
      const lag = planEnd != null ? tailB - planEnd : null;
      segments.push({
        a: tailA,
        b: tailB,
        color: lag == null ? 'neutral' : factSegmentColorOfLag(lag),
        planDay: planEnd,
        lagDays: lag,
        reason:
          lag == null
            ? 'Плановые границы не указаны — нейтрально.'
            : lag > 0
              ? `После планового окончания рейса (${fmt(planEnd as number)}) — опоздание ${lag} дн.`
              : `В срок планового окончания рейса (${fmt(planEnd as number)}).`,
      });
    }
  }

  return { segments, planKnown: true, missed, openTail: ongoing && cursor < factTo, noPlan: false };
};

/** Удобный адаптер: рейс с этапами + spanOverride → вход факт-сегментов. */
export const factSegmentsOfTrip = (
  trip: TimelineTrip & { spanOverride?: { pMin?: number | null; pMax?: number | null } | null },
  factFrom: number,
  factTo: number,
  today: number,
): FactSegmentsResult => {
  const span = tripSpan(trip);
  const ov = trip.spanOverride || {};
  const planFrom = ov.pMin ?? span.pMin ?? null;
  const planTo = ov.pMax ?? span.pMax ?? null;
  const ongoing = tripFactEnd(trip) == null && !trip.archived;
  return factSegmentsOf({ stages: trip.stages, planFrom, planTo, factFrom, factTo, ongoing, today });
};

/** Относительная яркость sRGB-цвета (WCAG 2.x). */
const relLum = (hex: string): number => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const toLin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(m[1].slice(0, 2), 16));
  const g = toLin(parseInt(m[1].slice(2, 4), 16));
  const b = toLin(parseInt(m[1].slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Контраст текста на фоне (WCAG AA требует ≥ 4.5:1 для мелкого текста). */
export const contrastRatio = (fg: string, bg: string): number => {
  const a = relLum(fg);
  const b = relLum(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};
