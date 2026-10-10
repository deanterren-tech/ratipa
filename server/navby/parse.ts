/**
 * Чистые функции разбора ответов Nav.by и решений о записи.
 * Не выполняют сетевых и БД-операций — покрываются мок-тестами
 * (scripts/test-navby.ts).
 *
 * Поля подтверждены живым чтением 10.10.2026 (см. config.ts).
 */

import {
  NAVBY_ODO_SOURCE,
  NAVBY_ODO_VIRT_SOURCE,
  parseNavbyDateTimeToMs,
} from './config.ts';

export type NavbyObjectStatus = 'active' | 'paused';

export interface NormalizedNavbyObject {
  objectId: string;
  uid: string | null;          // IMEI (object_uid)
  name: string;
  autoNumber: string | null;   // госномер как отдаёт nav.by
  garageNumber: string | null;
  status: NavbyObjectStatus;
}

export type OdoQuality = 'ok' | 'zero_missing' | 'absent';

export interface TelemetrySample {
  objectId: string;
  coordAtMs: number;           // UTC epoch мс (из datetime_unix либо разбора datetime)
  coordAt: string | null;      // исходная строка API (пояс +03:00)
  lat: number;
  lon: number;
  speed: number | null;        // км/ч; 0 — валидное «стоит»
  azimuth: number | null;
  satellites: number | null;   // sattelite (опечатка API)
  ignition: number | null;     // zazh
  gsm: number | null;          // gsm_lev
  place: string | null;        // place (адрес; только при get_address)
  country: string | null;
  countryCode: string | null;
  odoKm: number | null;        // odom_can; null = отсутствует/ноль-как-пусто
  odoPresent: boolean;
  odoQuality: OdoQuality;
  odoSource: string;
  odoVirtKm: number | null;    // odom_virt, если настроен (не смешивать с odom_can)
  odoVirtSource: string;
}

/** Число из значения API (числа приходят числами; строки тоже встречаются). */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Непустая строка или null. Пустая строка API ("") — это «нет значения». */
export function toStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/** Разбор элемента vehicle-list (все поля подтверждены живым ответом). */
export function normalizeNavbyObject(raw: Record<string, unknown>): NormalizedNavbyObject | null {
  const objectId = raw.object_id != null ? String(raw.object_id) : '';
  if (!objectId) return null;
  return {
    objectId,
    uid: toStr(raw.object_uid),
    name: toStr(raw.name) || toStr(raw.auto_number) || objectId,
    autoNumber: toStr(raw.auto_number),
    garageNumber: toStr(raw.garage_number),
    // status: "1" — активный, "0" — приостановленный (подтверждено).
    status: String(raw.status ?? '') === '1' ? 'active' : 'paused',
  };
}

/**
 * Разбор элемента current-position в измерение телеметрии.
 * Возвращает null, если запись непригодна (нет координат или времени).
 * ВАЖНО: отсутствующее значение не превращается в ноль; ноль одометра
 * не считается измерением (для парка это невозможно физически и в живом
 * ответе встречается у объектов без данных CAN — AK 3186-7).
 */
export function normalizePosition(raw: Record<string, unknown>): TelemetrySample | null {
  const lat = toNum(raw.latitude);
  const lon = toNum(raw.longitude);
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const unixSec = toNum(raw.datetime_unix);
  const coordAtMs = unixSec != null && unixSec > 0
    ? Math.round(unixSec * 1000)
    : parseNavbyDateTimeToMs(raw.datetime);
  if (coordAtMs == null) return null;

  const odoRaw = toNum(raw.odom_can);
  let odoKm: number | null = null;
  let odoQuality: OdoQuality = 'absent';
  if (odoRaw != null && odoRaw > 0) {
    odoKm = odoRaw;
    odoQuality = 'ok';
  } else if (odoRaw === 0) {
    odoQuality = 'zero_missing'; // 0 одометра трактуем как «данных нет», не как пробег 0
  }

  const virtRaw = toNum(raw.odom_virt);
  const odoVirtKm = virtRaw != null && virtRaw > 0 ? virtRaw : null;

  return {
    objectId: String(raw.object_id ?? ''),
    coordAtMs,
    coordAt: toStr(raw.datetime),
    lat,
    lon,
    speed: toNum(raw.speed),
    azimuth: toNum(raw.azimuth),
    satellites: toNum(raw.sattelite),
    ignition: toNum(raw.zazh),
    gsm: toNum(raw.gsm_lev),
    place: toStr(raw.place),
    country: toStr(raw.country),
    countryCode: toStr(raw.country_shot),
    odoKm,
    odoPresent: odoKm != null,
    odoQuality,
    odoSource: NAVBY_ODO_SOURCE,
    odoVirtKm,
    odoVirtSource: NAVBY_ODO_VIRT_SOURCE,
  };
}

export interface NewSampleDecision {
  isNew: boolean;
  reason: 'new' | 'same_timestamp' | 'older';
}

/**
 * Решение «новое ли измерение». Повторный ответ с той же меткой времени
 * (или старее) новым измерением не считается — иначе история забивается
 * дублями при опросе чаще, чем трекер шлёт данные.
 */
export function decideNewSample(prevCoordAtMs: number | null | undefined, sampleCoordAtMs: number): NewSampleDecision {
  if (prevCoordAtMs == null) return { isNew: true, reason: 'new' };
  if (sampleCoordAtMs > prevCoordAtMs) return { isNew: true, reason: 'new' };
  if (sampleCoordAtMs === prevCoordAtMs) return { isNew: false, reason: 'same_timestamp' };
  return { isNew: false, reason: 'older' };
}
