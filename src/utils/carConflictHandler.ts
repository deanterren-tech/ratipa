import { Vehicle } from "../types";

export interface CarConflict {
  field: string;
  oldValue: any;
  newValue: any;
}

export const detectCarDataConflict = (oldCar: Vehicle, newCar: Partial<Vehicle>): CarConflict[] => {
  const conflicts: CarConflict[] = [];

  const fieldsToCheck: (keyof Vehicle)[] = [
    "trailerNumber",
    "driverId",
    "driverName",
    "tariffId"
  ];

  for (const field of fieldsToCheck) {
    if (newCar[field] !== undefined && newCar[field] !== oldCar[field]) {
      conflicts.push({
        field,
        oldValue: oldCar[field],
        newValue: newCar[field]
      });
    }
  }

  return conflicts;
};
