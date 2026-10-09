/**
 * «Новый рейс» таймлайна → запись «Плана дохода» (trips_dashboard).
 *
 * Целые рейсы таймлайна строятся из записей «Плана дохода» НА ЧТЕНИИ
 * (lib/sources.ts, planTripsToWholeTrips; ключ полосы `pd:<id>`), поэтому форма
 * таймлайна создаёт ИМЕННО запись плана дохода — отдельная сущность
 * tripTimeline/trips не создаётся вовсе. Дублирующего рейса и обратной
 * интеграции (циклов «рейс → рейс») не возникает: связаны они стабильным
 * id записи плана, который и служит ключом полосы таймлайна.
 *
 * Финансы не выдумываются: фрахт, ставки, расходы и прибыль в запись НЕ
 * кладутся — она создаётся в состоянии «Требует заполнения» (needsFill).
 * Из формы переносится только то, что там реально заполнено: машина,
 * диспетчер, плановые даты, маршрут (города — в плечи, текст — в заметку).
 */
import type { TimelineLinkedPlanPayload } from '../../../../firebase/planDohodService';
import { calculateTripFinances } from '../../../../utils/financeCalculators';
import { dayNum } from './timeline';

/**
 * Разделители городов в свободном тексте маршрута: длинное/короткое тире,
 * стрелки, дефис с пробелами. Одиночный дефис внутри слова НЕ разделяет —
 * «Санкт-Петербург» остаётся одним городом.
 */
const ROUTE_SPLIT_RE = /\s*(?:—|–|→)\s*|\s+->\s+|\s+-\s+/;

/** Города маршрута из свободного текста (пустые фрагменты отброшены). */
export const routeCityPoints = (route: string): string[] =>
  String(route || '')
    .split(ROUTE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Маршрут → плечи плана (только города from/to; км/ставка/расходы не
 * заполняются — числа не выдумываются). Одна точка — плечо не строится.
 */
export const routeToLegs = (route: string): Array<{ from: string; to: string }> => {
  const points = routeCityPoints(route);
  if (points.length < 2) return [];
  const legs: Array<{ from: string; to: string }> = [];
  for (let i = 0; i + 1 < points.length; i += 1) legs.push({ from: points[i], to: points[i + 1] });
  return legs;
};

/**
 * Плановая продолжительность в днях — тем же расчётом, что в «Плане дохода»
 * (обе даты включительно). Нет обеих корректных дат — undefined: число не
 * выдумывается.
 */
export const planDaysForRange = (startIso: string, endIso: string): number | undefined => {
  if (dayNum(startIso) == null || dayNum(endIso) == null) return undefined;
  const fin = calculateTripFinances([], startIso, endIso, 0, 0, 0);
  const days = Number(fin.days);
  return Number.isFinite(days) && days > 0 ? days : undefined;
};

export interface TimelinePlanDraftInput {
  carNumber: string;
  route: string;
  startDate: string;
  endDate: string;
}

export interface TimelinePlanPayloadContext {
  /** Автор записи (logist) — как в форме «Плана дохода». */
  createdBy: string;
  /** Диспетчер рейса (стабильная связь id ↔ имя); null/пусто — не указан. */
  dispatcher?: { id: string; name: string } | null;
}

/** Запись плана дохода из данных формы таймлайна (без финансов и без id — его даёт вызывающая сторона). */
export const buildTimelinePlanPayload = (
  draft: TimelinePlanDraftInput,
  ctx: TimelinePlanPayloadContext,
): TimelineLinkedPlanPayload => {
  const route = String(draft.route || '').trim();
  const startIso = dayNum(draft.startDate) != null ? String(draft.startDate) : '';
  const endIso = dayNum(draft.endDate) != null ? String(draft.endDate) : '';
  const legs = routeToLegs(route);
  const days = planDaysForRange(startIso, endIso);
  const payload: TimelineLinkedPlanPayload = {
    carNumber: String(draft.carNumber || '').trim(),
    logist: ctx.createdBy,
    stripColor: 'bg-blue-500',
    isArchived: false,
    needsFill: true,
    createdFrom: 'timeline',
  };
  if (startIso) payload.dateStart = startIso;
  if (endIso) payload.dateEnd = endIso;
  if (days != null) payload.days = days;
  if (legs.length) payload.legs = legs;
  if (route) payload.tripNote = route;
  if (ctx.dispatcher && ctx.dispatcher.id) {
    payload.dispatcher = ctx.dispatcher.name || ctx.dispatcher.id;
    payload.dispatcherName = ctx.dispatcher.name || ctx.dispatcher.id;
    payload.dispatcherId = ctx.dispatcher.id;
  }
  return payload;
};

/**
 * Есть ли в записи плана уже заполненные финансовые данные (ставки, пробег,
 * фрахт, расходы). Используется правкой границ из карточки таймлайна: у
 * незаполненной записи пересчитанные нули НЕ записываются (числа не выдумываются).
 */
export const hasPlanFinancials = (raw: Record<string, unknown> | null | undefined): boolean => {
  if (!raw) return false;
  const rawLegs = raw.legs;
  const legs: Array<Record<string, unknown>> = Array.isArray(rawLegs)
    ? (rawLegs as Array<Record<string, unknown>>)
    : rawLegs && typeof rawLegs === 'object'
      ? Object.values(rawLegs as Record<string, Record<string, unknown>>)
      : [];
  const legHasNumbers = legs.some((l) => {
    if (!l || typeof l !== 'object') return false;
    return (
      Number(l.km) > 0 ||
      Number(l.rate) > 0 ||
      Number(l.freight) > 0 ||
      Number(l.emptyRunKm) > 0 ||
      Number(l.emptyRun) > 0 ||
      Number(l.coeff) > 0
    );
  });
  if (legHasNumbers) return true;
  return ['totalKm', 'totalFreight', 'totalExpenses', 'profit', 'profitFact', 'factKm'].some(
    (key) => raw[key] !== undefined && raw[key] !== null && Number(raw[key]) > 0,
  );
};
