/**
 * Плановые границы рейса: ОДНА сторона записи — источник истины.
 *
 * Задание владельца (часть 3, синхронизация дат): плановые даты старта и
 * возвращения связанного рейса живут ТОЛЬКО в записи «Плана дохода»
 * (`trips_dashboard/<planId>/dateStart|dateEnd`); у ручного рейса — ТОЛЬКО в его
 * собственной записи (`tripTimeline/trips/<id>/startDate|endDate`). Второго
 * независимого значения быть не должно: ни копии в `tripTimeline/trips` для
 * связанного рейса, ни правок дат в `tripTimeline/tripMeta/<ключ>`
 * (легаси-оверрайд planStart/planEnd очищается той же операцией, см. metaCleanup).
 *
 * Здесь живёт ЧИСТАЯ сборка этой записи (без React и без базы):
 *  · какие поля и пути получают даты (у связанного — dateStart/dateEnd плана,
 *    у ручного — startDate/endDate его записи) — ОДНА база, оба поля;
 *  · проверка порядка дат (возвращение не раньше старта) до записи;
 *  · пересчёт «Плана дохода» тем же расчётом, что у окна рейса
 *    (calculateTripFinances: дни — только при обеих датах; финансы — только у
 *    записи, где они уже заполнены) — БЕЗ создания записей истории;
 *  · кандидат для единой проверки периодов (lib/tripGuard.guardTimelinePeriod
 *    вызывает dbService — сам расчёт конфликта здесь не дублируется).
 *
 * Используют: dbService.saveTimelinePlanBounds (перетаскивание полосы) и
 * dbService.saveTimelineTripMeta (даты в патче перенаправляются в запись-
 * источник — в tripMeta даты больше не пишутся). Фактические даты (даты этапов
 * «факт», «Учёт выезда», факт-границы) здесь не участвуют вовсе.
 */
import type { LegPlan } from '../../../../types';
import { calculateTripFinances } from '../../../../utils/financeCalculators';
import { dayNum, dayStr } from './timeline';
import { hasPlanFinancials } from './planFromDraft';

export type PlanBoundsKind = 'plan' | 'manual';

export interface PlanBoundsWriteInput {
  /** Стабильный ключ таймлайна: `pd:<planId>` | `tl:<id>`. */
  tripKey: string;
  /** Запись-источник (trips_dashboard/<id> или tripTimeline/trips/<id>) — КАК ЕСТЬ. */
  raw: Record<string, unknown>;
  /** Текущий оверрайд tripMeta (если есть) — нужен только для очистки легаси. */
  metaRaw?: Record<string, unknown> | null;
  /** Новый старт (ISO или дд/мм/гггг). undefined — оставить как в записи. */
  startIso?: string | null;
  /** Новое возвращение. undefined — оставить как в записи. */
  endIso?: string | null;
  /** Автор (updatedBy записи плана). */
  by?: string;
  /** Фиксируемое время (для тестов); по умолчанию — тек. момент. */
  nowIso?: string;
}

export interface PlanBoundsWritePlan {
  ok: boolean;
  /** Понятная причина отказа (даты не записаны). */
  error?: string;
  kind: PlanBoundsKind;
  bareId: string;
  /** ЕДИНСТВЕННАЯ база записи, куда идут даты. */
  base: string;
  /** Имена полей записи под даты (у плана и ручного рейса они разные). */
  dateFields: { start: 'dateStart' | 'startDate'; end: 'dateEnd' | 'endDate' };
  /** Эффективные даты, которые будут записаны ('', — поле не пишется). */
  start: string;
  end: string;
  /** Один multi-path update: даты + пересчёт + служебные поля + очистка легаси. */
  updates: Record<string, unknown>;
  /** Только пути дат (для теста «одна сторона, оба поля вместе»). */
  datePaths: string[];
  /** Кандидат единой проверки периодов (lib/tripGuard): рейс с НОВЫМИ датами. */
  guard: { id: string; carNumber: string; carId: string; dateStart: string; dateEnd: string };
}

/** ISO-дата из произвольного значения или '' (не выдумываем).
 *  Принимает YYYY-MM-DD, ДД/ММ/ГГГГ и ДД.ММ.ГГГГ; календарный день — через
 *  Date.UTC (образец — tripDayNum в lib/tripGuard), сдвигов часовых поясов нет. */
const normDay = (v: unknown): string => {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  let n: number | null = null;
  if (iso) n = Math.round(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000);
  else if (ru) n = Math.round(Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])) / 86400000);
  else {
    const t = new Date(raw).getTime();
    n = Number.isFinite(t) ? Math.round(t / 86400000) : null;
  }
  if (n == null || !Number.isFinite(n)) return '';
  return dayStr(n);
};

/** Ключ рейса таймлайна → вид и id записи-источника. */
export const planBoundsTargetOf = (tripKey: string): { kind: PlanBoundsKind; bareId: string; base: string } => {
  const kind: PlanBoundsKind = /^pd:/.test(String(tripKey || '')) ? 'plan' : 'manual';
  const bareId = String(tripKey || '').replace(/^(pd|tl):/, '');
  return {
    kind,
    bareId,
    base: kind === 'plan' ? `trips_dashboard/${bareId}` : `tripTimeline/trips/${bareId}`,
  };
};

/**
 * Сборка записи плановых дат. Всегда ОДНА база (источник истины) и оба поля
 * дат одной операцией; даты в tripMeta не пишутся — наоборот, легаси-значения
 * очищаются в том же update.
 */
export const planBoundsWritePlan = (input: PlanBoundsWriteInput): PlanBoundsWritePlan => {
  const { kind, bareId, base } = planBoundsTargetOf(input.tripKey);
  const raw = input.raw || {};
  const dateFields = kind === 'plan'
    ? { start: 'dateStart' as const, end: 'dateEnd' as const }
    : { start: 'startDate' as const, end: 'endDate' as const };

  const curStart = normDay(raw[dateFields.start]);
  const curEnd = normDay(raw[dateFields.end]);
  const nextStart = input.startIso === undefined || input.startIso === null ? curStart : normDay(input.startIso);
  const nextEnd = input.endIso === undefined || input.endIso === null ? curEnd : normDay(input.endIso);

  const fail = (error: string): PlanBoundsWritePlan => ({
    ok: false,
    error,
    kind,
    bareId,
    base,
    dateFields,
    start: nextStart,
    end: nextEnd,
    updates: {},
    datePaths: [],
    guard: { id: bareId, carNumber: String(raw.carNumber || ''), carId: String(raw.carId ?? raw.vehicleId ?? ''), dateStart: nextStart, dateEnd: nextEnd },
  });

  const startDay = dayNum(nextStart);
  const endDay = dayNum(nextEnd);
  if (startDay == null && endDay == null) {
    return fail('Не указаны плановые даты — сохранять нечего');
  }
  if (startDay != null && endDay != null && endDay < startDay) {
    return fail('Плановое возвращение не может быть раньше планового старта — изменения не сохранены.');
  }

  const updates: Record<string, unknown> = {};
  const datePaths: string[] = [];
  // Оба поля дат — одной операцией, в ОДНОЙ базе записи (абсолютные значения:
  // повторная запись идемпотентна). Пустая сторона поле не трогает.
  if (nextStart) {
    updates[`${base}/${dateFields.start}`] = nextStart;
    datePaths.push(`${base}/${dateFields.start}`);
  }
  if (nextEnd) {
    updates[`${base}/${dateFields.end}`] = nextEnd;
    datePaths.push(`${base}/${dateFields.end}`);
  }

  if (kind === 'plan') {
    // Пересчёт — тем же расчётом, что делает «План дохода»/окно рейса при
    // правке дат (calculateTripFinances): дни — только при обеих датах,
    // финансы — только у записи, где они уже заполнены (числа не выдумываются).
    // Записываются ТОЛЬКО значения записи; история/журнал этой операцией не
    // создаются (пересчёт без истории).
    if (nextStart && nextEnd) {
      const fin = calculateTripFinances(
        ((raw.legs as LegPlan[] | undefined) || []),
        nextStart,
        nextEnd,
        Number(raw.extraExpense) || 0,
        Number(raw.ferryCost) || 0,
        Number(raw.factKm) || 0,
      );
      updates[`${base}/days`] = fin.days;
      if (hasPlanFinancials(raw)) {
        updates[`${base}/totalKm`] = fin.totalKm;
        updates[`${base}/totalFreight`] = fin.totalFreight;
        updates[`${base}/totalExpenses`] = fin.totalExpensesFact;
        updates[`${base}/profit`] = fin.profitPlan;
        updates[`${base}/profitFact`] = fin.profitFact;
      }
    }
    // Служебные поля «Плана дохода» — тот же формат, что у окна таймлайна.
    updates[`${base}/updatedAt`] = input.nowIso ? new Date(input.nowIso).toLocaleString('ru-RU') : new Date().toLocaleString('ru-RU');
    if (input.by) updates[`${base}/updatedBy`] = input.by;
  } else {
    updates[`${base}/updatedAt`] = input.nowIso || new Date().toISOString();
  }

  // Легаси-оверрайд tripMeta (planStart/planEnd) — второй источник дат: та же
  // операция очищает его, чтобы запись плана осталась ЕДИНСТВЕННЫМ местом.
  const meta = input.metaRaw || null;
  if (meta && (meta.planStart !== undefined || meta.planEnd !== undefined)) {
    if (meta.planStart !== undefined) updates[`tripTimeline/tripMeta/${input.tripKey}/planStart`] = null;
    if (meta.planEnd !== undefined) updates[`tripTimeline/tripMeta/${input.tripKey}/planEnd`] = null;
  }

  return {
    ok: true,
    kind,
    bareId,
    base,
    dateFields,
    start: nextStart,
    end: nextEnd,
    updates,
    datePaths,
    guard: {
      id: bareId,
      carNumber: String(raw.carNumber || ''),
      carId: String(raw.carId ?? raw.vehicleId ?? ''),
      dateStart: nextStart,
      dateEnd: nextEnd,
    },
  };
};
