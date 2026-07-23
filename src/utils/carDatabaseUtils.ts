import { Vehicle } from "../types";

// Assuming we have a way to access the vehicles data. 
// Given the shared subscription pattern in src/firebase.ts, we might need a function to get it.
// For now, these utilities will assume they receive the full vehicles array.

export const findCarByPlate = (vehicles: Vehicle[], plate: string): Vehicle | undefined => {
  if (!plate) return undefined;
  const normalizedPlate = plate.replace(/\s+/g, "").toUpperCase();
  return vehicles.find(
    (v) => v.carNumber.replace(/\s+/g, "").toUpperCase() === normalizedPlate
  );
};

export const getCarCoupling = (vehicle: Vehicle) => {
  return {
    carNumber: vehicle.carNumber,
    trailerNumber: vehicle.trailerNumber || null,
  };
};

export const getCarDriver = (vehicle: Vehicle) => {
  return {
    driverName: vehicle.driverName,
    driverId: vehicle.driverId,
  };
};

export const getCarSalaryTariff = (vehicle: Vehicle) => {
  return vehicle.tariffId || null;
};
