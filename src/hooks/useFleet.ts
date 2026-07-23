import {useState, useEffect} from 'react';
import {subscribeFleetUnits, getFleetUnitsOnce, type FleetUnit} from '../services/fleetService';

/**
 * Единая база сцепок (авто + прицеп + водитель + диспетчер).
 * Все модули берут данные отсюда — один источник истины.
 */

/** Все сцепки (FleetUnit[]) — подписка на единую базу. */
export function useFleetUnits(): FleetUnit[] {
  const [units, setUnits] = useState<FleetUnit[]>([]);
  useEffect(() => {
    const unsub = subscribeFleetUnits(setUnits);
    return unsub;
  }, []);
  return units;
}

/** Одна сцепка по carNumber/ couplingId (изменяемая связка). */
export function useFleetUnit(carNumber: string): { unit: FleetUnit | null; loading: boolean } {
  const [unit, setUnit] = useState<FleetUnit | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!carNumber) { setUnit(null); setLoading(false); return; }
    const key = carNumber.replace(/[^А-ЯA-Z0-9]/g, '').toUpperCase();
    const unsub = subscribeFleetUnits((units) => {
      const found = units.find((u) =>
        normStr(u.tractor?.carNumber) === key ||
        normStr(u.couplingId) === key
      ) || null;
      setUnit(found);
      setLoading(false);
    });
    return unsub;
  }, [carNumber]);
  return { unit, loading };
}

const normStr = (s?: string): string =>
  (s || '').toString().replace(/[^А-ЯA-Z0-9]/g, '').toUpperCase();
