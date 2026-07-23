// ЕДИНАЯ БАЗА ТС / ПРИЦЕПОВ / ВОДИТЕЛЕЙ / ДИСПЕТЧЕРОВ
// ---------------------------------------------------
// ОДИН ИСТОЧНИК ПРАВДЫ для всех модулей. Агрегирует существующие ветки RTDB
// без изменения формата записи в БД:
//   - vehicleFleet            → авто (тягач) + trailerNumber + denormalized driver/dispatcher
//   - vehicle_driver_data     → legacy центр/сцепки (паспорта, read-only fallback)
//   - driversPool             → водители (единый источник)
//   - directories/dispatchers → диспетчеры (справочник)
//
// СВЯЗКА (изменяемая): выбрал carNumber (авто) → подтягиваются
//   trailerNumber (прицеп), driver (по driverId/телефону/имени), dispatcher.
//
// Это НЕ повторяет ошибку ratipa-clean (там domain/types.ts лежал мёртвым,
// модули лазили в legacy/firebase.ts). Здесь сервис РЕАЛЬНО агрегирует
// данные и отдаёт их модулям через подписки и плоские селекторы.

import {dbService, directoryService} from '../api';
import type {Driver} from '../types';

export interface DispatcherRef {
  id: string;
  name: string;
  color?: string;
}

export interface FleetUnit {
  // Авто (тягач) — ключ поиска = carNumber
  carNumber: string;
  vehicleId?: string;
  brandModel?: string;
  // Прицеп (входит в сцепку)
  trailerNumber?: string;
  // Водитель (ссылка + denormalized для показа)
  driverId?: string | null;
  driverName?: string;
  driverPhone?: string;
  driver?: Driver | null; // разрешённая сущность из driversPool
  // Диспетчер (ссылка + denormalized)
  dispatcherId?: string | null;
  dispatcherName?: string;
  dispatcher?: DispatcherRef | null; // разрешённая сущность из directories/dispatchers
  // паспортные/прочие поля (проброс из vehicleFleet / vehicle_driver_data)
  [key: string]: unknown;
}

// soft-normalize для матчинга
const norm = (s?: string): string =>
  (s || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');

// Локальный кэш трёх веток (чтобы селекторы отдавали консистентные снимки)
let _vehicles: any[] = [];
let _drivers: Driver[] = [];
let _dispatchers: DispatcherRef[] = [];
let _legacy: Record<string, any> = {}; // pasport map keyed by normalized carNumber

const resolveDriver = (v: any): Driver | null => {
  const key = norm(v.driverPhone || v.phone);
  const byPhone = key ? _drivers.find((d) => norm(d.phone) === key) : undefined;
  const byName = v.driverName
    ? _drivers.find((d) => norm(d.shortNameRu || d.name) === norm(v.driverName))
    : undefined;
  return (v.driverId && _drivers.find((d) => d.id === v.driverId)) || byPhone || byName || null;
};

const resolveDispatcher = (v: any): DispatcherRef | null => {
  return (
    (v.dispatcherId && _dispatchers.find((d) => d.id === v.dispatcherId)) ||
    (v.dispatcherName && _dispatchers.find((d) => norm(d.name) === norm(v.dispatcherName))) ||
    null
  );
};

const buildUnit = (v: any): FleetUnit => {
  const driver = resolveDriver(v);
  const dispatcher = resolveDispatcher(v);
  // merge legacy passport fields (read-only)
  const legacy = _legacy[norm(v.carNumber || v.id)] || {};
  return {
    ...legacy,
    ...v,
    carNumber: v.carNumber || v.id,
    vehicleId: v.id,
    trailerNumber: v.trailerNumber ?? legacy.trailerNumber,
    driverId: v.driverId ?? (driver ? driver.id : null),
    driverName: v.driverName ?? (driver ? driver.shortNameRu || driver.name : legacy.driverName),
    driverPhone: v.driverPhone ?? (driver ? driver.phone : legacy.driverPhone),
    driver,
    dispatcherId: v.dispatcherId ?? (dispatcher ? dispatcher.id : null),
    dispatcherName: v.dispatcherName ?? (dispatcher ? dispatcher.name : legacy.dispatcherName),
    dispatcher,
  };
};

/**
 * Подписаться на единую базу сцепок. callback → FleetUnit[] с разрешёнными
 * водителем/диспетчером и смерженными паспортными полями из legacy.
 */
export const subscribeFleetUnits = (callback: (units: FleetUnit[]) => void): (() => void) => {
  const emit = () => callback(_vehicles.map(buildUnit));

  const unsubV = dbService.getVehicleFleet((list) => {
    _vehicles = list || [];
    emit();
  });
  const unsubD = dbService.getDrivers((list) => {
    _drivers = list || [];
    emit();
  });
  const unsubDisp = directoryService.getDispatchers((list) => {
    _dispatchers = (list || []).map((d: any) => ({ id: d.id, name: d.name, color: d.color }));
    emit();
  });
  // legacy passport data (read-only fallback, как в sharedGetVehicleDriverData)
  const unsubLegacy = (() => {
    try {
      // используем onceValue через dbService если доступно, иначе firebaseGet
      const { onceValue } = require('../firebase');
      const { ref, getDatabase } = require('firebase/database');
      onceValue(
        ref(getDatabase(), 'vehicle_driver_data'),
        (snap: any) => {
          const val = snap && snap.val ? snap.val() : null;
          if (val) {
            const map: Record<string, any> = {};
            Object.keys(val).forEach((lk) => {
              const lr = val[lk] || {};
              const lCar = (lr.carNumber || lr.vehicleNumbers || '').toString().replace(/[^А-ЯA-Z0-9]/g, '');
              if (lCar) map[lCar] = lr;
            });
            _legacy = map;
            emit();
          }
        },
      );
    } catch {
      /* offline: legacy просто пустой */
    }
    return () => {};
  })();

  return () => {
    unsubV();
    unsubD();
    unsubDisp();
    unsubLegacy();
  };
};

/** Разово получить все сцепки (без подписки). */
export const getFleetUnitsOnce = (callback: (units: FleetUnit[]) => void): void => {
  let done = 0;
  const finish = () => {
    callback(_vehicles.map(buildUnit));
  };
  dbService.getVehicleFleet((l) => { _vehicles = l || []; if (++done === 3) finish(); });
  dbService.getDrivers((l) => { _drivers = l || []; if (++done === 3) finish(); });
  directoryService.getDispatchers((l) => { _dispatchers = (l || []).map((d: any) => ({id: d.id, name: d.name, color: d.color})); if (++done === 3) finish(); });
};

// ============ ПЛОСКИЕ СЕЛЕКТОРЫ (для модулей, которым нужен 1 вид сущности) ============

/** Авто (тягачи) — плоский список из единой базы. */
export const getVehicles = (cb: (list: any[]) => void): (() => void) =>
  subscribeFleetUnits((units) => cb(units));

/** Водители — из driversPool (единый источник). */
export const getDriversFlat = (cb: (list: Driver[]) => void): (() => void) =>
  dbService.getDrivers(cb);

/** Диспетчеры — из directories/dispatchers. */
export const getDispatchersFlat = (cb: (list: DispatcherRef[]) => void): (() => void) =>
  directoryService.getDispatchers((l) => cb((l || []).map((d: any) => ({ id: d.id, name: d.name, color: d.color }))));

/** Центр/сцепки (couplings) — FleetUnit[] (авто+прицеп+водитель+диспетчер). */
export const getCouplings = (cb: (list: FleetUnit[]) => void): (() => void) =>
  subscribeFleetUnits(cb);
