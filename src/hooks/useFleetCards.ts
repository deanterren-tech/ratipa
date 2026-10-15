/**
 * Данные и стек полных карточек автомобиля/водителя.
 *
 * ЕДИНЫЙ механизм загрузки для всех мест портала:
 *  - useVehicleCard(carNumber) — полная запись по vehicleId: tractors + couplings
 *    + trailers + водители + диспетчеры + тарифы (+ «Учёт выезда» и последние
 *    рейсы плана дохода как связанные данные только для чтения);
 *  - useDriverCard(driverId) — полная запись по driverId из `drivers` + телефоны
 *    из единого поля phones + назначения/машины из связок (по id) + диспетчер и
 *    группа ставок из справочников.
 *
 * Состояния загрузки честные: loading → ready | not-found, «error» — если данные
 * не пришли за отведённое время (повторная попытка перезапускает подписки).
 * Источники читаются через общие кэшированные подписки (src/db/subscriptions),
 * поэтому открытие карточки не создаёт дублирующих чтений БД.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {dbService, directoryService} from '../api';
import {
  getCouplingsFlat,
  getDriversFlat,
  getDispatchersFlat,
  getTrailersFlat,
  getVehicles,
} from '../services/fleetService';
import {
  buildDriverCardModel,
  buildVehicleCardModel,
  findDriverRecord,
  findVehicleRecord,
  firstPlatePart,
  normalizeCardKey,
  resolveCardPhase,
  type CardLoadPhase,
  type DriverCardModel,
  type RawRecord,
  type VehicleCardModel,
} from '../utils/fleetCardModel';
import type {DriverLike} from '../utils/driverRegistry';

/** Сколько ждём первый ответ основных источников, прежде чем показать ошибку. */
const LOAD_TIMEOUT_MS = 12000;

type Unsub = () => void;
const noop: Unsub = () => {};

// ---------------------------------------------------------------------------
// Стек карточек: автомобиль → водитель → автомобиль …
// Нижние карточки остаются смонтированными (скрытыми), поэтому закрытие
// верхней возвращает к нижней без потери контекста и состояния прокрутки.
// ---------------------------------------------------------------------------

export interface VehicleCardRef {
  type: 'vehicle';
  carNumber: string;
  /** id записи, если он известен вызывающему (при открытии точнее, чем номер). */
  vehicleId?: string;
}

export interface DriverCardRef {
  type: 'driver';
  driverId: string;
  driverName?: string;
}

export type FleetCardRef = VehicleCardRef | DriverCardRef;

export function fleetCardRefKey(ref: FleetCardRef): string {
  return ref.type === 'vehicle'
    ? `vehicle:${normalizeCardKey(ref.vehicleId || ref.carNumber)}`
    : `driver:${ref.driverId}`;
}

export interface FleetCardStack {
  stack: FleetCardRef[];
  push: (ref: FleetCardRef) => void;
  /** Заменить верхнюю карточку (переход «предыдущий/следующий водитель»). */
  replaceTop: (ref: FleetCardRef) => void;
  pop: () => void;
  closeAll: () => void;
}

export function useFleetCardStack(): FleetCardStack {
  const [stack, setStack] = useState<FleetCardRef[]>([]);
  const push = useCallback((ref: FleetCardRef) => {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      // Повторное открытие того же — не плодит копии в стеке.
      if (top && fleetCardRefKey(top) === fleetCardRefKey(ref)) return prev;
      return [...prev, ref];
    });
  }, []);
  const replaceTop = useCallback((ref: FleetCardRef) => {
    setStack((prev) => (prev.length === 0 ? [ref] : [...prev.slice(0, -1), ref]));
  }, []);
  const pop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);
  return {stack, push, replaceTop, pop, closeAll};
}

// ---------------------------------------------------------------------------
// Автомобиль
// ---------------------------------------------------------------------------

export interface VehicleTripItem {
  date: string;
  direction: string;
}

export interface VehicleCardData {
  phase: CardLoadPhase;
  model: VehicleCardModel | null;
  trips: VehicleTripItem[];
  retry: () => void;
}

function normList(value: unknown): RawRecord[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as RawRecord[]) : [];
}

/**
 * Единый список групп ставок для карточек — берётся из чистого слоя
 * (utils/fleetCardModel), чтобы правило приоритета источников тестировалось.
 */
import {mergeRateGroups, type RateGroupOption} from '../utils/fleetCardModel';

export function useVehicleCard(carNumber: string, vehicleId?: string): VehicleCardData {
  const [nonce, setNonce] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [tractors, setTractors] = useState<RawRecord[] | null>(null);
  const [couplings, setCouplings] = useState<RawRecord[] | null>(null);
  const [trailers, setTrailers] = useState<RawRecord[] | null>(null);
  const [drivers, setDrivers] = useState<DriverLike[] | null>(null);
  const [dispatchers, setDispatchers] = useState<Array<{ id?: string; name?: string }>>([]);
  const [dirRateGroups, setDirRateGroups] = useState<RateGroupOption[]>([]);
  const [legacyRateGroups, setLegacyRateGroups] = useState<RateGroupOption[]>([]);
  const [bazaList, setBazaList] = useState<RawRecord[]>([]);
  const [planList, setPlanList] = useState<RawRecord[]>([]);

  useEffect(() => {
    setTimedOut(false);
    setTractors(null);
    setCouplings(null);
    setTrailers(null);
    setDrivers(null);
    const unsubs: Unsub[] = [
      getVehicles((list: unknown[]) => setTractors(normList(list))),
      getCouplingsFlat((list: unknown[]) => setCouplings(normList(list))),
      getTrailersFlat((list: unknown[]) => setTrailers(normList(list))),
      getDriversFlat((list: DriverLike[]) => setDrivers(Array.isArray(list) ? list : [])),
      getDispatchersFlat((list) => setDispatchers(Array.isArray(list) ? list : [])),
      // Справочник групп ставок (канонический источник) + легаси carsPool.
      directoryService.getRateGroups((list: RateGroupOption[]) => setDirRateGroups(Array.isArray(list) ? list : [])),
      dbService.getCarRateGroups
        ? dbService.getCarRateGroups((list: RateGroupOption[]) => setLegacyRateGroups(Array.isArray(list) ? list : []))
        : noop,
      dbService.getBazaRecords
        ? dbService.getBazaRecords((list: unknown[]) => setBazaList(normList(list)))
        : noop,
      dbService.getPlanDohod
        ? dbService.getPlanDohod((list: unknown[]) => setPlanList(normList(list)))
        : noop,
    ];
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
      unsubs.forEach((u) => { if (typeof u === 'function') u(); });
    };
  }, [carNumber, vehicleId, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const key = normalizeCardKey(vehicleId || carNumber);

  const model = useMemo(() => {
    const tractor = findVehicleRecord(tractors || [], key);
    const coupling = findVehicleRecord(couplings || [], key);
    if (!tractor && !coupling) return null;
    const trailerId = normalizeCardKey(coupling?.trailerId || tractor?.trailerId);
    const trailer = trailerId
      ? (trailers || []).find((t) => normalizeCardKey(t.id) === trailerId) || null
      : null;
    const bazaMatch = (bazaList || []).find(
      (c) => normalizeCardKey(firstPlatePart(c.carNumber)) === key || normalizeCardKey(c.vehicleNumbers) === key,
    ) || null;
    return buildVehicleCardModel({
      vehicleId: carNumber,
      tractor,
      coupling,
      trailer,
      drivers: drivers || [],
      dispatchers,
      rateGroups: mergeRateGroups(dirRateGroups, legacyRateGroups),
      baza: bazaMatch,
    });
  }, [carNumber, key, tractors, couplings, trailers, drivers, dispatchers, dirRateGroups, legacyRateGroups, bazaList]);

  const trips = useMemo<VehicleTripItem[]>(() => {
    const found = (planList || []).filter(
      (t) => normalizeCardKey(firstPlatePart(t.carNumber)) === key || normalizeCardKey(t.vehicleNumbers) === key,
    );
    return found.slice(0, 5).map((t) => ({
      date: String(t.dateLoading || t.dateDeparture || ''),
      direction: String(t.direction || t.route || ''),
    }));
  }, [planList, key]);

  const phase = resolveCardPhase(tractors !== null && couplings !== null, !!model, timedOut);

  return {phase, model, trips, retry};
}

// ---------------------------------------------------------------------------
// Водитель
// ---------------------------------------------------------------------------

export interface DriverSalaryItem {
  date: string;
  amount: string;
}

export interface DriverCardData {
  phase: CardLoadPhase;
  model: DriverCardModel | null;
  salary: DriverSalaryItem[];
  retry: () => void;
}

export function useDriverCard(driverId: string, driverName?: string): DriverCardData {
  const [nonce, setNonce] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [drivers, setDrivers] = useState<DriverLike[] | null>(null);
  const [couplings, setCouplings] = useState<RawRecord[] | null>(null);
  const [tractors, setTractors] = useState<RawRecord[] | null>(null);
  const [dispatchers, setDispatchers] = useState<Array<{ id?: string; name?: string }>>([]);
  const [dirRateGroups, setDirRateGroups] = useState<RateGroupOption[]>([]);
  const [legacyRateGroups, setLegacyRateGroups] = useState<RateGroupOption[]>([]);
  const [salaryList, setSalaryList] = useState<RawRecord[]>([]);

  useEffect(() => {
    setTimedOut(false);
    setDrivers(null);
    setCouplings(null);
    setTractors(null);
    const unsubs: Unsub[] = [
      getDriversFlat((list: DriverLike[]) => setDrivers(Array.isArray(list) ? list : [])),
      getCouplingsFlat((list: unknown[]) => setCouplings(normList(list))),
      getVehicles((list: unknown[]) => setTractors(normList(list))),
      getDispatchersFlat((list) => setDispatchers(Array.isArray(list) ? list : [])),
      directoryService.getRateGroups((list: RateGroupOption[]) => setDirRateGroups(Array.isArray(list) ? list : [])),
      dbService.getCarRateGroups
        ? dbService.getCarRateGroups((list: RateGroupOption[]) => setLegacyRateGroups(Array.isArray(list) ? list : []))
        : noop,
      driverId && dbService.getDriverSalaryLogs
        ? dbService.getDriverSalaryLogs(driverId, (logs: unknown[]) => setSalaryList(normList(logs)))
        : noop,
    ];
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
      unsubs.forEach((u) => { if (typeof u === 'function') u(); });
    };
  }, [driverId, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const model = useMemo(() => {
    const registry = drivers || [];
    // Связь — по стабильному id; имя используется только для показа, когда id нет.
    const driver = findDriverRecord(registry, driverId, driverName);
    if (!driver) return null;
    const id = String(driver.id);
    const carriers: RawRecord[] = [
      ...(couplings || []).filter((c) => String(c.driverId) === id || String(c.driver2Id) === id),
      ...(tractors || []).filter((t) => String(t.driverId) === id || String(t.driver2Id) === id),
    ];
    return buildDriverCardModel({driverId: id, driver, linkCarriers: carriers, dispatchers, rateGroups: mergeRateGroups(dirRateGroups, legacyRateGroups)});
  }, [driverId, driverName, drivers, couplings, tractors, dispatchers, dirRateGroups, legacyRateGroups]);

  const salary = useMemo<DriverSalaryItem[]>(() => {
    return (salaryList || []).slice(-5).reverse().map((s) => ({
      date: String(s.date || s.datetime || s.period || ''),
      amount: s.amount != null ? `${s.amount} €` : (s.total != null ? `${s.total} €` : ''),
    }));
  }, [salaryList]);

  const phase = resolveCardPhase(drivers !== null, !!model, timedOut);

  return {phase, model, salary, retry};
}
