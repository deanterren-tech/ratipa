/**
 * СТАТУС-ЛИНИЯ рейса — тонкая линия факта под полосой плана в компактном виде
 * таймлайна. Три состояния по дням (правило владельца):
 *
 *   зелёный   — всё идёт по плану;
 *   оранжевый — срок ближайшего невыполненного этапа подходит (за 1–2 дня):
 *               горит, пока этап не отмечен; как только факт внесён в срок,
 *               участок снова зелёный;
 *   красный   — срок прошёл: красный ровно на период просрочки (от дня после
 *               плановой даты до дня фактического выполнения). Если этап так и
 *               не выполнен — красный продолжается до сегодня.
 *
 * Линия идёт по дням фактической полосы (factFrom…factTo), этапы — в едином
 * порядке маршрута (lib/stageSchedule.stageRouteCmp). Пропущенный этап (срок
 * прошёл, факта нет, а рейс уже дошёл до следующего) — тоже просрочка: его
 * плановая дата участвует в сроке следующего выполненного участка.
 * Чистая функция: ничего не читает и не пишет; today — параметр.
 */
import { dayNum, tripFactEnd, tripSpan } from './timeline';
import { stageRouteCmp } from './stageSchedule';
import type { TimelineStage, TimelineTrip } from '../../../../types';

/** За сколько дней до срока линия становится оранжевой. */
export const STATUS_SOON_DAYS = 2;

export type StatusLineState = 'ok' | 'soon' | 'late' | 'none';

/** Насыщенные цвета: линия тонкая (4–5 px), пастель на ней не читается. */
export const STATUS_LINE_COLORS: Record<StatusLineState, { color: string; label: string }> = {
  ok: { color: '#22A06B', label: 'по плану' },
  soon: { color: '#F59E0B', label: 'срок подходит (1–2 дня)' },
  late: { color: '#E11D48', label: 'срок прошёл — просрочка' },
  none: { color: '#C3C8D0', label: 'план не указан' },
};

export interface StatusLineSegment {
  a: number;
  b: number;
  state: StatusLineState;
  reason: string;
}

export interface StatusLineInput {
  stages: TimelineStage[];
  /** Плановое окончание рейса — срок, если у рейса нет этапов с датами. */
  planTo: number | null;
  factFrom: number;
  factTo: number;
  /** Рейс ещё идёт (хвост до сегодня). */
  ongoing: boolean;
  today: number;
}

const fmt = (n: number): string => {
  const d = new Date(n * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const nameOf = (s: TimelineStage): string => String(s.label || s.type || 'этап').trim() || 'этап';

/** Склеивает соседние участки одного состояния (у них общая причина первого). */
const merge = (segs: StatusLineSegment[]): StatusLineSegment[] => {
  const out: StatusLineSegment[] = [];
  for (const s of segs) {
    if (s.b < s.a) continue;
    const prev = out[out.length - 1];
    if (prev && prev.state === s.state && prev.b + 1 === s.a) prev.b = s.b;
    else out.push({ ...s });
  }
  return out;
};

export const statusLineOf = (input: StatusLineInput): StatusLineSegment[] => {
  const { factFrom, factTo, ongoing, today } = input;
  if (factTo < factFrom) return [];
  const stages = [...input.stages].sort(stageRouteCmp);
  const segs: StatusLineSegment[] = [];
  let cursor = factFrom;
  /** Невыполненные этапы позади текущего участка (их срок тоже считается). */
  let pending: Array<{ p: number; name: string }> = [];

  /** Участок a…b со сроком dl: до срока — зелёный, после — красный. */
  const pushDone = (a: number, b: number, dl: number | null, why: string) => {
    if (dl == null || b <= dl) {
      segs.push({ a, b, state: 'ok', reason: why });
      return;
    }
    segs.push({ a, b: Math.min(b, dl), state: 'ok', reason: why });
    segs.push({ a: Math.max(a, dl + 1), b, state: 'late', reason: `Просрочка ${b - dl} дн. · ${why}` });
  };

  for (const s of stages) {
    const p = dayNum(s.plannedDate);
    const f = dayNum(s.actualDate);
    if (f == null) {
      if (p != null) pending.push({ p, name: nameOf(s) });
      continue;
    }
    if (f < cursor) continue;
    const dates = [...pending.map((x) => x.p), ...(p != null ? [p] : [])];
    const dl = dates.length ? Math.min(...dates) : null;
    const skipped = pending.filter((x) => dl != null && x.p === dl).map((x) => x.name);
    const why = skipped.length
      ? `Этап «${skipped.join('», «')}» пропущен (срок ${fmt(dl as number)}), рейс дошёл до «${nameOf(s)}» ${fmt(f)}`
      : `Этап «${nameOf(s)}»: план ${p != null ? fmt(p) : '—'}, факт ${fmt(f)}`;
    pushDone(cursor, Math.min(f, factTo), dl, why);
    cursor = f + 1;
    pending = [];
    if (cursor > factTo) break;
  }

  if (cursor <= factTo) {
    // Хвост: ближайший срок — первый невыполненный этап (или окончание рейса).
    const next = pending.length ? pending.reduce((m, x) => (x.p < m.p ? x : m)) : null;
    const dl = next ? next.p : stages.some((s) => dayNum(s.plannedDate) != null) ? null : input.planTo;
    const what = next ? `этап «${next.name}»` : 'окончание рейса';
    if (dl == null) {
      const known = stages.some((s) => dayNum(s.plannedDate) != null) || input.planTo != null;
      segs.push({
        a: cursor,
        b: factTo,
        state: known ? 'ok' : 'none',
        reason: known ? 'Все этапы выполнены' : 'План не указан — срок неизвестен',
      });
    } else if (factTo > dl) {
      segs.push({ a: cursor, b: Math.min(factTo, dl), state: 'ok', reason: `Срок: ${what} ${fmt(dl)}` });
      segs.push({
        a: Math.max(cursor, dl + 1),
        b: factTo,
        state: 'late',
        reason: `Срок прошёл: ${what} ${fmt(dl)}, факта нет — просрочка ${factTo - dl} дн.${ongoing ? ' (растёт до сегодня)' : ''}`,
      });
    } else if (ongoing && dl - today <= STATUS_SOON_DAYS) {
      const soonFrom = Math.max(cursor, dl - STATUS_SOON_DAYS);
      segs.push({ a: cursor, b: soonFrom - 1, state: 'ok', reason: `Срок: ${what} ${fmt(dl)}` });
      segs.push({
        a: soonFrom,
        b: factTo,
        state: 'soon',
        reason: `Срок подходит: ${what} ${fmt(dl)} — через ${Math.max(0, dl - today)} дн.`,
      });
    } else {
      segs.push({ a: cursor, b: factTo, state: 'ok', reason: `следующий срок: ${what} ${fmt(dl)}` });
    }
  }
  return merge(segs);
};

/** Адаптер: рейс → вход статус-линии (те же плановые границы, что у сегментов факта). */
export const statusLineOfTrip = (
  trip: TimelineTrip & { spanOverride?: { pMin?: number | null; pMax?: number | null } | null },
  factFrom: number,
  factTo: number,
  today: number,
): StatusLineSegment[] => {
  const span = tripSpan(trip);
  const ov = trip.spanOverride || {};
  const planTo = ov.pMax ?? span.pMax ?? null;
  const ongoing = tripFactEnd(trip) == null && !trip.archived;
  return statusLineOf({ stages: trip.stages, planTo, factFrom, factTo, ongoing, today });
};
