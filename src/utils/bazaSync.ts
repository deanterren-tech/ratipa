import { getDatabase, ref, get, update, push, set } from 'firebase/database';
import { database } from '../firebase';

export function normalizePlate(value: string): string {
  if (!value) return '';
  return value.toUpperCase().replace(/[^А-ЯA-Z0-9]/g, '');
}

export function resolveDriverForCar(carId: string, cars: any[], drivers: any[]): any {
  const car = cars.find(c => c.id === carId);
  if (!car) return null;
  if (car.driverId) {
    const driver = drivers.find(d => d.id === car.driverId);
    if (driver) return driver;
  }
  return null;
}

export function applySharedCarToBazaRecord(bazaRecord: any, cars: any[]): any {
  if (!bazaRecord.carId) return bazaRecord;
  const car = cars.find(c => c.id === bazaRecord.carId);
  if (!car) return bazaRecord;
  return {
    ...bazaRecord,
    carNumber: car.vehicleNumbers || car.carNumber || bazaRecord.carNumber,
    brandModel: car.brands || car.brandModel || bazaRecord.brandModel,
  };
}

export function applySharedDriverToBazaRecord(bazaRecord: any, drivers: any[]): any {
  if (!bazaRecord.driverId) return { ...bazaRecord, driverShortNameRu: bazaRecord.driverShortNameRu || bazaRecord.driverName || '— (Нет водителя)' };
  const driver = drivers.find(d => d.id === bazaRecord.driverId);
  if (!driver) return { ...bazaRecord, driverShortNameRu: bazaRecord.driverShortNameRu || bazaRecord.driverName || '— (Водитель удален)' };
  return {
    ...bazaRecord,
    driverShortNameRu: driver.shortNameRu || driver.name,
    driverName: driver.shortNameRu || driver.name,
  };
}

export async function migrateLegacyBazaCars() {
  const db = database;
  const vfSnap = await get(ref(db, 'vehicleFleet'));
  const bazaSnap = await get(ref(db, 'baza'));
  
  const vfData = vfSnap.val() || {};
  const bazaData = bazaSnap.val() || {};
  
  const updates: any = {};
  
  const masterCars: Record<string, any> = {};
  Object.keys(vfData).forEach(key => {
    const car = vfData[key];
    const norm = normalizePlate(car.carNumber || car.vehicleNumbers);
    if (norm) {
      if (!masterCars[norm] || (!masterCars[norm].driverId && car.driverId)) {
        masterCars[norm] = { id: key, ...car };
      }
    }
  });

  Object.keys(vfData).forEach(key => {
    const record = vfData[key];
    if (record.dateArrival || record.dateLoading || record.dateDeparture || record.dateRepairStart || record.status === 'archive') {
      if (!bazaData[key]) {
        const norm = normalizePlate(record.carNumber || record.vehicleNumbers);
        const masterCar = masterCars[norm];
        const newBazaRec = {
          ...record,
          carId: masterCar ? masterCar.id : null,
          driverId: masterCar ? masterCar.driverId : record.driverId,
          isLegacyMigrated: true
        };
        updates[`baza/${key}`] = newBazaRec;
      }
    }
  });

  Object.keys(bazaData).forEach(key => {
    const record = bazaData[key];
    if (!record.carId && record.carNumber) {
      const norm = normalizePlate(record.carNumber);
      const masterCar = masterCars[norm];
      if (masterCar) {
        updates[`baza/${key}/carId`] = masterCar.id;
        if (!record.driverId && masterCar.driverId) {
          updates[`baza/${key}/driverId`] = masterCar.driverId;
        }
      }
    }
  });

  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
  
  return { migrated: Object.keys(updates).length };
}
