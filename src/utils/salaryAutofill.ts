import { Vehicle, Driver } from '../types';

// — existing normalizePlate stays unchanged —

export function normalizePlate(value: string): string {
  return (value || '').toUpperCase().trim().replace(/[^A-ZА-Я0-9]/gi, '');
}

/** Белорусский транслит кириллица → латиница для госномеров. */
const CYR_TO_LAT: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'І': 'I', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'а': 'a', 'в': 'b', 'е': 'e', 'і': 'i', 'к': 'k', 'м': 'm',
  'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'х': 'x',
};

function translitPlate(s: string): string {
  return s.split('').map(c => CYR_TO_LAT[c] || c).join('');
}

/**
 * Formats a license plate for display.
 * 
 * Belarusian tractor plate (2 letters + 5 digits): AB92717 → AB 9271-7
 * Belarusian trailer plate (1 letter + 4 digits + 1 letter + 1 digit): A2416E7 → A2416E-7
 * Otherwise returns the normalized value.
 */
export function formatPlate(value: string): string {
  if (!value) return '';
  const norm = normalizePlate(value);
  if (!norm) return value;

  // Convert Cyrillic to Latin for pattern matching (belarusian plates)
  const lat = translitPlate(norm);

  // Tractor: 2 letters + 5 digits → "AB 9271-7"
  if (/^[A-Z]{2}\d{5}$/.test(lat)) {
    return norm.slice(0, 2) + ' ' + norm.slice(2, 6) + '-' + norm.slice(6);
  }
  // Trailer: 1 letter + 4 digits + 1 letter + 1 digit → "A2416E-7"
  if (/^[A-Z]\d{4}[A-Z]\d$/.test(lat)) {
    return norm.slice(0, 6) + '-' + norm.slice(6);
  }
  // Other known short formats — keep normalized
  return norm;
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