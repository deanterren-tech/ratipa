/**
 * Группы ставок: ОДИН источник — справочник directories/rateGroups.
 *
 * Принадлежность машины к группе хранится только в самой машине
 * (tractors/couplings → rateGroupId). Список машин группы, который показывают
 * «Настройки» и «Зарплата», вычисляется отсюда, а не хранится отдельно
 * (раньше — в carsPool, где группа «c2» имела другую ставку, чем в справочнике).
 * Чистые функции: ничего не читают и не пишут.
 */
import type { CarRateGroup } from '../types';

const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };

/** Номер машины для сравнения: тягач (до «/»), латиница, только буквы и цифры. */
export const plateKey = (plate: unknown): string =>
  String(plate ?? '')
    .split('/')[0]
    .toUpperCase()
    .replace(/[АВЕКМНОРСТХУ]/g, (c) => LOOKALIKE[c])
    .replace(/[^A-Z0-9]/g, '');

export interface FleetRecord {
  id: string;
  carNumber?: string;
  rateGroupId?: string | null;
}

export interface DirRateGroup {
  id?: string;
  key?: string;
  dbKey?: string;
  name?: string;
  rate?: number | string;
  perDiemRate?: number | string | null;
  comment?: string;
}

const plateOf = (r: FleetRecord): string => String(r.carNumber || r.id || '').trim();

/** Группы справочника со списком машин, вычисленным по rateGroupId. */
export const rateGroupsWithVehicles = (dir: DirRateGroup[], tractors: FleetRecord[], couplings: FleetRecord[]): CarRateGroup[] =>
  (dir || [])
    .filter((g) => g && (g.id || g.key || g.dbKey))
    .map((g) => {
      const id = String(g.id || g.dbKey || g.key);
      const seen = new Set<string>();
      const vehicles: string[] = [];
      for (const r of [...(tractors || []), ...(couplings || [])]) {
        if (!r || String(r.rateGroupId || '') !== id) continue;
        const p = plateOf(r);
        const k = plateKey(p);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        vehicles.push(p);
      }
      const per = g.perDiemRate == null || g.perDiemRate === '' ? undefined : Number(g.perDiemRate);
      return { id, name: String(g.name || id), rate: Number(g.rate) || 0, perDiemRate: per, vehicles, comment: g.comment || '' };
    });

/**
 * Изменения rateGroupId, чтобы в группе были ровно машины `plates`:
 * отмеченные получают id группы, убранные из списка — пустое значение.
 * Возвращает карту путей для одного update() и номера, которых нет в автопарке.
 */
export const membershipUpdates = (
  groupId: string,
  plates: string[],
  fleet: { tractors: FleetRecord[]; couplings: FleetRecord[] },
): { updates: Record<string, string>; unknownPlates: string[] } => {
  const want = new Set((plates || []).map(plateKey).filter(Boolean));
  const found = new Set<string>();
  const updates: Record<string, string> = {};
  for (const [root, list] of [['tractors', fleet.tractors], ['couplings', fleet.couplings]] as const) {
    for (const r of list || []) {
      if (!r?.id) continue;
      const k = plateKey(plateOf(r));
      const cur = String(r.rateGroupId || '');
      if (want.has(k)) {
        found.add(k);
        if (cur !== groupId) updates[`${root}/${r.id}/rateGroupId`] = groupId;
      } else if (cur === groupId) {
        updates[`${root}/${r.id}/rateGroupId`] = '';
      }
    }
  }
  const unknownPlates = (plates || []).filter((p) => plateKey(p) && !found.has(plateKey(p)));
  return { updates, unknownPlates };
};
