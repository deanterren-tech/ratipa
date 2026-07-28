// ЕДИНАЯ БАЗА RATIPA — агрегатор сцепок (portal-схема)
// ------------------------------------------------------
// ОДИН ИСТОЧНИК ПРАВДЫ для авто/прицепов/водителей/диспетчеров.
// Читает ТОЛЬКО через dbService (единый слой доступа к БД), никогда
// напрямую из firebase. Имена веток — portal:
//   tractors    → авто (тягачи)
//   trailers    → прицепы
//   couplings   → связка (tractorId + trailerId + driverId + dispatcherName + status)
//   drivers     → водители
//   directories/dispatchers → диспетчеры (справочник)
//
// FleetUnit — это НЕ запись в БД. Это тип (виртуальная сборка), которую
// fleetService отдаёт модулю: раскрытая couplings + полные сущности
// tractor/trailer/driver/dispatcher (нормализованная вложенная структура).

import {dbService, directoryService} from '../api';
import type {Driver} from '../types';

export interface TractorRef {
  id: string;
  carNumber: string;
  brand?: string;
  [key: string]: unknown;
}

export interface TrailerRef {
  id: string;
  trailerNumber: string;
  trailerBrand?: string;
  [key: string]: unknown;
}

export interface DispatcherRef {
  id?: string;
  name: string;
  color?: string;
}

/** Вложенная нормализованная структура сцепки (Variant A). */
export interface FleetUnit {
  couplingId: string;                 // couplings.id
  tractor: TractorRef | null;         // из tractors (полностью)
  trailer: TrailerRef | null;         // из trailers (полностью)
  driver: Driver | null;              // из drivers (полностью)
  dispatcher: DispatcherRef | null;   // из directories.dispatchers (по dispatcherName)
  status: string;                     // из couplings.status
  // сырьё couplings для записи/редактирования
  raw: {
    tractorId?: string | null;
    trailerId?: string | null;
    driverId?: string | null;
    dispatcherName?: string | null;
    status?: string;
    // Ключевые поля дублируются в couplings (приоритетнее tractors,
    // т.к. у 39 тракторов brand пустой, а в couplings он есть у всех 46)
    brand?: string | null;
    brandModel?: string | null;
    brands?: string | null;
    brandRu?: string | null;
    trailerBrand?: string | null;
    trailerMake?: string | null;
    vehicleType?: string | null;
    dimensions?: string | null;
    weight?: string | null;
    rateGroupId?: string | null;
    driver2?: string | null;
    dispatcherName2?: string | null;
  };
}

const norm = (s?: string): string =>
  (s || '').toString().trim().toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');

/** Резолв диспетчера из couplings.dispatcherName, который может быть либо именем,
 *  либо UID (исторически писался uid). Возвращает объект {name} или null. */
const resolveDispatcher = (dispatcherName: string | null | undefined, dispatchers: DispatcherRef[]): DispatcherRef | null => {
  if (!dispatcherName) return null;
  const byName = new Map<string, DispatcherRef>();
  const byId = new Map<string, DispatcherRef>();
  (dispatchers || []).forEach((d) => {
    if (d.name) byName.set(norm(d.name), d);
    if (d.id) byId.set(norm(d.id), d);
  });
  return byName.get(norm(dispatcherName)) || byId.get(norm(dispatcherName)) || { name: dispatcherName };
};

/**
 * Подписаться на единую базу сцепок. callback → FleetUnit[] с раскрытыми
 * tractor/trailer/driver/dispatcher (изменяемая связка «авто → всё остальное»).
 */
export const subscribeFleetUnits = (callback: (units: FleetUnit[]) => void): (() => void) => {
  let tractors: any[] = [];
  let trailers: any[] = [];
  let drivers: Driver[] = [];
  let couplings: any[] = [];
  let dispatchers: DispatcherRef[] = [];

  const emit = () => {
    const driverById = new Map<string, Driver>();
    drivers.forEach((d) => driverById.set(norm(d.id), d));
    const trailerById = new Map<string, any>();
    trailers.forEach((t) => trailerById.set(norm(t.id), t));
    const dispatcherByName = new Map<string, DispatcherRef>();
    dispatchers.forEach((d) => dispatcherByName.set(norm(d.name), d));

    const units: FleetUnit[] = couplings.map((c) => {
      const tractorId = c.tractorId || c.id;
      const tractor = tractorId ? (tractors.find((t) => norm(t.id) === norm(tractorId)) || null) : null;
      const trailer = c.trailerId ? (trailerById.get(norm(c.trailerId)) || null) : null;
      const driver = c.driverId ? (driverById.get(norm(c.driverId)) || null) : null;
      const dispatcher = c.dispatcherName ? (dispatcherByName.get(norm(c.dispatcherName)) || resolveDispatcher(c.dispatcherName, dispatchers)) : null;
      return {
        couplingId: c.id,
        tractor: tractor ? { id: tractor.id, carNumber: tractor.carNumber || tractor.id, ...tractor } : null,
        trailer: trailer ? { id: trailer.id, trailerNumber: trailer.trailerNumber || trailer.id, ...trailer } : null,
        driver: driver || null,
        dispatcher: dispatcher || (c.dispatcherName ? { name: c.dispatcherName } : null),
        status: c.status || 'base',
        raw: {
          tractorId: c.tractorId ?? null,
          trailerId: c.trailerId ?? null,
          driverId: c.driverId ?? null,
          dispatcherName: c.dispatcherName ?? null,
          status: c.status,
          // Ключевые поля дублируются в couplings — они ПРИОРИТЕТНЕЕ
          // tractors (у 39 тракторов brand пустой, а в couplings он есть у всех 46).
          // Чтобы сцепка не "пустела" при правке марки в Справочниках.
          brand: c.brand ?? null,
          brandModel: c.brandModel ?? null,
          brands: c.brands ?? null,
          brandRu: c.brandRu ?? null,
          trailerBrand: c.trailerBrand ?? null,
          trailerMake: c.trailerMake ?? null,
          vehicleType: c.vehicleType ?? null,
          dimensions: c.dimensions ?? null,
          weight: c.weight ?? null,
          rateGroupId: c.rateGroupId ?? null,
          driver2: c.driver2 ?? null,
          dispatcherName2: c.dispatcherName2 ?? null,
        },
      };
    });
    callback(units);
  };

  const u1 = dbService.getTractors((list) => { tractors = list || []; emit(); });
  const u2 = dbService.getTrailers((list) => { trailers = list || []; emit(); });
  const u3 = dbService.getDrivers((list) => { drivers = list || []; emit(); });
  const u4 = dbService.getCouplings((list) => { couplings = list || []; emit(); });
  const u5 = directoryService.getDispatchers((list) => {
    dispatchers = (list || []).map((d: any) => ({ id: d.id, name: d.name, color: d.color }));
    emit();
  });

  return () => { u1(); u2(); u3(); u4(); u5(); };
};

/** Разово получить все сцепки (без подписки). */
export const getFleetUnitsOnce = (callback: (units: FleetUnit[]) => void): void => {
  let done = 0;
  const acc = { tractors: [] as any[], trailers: [] as any[], drivers: [] as Driver[], couplings: [] as any[], dispatchers: [] as DispatcherRef[] };
  const finish = () => {
    const driverById = new Map<string, Driver>();
    acc.drivers.forEach((d) => driverById.set(norm(d.id), d));
    const trailerById = new Map<string, any>();
    acc.trailers.forEach((t) => trailerById.set(norm(t.id), t));
    const dispatcherByName = new Map<string, DispatcherRef>();
    acc.dispatchers.forEach((d) => dispatcherByName.set(norm(d.name), d));
    const units: FleetUnit[] = acc.couplings.map((c) => {
      const tractor = c.tractorId ? (acc.tractors.find((t) => norm(t.id) === norm(c.tractorId)) || null) : null;
      const trailer = c.trailerId ? (trailerById.get(norm(c.trailerId)) || null) : null;
      const driver = c.driverId ? (driverById.get(norm(c.driverId)) || null) : null;
      const dispatcher = c.dispatcherName ? (dispatcherByName.get(norm(c.dispatcherName)) || resolveDispatcher(c.dispatcherName, acc.dispatchers)) : null;
      return {
        couplingId: c.id,
        tractor: tractor ? { id: tractor.id, carNumber: tractor.carNumber || tractor.id, ...tractor } : null,
        trailer: trailer ? { id: trailer.id, trailerNumber: trailer.trailerNumber || trailer.id, ...trailer } : null,
        driver: driver || null,
        dispatcher: dispatcher || (c.dispatcherName ? { name: c.dispatcherName } : null),
        status: c.status || 'base',
        raw: { tractorId: c.tractorId ?? null, trailerId: c.trailerId ?? null, driverId: c.driverId ?? null, dispatcherName: c.dispatcherName ?? null, status: c.status },
      };
    });
    callback(units);
  };
  dbService.getTractors((l) => { acc.tractors = l || []; if (++done === 5) finish(); });
  dbService.getTrailers((l) => { acc.trailers = l || []; if (++done === 5) finish(); });
  dbService.getDrivers((l) => { acc.drivers = l || []; if (++done === 5) finish(); });
  dbService.getCouplings((l) => { acc.couplings = l || []; if (++done === 5) finish(); });
  directoryService.getDispatchers((l) => { acc.dispatchers = (l || []).map((d: any) => ({ id: d.id, name: d.name, color: d.color })); if (++done === 5) finish(); });
};

// ============ ПЛОСКИЕ СЕЛЕКТОРЫ (для модулей, которым нужен 1 вид сущности) ============

/** Авто (тягачи) — плоский список из единой базы. */
export const getVehicles = (cb: (list: any[]) => void): (() => void) =>
  dbService.getTractors(cb);

/** Прицепы — плоский список. */
export const getTrailersFlat = (cb: (list: any[]) => void): (() => void) =>
  dbService.getTrailers(cb);

/** Водители — из drivers (единый источник). */
export const getDriversFlat = (cb: (list: Driver[]) => void): (() => void) =>
  dbService.getDrivers(cb);

/** Диспетчеры — из directories/dispatchers. */
export const getDispatchersFlat = (cb: (list: DispatcherRef[]) => void): (() => void) =>
  directoryService.getDispatchers((l) => cb((l || []).map((d: any) => ({ id: d.id, name: d.name, color: d.color }))));

/** Центр/сцепки (couplings) — FleetUnit[] (авто+прицеп+водитель+диспетчер). */
export const getCouplings = (cb: (list: FleetUnit[]) => void): (() => void) =>
  subscribeFleetUnits(cb);

/**
 * Плоский список сцепок для UI-пикеров/редакторов (обратно-совместимый вид):
 * раскрывает вложенный FleetUnit в плоские поля carNumber/trailerNumber/driverName/...
 */
export const getCouplingsFlat = (cb: (list: any[]) => void): (() => void) =>
  subscribeFleetUnits((units) => cb(units.map((u) => ({
    id: u.couplingId,
    couplingId: u.couplingId,
    carNumber: u.tractor?.carNumber || u.couplingId,
    vehicleNumbers: u.tractor?.carNumber || u.couplingId,
    tractorId: u.raw.tractorId,
    trailerNumber: u.trailer?.trailerNumber || '',
    trailerId: u.raw.trailerId,
    brand: u.raw.brand || u.tractor?.brand || u.tractor?.brandModel || '',
    brandModel: u.raw.brandModel || u.raw.brands || u.tractor?.brandModel || u.tractor?.brands || u.tractor?.brand || '',
    brandRu: u.raw.brandRu || u.tractor?.brandRu || '',
    brandsRu: u.raw.brandModel || u.raw.brands || u.tractor?.brandModel || u.tractor?.brands || u.tractor?.brand || '',
    brandsLat: u.trailer?.trailerBrand || '',
    trailerBrand: u.raw.trailerBrand || u.tractor?.trailerBrand || u.trailer?.trailerBrand || '',
    trailerMake: u.raw.trailerMake || u.tractor?.trailerMake || u.trailer?.trailerBrand || '',
    driverId: u.raw.driverId || '',
    driverName: u.driver?.shortNameRu || u.driver?.name || '',
    driverNameRu: u.driver?.shortNameRu || '',
    driverNameLat: u.driver?.nameLat || '',
    phones: u.driver?.phones || [],
    passportNumber: u.driver?.passport || '',
    personalId: u.driver?.personalId || '',
    birthDate: u.driver?.birthDate || '',
    passportStart: u.driver?.passportStart || '',
    passportEnd: u.driver?.passportEnd || '',
    passportIssuedBy: u.driver?.passportIssued || '',
    licenseNumber: u.driver?.licenseNumber || '',
    lastPassportVerificationYear: (u.tractor as any)?.lastPassportVerificationYear,
    dispatcher: u.dispatcher?.name || u.raw.dispatcherName || u.tractor?.dispatcherName || u.tractor?.dispatcher || '',
    dispatcherName: u.dispatcher?.name || u.raw.dispatcherName || u.tractor?.dispatcherName || u.tractor?.dispatcher || '',
    status: u.status,
    year: u.tractor?.year,
    dimensions: u.raw.dimensions || u.tractor?.dimensions,
    weight: u.raw.weight || u.tractor?.weight,
    rate: u.tractor?.rate,
    vehicleType: u.raw.vehicleType || u.tractor?.vehicleType,
    rateGroupId: u.raw.rateGroupId || (u.tractor as any)?.rateGroupId || '',
    driver2: u.raw.driver2 || (u.tractor as any)?.driver2 || '',
  }))));
