/**
 * Расчёт ИЗМЕНЕНИЙ ПЛАНА этапов рейса (сравнение сохранённого состояния и
 * черновика окна). Контроля доступа и разовых разрешений здесь НЕТ: механизм
 * разрешений на изменение плана удалён полностью — плановые даты, запас,
 * порядок и состав этапов правит любой исполнитель с правом записи, изменения
 * записываются кнопкой «Сохранить» и фиксируются единой историей изменений
 * (lib/tripHistory).
 *
 * Файл — чистая логика без обращений к базе: используется окном рейса (гейты
 * валидации, «было → стало» в истории) и доступен автотестам. Раньше в этом
 * файле (lib/planLock) жил ещё и контроль плана («Черновик плана» / «План
 * сохранён» / разовое разрешение администратора) — он удалён.
 */
import type { TimelineStage } from '../../../../types';
import { dayNum } from './timeline';
import { stageBufferOf, stageSeqOf, hasStageSeq } from './stageSchedule';

/** Служебный этап-заглушка (показ без реального плана) — не считается планом. */
export const isFallbackStage = (s: TimelineStage): boolean => String(s?.id || '').endsWith('-fallback-load');

/** Есть ли у рейса РЕАЛЬНО заполненный план (этап с плановой датой). */
export const hasStoredPlan = (stages: TimelineStage[] | undefined): boolean =>
  (stages || []).some((s) => !isFallbackStage(s) && dayNum(s.plannedDate) != null);

/**
 * Есть ли у рейса сохранённый СОСТАВ плана этапов (непустой набор реальных
 * этапов, без служебных заглушек).
 */
export const hasStoredStages = (stages: TimelineStage[] | undefined): boolean =>
  (stages || []).some((s) => !isFallbackStage(s));

/** Изменения плана между сохранённым состоянием и черновиком окна. */
export interface PlanStageChanges {
  adds: TimelineStage[];
  /**
   * Правки планового графика существующих этапов: плановая дата, запас этапа
   * (bufferDays — часть плана: сдвигает эффективные сроки) и порядок маршрута
   * (order/seq — «раньше внесён — левее»; тоже свойство плана).
   */
  plannedUpdates: Array<{
    id: string;
    plannedDate: string;
    before: string;
    bufferDays?: number;
    bufferBefore?: number;
    order?: number;
    seq?: number;
    orderBefore?: number;
  }>;
  removes: TimelineStage[];
  /** Правки привязки этапов к кругам (null — привязка снята). */
  circleUpdates: Array<{ id: string; circle: number | null; before: number | null }>;
  /**
   * Ленивая миграция seq: сохранённые этапы БЕЗ собственного seq — при первой
   * же правке этапов этого рейса номер записывается СУЩЕСТВУЮЩИМ сохранением
   * (значение — тот же показываемый порядок seq→order→позиция, ничего не
   * меняется по существу).
   */
  seqBackfill: Array<{ id: string; seq: number }>;
  /** Изменилось ли КОЛИЧЕСТВО кругов рейса (поле «Круги» — часть плана). */
  circlesChanged: boolean;
  /** Сколько записей реально изменится. */
  count: number;
}

/** Круг этапа: целое от 1 либо null (привязки нет). */
const circleValueOf = (v: unknown): number | null => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : null;
};

export const computePlanStageChanges = (
  stored: TimelineStage[] | undefined,
  draft: TimelineStage[] | undefined,
  /** Круги рейса: сохранённое и черновое «Количество кругов» (часть плана). */
  circles?: { stored?: number; draft?: number },
): PlanStageChanges => {
  const storedById = new Map((stored || []).map((s) => [s.id, s]));
  const draftById = new Map((draft || []).map((s) => [s.id, s]));
  const adds: TimelineStage[] = [];
  const plannedUpdates: PlanStageChanges['plannedUpdates'] = [];
  const removes: TimelineStage[] = [];
  const circleUpdates: PlanStageChanges['circleUpdates'] = [];
  const seqBackfill: PlanStageChanges['seqBackfill'] = [];
  // Позиции в массивах — миграционный «order» для расчета seq (lib/stageSchedule).
  const storedIdx = new Map((stored || []).map((s, i) => [s.id, i]));
  (draft || []).forEach((s, i) => {
    const before = storedById.get(s.id);
    if (!before) {
      if (!isFallbackStage(s)) adds.push(s);
      return;
    }
    const dateChanged = (before.plannedDate || '') !== (s.plannedDate || '');
    // Запас этапа и порядок маршрута — часть плана (сдвигают эффективные сроки
    // и порядок в дне).
    const bufferChanged = stageBufferOf(before) !== stageBufferOf(s);
    const seqBefore = stageSeqOf(before, storedIdx.get(before.id) ?? 0);
    const seqDraft = Number(s.seq) && Number(s.seq) > 0 ? Math.floor(Number(s.seq)) : i + 1;
    const orderChanged = seqBefore !== seqDraft;
    if (dateChanged || bufferChanged || orderChanged) {
      plannedUpdates.push({
        id: s.id,
        plannedDate: s.plannedDate || '',
        before: before.plannedDate || '',
        ...(bufferChanged ? { bufferDays: stageBufferOf(s), bufferBefore: stageBufferOf(before) } : {}),
        // Порядок менялся — этот же путь записи уже несёт seq (backfill ниже
        // не дублируется); иначе номер мигрирует лениво.
        ...(orderChanged ? { order: seqDraft, seq: seqDraft, orderBefore: seqBefore } : {}),
      });
    }
    // Ленивая миграция: у старой записи нет своего seq — при этой же правке
    // этапов дописываем текущий эффективный номер (значение не меняется).
    if (!hasStageSeq(before) && !orderChanged) {
      seqBackfill.push({ id: s.id, seq: seqBefore });
    }
    const beforeCircle = circleValueOf(before.circle);
    const draftCircle = circleValueOf(s.circle);
    if (beforeCircle !== draftCircle) {
      circleUpdates.push({ id: s.id, circle: draftCircle, before: beforeCircle });
    }
  });
  (stored || []).forEach((s) => {
    if (!draftById.has(s.id) && !isFallbackStage(s)) removes.push(s);
  });
  const storedCircles = circles ? Math.max(1, Math.floor(Number(circles.stored)) || 1) : null;
  const draftCircles = circles ? Math.max(1, Math.floor(Number(circles.draft)) || 1) : null;
  const circlesChanged = storedCircles != null && draftCircles != null && storedCircles !== draftCircles;
  return {
    adds,
    plannedUpdates,
    removes,
    circleUpdates,
    seqBackfill,
    circlesChanged,
    count:
      adds.length +
      plannedUpdates.length +
      removes.length +
      circleUpdates.length +
      (circlesChanged ? 1 : 0),
  };
};

/**
 * Человекочитаемое описание изменений плана этапов — ОДНА строка (для журнала
 * портала и summary записи истории). Даты печатает переданный `dayLabel`
 * (формат модуля), названия этапов — `nameOf`.
 */
export const describePlanChanges = (
  changes: PlanStageChanges,
  opts: {
    nameOf: (s: TimelineStage) => string;
    /** Подпись этапа по id (ищем среди сохранённых и черновых этапов окна). */
    nameById?: (id: string) => string;
    dayLabel: (v: string) => string;
    circlesBefore?: number;
    circlesAfter?: number;
  },
): string => {
  const parts: string[] = [];
  const nameOfId = (id: string): string => {
    const st = findStageById(changes, id);
    if (st) return opts.nameOf(st);
    return opts.nameById ? opts.nameById(id) : id;
  };
  changes.plannedUpdates.forEach((u) => {
    const name = nameOfId(u.id);
    const bits: string[] = [`план ${u.before ? opts.dayLabel(u.before) : 'не указана'} → ${u.plannedDate ? opts.dayLabel(u.plannedDate) : 'не указана'}`];
    if (u.bufferDays !== undefined) bits.push(`запас ${u.bufferBefore ?? 0} → ${u.bufferDays}`);
    if (u.seq !== undefined) bits.push(`порядок ${u.orderBefore ?? '—'} → ${u.seq}`);
    parts.push(`${name}: ${bits.join('; ')}`);
  });
  changes.circleUpdates.forEach((u) => {
    parts.push(`${nameOfId(u.id)}: круг ${u.before ?? 'не указан'} → ${u.circle ?? 'не указан'}`);
  });
  if (changes.circlesChanged) {
    parts.push(`количество кругов рейса: ${opts.circlesBefore ?? '—'} → ${opts.circlesAfter ?? '—'}`);
  }
  changes.adds.forEach((s) =>
    parts.push(`добавлен этап «${opts.nameOf(s)}»${dayNum(s.plannedDate) != null ? ` (план ${opts.dayLabel(s.plannedDate)})` : ''}`),
  );
  changes.removes.forEach((s) => parts.push(`удалён этап «${opts.nameOf(s)}»`));
  return parts.join('; ') || 'без изменений';
};

/** Поиск этапа по id среди изменённых записей (для подписи изменения). */
const findStageById = (changes: PlanStageChanges, id: string): TimelineStage | null => {
  const added = changes.adds.find((s) => s.id === id);
  if (added) return added;
  const removed = changes.removes.find((s) => s.id === id);
  return removed || null;
};
