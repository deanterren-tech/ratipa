/**
 * Таймлайн ↔ источники: «План дохода» и «Учёт выезда».
 *
 * Полосы целых рейсов и периоды на базе СТРОЯТСЯ ИЗ ИСТОЧНИКОВ НА ЧТЕНИИ:
 *  - целый рейс из «Плана дохода» (tripsdashboard) — границы start/end, плечи,
 *    финансы; связь — стабильный id записи плана (`pd:<id>`);
 *  - период «На базе» и ремонт — из «Учёта выезда» (baza), связь `bz:<id>`;
 *  - этапы (промежуточные события) рейсов из плана — ветка
 *    tripTimeline/tripStages/<planId> (стабильная связь с источником).
 *
 * Копий-записей нет: повторное сохранение и перезагрузка не создают дубликаты,
 * смена авто переносит полосу, удаление источника убирает её, «бесхозных»
 * записей не бывает. Ручные рейсы модуля (tripTimeline/trips) живут отдельно
 * и не перезаписываются.
 *
 * Машины связываются через идентификатор общего справочника сцепок
 * (couplings.id → carId), текстовый номер используется только как резервный
 * поиск по справочнику — строки таймлайна ключуются стабильным carKey.
 */
import type { TimelineStage, TimelineTrip } from '../../../../types';
import {
  buildDispatcherDirectory,
  dispatcherDisplayName,
  resolveDispatcherId,
  type DispatcherDirectory,
} from '../../../../utils/dispatcher';
import { dayNum, normalizeStages, todayNum, type SpanOverride } from './timeline';
import { normalizeCircles } from './circles';
import { dedupeBazaRecords } from '../../baza/lib/bazaDedupe';

const normKey = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
const firstPart = (s: unknown): string => String(s ?? '').split('/')[0] || '';

/** Транслитерация для сопоставления номеров в разных раскладках (в справочнике
 *  сцепок номера хранятся латиницей, в плане дохода встречается кириллица). */
const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E',
};
const LAT_TO_CYR: Record<string, string> = Object.fromEntries(
  Object.entries(CYR_TO_LAT).map(([cyr, lat]) => [lat, cyr]),
);
const translit = (s: string, map: Record<string, string>): string =>
  s
    .split('')
    .map((ch) => map[ch] || ch)
    .join('');

/** Варианты ключа номера: как есть + латиница + кириллица. */
const keyVariants = (s: unknown): string[] => {
  const raw = String(s ?? '');
  const set = new Set<string>();
  [raw, translit(raw, CYR_TO_LAT), translit(raw, LAT_TO_CYR)].forEach((v) => {
    const k = normKey(v);
    if (k) set.add(k);
  });
  return Array.from(set);
};

/** Машина из единого справочника (сцепки → тягачи). */
export interface CarRef {
  /** couplings.id — стабильный идентификатор автомобиля. */
  carId: string;
  /** Человекочитаемый номер тягача. */
  carNumber: string;
  /** Стабильная связь с диспетчером (couplings.dispatcherId). */
  dispatcherId: string;
  dispatcherName: string;
}

export const carKeyOf = (carId: string | null | undefined, carNumber: string): string =>
  carId ? `car:${carId}` : `plate:${plateKeyOf(carNumber)}`;

/** Ключ номера для сопоставления (учитывает раскладку кириллица/латиница). */
export const plateKeyOf = (s: unknown): string => keyVariants(s)[0] || '';

/** Индекс автомобилей по вариантам номера и id (для резервного поиска). */
export const buildCarIndex = (couplingsFlat: Array<Record<string, unknown>>): Map<string, CarRef> => {
  const index = new Map<string, CarRef>();
  const add = (keys: string[], car: CarRef) => {
    keys.forEach((key) => {
      if (key && !index.has(key)) index.set(key, car);
    });
  };
  (couplingsFlat || []).forEach((c) => {
    const carId = String(c.couplingId || c.id || '');
    const carNumber = String(c.carNumber || c.vehicleNumbers || carId);
    if (!carNumber && !carId) return;
    const car: CarRef = {
      carId,
      carNumber,
      dispatcherId: String(c.dispatcherId || ''),
      dispatcherName: String(c.dispatcherName || c.dispatcher || ''),
    };
    add(keyVariants(carId), car);
    add(keyVariants(carNumber), car);
    add(keyVariants(firstPart(carNumber)), car);
  });
  return index;
};

/** Резервный поиск машины по тексту номера (с учётом раскладки и первой части сцепки). */
export const resolveCarForText = (index: Map<string, CarRef>, text: string): CarRef | null => {
  for (const key of [...keyVariants(text), ...keyVariants(firstPart(text))]) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
};

/** Уникальные машины справочника (для строк «без рейсов в периоде»). */
export const uniqueFleetCars = (index: Map<string, CarRef>): CarRef[] => {
  const seen = new Set<string>();
  const out: CarRef[] = [];
  index.forEach((car) => {
    const key = car.carId || car.carNumber;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(car);
  });
  return out;
};

// ---------------------------------------------------------------------------
// Целые рейсы из «Плана дохода»
// ---------------------------------------------------------------------------

export interface PlanLegInfo {
  from: string;
  to: string;
  km: number;
  rate?: number;
  freight?: number;
}

export interface PlanTripInfo {
  /** id исходной записи плана дохода. */
  id: string;
  direction?: string;
  month?: string;
  days?: number;
  totalKm?: number;
  factKm?: number;
  totalFreight?: number;
  profit?: number;
  profitFact?: number;
  note?: string;
  legs: PlanLegInfo[];
  isArchived?: boolean;
  /** Запись создана формой таймлайна и ещё не заполнена («Требует заполнения»). */
  needsFill?: boolean;
}

/**
 * Скрытый на таймлайне дубль (поле `hiddenFromTimeline` в исходной записи
 * «Плана дохода»): запись не удаляется и остаётся видимой в самом «Плане
 * дохода», но на таймлайне не участвует в полосах/счётчиках/конфликтах.
 */
export interface HiddenTripInfo {
  /** Причина скрытия из источника (`hiddenReason`), как записана в данных. */
  reason: string;
  hiddenAt?: string;
  hiddenBy?: string;
  /** Основная (живая) запись — по `duplicateOf` из источника, если найден (данные не выдумываются). */
  duplicate?: { key: string; id: string; carNumber: string; dateStart: string; dateEnd: string; archived: boolean };
}

/** Целый рейс таймлайна: ручной рейс модуля либо рейс, связанный с планом. */
export interface WholeTrip extends TimelineTrip {
  /** manual — ручной рейс модуля; plan — целый рейс из «Плана дохода». */
  kind: 'manual' | 'plan';
  /** Стабильный ключ таймлайна: `tl:<id>` | `pd:<id>`. */
  key: string;
  /** Ключ строки машины (carKeyOf по справочнику). */
  carKey: string;
  /** Плановая информация плана дохода (для карточки, без выдуманных значений). */
  plan?: PlanTripInfo;
  /** Исходная запись «Плана дохода» (для правок плановых дат через существующий сервис). */
  planRaw?: Record<string, unknown>;
  /** Границы заданы источником — на таймлайне не редактируются. */
  readOnlyDates?: boolean;
  /** В плане нет даты возвращения (показываем неполный план, дату не выдумываем). */
  openPlan?: boolean;
  /** Переопределение плановых границ (из плана дохода). */
  spanOverride?: SpanOverride;
  /**
   * План создан формой таймлайна и потому может быть в состоянии «Черновик
   * плана»: только для таких записей маркер planGuard.draftCreated учитывается
   * контролем плана (у заполненных реальных рейсов он не даёт бесплатную правку).
   */
  planDraftFromTimeline?: boolean;
  /** Запись помечена в источнике `hiddenFromTimeline` — дубль, скрытый на таймлайне. */
  hiddenFromTimeline?: boolean;
  /** Для скрытого дубля: причина и основная запись (см. HiddenTripInfo). */
  hiddenInfo?: HiddenTripInfo;
  /** Понятные предупреждения по данным (конфликты не исправляются автоматически). */
  warnings: string[];
  /**
   * Количество кругов рейса — поле ЗАПИСИ рейса («circles»): у связанных
   * рейсов это trips_dashboard/<planId>, у ручных — tripTimeline/trips.
   * Отсутствие поля = 1 (миграция без пересчёта, lib/circles.normalizeCircles).
   */
  circles: number;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const parseLegs = (raw: unknown): PlanLegInfo[] => {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return (list as Array<Record<string, unknown>>)
    .filter((l) => l && typeof l === 'object')
    .map((l) => ({
      from: String(l.from || ''),
      to: String(l.to || ''),
      km: num(l.km) ?? num(l.distance) ?? 0,
      rate: num(l.rate),
      freight: num(l.freight),
    }))
    .filter((l) => l.from || l.to);
};

/** Рейсы из «Плана дохода» → целые рейсы таймлайна (идемпотентно, без записей).
 *  Записи с `hiddenFromTimeline` помечаются (hiddenFromTimeline/hiddenInfo) и НЕ
 *  отбрасываются здесь — вызывающий слой (useTimelineData) исключает их из
 *  таймлайна, оставляя доступными для плашки при прямом открытии. */
export const planTripsToWholeTrips = (
  planTrips: Array<Record<string, unknown>>,
  carIndex: Map<string, CarRef>,
  dir: DispatcherDirectory,
  stagesStore: Record<string, Record<string, unknown>>,
): WholeTrip[] => {
  const list = (planTrips || []).filter((rec) => rec && typeof rec === 'object' && rec.id);
  const byId = new Map(list.map((rec) => [String(rec.id), rec]));
  return list
    .map((rec) => {
      const id = String(rec.id);
      const carNumberText = String(rec.carNumber || '');
      const car = resolveCarForText(carIndex, carNumberText);
      const ownDispatcherId = resolveDispatcherId(rec, dir);
      const displayName = dispatcherDisplayName(rec, dir);
      const dispatcherId = ownDispatcherId || car?.dispatcherId || '';
      const dispatcherName =
        (dispatcherId && dir.byId.get(dispatcherId)?.name) ||
        (displayName && displayName !== '—' ? displayName : '') ||
        car?.dispatcherName ||
        '';
      const startIso = String(rec.dateStart || '');
      const endIso = String(rec.dateEnd || '');
      const pMin = dayNum(startIso);
      const pMax = dayNum(endIso);
      const warnings: string[] = [];
      if (!car) warnings.push('Автомобиль плана не найден в справочнике — строка показана по тексту плана');
      if (pMin == null) warnings.push('В плане не указана дата старта — полоса рейса не строится');
      if (pMin != null && pMax == null) warnings.push('В плане не указана дата возвращения — показан неполный план');
      if (pMin != null && pMax != null && pMax < pMin) warnings.push('Дата возвращения в плане раньше старта — проверьте план дохода');
      // Дубль, скрытый на таймлайне: флаг и основная запись — из источника, без выдумывания.
      const hiddenFromTimeline = rec.hiddenFromTimeline === true;
      const dupRec = hiddenFromTimeline && rec.duplicateOf ? byId.get(String(rec.duplicateOf)) : undefined;
      const hiddenInfo: HiddenTripInfo | undefined = hiddenFromTimeline
        ? {
            reason: rec.hiddenReason ? String(rec.hiddenReason) : '',
            hiddenAt: rec.hiddenAt ? String(rec.hiddenAt) : undefined,
            hiddenBy: rec.hiddenBy ? String(rec.hiddenBy) : undefined,
            duplicate: dupRec
              ? {
                  key: `pd:${String(dupRec.id)}`,
                  id: String(dupRec.id),
                  carNumber: String(dupRec.carNumber || ''),
                  dateStart: String(dupRec.dateStart || ''),
                  dateEnd: String(dupRec.dateEnd || ''),
                  archived: dupRec.isArchived === true,
                }
              : undefined,
          }
        : undefined;
      const trip: WholeTrip = {
        id: `pd:${id}`,
        kind: 'plan',
        key: `pd:${id}`,
        carKey: carKeyOf(car?.carId || '', car?.carNumber || carNumberText),
        carNumber: car?.carNumber || carNumberText,
        route: String(rec.direction || rec.tripNote || ''),
        dispatcherId,
        dispatcherName,
        bufferDays: 0,
        archived: rec.isArchived === true,
        createdAt: '',
        updatedAt: '',
        stages: normalizeStages(stagesStore[id] || {}),
        readOnlyDates: true,
        openPlan: pMin != null && pMax == null,
        spanOverride: { pMin, pMax },
        planRaw: rec,
        // Круги рейса — поле записи «Плана дохода» (отсутствие = 1, миграция
        // без пересчёта; правило единое — lib/circles).
        circles: normalizeCircles(rec.circles),
        // Черновик формы таймлайна (маркер planGuard.draftCreated действителен):
        // запись создана «Новым рейсом» и ещё «Требует заполнения».
        planDraftFromTimeline: rec.createdFrom === 'timeline' || rec.needsFill === true,
        hiddenFromTimeline,
        hiddenInfo,
        warnings,
        plan: {
          id,
          direction: rec.direction ? String(rec.direction) : undefined,
          month: rec.currentMonth ? String(rec.currentMonth) : undefined,
          days: num(rec.days),
          totalKm: num(rec.totalKm),
          factKm: num(rec.factKm),
          totalFreight: num(rec.totalFreight),
          profit: num(rec.profit),
          profitFact: num(rec.profitFact),
          note: rec.tripNote ? String(rec.tripNote) : undefined,
          legs: parseLegs(rec.legs),
          isArchived: rec.isArchived === true,
          needsFill: rec.needsFill === true,
        },
      };
      return trip;
    })
    // Рейс без старта не может дать полосу, но остаётся в обзоре машины
    .filter((t) => !(t.warnings.some((w) => w.includes('не указана дата старта')) && t.stages.length === 0));
};

// ---------------------------------------------------------------------------
// Периоды «Учёта выезда»: база и ремонт
// ---------------------------------------------------------------------------

export interface BasePeriod {
  id: string;
  key: string; // bz:<id>
  carKey: string;
  carId: string;
  carNumber: string;
  dispatcherId: string;
  dispatcherName: string;
  arrivalDay: number | null;
  departureDay: number | null;
  repairStartDay: number | null;
  repairEndDay: number | null;
  /** dateLoading («Готовность») — плановая подсказка, показывается на подстроке «План». */
  plannedReadyDay: number | null;
  causeLabel: string;
  causeKind: 'repair' | 'wait' | 'base';
  comment: string;
  archived: boolean;
  openBase: boolean;
  openRepair: boolean;
  /** Выезд указан, а окончание ремонта нет: ремонт показываем до выезда с пометкой. */
  repairCappedByDeparture: boolean;
  warnings: string[];
}

const causeOf = (rec: Record<string, unknown>): { label: string; kind: BasePeriod['causeKind'] } => {
  const status = String(rec.status || '');
  if (status === 'repair') return { label: 'Ремонт', kind: 'repair' };
  if (status === 'loading') return { label: 'Ожидание', kind: 'wait' };
  return { label: 'На базе', kind: 'base' };
};

/** Записи «Учёта выезда» → периоды базы и ремонта (идемпотентно, без записей).
 *  Дубли активных записей (одна машина + один приезд) схлопываются по
 *  стабильному ключу «машина + период + класс» (lib/bazaDedupe) — на таймлайне
 *  показывается та же единственная запись, что и в модуле «Учёт выезда»;
 *  данные в базе не изменяются (список для очистки — в отчёте, удаление
 *  только с подтверждением владельца). */
export const bazaToBasePeriods = (
  baza: Array<Record<string, unknown>>,
  carIndex: Map<string, CarRef>,
  dir: DispatcherDirectory,
): BasePeriod[] => {
  const rawRecords: Array<Record<string, unknown> & { id: string }> = (baza || [])
    .filter((rec) => rec && typeof rec === 'object')
    .map((rec) => ({ ...rec, id: String(rec.id || '') }));
  const deduped = dedupeBazaRecords(rawRecords).kept;
  return deduped
    .map((rec) => {
      const id = String(rec.id || '');
      const carNumberText = String(rec.carNumber || '');
      const explicitCarId = String(rec.carId || rec.couplingId || '');
      const car =
        (explicitCarId ? carIndex.get(normKey(explicitCarId)) : undefined) ||
        resolveCarForText(carIndex, carNumberText);
      const dispatcherId = car?.dispatcherId || '';
      const dispatcherName = car?.dispatcherName || (dispatcherId && dir.byId.get(dispatcherId)?.name) || '';
      const arrival = dayNum(String(rec.dateArrival || ''));
      const departure = dayNum(String(rec.dateDeparture || ''));
      const repairStart = dayNum(String(rec.dateRepairStart || ''));
      const repairEnd = dayNum(String(rec.dateRepairEnd || ''));
      const plannedReady = dayNum(String(rec.dateLoading || ''));
      const warnings: string[] = [];
      if (arrival == null && departure == null && repairStart == null) {
        warnings.push('В записи учёта выезда нет дат — период не строится');
      }
      if (arrival != null && departure != null && departure < arrival) {
        warnings.push('Фактический выезд раньше приезда — проверьте учёт выезда');
      }
      if (arrival == null && departure != null) warnings.push('Нет даты приезда — период на базе показан по неполным данным');
      if (arrival != null && departure == null) warnings.push('Выезд не указан — период на базе открыт');
      if (arrival != null && plannedReady != null && plannedReady < arrival) {
        warnings.push('Срок готовности раньше приезда — проверьте учёт выезда');
      }
      if (repairEnd != null && repairStart == null) warnings.push('Окончание ремонта без начала — сегмент не строится');
      if (repairStart != null && repairEnd != null && repairEnd < repairStart) warnings.push('Окончание ремонта раньше начала — проверьте учёт выезда');
      if (
        repairStart != null &&
        ((arrival != null && repairStart < arrival) ||
          (departure != null && repairStart > departure))
      ) {
        warnings.push('Ремонт вне периода на базе — проверьте даты учёта выезда');
      }
      if (repairStart != null && repairEnd == null && departure != null) {
        warnings.push('Выезд указан, а ремонт не закрыт — данные неполные');
      }
      const cause = causeOf(rec);
      return {
        id,
        key: `bz:${id}`,
        carKey: carKeyOf(car?.carId || explicitCarId, car?.carNumber || carNumberText),
        carId: car?.carId || explicitCarId,
        carNumber: car?.carNumber || carNumberText,
        dispatcherId,
        dispatcherName,
        arrivalDay: arrival,
        departureDay: departure,
        repairStartDay: repairStart,
        repairEndDay: repairEnd,
        plannedReadyDay: plannedReady,
        causeLabel: cause.label,
        causeKind: cause.kind,
        comment: String(rec.comment || ''),
        archived: rec.isArchived === true || String(rec.status || '') === 'archive',
        openBase: arrival != null && departure == null,
        openRepair: repairStart != null && repairEnd == null && departure == null,
        repairCappedByDeparture: repairStart != null && repairEnd == null && departure != null,
        warnings,
      } satisfies BasePeriod;
    })
    .filter((p) => p.arrivalDay != null || p.departureDay != null || p.repairStartDay != null);
};

/** ПЛАН периода на базе: приезд → СРОК ГОТОВНОСТИ (dateLoading). Это плановая
 *  конечная точка базы, НЕ окончание ремонта; без срока полосу не рисуем. */
export const readyBarRange = (p: BasePeriod): { a: number; b: number } | null => {
  if (p.arrivalDay == null || p.plannedReadyDay == null) return null;
  return { a: p.arrivalDay, b: Math.max(p.arrivalDay, p.plannedReadyDay) };
};

/** Отклонение фактического выезда от срока готовности — словами, без вымысла.
 *  Сравниваются календарные дни (в полях только даты). */
export interface BaseDeviation {
  kind: 'on' | 'early' | 'late' | 'no-plan' | 'no-fact' | 'overdue' | 'incomplete';
  /** Разница в днях (выезд − срок готовности); null если сравнивать нечего. */
  days: number | null;
  label: string;
  /** Компактная подпись для полосы, если позволяет ширина. */
  short: string;
}

export const baseDeviation = (p: BasePeriod, today: number): BaseDeviation => {
  const ready = p.plannedReadyDay;
  const dep = p.departureDay;
  if (p.arrivalDay == null && ready == null && dep == null) {
    return { kind: 'incomplete', days: null, label: 'Неполные данные', short: '' };
  }
  if (p.arrivalDay == null) {
    // Полную полосу базы без начала не выдумываем; сравнение сроков допустимо
    if (ready != null && dep != null) {
      const diff = dep - ready;
      return {
        kind: diff === 0 ? 'on' : diff > 0 ? 'late' : 'early',
        days: diff,
        label: `Нет даты приезда — неполные данные; выезд ${diff === 0 ? 'в срок готовности' : diff > 0 ? `позже срока готовности на ${diff} дн` : `раньше срока готовности на ${-diff} дн`}`,
        short: '',
      };
    }
    return { kind: 'incomplete', days: null, label: 'Нет даты приезда — неполные данные', short: '' };
  }
  if (ready == null) {
    return {
      kind: 'no-plan',
      days: null,
      label: dep != null ? 'Срок готовности не указан; фактический выезд указан' : 'Срок готовности не указан',
      short: 'срок готовности не указан',
    };
  }
  if (dep == null) {
    const overdue = ready < today;
    return {
      kind: overdue ? 'overdue' : 'no-fact',
      days: null,
      label: overdue
        ? 'Срок готовности прошёл, фактический выезд не указан'
        : 'Фактический выезд не указан (срок готовности ещё не наступил)',
      short: overdue ? 'выезд не указан' : 'ожидается',
    };
  }
  const diff = dep - ready;
  if (diff === 0) return { kind: 'on', days: 0, label: 'Выезд по плану', short: 'по плану' };
  return {
    kind: diff > 0 ? 'late' : 'early',
    days: diff,
    label: diff > 0 ? `Выезд позже срока готовности на ${diff} дн` : `Выезд раньше срока готовности на ${-diff} дн`,
    short: `${diff > 0 ? '+' : '−'}${Math.abs(diff)} дн`,
  };
};
export const baseBarRange = (p: BasePeriod, today: number): { a: number; b: number; open: boolean } | null => {
  const a = p.arrivalDay;
  if (a == null) return null;
  const dep = p.departureDay;
  if (dep == null) return { a, b: Math.max(today, a), open: true };
  if (dep < a) return { a, b: a, open: false };
  return { a, b: dep, open: false };
};

/** Период ремонта для отрисовки (открытый — до сегодня/выезда, дату не подставляем). */
export const repairBarRange = (
  p: BasePeriod,
  today: number,
): { a: number; b: number; open: boolean; capped: boolean } | null => {
  const a = p.repairStartDay;
  if (a == null) return null;
  const end = p.repairEndDay;
  if (end == null) {
    if (p.departureDay != null) {
      return { a, b: Math.max(p.departureDay, a), open: false, capped: true };
    }
    return { a, b: Math.max(today, a), open: true, capped: false };
  }
  if (end < a) return { a, b: a, open: false, capped: false };
  return { a, b: end, open: false, capped: false };
};

// ---------------------------------------------------------------------------
// Конфликты дат (предупреждения, без автоисправлений)
// ---------------------------------------------------------------------------

/**
 * Проверки пересечений в группе машины: рейс ↔ база, база ↔ ремонт уже проверены
 * выше; здесь — только то, что видно по интервалам. Ничего не двигаем и не чиним.
 */
export const collectCarConflicts = (
  trips: WholeTrip[],
  bases: BasePeriod[],
  today: number,
): string[] => {
  const out: string[] = [];
  trips.forEach((t) => {
    t.warnings.forEach((w) => out.push(w));
    const ov = t.spanOverride || {};
    const ts = ov.pMin ?? null;
    const te = ov.pMax ?? null;
    if (ts != null && te != null) {
      bases.forEach((p) => {
        const r = baseBarRange(p, today);
        if (!r) return;
        if (ts <= r.b && te >= r.a) {
          out.push(`Рейс ${t.route || t.key} пересекается с периодом на базе (${p.key}) — проверьте даты`);
        }
      });
    }
  });
  bases.forEach((p) => p.warnings.forEach((w) => out.push(w)));
  return Array.from(new Set(out));
};
