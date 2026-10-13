/**
 * Права на этапы рейса — ЕДИНЫЙ резолвер (lib/stageRights), на который
 * надстраиваются следующие задачи блока (замки, «Запросить изменение», журнал
 * правок дат) БЕЗ переделки этой функции.
 *
 * Три НЕЗАВИСИМЫХ права (жалоба владельца: «Добавить этап» должна работать
 * всегда, в том числе после сохранения записи и для завершённых рейсов):
 *
 *  · canAddStage — добавить этап рейса. Всегда true для авторизованного
 *    исполнителя (право записи в модуль) при ЛЮБОМ статусе рейса: черновик,
 *    сохранённый план, завершённый, архивный. Добавление самого этапа —
 *    не изменение уже внесённых дат, поэтому контроль плана его не блокирует.
 *
 *  · canFillEmptyDates — внести дату в ПУСТОЕ поле плановой даты этапа. В любой
 *    момент, в том числе ПОСЛЕ явного сохранения плана (главный кейс владельца):
 *    заполнение пустого — не переписывание уже внесённых дат.
 *
 *  · canEditExistingDates — изменить УЖЕ ВНЕСЁННУЮ плановую дату. По решению
 *    владельца («открой доступ для дат планирования всем») плановые даты открыты
 *    всем исполнителям с правом записи: флаг PLAN_DATES_OPEN_TO_ALL (lib/planLock)
 *    снимает и требование «администратор», и разовое разрешение. При выключенном
 *    флаге возвращается прежнее правило «только администраторы + разовое
 *    разрешение».
 *
 * Функция чистая: роли и статус рейса — параметры, никаких обращений к базе.
 */
import type { TimelineStage } from '../../../../types';
import { PLAN_DATES_OPEN_TO_ALL, type PlanUiState } from './planLock';
import { stageMoveKindOf, type StageMoveKind } from './stageSchedule';

export interface StageRightsUser {
  /** Роль пользователя (users_list.role). */
  role?: string;
}

export interface StageRightsTrip {
  /** manual — ручной рейс; plan — рейс из «Плана дохода». */
  kind?: 'manual' | 'plan';
  /** Рейс в архиве (завершён/закрыт). */
  archived?: boolean;
  /** Состояние замка плана (lib/planLock): draft | saved | permitted. */
  planState?: PlanUiState;
}

export interface StageRightsOptions {
  /** Право записи в модуль (tripTimeline = write) — «авторизованный исполнитель». */
  canWrite: boolean;
  /**
   * Переопределение режима плановых дат (для тестов обоих режимов): по умолчанию
   * берётся флаг продукта PLAN_DATES_OPEN_TO_ALL (lib/planLock).
   */
  planDatesOpen?: boolean;
}

export interface StageRights {
  /** Администратор (root_admin / admin) — правит уже внесённые даты. */
  isAdmin: boolean;
  /** Добавить этап — при любом статусе рейса, независимо от замка плана. */
  canAddStage: boolean;
  /** Заполнить ПУСТУЮ плановую дату — в любой момент, в том числе после сохранения. */
  canFillEmptyDates: boolean;
  /** Изменить УЖЕ ВНЕСЁННУЮ плановую дату — при открытых плановых датах все
   *  исполнители с правом записи, иначе только администраторы. */
  canEditExistingDates: boolean;
  /**
   * Перестановка строк этапов БЕЗ смены дней: этапы одного дня и этапы без
   * дат — порядок строк окна рейса («как внесено сверху вниз»). Доступна
   * исполнителю с правом записи (даты при этом не меняются).
   */
  canReorderStages: boolean;
  /**
   * Перестановка этапов с внесёнными датами РАЗНЫХ дней. Такая перестановка
   * меняет сами ПЛАНОВЫЕ даты этапов местами, поэтому при открытых плановых
   * датах (PLAN_DATES_OPEN_TO_ALL) доступна исполнителю с правом записи, иначе —
   * только администраторам.
   */
  canReorderAcrossDays: boolean;
  /**
   * Режим правки плановых дат: true — открыт всем исполнителям с правом записи
   * (PLAN_DATES_OPEN_TO_ALL), false — прежний контроль (только администраторы).
   * Используется resolveStageMove для признака adminOnly.
   */
  planDatesOpen: boolean;
}

/** Административные роли портала. */
export const isAdminRole = (role?: string): boolean => role === 'root_admin' || role === 'admin';

export const resolveStageRights = (
  user: StageRightsUser | null | undefined,
  trip: StageRightsTrip | null | undefined,
  options: StageRightsOptions,
): StageRights => {
  const canWrite = options?.canWrite === true;
  const isAdmin = isAdminRole(user?.role);
  const planDatesOpen = options?.planDatesOpen ?? PLAN_DATES_OPEN_TO_ALL;
  return {
    isAdmin,
    // Статус рейса (в т.ч. archived) на это право НЕ влияет — требование блока.
    canAddStage: canWrite,
    canFillEmptyDates: canWrite,
    canEditExistingDates: canWrite && (isAdmin || planDatesOpen),
    canReorderStages: canWrite,
    canReorderAcrossDays: canWrite && (isAdmin || planDatesOpen),
    planDatesOpen,
  };
};

// ---------------------------------------------------------------------------
// Перестановка строк этапов (единый резолвер — используется UI и тестами)
// ---------------------------------------------------------------------------

export interface StageMoveDecision {
  /** Вид пары (null — пара «этап с датой ↔ этап без даты», не переставляется). */
  kind: StageMoveKind | null;
  /** Разрешена ли перестановка ЭТОМУ пользователю. */
  allowed: boolean;
  /** Для пары требуется администратор (вид 'cross-day'). */
  adminOnly: boolean;
  /** Причина блокировки для подсказки ('' — перестановка доступна). */
  reason: string;
}

/**
 * Право перестановки пары соседних строк «перемещаемый этап ↔ сосед»:
 *  · оба без даты ('empty-tail') и один день ('same-day') — исполнитель с
 *    правом записи; даты не меняются, seq перенумеровывается 1..N;
 *  · разные дни ('cross-day') — обмен плановыми датами; при открытых плановых
 *    датах доступно исполнителю, иначе только администратору;
 *  · этап с датой ↔ этап без даты — не переставляется никому (порядок хвоста
 *    без дат и датированных этапов задаётся датами).
 * Замок плана (planLock) поверх этого правила не ослабляется: UI применяет его
 * отдельно, как и для правки полей дат.
 */
export const resolveStageMove = (
  rights: StageRights,
  moved: TimelineStage | null | undefined,
  neighbor: TimelineStage | null | undefined,
): StageMoveDecision => {
  if (!moved || !neighbor) {
    return { kind: null, allowed: false, adminOnly: false, reason: 'Переставлять нечего — соседней строки нет.' };
  }
  const kind = stageMoveKindOf(moved, neighbor);
  if (!kind) {
    return {
      kind: null,
      allowed: false,
      adminOnly: false,
      reason: 'Этап с датой и этап без даты местами не меняются: порядок этапов с датами задают даты. Сначала внесите дату.',
    };
  }
  if (kind === 'cross-day') {
    return rights.canReorderAcrossDays
      ? { kind, allowed: true, adminOnly: !rights.planDatesOpen, reason: '' }
      : {
          kind,
          allowed: false,
          adminOnly: true,
          reason: 'Перестановка этапов с внесёнными датами разных дней — только администратор: этапы поменяются датами местами.',
        };
  }
  return rights.canReorderStages
    ? { kind, allowed: true, adminOnly: false, reason: '' }
    : { kind, allowed: false, adminOnly: false, reason: 'Нет права записи в модуль — перестановка недоступна.' };
};

/**
 * Редактируемость КОНКРЕТНОГО поля плановой даты этапа: пустое — по праву
 * заполнения (canFillEmptyDates); уже внесённое — по canEditExistingDates.
 * Внешний замок (planEditableNow — из lib/planLock.planDatesEditable) применяется
 * только к внесённым датам: при открытых плановых датах он true для всех
 * исполнителей с правом записи, при прежнем контроле — «черновик / разовое
 * разрешение / root-администратор».
 */
export const canEditPlannedDateField = (
  rights: StageRights,
  currentValue: string | null | undefined,
  planEditableNow: boolean,
): boolean => {
  const filled = String(currentValue || '').trim() !== '';
  return filled ? rights.canEditExistingDates && planEditableNow : rights.canFillEmptyDates;
};
