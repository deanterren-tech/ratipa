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
import { effectiveStageTypes } from './lib/catalog';
import { mergeDirections, type DirectionDef } from './lib/directions';
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

export interface DispatcherOption {
  id: string;
  name: string;
}

export interface TimelineData {
  /** Целые рейсы: ручные + из «Плана дохода» (порядок: ручные, затем планы). */
  trips: WholeTrip[];
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
}

const normalizeManualTrip = (raw: TimelineTrip, carIndex: Map<string, CarRef>, dir: DispatcherDirectory): WholeTrip => {
  const stages = normalizeStages(raw.stages);
  const withStages = withFallbackStages({
    ...raw,
    carNumber: raw.carNumber || '',
    route: raw.route || '',
    bufferDays: Number(raw.bufferDays) || 0,
    archived: raw.archived === true,
    stages,
  });
  const car =
    (raw.vehicleId ? carIndex.get(String(raw.vehicleId).toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '')) : undefined) ||
    resolveCarForText(carIndex, raw.carNumber || '');
  const dispatcherId = raw.dispatcherId || car?.dispatcherId || '';
  const dispatcherName =
    raw.dispatcherName || car?.dispatcherName || (dispatcherId && dir.byId.get(dispatcherId)?.name) || '';
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
    // Направления (Турция, Китай, добавленные пользователем) — справочник «Настройки»
    const u10 = directoryService.getTripDirections((list) => setDbDirections((list || []) as Array<Record<string, unknown>>));
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
    };
  }, []);

  const carIndex = useMemo(() => buildCarIndex(couplings), [couplings]);
  const dir = useMemo(() => buildDispatcherDirectory(dispatchers.map((d) => ({ id: d.id, name: d.name }))), [dispatchers]);
  const fleetCars = useMemo(() => uniqueFleetCars(carIndex), [carIndex]);

  const trips = useMemo(() => {
    const manual = manualTrips.map((t) => normalizeManualTrip(t, carIndex, dir));
    const fromPlan = planTripsToWholeTrips(planTrips, carIndex, dir, stagesStore);
    return [...manual, ...fromPlan];
  }, [manualTrips, planTrips, carIndex, dir, stagesStore]);

  const bases = useMemo(() => bazaToBasePeriods(baza, carIndex, dir), [baza, carIndex, dir]);

  const stageTypes = useMemo(() => effectiveStageTypes(dbStageTypes), [dbStageTypes]);

  const directions = useMemo(() => mergeDirections(dbDirections), [dbDirections]);

  return { trips, bases, events, fleetCars, dispatchers, stageTypes, cities, directions };
}
