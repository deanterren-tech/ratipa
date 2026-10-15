/**
 * Права на этапы рейса — ЕДИНЫЙ резолвер (lib/stageRights).
 *
 * Три НЕЗАВИСИМЫХ права (жалоба владельца: «Добавить этап» должна работать
 * всегда, в том числе после сохранения записи и для завершённых рейсов):
 *
 *  · canAddStage — добавить этап рейса. Всегда true для авторизованного
 *    исполнителя (право записи в модуль) при ЛЮБОМ статусе рейса: черновик,
 *    сохранённый план, завершённый, архивный.
 *
 *  · canFillEmptyDates — внести дату в ПУСТОЕ поле плановой даты этапа. В любой
 *    момент, в том числе после явного сохранения плана.
 *
 *  · canEditExistingDates — изменить УЖЕ ВНЕСЁННУЮ плановую дату. По решению
 *    владельца («открой доступ для дат планирования всем») плановые даты открыты
 *    всем исполнителям с правом записи: контроля плана и разовых разрешений
 *    администратора в модуле больше НЕТ (механизм удалён целиком) — правка
 *    доступна при праве записи, изменения фиксирует история изменений рейса.
 *
 * Функция чистая: роли и статус рейса — параметры, никаких обращений к базе.
 */
import type { TimelineStage } from '../../../../types';
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
}

export interface StageRightsOptions {
  /** Право записи в модуль (tripTimeline = write) — «авторизованный исполнитель». */
  canWrite: boolean;
}

export interface StageRights {
  /** Администратор (root_admin / admin). */
  isAdmin: boolean;
  /** Добавить этап — при любом статусе рейса. */
  canAddStage: boolean;
  /** Заполнить ПУСТУЮ плановую дату — в любой момент, в том числе после сохранения. */
  canFillEmptyDates: boolean;
  /** Изменить УЖЕ ВНЕСЁННУЮ плановую дату — исполнителю с правом записи. */
  canEditExistingDates: boolean;
  /**
   * Перестановка строк этапов БЕЗ смены дней: этапы одного дня и этапы без
   * дат — порядок строк окна рейса («как внесено сверху вниз»).
   */
  canReorderStages: boolean;
  /**
   * Перестановка этапов с внесёнными датами РАЗНЫХ дней: этапы меняются
   * плановыми датами местами — доступна исполнителю с правом записи.
   */
  canReorderAcrossDays: boolean;
}

/** Административные роли портала. */
export const isAdminRole = (role?: string): boolean => role === 'root_admin' || role === 'admin';

export const resolveStageRights = (
  user: StageRightsUser | null | undefined,
  _trip: StageRightsTrip | null | undefined,
  options: StageRightsOptions,
): StageRights => {
  const canWrite = options?.canWrite === true;
  const isAdmin = isAdminRole(user?.role);
  return {
    isAdmin,
    // Статус рейса (в т.ч. archived) на эти права НЕ влияет.
    canAddStage: canWrite,
    canFillEmptyDates: canWrite,
    canEditExistingDates: canWrite,
    canReorderStages: canWrite,
    canReorderAcrossDays: canWrite,
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
  /** Для пары требуется администратор (вид 'cross-day') — больше не требуется. */
  adminOnly: boolean;
  /** Причина блокировки для подсказки ('' — перестановка доступна). */
  reason: string;
}

/**
 * Право перестановки пары соседних строк «перемещаемый этап ↔ сосед»:
 *  · оба без даты ('empty-tail') и один день ('same-day') — исполнитель с
 *    правом записи; даты не меняются, seq перенумеровывается 1..N;
 *  · разные дни ('cross-day') — обмен плановыми датами; доступно исполнителю с
 *    правом записи (плановые даты открыты всем);
 *  · этап с датой ↔ этап без даты — не переставляется никому (порядок хвоста
 *    без дат и датированных этапов задаётся датами).
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
      ? { kind, allowed: true, adminOnly: false, reason: '' }
      : {
          kind,
          allowed: false,
          adminOnly: false,
          reason: 'Перестановка этапов с внесёнными датами разных дней — нужен право записи в модуль.',
        };
  }
  return rights.canReorderStages
    ? { kind, allowed: true, adminOnly: false, reason: '' }
    : { kind, allowed: false, adminOnly: false, reason: 'Нет права записи в модуль — перестановка недоступна.' };
};

/**
 * Редактируемость КОНКРЕТНОГО поля плановой даты этапа: пустое — по праву
 * заполнения (canFillEmptyDates); уже внесённое — по canEditExistingDates.
 * Контроль плана и разовые разрешения удалены: отдельных «замков» нет.
 */
export const canEditPlannedDateField = (
  rights: StageRights,
  currentValue: string | null | undefined,
): boolean => {
  const filled = String(currentValue || '').trim() !== '';
  return filled ? rights.canEditExistingDates : rights.canFillEmptyDates;
};
