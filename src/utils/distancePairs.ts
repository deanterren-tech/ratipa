/**
 * Расстояния: одна запись на пару мест.
 *
 * Пара не зависит от направления (Минск–Брест = Брест–Минск). Совпадение —
 * по cityId, если он есть у обеих записей, иначе по названию (регистр, «ё»,
 * лишние пробелы не важны). Чистые функции: ничего не читают и не пишут.
 */

export interface DistanceLike {
  id?: string;
  from?: string;
  to?: string;
  fromCityId?: string;
  toCityId?: string;
  distance?: number;
}

export const placeKey = (name: unknown): string =>
  String(name ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

const ends = (d: DistanceLike): { a: string; b: string; byCity: boolean } => {
  if (d.fromCityId && d.toCityId) return { a: `c:${d.fromCityId}`, b: `c:${d.toCityId}`, byCity: true };
  return { a: `n:${placeKey(d.from)}`, b: `n:${placeKey(d.to)}`, byCity: false };
};

/** Ключ пары без учёта направления; пусто — у записи нет одного из концов. */
export const pairKey = (d: DistanceLike): string => {
  const { a, b } = ends(d);
  if (a.length <= 2 || b.length <= 2) return '';
  return [a, b].sort().join('|');
};

const samePair = (x: DistanceLike, y: DistanceLike): boolean => {
  const kx = pairKey(x);
  if (kx && kx === pairKey(y)) return true;
  // Одна запись с городами, другая только с названиями — сравниваем по названиям.
  const nx = [placeKey(x.from), placeKey(x.to)].sort().join('|');
  const ny = [placeKey(y.from), placeKey(y.to)].sort().join('|');
  return !!placeKey(x.from) && !!placeKey(x.to) && nx === ny;
};

/** Существующая запись той же пары (в любом направлении), кроме самой записи. */
export const findSamePair = <T extends DistanceLike>(list: T[], d: DistanceLike): T | null =>
  list.find((x) => x && x.id !== d.id && samePair(x, d)) || null;

/** Запись расстояния между двумя местами (по названиям, направление не важно). */
export const lookupDistance = <T extends DistanceLike>(list: T[], from: string, to: string): T | null => {
  if (!placeKey(from) || !placeKey(to)) return null;
  return list.find((x) => x && samePair(x, { from, to })) || null;
};

export interface PairGroup<T> {
  key: string;
  records: T[];
  /** Разные значения км у записей одной пары — нужно решение. */
  conflict: boolean;
}

/** Группировка списка по парам — для плана объединения дублей. */
export const groupByPair = <T extends DistanceLike>(list: T[]): PairGroup<T>[] => {
  const groups: PairGroup<T>[] = [];
  for (const d of list) {
    if (!d) continue;
    const g = groups.find((x) => samePair(x.records[0], d));
    if (g) g.records.push(d);
    else groups.push({ key: pairKey(d) || `id:${d.id}`, records: [d], conflict: false });
  }
  groups.forEach((g) => {
    g.conflict = new Set(g.records.map((r) => Number(r.distance) || 0)).size > 1;
  });
  return groups;
};
