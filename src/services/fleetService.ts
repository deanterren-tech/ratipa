// ЕДИНАЯ БАЗА ТС / ПРИЦЕПОВ / ВОДИТЕЛЕЙ / ДИСПЕТЧЕРОВ
// ---------------------------------------------------
// Строит связную модель «сцепки» поверх СУЩЕСТВУЮЩИХ веток RTDB,
// не ломая модули и не меняя формат записи в БД:
//   - vehicleFleet          → авто (тягач) + trailerNumber + denormalized driver/dispatcher
//   - driversPool           → водители (единый источник)
//   - directories/dispatchers → диспетчеры (справочник)
//
// СВЯЗКА (изменяемая): выбрал carNumber (авто) → подтягиваются
//   trailerNumber (прицеп), driver (по driverId/телефону/имени), dispatcher
//   (по dispatcherId/имени). Матчинг работает и на denormalized полях,
//   и на id-ссылках (если добавлены в запись).
//
// Это НЕ повторяет ошибку ratipa-clean: там domain/types.ts лежал
// мёртвым, модули лазили в legacy/firebase.ts напрямую. Здесь сервис
// РЕАЛЬНО агрегирует данные и отдаёт готовую FleetUnit через подписку.

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
  // паспортные/прочие поля (проброс из vehicleFleet)
  [key: string]: unknown;
}

// soft-normalize для матчинга (убираем пробелы, приводим к верхнему регистру)
const norm = (s?: string): string =>
  (s || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Подписаться на единую базу сцепок. Возвращает unsubscribe.
 * callback получает массив FleetUnit с уже разрешёнными
 * водителем и диспетчером (изменяемая связка «авто → всё остальное»).
 */
export const subscribeFleetUnits = (
  callback: (units: FleetUnit[]) => void,
): (() => void) => {
  let vehicles: any[] = [];
  let drivers: Driver[] = [];
  let dispatchers: DispatcherRef[] = [];

  const emit = () => {
    const driverByPhone = new Map<string, Driver>();
    const driverByName = new Map<string, Driver>();
    drivers.forEach((d) => {
      if (d.phone) driverByPhone.set(norm(d.phone), d);
      if (d.shortNameRu) driverByName.set(norm(d.shortNameRu), d);
      if (d.name) driverByName.set(norm(d.name), d);
    });
    const dispatcherByName = new Map<string, DispatcherRef>();
    dispatchers.forEach((d) => dispatcherByName.set(norm(d.name), d));

    const units: FleetUnit[] = vehicles.map((v) => {
      const driverKey = norm(v.driverPhone || v.phone);
      const driver =
        (v.driverId && drivers.find((d) => d.id === v.driverId)) ||
        (driverKey && driverByPhone.get(driverKey)) ||
        (v.driverName && driverByName.get(norm(v.driverName))) ||
        null;

      const dispatcher =
        (v.dispatcherId && dispatchers.find((d) => d.id === v.dispatcherId)) ||
        (v.dispatcherName && dispatcherByName.get(norm(v.dispatcherName))) ||
        null;

      return {
        ...v,
        carNumber: v.carNumber || v.id,
        vehicleId: v.id,
        trailerNumber: v.trailerNumber,
        driverId: v.driverId ?? (driver ? driver.id : null),
        driverName: v.driverName ?? (driver ? driver.shortNameRu || driver.name : undefined),
        driverPhone: v.driverPhone ?? (driver ? driver.phone : undefined),
        driver,
        dispatcherId: v.dispatcherId ?? (dispatcher ? dispatcher.id : null),
        dispatcherName: v.dispatcherName ?? (dispatcher ? dispatcher.name : undefined),
        dispatcher,
      };
    });
    callback(units);
  };

  const unsubV = dbService.getVehicleFleet((list) => {
    vehicles = list || [];
    emit();
  });
  const unsubD = dbService.getDrivers((list) => {
    drivers = list || [];
    emit();
  });
  const unsubDisp = directoryService.getDispatchers((list) => {
    dispatchers = (list || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      color: d.color,
    }));
    emit();
  });

  return () => {
    unsubV();
    unsubD();
    unsubDisp();
  };
};

/**
 * Разово получить все сцепки (без подписки).
 */
export const getFleetUnitsOnce = (
  callback: (units: FleetUnit[]) => void,
): void => {
  let done = 0;
  const acc = {vehicles: [] as any[], drivers: [] as Driver[], dispatchers: [] as DispatcherRef[]};
  const finish = () => {
    const units: FleetUnit[] = acc.vehicles.map((v) => {
      const driver =
        (v.driverId && acc.drivers.find((d) => d.id === v.driverId)) ||
        (v.driverPhone && acc.drivers.find((d) => norm(d.phone) === norm(v.driverPhone))) ||
        (v.driverName && acc.drivers.find((d) => norm(d.shortNameRu || d.name) === norm(v.driverName))) ||
        null;
      const dispatcher =
        (v.dispatcherId && acc.dispatchers.find((d) => d.id === v.dispatcherId)) ||
        (v.dispatcherName && acc.dispatchers.find((d) => norm(d.name) === norm(v.dispatcherName))) ||
        null;
      return {
        ...v,
        carNumber: v.carNumber || v.id,
        vehicleId: v.id,
        trailerNumber: v.trailerNumber,
        driverId: v.driverId ?? (driver ? driver.id : null),
        driverName: v.driverName ?? (driver ? driver.shortNameRu || driver.name : undefined),
        driverPhone: v.driverPhone ?? (driver ? driver.phone : undefined),
        driver,
        dispatcherId: v.dispatcherId ?? (dispatcher ? dispatcher.id : null),
        dispatcherName: v.dispatcherName ?? (dispatcher ? dispatcher.name : undefined),
        dispatcher,
      };
    });
    callback(units);
  };
  dbService.getVehicleFleet((l) => { acc.vehicles = l || []; if (++done === 3) finish(); });
  dbService.getDrivers((l) => { acc.drivers = l || []; if (++done === 3) finish(); });
  directoryService.getDispatchers((l) => { acc.dispatchers = (l || []).map((d: any) => ({id: d.id, name: d.name, color: d.color})); if (++done === 3) finish(); });
};
