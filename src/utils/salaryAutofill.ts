import { Vehicle, Driver } from '../types';

import { formatPlate as formatPlateUnified, plateKeyFull } from './plate';

/** Номер для сравнения: единое правило из utils/plate (латиница, без знаков). */
export function normalizePlate(value: string): string {
  return plateKeyFull(value);
}

/** Единый вид номера (utils/plate): «AO 8807-7», «A 1086 B-7», «A042HY67». */
export function formatPlate(value: string): string {
  return formatPlateUnified(value);
}

/**
 * Formats a coupling string (tractor / trailer) or single plate for display.
 * 
 * "AB92717 / A 2416 E-7" → "AB 9271-7 / A2416E-7"
 */
export function formatCoupling(value: string): string {
  if (!value) return '';
  if (value.includes(' / ')) {
    return value.split(' / ').map(p => formatPlate(p.trim())).join(' / ');
  }
  return formatPlate(value.trim());
}

// — rest of file unchanged (findCarByPlate, getDriverById, etc.) —

export function findCarByPlate(value: string, vehicles: Vehicle[]): {
  matchType: 'exact' | 'partial' | 'multiple' | 'none';
  matchedCars: Vehicle[];
} {
  // Если введена полная сцепка "ТЯГАЧ / ПРИЦЕП" — ищем только по тягачу
  const tractorPart = String(value || '').split('/')[0];
  const normQuery = normalizePlate(tractorPart);
  if (!normQuery) {
    return { matchType: 'none', matchedCars: [] };
  }

  // Машины без номера (мусорные записи) не участвуют в поиске
  const validVehicles = vehicles.filter(car => normalizePlate(car.carNumber || car.vehicleNumbers || ''));

  // 1. Exact match on normalized number
  const exactMatches = validVehicles.filter(car => {
    const vNum = car.carNumber || car.vehicleNumbers || '';
    return normalizePlate(vNum) === normQuery;
  });

  if (exactMatches.length === 1) {
    return { matchType: 'exact', matchedCars: exactMatches };
  } else if (exactMatches.length > 1) {
    return { matchType: 'multiple', matchedCars: exactMatches };
  }

  // 2. Partial/soft search if no exact match.
  // Обратное включение (query содержит номер) — только если запрос достаточно длинный,
  // иначе короткие номера матчат всё подряд.
  const partialMatches = validVehicles.filter(car => {
    const vNum = car.carNumber || car.vehicleNumbers || '';
    const normV = normalizePlate(vNum);
    return normV.includes(normQuery) || (normQuery.length >= 4 && normV.length >= 4 && normQuery.includes(normV));
  });

  if (partialMatches.length === 1) {
    return { matchType: 'partial', matchedCars: partialMatches };
  } else if (partialMatches.length > 1) {
    return { matchType: 'multiple', matchedCars: partialMatches };
  }

  return { matchType: 'none', matchedCars: [] };
}

export function getDriverById(driverId: string, drivers: Driver[]): Driver | undefined {
  if (!driverId) return undefined;
  return drivers.find(d => d.id === driverId);
}

export function getDriverIdForCar(car: Vehicle, driversMap: Record<string, string>): string | undefined {
  if (!car || !driversMap || typeof driversMap !== 'object') return undefined;
  const normCarPlate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
  if (!normCarPlate) return undefined;
  const foundKey = Object.keys(driversMap).find(k => normalizePlate(k) === normCarPlate);
  return foundKey ? driversMap[foundKey] : undefined;
}