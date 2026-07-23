import { ref, get, set, update } from 'firebase/database';
import { database } from '../api';
import { Driver, Vehicle } from '../types';

/**
 * Formats a driver's name to a short Russian format "LastName I.O."
 * Handles either a Driver object, or separate lastName, firstName, middleName strings.
 */
export function formatDriverShortName(
  driverOrLastName: any,
  firstName?: string,
  middleName?: string
): string {
  if (!driverOrLastName) return '';
  let last = '';
  let first = '';
  let middle = '';

  if (typeof driverOrLastName === 'object') {
    last = driverOrLastName.lastNameRu || '';
    first = driverOrLastName.firstNameRu || '';
    middle = driverOrLastName.middleNameRu || '';
    // Fallback to parsing drv.name if parts are empty
    if (!last && driverOrLastName.name) {
      const parts = driverOrLastName.name.trim().split(/\s+/);
      last = parts[0] || '';
      first = parts[1] || '';
      middle = parts[2] || '';
    }
  } else {
    last = driverOrLastName || '';
    if (last.includes(' ') && !firstName) {
      const parts = last.trim().split(/\s+/);
      last = parts[0] || '';
      first = parts[1] || '';
      middle = parts[2] || '';
    } else {
      first = firstName || '';
      middle = middleName || '';
    }
  }

  last = last.trim();
  first = first.trim();
  middle = middle.trim();

  if (!last) return '';

  let initials = '';
  if (first) {
    initials += ' ' + first[0].toUpperCase() + '.';
    if (middle) {
      initials += middle[0].toUpperCase() + '.';
    }
  }

  return `${last}${initials}`;
}

/**
 * Retrieves the short format name for a driver by driverId.
 */
export function getDriverShortName(driverId: string, drivers?: Driver[]): string {
  if (!driverId) return '';
  if (drivers) {
    const drv = drivers.find(d => d.id === driverId);
    if (drv) {
      return drv.shortNameRu || formatDriverShortName(drv);
    }
  }
  return '';
}

/**
 * Syncs the driver's shortNameRu as a cached driverName to the vehicle record.
 */
export async function syncDriverShortNameToCar(carId: string, driverId: string, drivers?: Driver[]): Promise<void> {
  if (!carId) return;

  let shortName = '';
  if (driverId) {
    if (drivers) {
      shortName = getDriverShortName(driverId, drivers);
    } else {
      const drvSnap = await get(ref(database, `driversPool/${driverId}`));
      if (drvSnap.exists()) {
        const drvData = drvSnap.val();
        shortName = drvData.shortNameRu || formatDriverShortName({ ...drvData, id: driverId });
      }
    }
  }

  await update(ref(database, `vehicleFleet/${carId}`), {
    driverId: driverId || null,
    driverName: shortName || null,
  });
}

/**
 * Automatically applies driver fields (driverId, shortNameRu) from a vehicle to a form.
 */
export function applyDriverFromCarToForm(
  carId: string,
  drivers: Driver[],
  vehicles: Vehicle[]
): { driverId: string; shortNameRu: string } | null {
  if (!carId) return null;
  const car = vehicles.find(v => v.id === carId);
  if (!car || !car.driverId) return null;

  const shortName = getDriverShortName(car.driverId, drivers);
  return {
    driverId: car.driverId,
    shortNameRu: shortName,
  };
}

/**
 * Normalizes an existing/legacy driver name string into "LastName I.O." if possible.
 */
export function normalizeExistingDriverValue(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();

  // Try parsing "LastName I.O." (with optional spaces)
  const shortFormatMatch = trimmed.match(/^([а-яА-ЯёЁa-zA-Z\-]+)\s+([а-яА-ЯёЁa-zA-Z])\.?\s*([а-яА-ЯёЁa-zA-Z])\.?$/);
  if (shortFormatMatch) {
    const last = shortFormatMatch[1];
    const firstInit = shortFormatMatch[2].toUpperCase();
    const midInit = shortFormatMatch[3].toUpperCase();
    return `${last} ${firstInit}.${midInit}.`;
  }
  
  const shortFormatSingleMatch = trimmed.match(/^([а-яА-ЯёЁa-zA-Z\-]+)\s+([а-яА-ЯёЁa-zA-Z])\.?$/);
  if (shortFormatSingleMatch) {
    const last = shortFormatSingleMatch[1];
    const firstInit = shortFormatSingleMatch[2].toUpperCase();
    return `${last} ${firstInit}.`;
  }

  // Parse "Last First Middle" full name
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[0];
    const first = parts[1];
    const middle = parts[2] || '';
    let initials = first[0].toUpperCase() + '.';
    if (middle) {
      initials += middle[0].toUpperCase() + '.';
    }
    return `${last} ${initials}`;
  }

  return trimmed;
}

/**
 * Migrates existing driver names in database to shortNameRu and synchronizes relations.
 */
export async function migrateExistingDriverNames(): Promise<{ migratedCount: number }> {
  let count = 0;

  try {
    // 1. Fetch and migrate driversPool
    const driversSnap = await get(ref(database, 'driversPool'));
    const driversMap: Record<string, Driver> = {};
    if (driversSnap.exists()) {
      const data = driversSnap.val();
      for (const key of Object.keys(data)) {
        const d = data[key];
        const parsedDriver: Driver = {
          id: key,
          name: d.name || '',
          lastNameRu: d.lastNameRu || '',
          firstNameRu: d.firstNameRu || '',
          middleNameRu: d.middleNameRu || '',
          lastNameLat: d.lastNameLat || '',
          firstNameLat: d.firstNameLat || '',
          middleNameLat: d.middleNameLat || '',
          shortNameRu: d.shortNameRu || '',
          shortNameLat: d.shortNameLat || '',
          phone: d.phone || '',
          license: d.license || '',
          rateGroupId: d.rateGroupId || '',
          comment: d.comment || '',
        };

        // Split name if lastNameRu is missing
        if (!parsedDriver.lastNameRu && parsedDriver.name) {
          const parts = parsedDriver.name.trim().split(/\s+/);
          parsedDriver.lastNameRu = parts[0] || '';
          parsedDriver.firstNameRu = parts[1] || '';
          parsedDriver.middleNameRu = parts[2] || '';
        }

        // Compute shortNameRu
        parsedDriver.shortNameRu = formatDriverShortName(parsedDriver);
        
        // Save back to DB
        await set(ref(database, `driversPool/${key}`), parsedDriver);
        driversMap[key] = parsedDriver;
        count++;
      }
    }

    // 2. Fetch and migrate vehicleFleet (cache driverName as shortNameRu, assign driverId)
    const fleetSnap = await get(ref(database, 'vehicleFleet'));
    if (fleetSnap.exists()) {
      const data = fleetSnap.val();
      for (const key of Object.keys(data)) {
        const v = data[key];
        let dId = v.driverId || '';
        let dName = v.driverName || '';

        // Try matching by name if driverId is missing but we have a driverName
        if (!dId && dName) {
          const normName = dName.trim().toLowerCase();
          const foundDriver = Object.values(driversMap).find(drv => 
            drv.name.trim().toLowerCase() === normName ||
            drv.shortNameRu?.trim().toLowerCase() === normName
          );
          if (foundDriver) {
            dId = foundDriver.id;
            dName = foundDriver.shortNameRu || '';
          } else {
            dName = normalizeExistingDriverValue(dName);
          }
        } else if (dId && driversMap[dId]) {
          dName = driversMap[dId].shortNameRu || '';
        }

        await update(ref(database, `vehicleFleet/${key}`), {
          driverId: dId || null,
          driverName: dName || null,
        });
      }
    }

    // 3. Fetch and migrate salaryHistory (salaryLogs)
    const salarySnap = await get(ref(database, 'salaryHistory'));
    if (salarySnap.exists()) {
      const data = salarySnap.val();
      for (const key of Object.keys(data)) {
        const log = data[key];
        let dId = log.driverId || '';
        let dName = log.driver || '';

        if (!dId && dName) {
          const normName = dName.trim().toLowerCase();
          const foundDriver = Object.values(driversMap).find(drv => 
            drv.name.trim().toLowerCase() === normName ||
            drv.shortNameRu?.trim().toLowerCase() === normName
          );
          if (foundDriver) {
            dId = foundDriver.id;
            dName = foundDriver.shortNameRu || '';
          } else {
            dName = normalizeExistingDriverValue(dName);
          }
        } else if (dId && driversMap[dId]) {
          dName = driversMap[dId].shortNameRu || '';
        }

        await update(ref(database, `salaryHistory/${key}`), {
          driverId: dId || null,
          driver: dName || null,
        });
      }
    }
  } catch (err) {
    console.error('Migration failed:', err);
  }

  return { migratedCount: count };
}

export async function migrateExistingBazaDriverLinks() {
  try {
    const driversSnap = await get(ref(database, 'driversPool'));
    const driversMap: Record<string, Driver> = {};
    if (driversSnap.exists()) {
      const data = driversSnap.val();
      for (const key of Object.keys(data)) {
        driversMap[key] = data[key] as Driver;
      }
    }

    const bazaSnap = await get(ref(database, 'baza'));
    let matchedCount = 0;
    let ambiguousCount = 0;
    let unmatchedCount = 0;

    if (bazaSnap.exists()) {
      const data = bazaSnap.val();
      const updates: Record<string, any> = {};

      for (const key of Object.keys(data)) {
        const record = data[key];
        
        if (record.migrationStatus) continue; // Already migrated

        const currentDriverText = record.driverName || '';
        if (!currentDriverText.trim()) continue;

        const normName = currentDriverText.trim().toLowerCase();
        
        // Find possible matches
        const possibleMatches = Object.values(driversMap).filter(drv => {
          const names = [drv.name, drv.shortNameRu, drv.lastNameRu].map(n => (n || '').trim().toLowerCase());
          return names.some(n => n && n === normName) || 
                 (drv.lastNameRu && normName.includes(drv.lastNameRu.toLowerCase()));
        });

        const updateData: any = {
          driverRaw: currentDriverText,
        };

        if (possibleMatches.length === 1) {
          const match = possibleMatches[0];
          updateData.driverId = match.id;
          updateData.driverShortNameRu = match.shortNameRu || formatDriverShortName(match);
          updateData.driverName = updateData.driverShortNameRu; 
          updateData.migrationStatus = 'matched';
          matchedCount++;
        } else if (possibleMatches.length > 1) {
          updateData.migrationStatus = 'ambiguous';
          ambiguousCount++;
        } else {
          updateData.migrationStatus = 'unmatched';
          unmatchedCount++;
        }

        updates[`baza/${key}`] = { ...record, ...updateData };
      }

      if (Object.keys(updates).length > 0) {
        await update(ref(database), updates);
      }
    }

    return { matchedCount, ambiguousCount, unmatchedCount };
  } catch (err) {
    console.error('Baza migration failed:', err);
    throw err;
  }
}