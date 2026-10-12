/**
 * GeoNames: чистая логика импорта городов (разбор официальных TSV-дампов,
 * отбор по странам/порогам, решение «создать/дополнить/пропустить»).
 * Без сети, без базы, без React — всё тестируется на мок-TSV.
 *
 * Источник данных: https://download.geonames.org/export/dump/
 *  - cities5000.zip / cities15000.zip — населённые пункты (TSV UTF-8);
 *  - alternateNamesV2.zip — альтернативные названия (в т.ч. isoLanguage=ru).
 *
 * Идемпотентность (правила импорта):
 *  - сначала поиск по geonameId, затем по нормализованному названию/алиасам;
 *  - при совпадении — ДОПОЛНИТЬ aliases/geonameId/координаты/population
 *    (только ЗАПОЛНЯЕМ отсутствующее), НЕ переименовываем и НЕ затираем
 *    существующие значения;
 *  - записи с type ≠ «город» (граница/таможня/терминал) не трогаем вовсе —
 *    они ведутся вручную/миграцией;
 *  - дубли по нормализованному названию не создаются (в т.ч. внутри прогона).
 */
import { normalizeCityName, hasCyrillic, citySlug } from './cityDirectory';

// ---------------------------------------------------------------------------
// Настройки (страны ISO и пороги населения)
// ---------------------------------------------------------------------------

/** Страны по умолчанию (ISO-2). */
export const GEONAMES_DEFAULT_COUNTRIES = ['BY', 'RU', 'KZ', 'CN', 'TR', 'UZ', 'TJ', 'AM', 'GE', 'MN', 'KG'];

/** Порог населения по умолчанию. */
export const GEONAMES_DEFAULT_THRESHOLD = 15000;

/** Страны с пониженным порогом (мало городов выше общего порога). */
export const GEONAMES_SMALL_COUNTRIES = ['BY', 'KZ', 'UZ', 'TJ', 'AM', 'GE', 'MN', 'KG'];

/** Пониженный порог для GEONAMES_SMALL_COUNTRIES. */
export const GEONAMES_SMALL_THRESHOLD = 5000;

export interface GeonamesSettings {
  /** ISO-2 коды стран. */
  countries: string[];
  /** Порог населения по умолчанию. */
  threshold: number;
  /** Пониженный порог для «малых» стран списка. */
  smallThreshold: number;
}

const isIso2 = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]{2}$/.test(v);

/** Настройки из базы/UI с безопасными значениями по умолчанию. */
export function resolveGeonamesSettings(raw: unknown): GeonamesSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const countries = Array.isArray(o.countries)
    ? Array.from(new Set((o.countries as unknown[]).filter(isIso2).map((c) => c.toUpperCase())))
    : [];
  const threshold = Math.max(0, Math.floor(Number(o.threshold) || 0));
  const smallThreshold = Math.max(0, Math.floor(Number(o.smallThreshold) || 0));
  return {
    countries: countries.length ? countries : [...GEONAMES_DEFAULT_COUNTRIES],
    threshold: threshold || GEONAMES_DEFAULT_THRESHOLD,
    smallThreshold: smallThreshold || GEONAMES_SMALL_THRESHOLD,
  };
}

/** Порог населения для страны с учётом «малых» стран. */
export const thresholdForCountry = (settings: GeonamesSettings, country: string): number =>
  GEONAMES_SMALL_COUNTRIES.includes(String(country).toUpperCase()) ? settings.smallThreshold : settings.threshold;

// ---------------------------------------------------------------------------
// Разбор TSV
// ---------------------------------------------------------------------------

export interface GeonamesRow {
  geonameId: number;
  name: string;
  asciiname: string;
  alternateNames: string[];
  lat: number;
  lng: number;
  featureClass: string;
  featureCode: string;
  country: string;
  population: number;
}

/**
 * Строка cities5000.txt / cities15000.txt (19 колонок, табуляции):
 * 0 geonameid, 1 name, 2 asciiname, 3 alternatenames, 4 lat, 5 lng,
 * 6 fclass, 7 fcode, 8 country, 9 cc2, 10 admin1..14 dem, 15 timezone, 16 mdate.
 */
export function parseCitiesRow(line: string): GeonamesRow | null {
  if (!line) return null;
  const c = line.split('\t');
  if (c.length < 15) return null;
  const geonameId = Number(c[0]);
  if (!Number.isFinite(geonameId) || geonameId <= 0) return null;
  const name = (c[1] || '').trim();
  const asciiname = (c[2] || '').trim();
  if (!name && !asciiname) return null;
  const lat = Number(c[4]);
  const lng = Number(c[5]);
  return {
    geonameId,
    name,
    asciiname,
    alternateNames: (c[3] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
    featureClass: (c[6] || '').trim(),
    featureCode: (c[7] || '').trim(),
    country: (c[8] || '').trim().toUpperCase(),
    population: Number(c[14]) || 0,
  };
}

export interface AltNameRow {
  geonameId: number;
  language: string;
  name: string;
  isPreferred: boolean;
  isHistoric: boolean;
}

/**
 * Строка alternateNamesV2.txt:
 * 0 id, 1 geonameid, 2 isolanguage, 3 alternate name, 4 isPreferredName,
 * 5 isShortName, 6 isColloquial, 7 isHistoric, 8 from, 9 to.
 */
export function parseAlternateNameRow(line: string): AltNameRow | null {
  if (!line) return null;
  const c = line.split('\t');
  if (c.length < 5) return null;
  const geonameId = Number(c[1]);
  if (!Number.isFinite(geonameId) || geonameId <= 0) return null;
  const lang = (c[2] || '').trim().toLowerCase();
  const name = (c[3] || '').trim();
  if (!lang || !name) return null;
  return {
    geonameId,
    language: lang,
    name,
    isPreferred: (c[4] || '').trim() === '1',
    isHistoric: (c[7] || '').trim() === '1',
  };
}

// ---------------------------------------------------------------------------
// Отбор городов
// ---------------------------------------------------------------------------

/** Класс «P» — населённые пункты; берём только его. Столицы — всегда. */
export const isCityRow = (r: GeonamesRow): boolean => r.featureClass === 'P';

/** Проходит ли город фильтр по стране и порогу населения (столицы — всегда). */
export function passesCityFilter(r: GeonamesRow, settings: GeonamesSettings): boolean {
  if (!settings.countries.includes(r.country)) return false;
  if (!isCityRow(r)) return false;
  if (r.featureCode === 'PPLC') return true;
  return r.population >= thresholdForCountry(settings, r.country);
}

export function pickGeonamesCities(rows: Iterable<GeonamesRow>, settings: GeonamesSettings): GeonamesRow[] {
  const out: GeonamesRow[] = [];
  for (const r of rows) if (passesCityFilter(r, settings)) out.push(r);
  return out;
}

// ---------------------------------------------------------------------------
// Запись справочника из строки GeoNames
// ---------------------------------------------------------------------------

/** Максимум латинских алиасов (англ. и прочие), чтобы не раздувать записи. */
const MAX_LATIN_ALIASES = 8;

export interface GeonamesCity {
  geonameId: number;
  /** Русское имя (isoLanguage=ru, isPreferred приоритетно), иначе основное. */
  name: string;
  /** Английское/латинское имя (asciiname), иначе основное. */
  asciiName: string;
  /** Прочие написания: другие ru-варианты и латинские из дампа. */
  aliases: string[];
  country: string;
  lat: number;
  lng: number;
  population: number;
}

/**
 * Город из строки дампа + собранных ru-имён (map geonameId → имена).
 * name — русское (предпочтительное, иначе первое), иначе asciiname/name.
 * aliases — остальные формы: другие ru-варианты, латиница из alternatenames.
 */
export function buildGeonamesCity(row: GeonamesRow, ruNames?: string[]): GeonamesCity {
  const rus = (ruNames || []).map((s) => String(s).trim()).filter(Boolean);
  const name = rus[0] || row.asciiname || row.name;
  const asciiName = row.asciiname || row.name;
  const seen = new Set<string>();
  /** «Грубый» ключ без пунктуации: отсекает варианты Skidel’ / Skidel' / Skidel. */
  const loose = (s: string): string => normalizeCityName(s).replace(/[^a-zа-я0-9]/g, '');
  const seenLoose = new Set<string>([loose(name)]);
  const aliases: string[] = [];
  let latinCount = 0;
  const add = (v: string, latin: boolean): void => {
    const s = String(v || '').trim();
    if (!s) return;
    const norm = normalizeCityName(s);
    if (!norm || norm === normalizeCityName(name)) return;
    const lo = loose(s);
    if (seen.has(norm) || (lo && seenLoose.has(lo))) return;
    if (latin) {
      // латиница: только привычные символы (без иврита/арабицы и прочих раскладок)
      if (!/^[A-Za-z0-9 .,'’\-()/]+$/.test(s)) return;
      if (latinCount >= MAX_LATIN_ALIASES) return;
      latinCount += 1;
    }
    seen.add(norm);
    if (lo) seenLoose.add(lo);
    aliases.push(s);
  };
  rus.slice(1).forEach((a) => add(a, false));
  row.alternateNames.forEach((a) => {
    if (hasCyrillic(a)) return;
    add(a, true);
  });
  if (normalizeCityName(asciiName) !== normalizeCityName(name)) add(asciiName, true);
  return {
    geonameId: row.geonameId,
    name,
    asciiName,
    aliases,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    population: row.population,
  };
}

/** Стабильный id записи для нового города (`gn-` не нужен: слаг имени). */
export function slugForCity(city: GeonamesCity): string {
  return citySlug(city.name);
}

// ---------------------------------------------------------------------------
// Идемпотентное решение «создать / дополнить / пропустить»
// ---------------------------------------------------------------------------

export interface ExistingCityEntry {
  id: string;
  name: string;
  aliases?: string[];
  type?: string;
  source?: string;
  country?: string;
  geonameId?: number;
  lat?: number;
  lng?: number;
  population?: number;
}

export interface ImportDecision {
  action: 'create' | 'extend' | 'skip';
  /** Существующая запись (при extend/skip). */
  id?: string;
  /** Человекочитаемая причина решения. */
  reason: string;
  /** Алиасы для дополнения (только отсутствующие формы). */
  addAliases: string[];
  /** Проставляемые поля (только отсутствующие/пустые). */
  patch: Record<string, unknown>;
}

const formsOf = (c: { name: string; aliases?: string[] }): string[] =>
  [c.name, ...(c.aliases || [])].map((v) => normalizeCityName(v)).filter(Boolean);

/** Поля существующей записи не перезаписываются — только дополняются пустые. */
export function decideCityImport(city: GeonamesCity, existing: ExistingCityEntry | null): ImportDecision {
  if (!existing) {
    return { action: 'create', reason: 'новая запись', addAliases: [], patch: {} };
  }
  if (existing.type && existing.type !== 'город') {
    return {
      action: 'skip',
      id: existing.id,
      reason: `существующая запись не город (${existing.type}) — не трогаем`,
      addAliases: [],
      patch: {},
    };
  }
  const have = new Set(formsOf(existing));
  const cityForms = [city.name, city.asciiName, ...city.aliases];
  const seen = new Set<string>();
  const addAliases: string[] = [];
  for (const f of cityForms) {
    const norm = normalizeCityName(f);
    if (!norm || have.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    addAliases.push(String(f).trim());
  }
  const patch: Record<string, unknown> = {};
  if (!existing.geonameId) patch.geonameId = city.geonameId;
  if (existing.lat == null || existing.lng == null || (existing.lat === 0 && existing.lng === 0)) {
    patch.lat = city.lat;
    patch.lng = city.lng;
  }
  if (!existing.population) patch.population = city.population;
  if (!existing.country && city.country) patch.country = city.country;
  if (!addAliases.length && !Object.keys(patch).length) {
    return { action: 'skip', id: existing.id, reason: 'уже полное совпадение (идемпотентно, без изменений)', addAliases: [], patch: {} };
  }
  return {
    action: 'extend',
    id: existing.id,
    reason: addAliases.length || Object.keys(patch).length ? 'дополнение отсутствующих полей' : 'без изменений',
    addAliases,
    patch,
  };
}

/**
 * Индекс существующих записей: geonameId → id и норм. форма (имя/алиасы) → id.
 * Дополняется по ходу импорта созданными/дополненными записями (защита от
 * дублей внутри прогона).
 */
export class CityIndex {
  private byGeonameId = new Map<number, string>();
  private byForm = new Map<string, string>();
  private entries = new Map<string, ExistingCityEntry>();

  constructor(list: Array<ExistingCityEntry & { id: string }>) {
    list.forEach((c) => this.add(c));
  }

  add(c: ExistingCityEntry & { id: string }): void {
    this.entries.set(c.id, c);
    if (c.geonameId) this.byGeonameId.set(c.geonameId, c.id);
    formsOf(c).forEach((f) => {
      if (!this.byForm.has(f)) this.byForm.set(f, c.id);
    });
  }

  getById(id: string): ExistingCityEntry | undefined {
    return this.entries.get(id);
  }

  /** Поиск: сначала по geonameId, затем по нормализованному имени/алиасам. */
  find(city: GeonamesCity): ExistingCityEntry | null {
    const byGeo = this.byGeonameId.get(city.geonameId);
    if (byGeo) return this.entries.get(byGeo) || null;
    for (const f of [city.name, city.asciiName, ...city.aliases]) {
      const norm = normalizeCityName(f);
      if (!norm) continue;
      const id = this.byForm.get(norm);
      if (id) return this.entries.get(id) || null;
    }
    return null;
  }

  /** Уникальный id для нового города (слаги + детерминированные суффиксы). */
  uniqueId(city: GeonamesCity): string {
    let id = slugForCity(city);
    if (!this.entries.has(id)) return id;
    // коллизия: тот же слаг, но другая запись — та же норма? если та же, это дубль (не создаём)
    let n = 2;
    while (this.entries.has(`${id}-${n}`)) n += 1;
    return `${id}-${n}`;
  }
}
