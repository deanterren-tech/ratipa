/**
 * Где используется запись справочника — чтобы не удалить то, на что ссылаются
 * карточки авто, водителей и рейсы (иначе в карточках остаются «висячие»
 * ссылки: группа ставок без записи, марка без пункта списка).
 *
 * Чистые функции: данные приходят параметрами, ничего не читается и не пишется.
 */
import { brandCompareKey, type BrandKind } from './vehicleRecordNormalize';

export type UsageCollection = 'vehicleBrands' | 'trailerBrands' | 'rateGroups' | 'directions';

export interface UsageData {
  tractors?: unknown;
  couplings?: unknown;
  trailers?: unknown;
  drivers?: unknown;
  /** Рейсы таймлайна/дашборда: поле direction — название направления. */
  trips?: unknown;
}

export interface UsageItem {
  id?: string;
  key?: string;
  dbKey?: string;
  name?: string;
  label?: string;
}

const records = (src: unknown): Array<Record<string, unknown>> => {
  if (!src || typeof src !== 'object') return [];
  const list = Array.isArray(src) ? src : Object.values(src as Record<string, unknown>);
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** «Тягач / прицеп» в одном поле: для тягача первая часть, для прицепа последняя. */
const partOf = (kind: BrandKind, text: string): string => {
  const parts = text.split('/').map((p) => p.trim()).filter(Boolean);
  return (kind === 'trailer' ? parts[parts.length - 1] : parts[0]) || text;
};

const VEHICLE_FIELDS = ['brand', 'brandModel', 'brands'];
const TRAILER_FIELDS = ['trailerMake', 'trailerBrand', 'brand'];

/** Сколько записей ссылается на элемент справочника (0 — можно удалять). */
export const directoryUsageCount = (collection: UsageCollection, item: UsageItem, data: UsageData): number => {
  if (collection === 'rateGroups') {
    const ids = new Set([item.id, item.key, item.dbKey].filter((x): x is string => !!x));
    if (!ids.size) return 0;
    let n = 0;
    for (const src of [data.tractors, data.couplings, data.drivers]) {
      n += records(src).filter((r) => ids.has(str(r.rateGroupId))).length;
    }
    return n;
  }
  if (collection === 'directions') {
    const names = new Set([item.label, item.name].map(str).filter(Boolean));
    if (!names.size) return 0;
    return records(data.trips).filter((t) => names.has(str(t.direction))).length;
  }
  const kind: BrandKind = collection === 'vehicleBrands' ? 'vehicle' : 'trailer';
  const target = brandCompareKey(kind, str(item.key) || str(item.name));
  if (!target) return 0;
  const fields = kind === 'vehicle' ? VEHICLE_FIELDS : TRAILER_FIELDS;
  // Карточка авто и сцепка: у сцепки марки тягача и прицепа лежат в разных полях.
  const sources = kind === 'vehicle' ? [data.tractors, data.couplings] : [data.tractors, data.couplings, data.trailers];
  let n = 0;
  for (const src of sources) {
    for (const r of records(src)) {
      const own = kind === 'trailer' && src === data.trailers ? ['brand'] : fields.filter((f) => !(kind === 'trailer' && f === 'brand'));
      if (own.some((f) => str(r[f]) && brandCompareKey(kind, partOf(kind, str(r[f]))) === target)) n += 1;
    }
  }
  return n;
};
