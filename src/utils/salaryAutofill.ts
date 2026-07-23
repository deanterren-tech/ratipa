import { Vehicle, Driver } from '../types';

/**
 * Normalizes a license plate number by removing spaces, hyphens, and converting to uppercase.
 */
export function normalizePlate(value: string): string {
  return (value || '').toUpperCase().trim().replace(/[^A-ZА-Я0-9]/gi, '');
}

/**
 * Finds matching vehicles in the active fleet based on the plate number.
 * Supports exact and partial/soft matching.
 */
export function findCarByPlate(value: string, vehicles: Vehicle[]): {
  matchType: 'exact' | 'partial' | 'multiple' | 'none';
  matchedCars: Vehicle[];
} {
  const normQuery = normalizePlate(value);
  if (!normQuery) {
    return { matchType: 'none', matchedCars: [] };
  }

  // 1. Exact match on normalized number
  const exactMatches = vehicles.filter(car => {
    const vNum = car.carNumber || car.vehicleNumbers || '';
    return normalizePlate(vNum) === normQuery;
  });

  if (exactMatches.length === 1) {
    return { matchType: 'exact', matchedCars: exactMatches };
  } else if (exactMatches.length > 1) {
    return { matchType: 'multiple', matchedCars: exactMatches };
  }

  // 2. Partial/soft search if no exact match
  const partialMatches = vehicles.filter(car => {
    const vNum = car.carNumber || car.vehicleNumbers || '';
    const normV = normalizePlate(vNum);
    return normV.includes(normQuery) || normQuery.includes(normV);
  });

  if (partialMatches.length === 1) {
    return { matchType: 'partial', matchedCars: partialMatches };
  } else if (partialMatches.length > 1) {
    return { matchType: 'multiple', matchedCars: partialMatches };
  }

  return { matchType: 'none', matchedCars: [] };
}

/**
 * Looks up a driver from the drivers pool by their ID.
 */
export function getDriverById(driverId: string, drivers: Driver[]): Driver | undefined {
  if (!driverId) return undefined;
  return drivers.find(d => d.id === driverId);
}

/**
 * Finds mapped driverId for a given vehicle using the driversMap mapping.
 */
export function getDriverIdForCar(car: Vehicle, driversMap: Record<string, string>): string | undefined {
  if (!driversMap) return undefined;
  
  // Try exact carNumber or vehicleNumbers in mapping
  if (car.carNumber && driversMap[car.carNumber]) {
    return driversMap[car.carNumber];
  }
  if (car.vehicleNumbers && driversMap[car.vehicleNumbers]) {
    return driversMap[car.vehicleNumbers];
  }

  // Try normalized match on keys
  const normCarPlate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
  const foundKey = Object.keys(driversMap).find(k => normalizePlate(k) === normCarPlate);
  if (foundKey) {
    return driversMap[foundKey];
  }

  return undefined;
}
