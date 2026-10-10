/**
 * Сопоставление автопарка портала с объектами Nav.by.
 *
 * Госномер — только подсказка: автоприсвоение допускается лишь при
 * ОДНОЗНАЧНОМ совпадении (ровно один автомобиль портала и ровно один объект
 * Nav.by с одинаковым нормализованным номером). Любая неоднозначность
 * (дубликаты на любой стороне) уходит в конфликты, которые решает
 * администратор в интерфейсе модуля.
 */

import type { NormalizedNavbyObject } from './parse.ts';

/**
 * Кириллица белорусских/российских номеров в латиницу; остальные символы —
 * только буквы/цифры, нижний регистр. «О421ХХ31» и «O421XX31» дают один и
 * тот же ключ. Пробелы, дефисы и точки игнорируются.
 */
const CYR_TO_LAT: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p',
  с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ё: 'e', б: 'b', г: 'g',
  д: 'd', ж: 'j', з: 'z', и: 'i', й: 'i', л: 'l', п: 'p', ф: 'f', ц: 'c',
  ч: 'c', ш: 's', щ: 's', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'y', я: 'y',
};

export function plateNormalize(v: string | null | undefined): string {
  if (!v) return '';
  let out = '';
  for (const ch of v.toLowerCase()) {
    if (CYR_TO_LAT[ch] !== undefined) out += CYR_TO_LAT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

export interface MatchCarInput {
  carKey: string;
  plate: string | null;
  label?: string;
}

export interface MatchObjectInput {
  objectId: string;
  uid: string | null;
  autoNumber: string | null;
  name?: string;
  status: NormalizedNavbyObject['status'] | string;
}

export interface AutoMatch {
  carKey: string;
  objectId: string;
  imei: string | null;
  plateNormalized: string;
  /** Госномер как в справочнике портала — для отображения (не для сверки). */
  plateRaw: string | null;
}

export interface FleetMatchConflict {
  plateNormalized: string;
  carKeys: string[];
  objectIds: string[];
  carsCount: number;
  objectsCount: number;
}

export interface FleetMatchResult {
  /** Однозначные пары — можно предложить автопривязку (source auto_plate). */
  auto: AutoMatch[];
  /** Неоднозначности: дубликаты номеров на любой стороне. */
  conflicts: FleetMatchConflict[];
  /** Автомобили портала без однозначного объекта (в т.ч. с пустым номером). */
  unmatchedCars: MatchCarInput[];
  /** Объекты Nav.by без однозначного автомобиля (включая приостановленные). */
  unmatchedObjects: MatchObjectInput[];
}

/**
 * Чистая функция сопоставления. Вызывающий сам решает, применять ли
 * автоприсвоение (портал применяет только к парам `auto`).
 */
export function matchFleet(cars: MatchCarInput[], objects: MatchObjectInput[]): FleetMatchResult {
  const carsByPlate = new Map<string, MatchCarInput[]>();
  for (const c of cars) {
    const key = plateNormalize(c.plate);
    if (!key) continue;
    const arr = carsByPlate.get(key) || [];
    arr.push(c);
    carsByPlate.set(key, arr);
  }
  const objectsByPlate = new Map<string, MatchObjectInput[]>();
  for (const o of objects) {
    // Имя объекта тоже бывает госномером («АР 9694-7» в object_name при пустом
    // auto_number не встречалось, но name подтверждён как номер у части объектов).
    const key = plateNormalize(o.autoNumber) || plateNormalize(o.name);
    if (!key) continue;
    const arr = objectsByPlate.get(key) || [];
    arr.push(o);
    objectsByPlate.set(key, arr);
  }

  const auto: AutoMatch[] = [];
  const conflicts: FleetMatchConflict[] = [];
  const matchedCarKeys = new Set<string>();
  const matchedObjectIds = new Set<string>();

  for (const [plate, carList] of carsByPlate) {
    const objList = objectsByPlate.get(plate) || [];
    if (carList.length === 1 && objList.length === 1) {
      if (matchedCarKeys.has(carList[0].carKey) || matchedObjectIds.has(objList[0].objectId)) continue;
      auto.push({
        carKey: carList[0].carKey,
        objectId: objList[0].objectId,
        imei: objList[0].uid,
        plateNormalized: plate,
        plateRaw: carList[0].plate,
      });
      matchedCarKeys.add(carList[0].carKey);
      matchedObjectIds.add(objList[0].objectId);
      continue;
    }
    if (objList.length > 0) {
      conflicts.push({
        plateNormalized: plate,
        carKeys: carList.map((c) => c.carKey),
        objectIds: objList.map((o) => o.objectId),
        carsCount: carList.length,
        objectsCount: objList.length,
      });
    }
  }

  const unmatchedCars = cars.filter((c) => !matchedCarKeys.has(c.carKey));
  const unmatchedObjects = objects.filter((o) => !matchedObjectIds.has(o.objectId));

  return { auto, conflicts, unmatchedCars, unmatchedObjects };
}
