/**
 * Контроль плана этапов: состояние блокировки плановых дат и вычисление
 * изменений плана при явном сохранении.
 *
 * Правила (спецификация модуля):
 *  - первичное планирование: план в состоянии «Черновик плана» — доступен правке,
 *    автосохранение черновика окончательным сохранением НЕ считается;
 *  - после явного сохранения плановые даты этапов блокируются («План сохранён»);
 *  - разблокировка — только разовым разрешением администратора на конкретную
 *    пару «рейс + пользователь» (одно успешное сохранение);
 *  - исторически заполненные планы (до включения контроля) считаются
 *    сохранёнными; автор/дата первоначального сохранения не выдумываются.
 *
 * Блокируется ТОЛЬКО план этапов: плановые даты, состав (добавление/удаление).
 * Фактические даты, журнал событий, границы целого рейса и план дохода — вне
 * этого контроля (живут по прежним правилам).
 */
import type { TimelinePlanGuard, TimelinePlanHistoryEntry, TimelinePlanPermission, TimelineStage } from '../../../../types';
import { dayNum } from './timeline';

export type PlanUiState = 'draft' | 'saved' | 'permitted';

export interface PlanLockInfo {
  state: PlanUiState;
  /** План сохранён, но автор/дата первоначального сохранения неизвестны. */
  legacy: boolean;
  version: number;
  initialSavedAt?: string;
  initialSavedBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Действующее разрешение ТЕКУЩЕГО пользователя (если выдано). */
  permission?: TimelinePlanPermission;
  /** Все действующие разрешения рейса (для администратора). */
  permissions: Record<string, TimelinePlanPermission>;
  history: TimelinePlanHistoryEntry[];
}

/** Служебный этап-заглушка (показ без реального плана) — не считается планом. */
export const isFallbackStage = (s: TimelineStage): boolean => String(s?.id || '').endsWith('-fallback-load');

/** Есть ли у рейса РЕАЛЬНО заполненный план (этап с плановой датой). */
export const hasStoredPlan = (stages: TimelineStage[] | undefined): boolean =>
  (stages || []).some((s) => !isFallbackStage(s) && dayNum(s.plannedDate) != null);

/**
 * Есть ли у рейса сохранённый СОСТАВ плана этапов (непустой набор реальных
 * этапов, без служебных заглушек). Заполненный состав без дат — тоже
 * «заполненный план»: у реальных рейсов он исторически сохранён.
 */
export const hasStoredStages = (stages: TimelineStage[] | undefined): boolean =>
  (stages || []).some((s) => !isFallbackStage(s));

/**
 * Состояние плана рейса.
 * @param storedStages — СОХРАНЁННЫЕ этапы (из источника, не черновик окна):
 *   по ним определяется «исторически заполненный» план.
 * @param timelineDraft — запись плана СОЗДАНА формой таймлайна (черновик):
 *   только для таких записей маркер draftCreated означает «первичное
 *   планирование ещё идёт». У реальных рейсов («План дохода» и ручные рейсы
 *   прошлых сессий) заполненный состав/даты — это сохранённый план, даже если
 *   маркер черновика туда попал ошибочно (например, старым скриптом или
 *   прежней версией формы): бесплатной правки заполненные рейсы не получают.
 */
export const resolvePlanLock = (params: {
  storedStages: TimelineStage[] | undefined;
  guard?: TimelinePlanGuard | null;
  perms?: Record<string, TimelinePlanPermission> | null;
  userId?: string | null;
  timelineDraft?: boolean;
}): PlanLockInfo => {
  const guard = params.guard || null;
  const perms = params.perms || {};
  const userId = String(params.userId || '');
  const hasInitial = !!guard?.initialSavedAt;
  const filled = hasStoredStages(params.storedStages) || hasStoredPlan(params.storedStages);
  // План заполнен до включения контроля: сохранён, но автор/дата неизвестны.
  // Маркер черновика учитывается ТОЛЬКО у записей, созданных формой таймлайна:
  // у заполненных реальных рейсов он не даёт «бесплатную» правку.
  const draftMarker = !!guard?.draftCreated && params.timelineDraft === true;
  const legacy = !hasInitial && !draftMarker && filled;
  const saved = hasInitial || legacy;
  const version = Number(guard?.version) || (saved ? 1 : 0);
  const permission = userId ? perms[userId] : undefined;
  const state: PlanUiState = saved ? (permission ? 'permitted' : 'saved') : 'draft';
  return {
    state,
    legacy: legacy && !hasInitial,
    version,
    initialSavedAt: hasInitial ? guard?.initialSavedAt : undefined,
    initialSavedBy: hasInitial ? guard?.initialSavedBy : undefined,
    updatedAt: guard?.updatedAt,
    updatedBy: guard?.updatedBy,
    permission,
    permissions: perms,
    history: Array.isArray(guard?.history) ? guard!.history : [],
  };
};

/** Изменения плана между сохранённым состоянием и черновиком окна. */
export interface PlanStageChanges {
  adds: TimelineStage[];
  plannedUpdates: Array<{ id: string; plannedDate: string; before: string }>;
  removes: TimelineStage[];
  /** Правки привязки этапов к кругам (null — привязка снята). */
  circleUpdates: Array<{ id: string; circle: number | null; before: number | null }>;
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
  (draft || []).forEach((s) => {
    const before = storedById.get(s.id);
    if (!before) {
      if (!isFallbackStage(s)) adds.push(s);
      return;
    }
    if ((before.plannedDate || '') !== (s.plannedDate || '')) {
      plannedUpdates.push({ id: s.id, plannedDate: s.plannedDate || '', before: before.plannedDate || '' });
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
  // Изменение количества кругов — изменение плана: количество кругов
  // участвует в счётчике изменений (разовое разрешение расходуется осознанно).
  const storedCircles = circles ? Math.max(1, Math.floor(Number(circles.stored)) || 1) : null;
  const draftCircles = circles ? Math.max(1, Math.floor(Number(circles.draft)) || 1) : null;
  const circlesChanged = storedCircles != null && draftCircles != null && storedCircles !== draftCircles;
  return {
    adds,
    plannedUpdates,
    removes,
    circleUpdates,
    circlesChanged,
    count:
      adds.length +
      plannedUpdates.length +
      removes.length +
      circleUpdates.length +
      (circlesChanged ? 1 : 0),
  };
};
