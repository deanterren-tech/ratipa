/**
 * Ядро приведения номеров авто к единому виду (чистые функции, без сети и записи).
 * Используется планом (plan-plate-unify.ts), применением (apply-plate-unify.ts) и тестом.
 */
import { formatPlate, plateKey } from '../../src/utils/plate';

export type Data = Record<string, any>;
export interface Change { path: string; before: string; after: string; kind: 'значение' | 'ключ' | 'id' | 'ссылка' | 'дубль' }

/** Журналы и история: не трогаем. */
export const SKIP_ALWAYS = new Set(['auditLogs', 'telemetry_history', 'telemetry_can_history', 'telemetry_can_coverage', 'telemetry_mapping_history', 'cities', 'appErrors', 'dozvolsHistoryV4', 'dozvolsHistoryV2', 'dozvolsDocumentsHistoryV1', 'global_history', 'agent_audit', 'agent_logs']);
/** Исключено по умолчанию (можно включить флагом --include): данные внешней синхронизации и журнал. */
export const SKIP_DEFAULT = ['telemetry_navby_objects', 'ratipa_zagruzok_log'];
export const FIELD = /^(carNumber|car|plateRaw|autoNumber|stateNumber|tractorPlate|vehicleNumbers)$/;
export const REF_FIELD = /^(couplingId|tractorId|carId|vehicleId)$/;
/** Коллекции, где КЛЮЧ записи — номер машины. */
export const KEYED = ['tractors', 'couplings', 'vehicle_statuses', 'vehicleFleet', 'telemetry_mapping', 'known_fleet', 'knownFleetCars'];

const walkStrings = (o: any, path: string, depth: number, fn: (path: string, key: string, v: string) => void) => {
  if (!o || typeof o !== 'object' || depth > 6) return;
  for (const [k, v] of Object.entries<any>(o)) {
    const p = `${path}/${k}`;
    if (typeof v === 'string') fn(p, k, v);
    else if (typeof v === 'object') walkStrings(v, p, depth + 1, fn);
  }
};

export const computeChanges = (data: Data, skip: Set<string>): Change[] => {
  const roots = Object.keys(data).filter((r) => !SKIP_ALWAYS.has(r) && !skip.has(r));
  const fleet = new Set(Object.entries<any>(data.tractors || {}).map(([k, v]) => plateKey(v?.carNumber || k)));
  const changes: Change[] = [];
  for (const r of roots) walkStrings(data[r], r, 0, (p, k, v) => {
    if (FIELD.test(k) && fleet.has(plateKey(v))) {
      const after = formatPlate(v);
      if (after !== v) changes.push({ path: p, before: v, after, kind: 'значение' });
    }
  });
  const renamed = new Map<string, string>(); // старый ключ → новый
  for (const r of KEYED) {
    if (SKIP_ALWAYS.has(r) || skip.has(r)) continue;
    for (const [k, v] of Object.entries<any>(data[r] || {})) {
      if (!fleet.has(plateKey(k)) || !/\d/.test(k)) continue;
      if (k !== plateKey(k)) { changes.push({ path: `${r}/${k}`, before: k, after: plateKey(k), kind: 'ключ' }); renamed.set(k, plateKey(k)); }
      if (v && typeof v === 'object') for (const f of ['id', 'tractorId'] as const)
        if (typeof v[f] === 'string' && fleet.has(plateKey(v[f])) && v[f] !== plateKey(v[f])) changes.push({ path: `${r}/${k}/${f}`, before: v[f], after: plateKey(v[f]), kind: 'id' });
    }
  }
  // Ссылки на старый ключ в других ветках (точное совпадение).
  const have = new Set(changes.map((c) => c.path));
  for (const r of roots) walkStrings(data[r], r, 0, (p, k, v) => {
    if (REF_FIELD.test(k) && renamed.has(v) && !have.has(p)) changes.push({ path: p, before: v, after: renamed.get(v)!, kind: 'ссылка' });
  });
  return changes;
};

export const getAt = (data: Data, path: string): any => path.split('/').reduce((o: any, k) => (o == null ? undefined : o[k]), data);
const setAt = (obj: any, parts: string[], val: any) => { let o = obj; parts.slice(0, -1).forEach((k) => { o = o[k]; }); o[parts[parts.length - 1]] = val; };

/** Все поля записи a уже есть в b с теми же значениями (a — «огрызок» b). */
const isSubset = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return Object.entries(a).every(([k, v]) => isSubset(v, b[k]));
};

export interface Built { updates: Record<string, unknown>; conflicts: Change[]; applied: Change[] }

/** Карта записи для одного multi-path update: переносы ключей — запись целиком + null на старом пути. */
export const buildUpdates = (data: Data, changes: Change[]): Built => {
  const updates: Record<string, unknown> = {};
  const conflicts: Change[] = [];
  const applied: Change[] = [];
  const moved = new Map<string, string>(); // `${root}/${old}` → new key
  for (const c of changes.filter((x) => x.kind === 'ключ')) {
    const [root] = c.path.split('/');
    const taken = [...moved].some(([m, nk]) => m.split('/')[0] === root && nk === c.after);
    const target = data[root]?.[c.after];
    if (target !== undefined && !taken && isSubset(getAt(data, c.path), target)) {
      // Двойник без собственных данных (всё уже есть в основной записи) — удаляется, ничего не теряется.
      updates[c.path] = null;
      applied.push({ ...c, kind: 'дубль' });
    } else if (target !== undefined || taken) conflicts.push(c);
    else moved.set(c.path, c.after);
  }
  const recordOf = new Map<string, any>();
  for (const [oldPath] of moved) recordOf.set(oldPath, structuredClone(getAt(data, oldPath)));
  for (const c of changes) {
    if (c.kind === 'ключ') continue;
    const owner = [...moved.keys()].find((m) => c.path.startsWith(`${m}/`));
    if (owner) {
      const rest = c.path.slice(owner.length + 1).split('/');
      const rec = recordOf.get(owner);
      if (getAt({ x: rec }, ['x', ...rest].join('/')) === c.before) setAt({ x: rec }, ['x', ...rest], c.after);
      applied.push(c);
    } else if (getAt(data, c.path) === c.before) { updates[c.path] = c.after; applied.push(c); }
  }
  for (const [oldPath, newKey] of moved) {
    const [root] = oldPath.split('/');
    updates[`${root}/${newKey}`] = recordOf.get(oldPath);
    updates[oldPath] = null;
    applied.push(changes.find((c) => c.kind === 'ключ' && c.path === oldPath)!);
  }
  return { updates, conflicts, applied };
};

/** Откат: прежние значения тех же путей (отсутствовавшее → null = удалить). */
export const buildRollback = (data: Data, updates: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.keys(updates).map((p) => [p, getAt(data, p) ?? null]));
