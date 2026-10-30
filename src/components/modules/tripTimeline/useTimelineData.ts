/**
 * Подписки и сборка модели модуля «Таймлайн рейсов по машинам».
 *
 * Источники (все — существующие ветки портала, читаются через dbService
 * и никуда не копируются):
 *  - «План дохода» (tripsdashboard) → целые рейсы: границы, плечи, финансы;
 *  - «Учёт выезда» (baza) → периоды на базе и ремонт;
 *  - ручные рейсы модуля (tripTimeline/trips) → отдельные целые рейсы модуля;
 *  - этапы рейсов из плана (tripTimeline/tripStages/<planId>) → промежуточные
 *    события, привязанные к конкретному рейсу;
 *  - события машины (tripTimeline/vehicleEvents) — сохранены как есть;
 *  - справочник сцепок (couplings) — машины и их диспетчеры (стабильные id);
 *  - справочник типов этапов (tripTimeline/config/stageTypes);
 *  - города — из существующего справочника расстояний портала
 *    (knownDistancesList): подсказки в поле «Место», свободный ввод не ограничен.
 */
import { useEffect, useMemo, useState } from 'react';
import { dbService, directoryService } from '../../../api';
import { getCouplingsFlat } from '../../../services/fleetService';
import { buildDispatcherDirectory, type DispatcherDirectory } from '../../../utils/dispatcher';
import type { TimelineStageType, TimelineTrip, TimelineVehicleEvent } from '../../../types';
import { dayNum, normalizeStages, withFallbackStages } from './lib/timeline';
import {
  buildDispatcherFacts,
  carPartOf,
  fillRecordDispatchers,
  pickDispatcher,
  resolveDispatcherFor,
  vehicleKeyVariants,
} from './lib/vehicleDispatcher';
import { effectiveStageTypes } from './lib/catalog';
import { normalizeCircles } from './lib/circles';
import { mergeDirections, type DirectionDef } from './lib/directions';
import { directionOptionsFromDb, effectiveDirectionOptions, type DirectionOption } from './lib/directionCatalog';
import { effectiveStageTemplates, stageTemplatesFromDb, type StageTemplate } from './lib/stageTemplates';
import {
  bazaToBasePeriods,
  buildCarIndex,
  carKeyOf,
  planTripsToWholeTrips,
  resolveCarForText,
  uniqueFleetCars,
  type BasePeriod,
  type CarRef,
  type WholeTrip,
} from './lib/sources';
import { plateKeyFull } from '../../../utils/plate';

export interface DispatcherOption {
  id: string;
  name: string;
}

export interface TimelineData {
  /** Целые рейсы: ручные + из «Плана дохода» (порядок: ручные, затем планы).
   *  Записи с `hiddenFromTimeline` сюда НЕ попадают — ни в полосы, ни в
   *  счётчики, ни в конфликты таймлайна («План дохода» их по-прежнему видит). */
  trips: WholeTrip[];
  /** Скрытые дубли (hiddenFromTimeline в источнике): только для прямого открытия
   *  карточки (deep link) с плашкой; в таймлайне не участвуют. */
  hiddenTrips: WholeTrip[];
  /** Периоды «Учёт выезда»: база и ремонт. */
  bases: BasePeriod[];
  /** События машины (ручные, ветка модуля). */
  events: TimelineVehicleEvent[];
  /** Все машины справочника (для строк «нет рейсов в периоде»). */
  fleetCars: CarRef[];
  /** Диспетчеры — тот же источник, что у «Плана дохода» (users_list.isDispatcher). */
  dispatchers: DispatcherOption[];
  /** Эффективный справочник типов этапов (из базы либо встроенный). */
  stageTypes: TimelineStageType[];
  /** Города из справочника расстояний (подсказки для свободного поля «Место»). */
  cities: string[];
  /** Направления (Турция, Китай и добавленные пользователем): встроенные + справочник. */
  directions: DirectionDef[];
  /**
   * Варианты переключателя направления из справочника Настроек
   * (`directories/directions`: Турция TR, Китай CN; при пустом справочнике —
   * встроенная пара). Никаких ставок/дней — упрощено по требованию владельца.
   */
  directionOptions: DirectionOption[];
  /**
   * Шаблоны этапов (ветка `stageTemplates`): упорядоченные списки НАЗВАНИЙ
   * этапов. Кнопка «Из шаблона» в окне рейса; при пустой ветке — стартовые
   * «Турция»/«Китай» (по факту рейсов, lib/stageTemplates).
   */
  stageTemplates: StageTemplate[];
}

const plateKey = (value: unknown): string => plateKeyFull(value);

/**
 * Диспетчер из связанной записи «Плана дохода».
 *
 * Первопричина жалобы «машина потеряла диспетчера»: у ручного рейса таймлайна
 * собственного диспетчера нет, карточка машины в парке тоже может быть без
 * назначения — и рейс показывался «без диспетчера», хотя в связанном плане
 * дохода диспетчер есть (план — достоверный источник назначения).
 *
 * Берём назначение только при ОДНОЗНАЧНОМ соответствии: по одному номеру
 * машины может быть несколько планов, поэтому в индекс попадают лишь машины,
 * у которых все планы указывают одного диспетчера. Иначе — не угадываем.
 */
const CYR2LAT: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E' };
const LAT2CYR: Record<string, string> = Object.fromEntries(Object.entries(CYR2LAT).map(([c, l]) => [l, c]));
/** Варианты ключа номера: как есть, латиницей и кириллицей (раскладка клавиатуры). */
const plateKeys = (value: unknown): string[] => {
  const raw = String(value || '');
  return [...new Set([raw, [...raw].map((ch) => CYR2LAT[ch] || ch).join(''), [...raw].map((ch) => LAT2CYR[ch] || ch).join('')].map(plateKey).filter(Boolean))];
};

/**
 * Плановое назначение по машине (совместимость с прежним интерфейсом).
 *
 * Раньше здесь была оставлена только машина, у которой ВСЕ планы указывают
 * одного диспетчера; из-за этого машина с историей назначений (8806: Юрий →
 * Максим) оставалась без диспетчера вообще. Теперь назначение выбирается по
 * дате (см. lib/vehicleDispatcher), а идентификатор выводится из имени.
 */
const buildPlanDispatcherIndex = (
  plans: Array<Record<string, unknown>>,
  dir: DispatcherDirectory,
  cars: Array<Record<string, unknown>> = [],
): Map<string, { id: string; name: string }> => {
  const facts = buildDispatcherFacts({ plans, cars, dir });
  const result = new Map<string, { id: string; name: string }>();
  facts.forEach((list, key) => {
    const picked = pickDispatcher(list, null);
    if (picked) result.set(key, { id: picked.id, name: picked.name });
  });
  return result;
};

/**
 * Справочник «машина → диспетчер» (`dispatchers_car_mapping`) — назначение
 * ведётся людьми и является источником истины. Ключи сравниваем с учётом
 * раскладки: в справочнике «АО 8806-7», в рейсе бывает «AO 8806-7» — раньше
 * из-за этого рейс показывался «без диспетчера».
 */
const buildDirectoryDispatcherIndex = (mapping: Record<string, string>): Map<string, string> => {
  const index = new Map<string, string>();
  Object.entries(mapping || {}).forEach(([plate, name]) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    plateKeys(plate).forEach((key) => index.set(key, clean));
  });
  return index;
};

const normalizeManualTrip = (
  raw: TimelineTrip,
  carIndex: Map<string, CarRef>,
  dir: DispatcherDirectory,
  planDispatchers?: Map<string, { id: string; name: string }>,
  directoryDispatchers?: Map<string, string>,
): WholeTrip => {
  const stages = normalizeStages(raw.stages);
  const withStages = withFallbackStages({
    ...raw,
    carNumber: raw.carNumber || '',
    route: raw.route || '',
    bufferDays: Number(raw.bufferDays) || 0,
    archived: raw.archived === true,
    stages,
  });
  // Карточка машины из справочника парка: ищем по нормализованному номеру в трёх
  // раскладках (в данных 8806 встречается и «АО 8806-7», и «AO 8806-7», и «АО8806-7» —
  // из-за этого карточка не находилась и рейс показывался «без диспетчера»).
  const car =
    (raw.vehicleId ? carIndex.get(plateKey(raw.vehicleId)) : undefined) ||
    plateKeys(raw.vehicleId || raw.carNumber || '').map((k) => carIndex.get(k)).find(Boolean) ||
    resolveCarForText(carIndex, raw.carNumber || '');
  // Поле диспетчера НИКОГДА не затирается пустым: своя запись → карточка
  // машины → однозначное назначение из связанного плана дохода → справочник.
  const plateLookup = plateKeys(raw.carNumber || car?.carNumber || '');
  const directoryName = plateLookup.map((k) => directoryDispatchers?.get(k)).find(Boolean) || '';
  const planDispatcher = plateLookup.map((k) => planDispatchers?.get(k)).find(Boolean);
  // Своя запись → справочник «машина → диспетчер» → карточка парка → связанный
  // план дохода → имя по id из справочника диспетчеров. Пустое значение НЕ
  // затирает уже существующее назначение.
  const dispatcherId = raw.dispatcherId || car?.dispatcherId || planDispatcher?.id || (directoryName ? '' : '') || '';
  const dispatcherName =
    raw.dispatcherName || directoryName || car?.dispatcherName || planDispatcher?.name || (dispatcherId && dir.byId.get(dispatcherId)?.name) || '';
  // Плановые границы ручного рейса: если в записи есть собственные startDate/
  // endDate (например, отредактированы в окне таймлайна), они показываются как
  // границы плана; этапы при этом не двигаются автоматически.
  const explicitStart = dayNum(String(raw.startDate || ''));
  const explicitEnd = dayNum(String(raw.endDate || ''));
  const spanOverride =
    explicitStart != null && explicitEnd != null
      ? { pMin: explicitStart, pMax: explicitEnd }
      : undefined;
  return {
    ...withStages,
    kind: 'manual',
    key: `tl:${raw.id}`,
    carKey: carKeyOf(car?.carId || raw.vehicleId || '', car?.carNumber || raw.carNumber || ''),
    carNumber: car?.carNumber || raw.carNumber || '',
    dispatcherId,
    dispatcherName,
    planDraftFromTimeline: true,
    spanOverride,
    // Круги ручного рейса — поле его собственной записи (отсутствие = 1).
    circles: normalizeCircles(raw.circles),
    warnings: [],
  };
};

export function useTimelineData(): TimelineData {
  const [manualTrips, setManualTrips] = useState<TimelineTrip[]>([]);
  const [planTrips, setPlanTrips] = useState<Array<Record<string, unknown>>>([]);
  const [baza, setBaza] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<TimelineVehicleEvent[]>([]);
  const [couplings, setCouplings] = useState<Array<Record<string, unknown>>>([]);
  const [stagesStore, setStagesStore] = useState<Record<string, Record<string, unknown>>>({});
  const [dispatchers, setDispatchers] = useState<DispatcherOption[]>([]);
  const [dbStageTypes, setDbStageTypes] = useState<TimelineStageType[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [dbDirections, setDbDirections] = useState<Array<Record<string, unknown>>>([]);
  /** Записи справочника `directories/directions` — варианты переключателя. */
  const [dbDirectionList, setDbDirectionList] = useState<Array<Record<string, unknown>>>([]);
  /** Ветка `stageTemplates` — шаблоны этапов (как есть из базы). */
  const [dbStageTemplates, setDbStageTemplates] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    const u1 = dbService.getTimelineTrips((list) => setManualTrips(list || []));
    const u2 = dbService.getVehicleEvents((list) => setEvents(list || []));
    const u3 = directoryService.getDispatchersObjects((list) => {
      setDispatchers(
        (list || [])
          .filter((d) => d && d.name)
          .map((d) => ({ id: String(d.id || d.name), name: String(d.name) })),
      );
    });
    const u4 = dbService.getTimelineStageTypes((list) => setDbStageTypes(list || []));
    const u5 = dbService.getDistances((list) => {
      // Города для подсказок поля «Место» — из существующего справочника
      // расстояний (knownDistancesList), без отдельного справочника.
      const set = new Set<string>();
      (list || []).forEach((d) => {
        if (!d) return;
        if (d.from) set.add(String(d.from).trim());
        if (d.to) set.add(String(d.to).trim());
      });
      setCities(Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru')));
    });
    // Источники: «План дохода» (рабочая ветка trips_dashboard) и «Учёт выезда»
    const u6 = dbService.getPlanDohodTrips((list) => setPlanTrips((list || []) as unknown as Array<Record<string, unknown>>));
    const u7 = dbService.getBazaRecords((list) => setBaza((list || []) as unknown as Array<Record<string, unknown>>));
    // Единая база сцепок: машины и их диспетчеры (стабильные id)
    const u8 = getCouplingsFlat((list) => setCouplings((list || []) as Array<Record<string, unknown>>));
    // Этапы рейсов, связанных с планом дохода
    const u9 = dbService.getTimelineTripStages((store) => setStagesStore(store || {}));
    // Единый справочник направлений «Плана дохода» (directories/directions) —
    // варианты переключателя рейса; ветка tripDirections — только цвета.
    const u10 = directoryService.getTripDirections((list) => setDbDirections((list || []) as Array<Record<string, unknown>>));
    // Справочник направлений (directories/directions) — ЕДИНЫЙ список: и
    // варианты переключателя, и метки/фильтр на полотне (ставок там нет).
    const u11 = directoryService.getDirections((list) => setDbDirectionList((list || []) as Array<Record<string, unknown>>));
    // Шаблоны этапов (кнопка «Из шаблона»; управление — Настройки).
    const u12 = dbService.getStageTemplates((store) => setDbStageTemplates(store || {}));
    return () => {
      if (typeof u1 === 'function') u1();
      if (typeof u2 === 'function') u2();
      if (typeof u3 === 'function') u3();
      if (typeof u4 === 'function') u4();
      if (typeof u5 === 'function') u5();
      if (typeof u6 === 'function') u6();
      if (typeof u7 === 'function') u7();
      if (typeof u8 === 'function') u8();
      if (typeof u9 === 'function') u9();
      if (typeof u10 === 'function') u10();
      if (typeof u11 === 'function') u11();
      if (typeof u12 === 'function') u12();
    };
  }, []);

  const carIndex = useMemo(() => buildCarIndex(couplings), [couplings]);
  const dir = useMemo(() => buildDispatcherDirectory(dispatchers.map((d) => ({ id: d.id, name: d.name }))), [dispatchers]);
  /** Факты назначения по всем источникам: карточки парка, справочник, планы. */
  const dispatcherFacts = useMemo(
    () => buildDispatcherFacts({ plans: planTrips, cars: couplings, dir }),
    [planTrips, couplings, dir],
  );

  /**
   * Индекс машин с ДОПОЛНЕННЫМ идентификатором диспетчера: в карточках парка
   * назначение часто хранится только именем — без идентификатора строка
   * таймлайна уходила в блок «Без диспетчера» (жалоба владельца по 8806).
   * Пустое значение никогда не затирается.
   */
  const fleetIndex = useMemo(() => {
    const resolved = new Map<string, CarRef>();
    carIndex.forEach((car, key) => {
      const next: CarRef = { ...car };
      if (!String(next.dispatcherId || '').trim() && String(next.dispatcherName || '').trim()) {
        const person = resolveDispatcherFor(
          { facts: dispatcherFacts, dir },
          { keys: vehicleKeyVariants(next.carNumber), day: null, ownName: next.dispatcherName },
        );
        if (person.id) next.dispatcherId = person.id;
        if (person.name && !next.dispatcherName) next.dispatcherName = person.name;
      }
      resolved.set(key, next);
    });
    return resolved;
  }, [carIndex, dispatcherFacts, dir]);

  const fleetCars = useMemo(() => uniqueFleetCars(fleetIndex), [fleetIndex]);

  const tripsAll = useMemo(() => {
    const planDispatcherIndex = buildPlanDispatcherIndex(planTrips, dir, couplings);
    const manual = manualTrips.map((t) => normalizeManualTrip(t, fleetIndex, dir, planDispatcherIndex));
    const fromPlan = planTripsToWholeTrips(planTrips, fleetIndex, dir, stagesStore);
    // Единый досчёт диспетчера для рейсов: своё поле → карточка → план по дате.
    fillRecordDispatchers([...manual, ...fromPlan], { facts: dispatcherFacts, dir }, {
      keysOf: (t) => [...vehicleKeyVariants(String(t.carKey || '').replace(/^(car|plate):/, '')), ...vehicleKeyVariants(t.carNumber)],
      dayOf: (t) => t.spanOverride?.pMin ?? t.spanOverride?.pMax ?? null,
    });
    return [...manual, ...fromPlan];
  }, [manualTrips, planTrips, fleetIndex, dir, stagesStore, dispatcherFacts, couplings]);

  // Скрытые дубли исключаются из таймлайна здесь — единственная точка входа
  // целых рейсов для всех экранов модуля; для прямого открытия карточки они
  // остаются в hiddenTrips (без выдумывания данных, «План дохода» не затронут).
  const trips = useMemo(() => tripsAll.filter((t) => t.hiddenFromTimeline !== true), [tripsAll]);
  const hiddenTrips = useMemo(() => tripsAll.filter((t) => t.hiddenFromTimeline === true), [tripsAll]);

  const bases = useMemo(() => {
    const periods = bazaToBasePeriods(baza, fleetIndex, dir);
    // Тот же единый механизм, что у рейсов: запись ремонта/базы получает
    // диспетчера из карточки машины или из плана, ближайшего к дате записи.
    fillRecordDispatchers(periods, { facts: dispatcherFacts, dir }, {
      keysOf: (p) => [...vehicleKeyVariants(String(p.carKey || '').replace(/^(car|plate):/, '')), ...vehicleKeyVariants(p.carNumber)],
      dayOf: (p) => p.arrivalDay ?? p.repairStartDay ?? p.repairEndDay ?? p.departureDay ?? null,
    });
    return periods;
  }, [baza, fleetIndex, dir, dispatcherFacts]);

  const stageTypes = useMemo(() => effectiveStageTypes(dbStageTypes), [dbStageTypes]);

  /** Направления — ОДИН справочник «Плана дохода» (directories/directions):
   *  метки/фильтр/раскраска на полотне; ветка tripDirections — только цвета. */
  const directions = useMemo(() => mergeDirections(dbDirectionList, dbDirections), [dbDirectionList, dbDirections]);
  const directionOptions = useMemo(
    () => effectiveDirectionOptions(directionOptionsFromDb(dbDirectionList)),
    [dbDirectionList],
  );
  const stageTemplates = useMemo(
    () => effectiveStageTemplates(stageTemplatesFromDb(dbStageTemplates)),
    [dbStageTemplates],
  );

  return { trips, hiddenTrips, bases, events, fleetCars, dispatchers, stageTypes, cities, directions, directionOptions, stageTemplates };
}
