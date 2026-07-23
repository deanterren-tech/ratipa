import {useState, useEffect, useMemo} from 'react';
import {subscribeFleetUnits, getFleetUnitsOnce, type FleetUnit} from '../services/fleetService';

/**
 * Единая база сцепок (авто + прицеп + водитель + диспетчер).
 * Возвращает все FleetUnit с уже разрешёнными связями.
 * Это замена разрозненным подпискам на vehicleFleet / driversPool /
 * directories/dispatchers внутри модулей.
 */
export const useFleetUnits = (): {
  units: FleetUnit[];
  loading: boolean;
} => {
  const [units, setUnits] = useState<FleetUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeFleetUnits((list) => {
      setUnits(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  return {units, loading};
};

/**
 * Изменяемая связка: выбрал carNumber (авто) → подтягиваются
 * прицеп, водитель и диспетчер (разрешённые сущности).
 * Если carNumber не задан — возвращает пустую сцепку.
 */
export const useFleetUnit = (carNumber?: string | null): {
  unit: FleetUnit | null;
  loading: boolean;
} => {
  const {units, loading} = useFleetUnits();
  const unit = useMemo(
    () => (carNumber ? units.find((u) => u.carNumber === carNumber) || null : null),
    [units, carNumber],
  );
  return {unit, loading};
};

/**
 * Разовый снапшот всех сцепок (без подписки) — для форм/экспорта.
 */
export const useFleetUnitsSnapshot = (): FleetUnit[] => {
  const [snap, setSnap] = useState<FleetUnit[]>([]);
  useEffect(() => {
    getFleetUnitsOnce(setSnap);
  }, []);
  return snap;
};
