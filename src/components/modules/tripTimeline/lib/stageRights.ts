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
 *  · canEditExistingDates — изменить УЖЕ ВНЕСЁННУЮ плановую дату. Только
 *    администраторы (root_admin / admin). Существующий замок плана (planLock)
 *    при этом СОХРАНЯЕТСЯ: у рейса с сохранённым планом не-root-администратору
 *    дополнительно нужно разовое разрешение (существующее правило не ослаблено).
 *
 * Функция чистая: роли и статус рейса — параметры, никаких обращений к базе.
 */
import type { TimelineStage } from '../../../../types';
import type { PlanUiState } from './planLock';
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
}

export interface StageRights {
  /** Администратор (root_admin / admin) — правит уже внесённые даты. */
  isAdmin: boolean;
  /** Добавить этап — при любом статусе рейса, независимо от замка плана. */
  canAddStage: boolean;
  /** Заполнить ПУСТУЮ плановую дату — в любой момент, в том числе после сохранения. */
  canFillEmptyDates: boolean;
  /** Изменить УЖЕ ВНЕСЁННУЮ плановую дату — только администраторы. */
  canEditExistingDates: boolean;
  /**
   * Перестановка строк этапов БЕЗ смены дней: этапы одного дня и этапы без
   * дат — порядок строк окна рейса («как внесено сверху вниз»). Доступна
   * исполнителю с правом записи (даты при этом не меняются).
   */
  canReorderStages: boolean;
  /**
   * Перестановка этапов с внесёнными датами РАЗНЫХ дней — только администраторы:
   * такая перестановка меняет сами даты этапов местами (этапы дней меняются
   * местами, строка «встаёт ровно туда, куда её поставил пользователь»).
   */
  canReorderAcrossDays: boolean;
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
  return {
    isAdmin,
    // Статус рейса (в т.ч. archived) на это право НЕ влияет — требование блока.
    canAddStage: canWrite,
    canFillEmptyDates: canWrite,
    canEditExistingDates: isAdmin && canWrite,
    canReorderStages: canWrite,
    canReorderAcrossDays: canWrite && isAdmin,
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
 *  · разные дни ('cross-day') — только администратор: этапы обмениваются
 *    внесёнными датами («перестановка этапов с внесёнными датами»);
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
      ? { kind, allowed: true, adminOnly: true, reason: '' }
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
 * заполнения (canFillEmptyDates); уже внесённое — только администраторам
 * (canEditExistingDates) и, как и раньше, под внешним замком плана
 * (planEditableNow — «черновик / разовое разрешение / root-администратор»).
 * Замок плана не ослабляется: для не-root-администратора с сохранённым планом
 * правка внесённой даты по-прежнему требует разового разрешения.
 */
export const canEditPlannedDateField = (
  rights: StageRights,
  currentValue: string | null | undefined,
  planEditableNow: boolean,
): boolean => {
  const filled = String(currentValue || '').trim() !== '';
  return filled ? rights.canEditExistingDates && planEditableNow : rights.canFillEmptyDates;
};
