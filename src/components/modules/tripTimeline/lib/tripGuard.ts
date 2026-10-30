/**
 * Единая проверка периодов рейсов одной машины.
 *
 * Зачем отдельный модуль: конфликт «два рейса одной машины в один период»
 * раньше ловился (или не ловился) в разных местах по-разному. Здесь одно
 * правило для ВСЕХ путей: создание рейса, смена машины, смена дат, перевод в
 * активный статус, перетаскивание полосы, создание/обновление из плана дохода.
 *
 * Правила (заданы владельцем):
 *  · два рейса одной машины не могут пересекаться по периоду;
 *  · у выполняемого рейса без даты возвращения второй активный рейс запрещён;
 *  · последовательные рейсы разрешены;
 *  · отменённые и архивные записи машину не блокируют;
 *  · редактируемый рейс исключается из проверки по своему ключу.
 *
 * Границы периодов. Точность данных — календарные даты, поэтому правило
 * сформулировано явно и применяется везде одинаково: **день возвращения
 * принадлежит предыдущему рейсу, а следующий рейс может начинаться этим же
 * днём** (передача машины в день приезда — обычная практика). Конфликт —
 * только когда периоды заходят друг на друга: startA < endB && startB < endA.
 *
 * Архивные и отменённые записи не участвуют: они история.
 */

import { plateKeyFull } from '../../../../utils/plate';
export interface TripPeriodInput {
  id?: string | null;
  carNumber?: unknown;
  carId?: unknown;
  dateStart?: unknown;
  dateEnd?: unknown;
  /** Плановый период (если хранится отдельно от фактического). */
  planStart?: unknown;
  planEnd?: unknown;
  archived?: unknown;
  status?: unknown;
}

export interface TripConflict {
  kind: 'overlap' | 'active-open';
  /** Конфликтующий рейс: id и период для сообщения пользователю. */
  tripId: string;
  dateStart: string;
  dateEnd: string;
  /** Готовый текст сообщения. */
  message: string;
}

const normPlate = (v: unknown): string => plateKeyFull(v);

/** Дата (YYYY-MM-DD или ДД.ММ.ГГГГ / ДД/ММ/ГГГГ) → номер дня, иначе null. */
export const tripDayNum = (value: unknown): number | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Math.round(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000);
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (ru) return Math.round(Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])) / 86400000);
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
};

const isInactive = (rec: TripPeriodInput): boolean => {
  const status = String(rec.status ?? '').trim().toLowerCase();
  if (rec.archived === true || String(rec.archived ?? '').toLowerCase() === 'true') return true;
  return status === 'archive' || status === 'archived' || status === 'cancelled' || status === 'canceled' || status === 'отменён' || status === 'отменен';
};

/** Период рейса: сначала фактический, иначе плановый. Открытый период = без конца. */
export const tripRangeOf = (rec: TripPeriodInput): { start: number | null; end: number | null } => {
  const start = tripDayNum(rec.dateStart ?? rec.planStart);
  const end = tripDayNum(rec.dateEnd ?? rec.planEnd);
  return { start, end };
};

/** Тот же номер машины? Сравнение с учётом раскладки и разделителей. */
export const sameCar = (a: TripPeriodInput, b: TripPeriodInput): boolean => {
  const idA = String(a.carId ?? '').trim();
  const idB = String(b.carId ?? '').trim();
  if (idA && idB && idA === idB) return true;
  const plateA = normPlate(a.carNumber);
  const plateB = normPlate(b.carNumber);
  return Boolean(plateA) && plateA === plateB;
};

const fmtDay = (n: number | null): string => {
  if (n == null) return '—';
  const d = new Date(n * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

export const periodText = (rec: TripPeriodInput): string => {
  const { start, end } = tripRangeOf(rec);
  return `${fmtDay(start)} – ${end == null ? 'без даты возвращения' : fmtDay(end)}`;
};

/**
 * Конфликт нового/изменяемого рейса с уже существующими рейсами той же машины.
 * Возвращает первое найденное противоречие или null, если всё чисто.
 */
export const findTripPeriodConflict = (
  candidate: TripPeriodInput,
  existing: TripPeriodInput[],
  options?: { selfKey?: string | null },
): TripConflict | null => {
  const selfKey = String(options?.selfKey ?? candidate.id ?? '').trim();
  const cand = tripRangeOf(candidate);
  const car = String(candidate.carNumber ?? '').trim();
  const candidates = (existing || []).filter((rec) => {
    if (!rec) return false;
    if (selfKey && String(rec.id ?? '').trim() === selfKey) return false;
    if (isInactive(rec)) return false;
    return sameCar(candidate, rec);
  });

  for (const rec of candidates) {
    const other = tripRangeOf(rec);
    // Открытый СУЩЕСТВУЮЩИЙ рейс (нет даты возвращения): машина занята, второй
    // активный рейс запрещён — блокируем всё, что начинается не раньше его начала.
    if (other.start != null && other.end == null) {
      if (cand.start == null || cand.start >= other.start) {
        return {
          kind: 'active-open',
          tripId: String(rec.id ?? ''),
          dateStart: fmtDay(other.start),
          dateEnd: '',
          message: `У машины ${car || '—'} есть выполняемый рейс без даты возвращения (${periodText(rec)}). Пока он не закрыт, второй рейс этой машины создать нельзя.`,
        };
      }
      continue;
    }
    // Открытый НОВЫЙ рейс: он тянется в будущее — пересекается со всем, что
    // заканчивается не раньше его начала.
    if (cand.start != null && cand.end == null) {
      if (other.end == null || other.end >= cand.start) {
        return {
          kind: 'overlap',
          tripId: String(rec.id ?? ''),
          dateStart: fmtDay(other.start),
          dateEnd: fmtDay(other.end),
          message: `У машины ${car || '—'} уже есть рейс ${periodText(rec)}, а новый рейс без даты возвращения начинается ${fmtDay(cand.start)} — периоды пересекаются.`,
        };
      }
      continue;
    }
    if (cand.start == null || cand.end == null || other.start == null || other.end == null) {
      // Недостаточно данных для сравнения: не придумываем выводов, но и не
      // позволяем двум записям без дат занять машину одновременно.
      if (isInactive(rec) === false && (cand.start == null && other.start == null)) {
        return {
          kind: 'overlap',
          tripId: String(rec.id ?? ''),
          dateStart: '',
          dateEnd: '',
          message: `У машины ${car || '—'} уже есть рейс без периода — укажите даты, чтобы избежать наложения.`,
        };
      }
      continue;
    }
    // Обычное пересечение: день возвращения предыдущего рейса свободен для выезда.
    if (cand.start < other.end && other.start < cand.end) {
      return {
        kind: 'overlap',
        tripId: String(rec.id ?? ''),
        dateStart: fmtDay(other.start),
        dateEnd: fmtDay(other.end),
        message: `Машина ${car || '—'} занята: рейс ${periodText(rec)} пересекается с выбранным периодом ${fmtDay(cand.start)} – ${fmtDay(cand.end)}.`,
      };
    }
  }
  return null;
};

/** Все конфликты разом — для аудита существующих записей (не молча, а списком). */
export const collectCarConflicts = (trips: TripPeriodInput[]): TripConflict[] => {
  const out: TripConflict[] = [];
  const seen = new Set<string>();
  (trips || []).forEach((rec, idx) => {
    if (!rec || isInactive(rec)) return;
    const rest = (trips || []).filter((_, i) => i !== idx);
    const conflict = findTripPeriodConflict(rec, rest, { selfKey: String(rec.id ?? '') });
    if (conflict) {
      const key = [String(rec.id ?? ''), conflict.tripId].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        out.push(conflict);
      }
    }
  });
  return out;
};
