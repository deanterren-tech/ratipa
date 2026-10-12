/**
 * Справочник городов клиента: подписка на ветку `cities` (верхний уровень),
 * поиск похожих и добавление нового города пользователем (source: 'user').
 *
 * Устройство как у остальных справочников портала:
 *  - одна разделяемая подписка на всех слушателей (кэш + пул отписок);
 *  - режим без Firebase (локалка) — значения живут в localStorage
 *    (`ratipa_dir_cities`), как у directoryService;
 *  - запись — только по явному действию пользователя (CityAutocomplete
 *    спрашивает подтверждение), с полями source/author/createdAt.
 *
 * Старые данные и сами города никуда не переносятся: справочник независим,
 * текстовые значения рейсов/этапов остаются как были.
 */
import { ref, set, update, remove } from 'firebase/database';
import { database, useFirebase, onValue, getLocalStorageData, dbService } from '../firebase';
import { citySlug, normalizeCityName, CITY_KINDS, type CityKind } from '../utils/cityDirectory';
import { resolveGeonamesSettings, type GeonamesSettings } from '../utils/geonames';
import { isCityAdmin, canAddCity, DENY_ADMIN_ONLY, DENY_ADD } from '../utils/cityRights';

/** Административные роли: удаление и объединение дублей — только им. */
export const ADMIN_ROLES = ['root_admin', 'admin'];
export { isCityAdmin };

const writeLocal = <T,>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[citiesService] localStorage write failed:', e);
  }
};

export interface CityRecord {
  id: string;
  name: string;
  country: string;
  aliases: string[];
  type: CityKind | string;
  usageCount: number;
  createdAt: string;
  /** 'migration' — из миграции, 'user' — добавлен пользователем, 'geonames' — импорт GeoNames. */
  source: string;
  author?: string;
  /** GeoNames-поля (заполняются импортом; могут отсутствовать). */
  geonameId?: number;
  lat?: number;
  lng?: number;
  population?: number;
  updatedAt?: string;
  /** id записей, объединённых в эту (история объединения, только admin). */
  mergedFrom?: string[];
}

export interface AddCityInput {
  name: string;
  country: string;
  type: CityKind;
  aliases?: string[];
}

export interface AddCityResult {
  ok: boolean;
  /** Запись справочника (существующая или созданная). */
  city?: CityRecord;
  /** true — запись уже была (дубликат не создавался). */
  existed?: boolean;
  error?: string;
}

const LS_KEY = 'ratipa_dir_cities';

const toRecord = (id: string, raw: Record<string, unknown>): CityRecord => ({
  id,
  name: String(raw.name ?? ''),
  country: String(raw.country ?? ''),
  aliases: Array.isArray(raw.aliases) ? (raw.aliases as unknown[]).map((a) => String(a)) : [],
  type: String(raw.type ?? 'город'),
  usageCount: Number(raw.usageCount) || 0,
  createdAt: String(raw.createdAt ?? ''),
  source: String(raw.source ?? ''),
  author: raw.author != null && raw.author !== '' ? String(raw.author) : undefined,
  geonameId: raw.geonameId != null ? Number(raw.geonameId) || undefined : undefined,
  lat: raw.lat != null ? Number(raw.lat) : undefined,
  lng: raw.lng != null ? Number(raw.lng) : undefined,
  population: raw.population != null ? Number(raw.population) || 0 : undefined,
  updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : undefined,
  mergedFrom: Array.isArray(raw.mergedFrom) ? (raw.mergedFrom as unknown[]).map(String) : undefined,
});

// ---------------------------------------------------------------------------
// Разделяемая подписка (кэш + пул слушателей, как у sharedDir* в firebase.ts)
// ---------------------------------------------------------------------------
let cache: CityRecord[] | null = null;
const listeners = new Set<(cities: CityRecord[]) => void>();
let liveUnsub: (() => void) | null = null;
let teardown: ReturnType<typeof setTimeout> | null = null;

const emit = (): void => {
  const list = cache || [];
  listeners.forEach((cb) => cb(list));
};

const ensureSubscription = (): void => {
  if (teardown) {
    clearTimeout(teardown);
    teardown = null;
  }
  if (liveUnsub) return;
  if (!useFirebase) {
    cache = getLocalStorageData<CityRecord[]>(LS_KEY, []);
    queueMicrotask(emit);
    return;
  }
  liveUnsub = onValue(
    ref(database, 'cities'),
    (snap: { val: () => unknown }) => {
      const val = snap.val();
      cache = val && typeof val === 'object'
        ? Object.entries(val as Record<string, Record<string, unknown>>).map(([id, raw]) => toRecord(id, raw || {}))
        : [];
      emit();
    },
    () => {
      if (cache === null) {
        cache = getLocalStorageData<CityRecord[]>(LS_KEY, []);
        emit();
      }
    },
  );
};

const scheduleTeardown = (): void => {
  if (teardown) clearTimeout(teardown);
  teardown = setTimeout(() => {
    if (listeners.size === 0 && liveUnsub) {
      liveUnsub();
      liveUnsub = null;
    }
  }, 5000);
};

/** Подписка на справочник городов. Возвращает функцию отписки. */
export const subscribeCities = (cb: (cities: CityRecord[]) => void): (() => void) => {
  ensureSubscription();
  listeners.add(cb);
  if (cache) cb(cache);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) scheduleTeardown();
  };
};

/** Текущий снимок справочника (если уже загружен). */
export const citiesSnapshot = (): CityRecord[] => cache || [];

/** Все формы имён записи (имя + алиасы), нормализованные. */
const formsOf = (city: CityRecord): string[] =>
  [city.name, ...city.aliases].map((v) => normalizeCityName(v)).filter(Boolean);

/** Найти запись по значению (имя или алиас). */
export const findCityByName = (value: string, cities?: CityRecord[]): CityRecord | null => {
  const norm = normalizeCityName(value);
  if (!norm) return null;
  const list = cities || cache || [];
  return list.find((c) => formsOf(c).includes(norm)) || null;
};

/**
 * Добавить город в справочник (source: 'user').
 * Идемпотентно: если запись с таким же нормализованным именем/алиасом уже
 * есть — новая НЕ создаётся, возвращается существующая.
 */
export const addCity = (input: AddCityInput, author: string, role = 'dispatcher'): AddCityResult => {
  if (!canAddCity(role)) return { ok: false, error: DENY_ADD };
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const norm = normalizeCityName(name);
  if (!norm) return { ok: false, error: 'Пустое название города' };
  if (name.length > 80) return { ok: false, error: 'Слишком длинное название города' };
  const country = String(input.country || '').trim();
  const type: CityKind = CITY_KINDS.includes(input.type) ? input.type : 'город';
  if (!country) return { ok: false, error: 'Укажите страну' };

  const existing = findCityByName(name);
  if (existing) return { ok: true, city: existing, existed: true };

  const list = cache || [];
  let id = citySlug(name);
  // защита от коллизии id с другой записью
  if (list.some((c) => c.id === id && !formsOf(c).includes(norm))) {
    let n = 2;
    while (list.some((c) => c.id === `${id}-${n}`)) n += 1;
    id = `${id}-${n}`;
  }
  const record: CityRecord = {
    id,
    name,
    country,
    aliases: (input.aliases || []).map((a) => String(a).trim()).filter((a) => a && normalizeCityName(a) !== norm),
    type,
    usageCount: 0,
    createdAt: new Date().toISOString(),
    source: 'user',
    author,
  };

  try {
    if (useFirebase) {
      const payload: Record<string, unknown> = {
        id: record.id,
        name: record.name,
        country: record.country,
        aliases: record.aliases,
        type: record.type,
        usageCount: record.usageCount,
        createdAt: record.createdAt,
        source: record.source,
        author: record.author ?? '',
      };
      set(ref(database, `cities/${id}`), payload).catch((err) => {
        console.error('[citiesService] addCity failed:', err);
      });
    } else {
      const local = getLocalStorageData<CityRecord[]>(LS_KEY, []);
      writeLocal(LS_KEY, [...local, record]);
    }
    // оптимистично: сразу видно автодополнению, сервер догонит
    cache = [...(cache || []), record];
    emit();
    dbService.logAction(author, role, 'Добавление города', 'cities', id, `Справочник городов: ${record.name} (${country}, ${type})`);
    return { ok: true, city: record, existed: false };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
};

/** Только для тестов/пробного профиля: подсунуть снимок справочника. */
export const __setCitiesForTests = (list: CityRecord[] | null): void => {
  cache = list;
  emit();
};

// ---------------------------------------------------------------------------
// Удаление и объединение дублей — ТОЛЬКО администратор (роль проверяется здесь)
// ---------------------------------------------------------------------------

export interface CityAdminResult {
  ok: boolean;
  error?: string;
  city?: CityRecord;
}

/**
 * Удалить запись справочника. Разрешено только администратору
 * (root_admin/admin) — и в UI, и здесь (сервисная проверка).
 */
export const deleteCity = (id: string, user: string, role: string): CityAdminResult => {
  if (!isCityAdmin(role)) {
    return { ok: false, error: DENY_ADMIN_ONLY };
  }
  const rec = (cache || []).find((c) => c.id === id);
  if (!rec) return { ok: false, error: 'Запись не найдена' };
  try {
    if (useFirebase) {
      remove(ref(database, `cities/${id}`)).catch((err) => {
        console.error('[citiesService] deleteCity failed:', err);
      });
    } else {
      const local = getLocalStorageData<CityRecord[]>(LS_KEY, []).filter((c) => c.id !== id);
      writeLocal(LS_KEY, local);
    }
    cache = (cache || []).filter((c) => c.id !== id);
    emit();
    dbService.logAction(user, role, 'Удаление города', 'cities', id, `Справочник городов: удалён ${rec.name}`);
    return { ok: true, city: rec };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
};

export interface MergeCitiesResult extends CityAdminResult {
  /** Сколько записей объединено (удалено) в целевую. */
  mergedCount?: number;
}

/**
 * Объединить дубли: алиасы и usageCount переносятся в целевую запись,
 * объединяемые записи УДАЛЯЮТСЯ (дубли не плодятся), к целевой добавляется
 * след mergedFrom. Имя/тип/страна/источник целевой записи не меняются.
 * Разрешено только администратору.
 */
export const mergeCities = (keepId: string, mergeIds: string[], user: string, role: string): MergeCitiesResult => {
  if (!isCityAdmin(role)) {
    return { ok: false, error: DENY_ADMIN_ONLY };
  }
  const list = cache || [];
  const keep = list.find((c) => c.id === keepId);
  if (!keep) return { ok: false, error: 'Целевая запись не найдена' };
  const toMerge = mergeIds
    .filter((id) => id && id !== keepId)
    .map((id) => list.find((c) => c.id === id))
    .filter((c): c is CityRecord => !!c);
  if (!toMerge.length) return { ok: false, error: 'Нет записей для объединения' };

  const haveNorms = new Set([keep, ].flatMap((c) => [c.name, ...c.aliases]).map((v) => normalizeCityName(v)));
  const addAliases: string[] = [];
  toMerge.forEach((m) => {
    [m.name, ...m.aliases].forEach((f) => {
      const norm = normalizeCityName(f);
      if (norm && !haveNorms.has(norm)) {
        haveNorms.add(norm);
        addAliases.push(f);
      }
    });
  });
  const now = new Date().toISOString();
  const mergedFrom = Array.from(new Set([...(keep.mergedFrom || []), ...toMerge.map((m) => m.id)]));
  const updatedKeep: CityRecord = {
    ...keep,
    aliases: [...keep.aliases, ...addAliases.filter((a) => !keep.aliases.includes(a))],
    usageCount: keep.usageCount + toMerge.reduce((s, m) => s + (m.usageCount || 0), 0),
    mergedFrom,
    updatedAt: now,
  };

  try {
    if (useFirebase) {
      const patches: Record<string, unknown> = {
        [`cities/${keep.id}/aliases`]: updatedKeep.aliases,
        [`cities/${keep.id}/usageCount`]: updatedKeep.usageCount,
        [`cities/${keep.id}/mergedFrom`]: mergedFrom,
        [`cities/${keep.id}/updatedAt`]: now,
      };
      toMerge.forEach((m) => { patches[`cities/${m.id}`] = null; });
      update(ref(database), patches).catch((err) => {
        console.error('[citiesService] mergeCities failed:', err);
      });
    } else {
      const local = getLocalStorageData<CityRecord[]>(LS_KEY, [])
        .filter((c) => !toMerge.some((m) => m.id === c.id))
        .map((c) => (c.id === keepId ? updatedKeep : c));
      writeLocal(LS_KEY, local);
    }
    cache = list.filter((c) => !toMerge.some((m) => m.id === c.id)).map((c) => (c.id === keepId ? updatedKeep : c));
    emit();
    dbService.logAction(
      user, role, 'Объединение дублей городов', 'cities', keepId,
      `«${keep.name}» ← ${toMerge.map((m) => `«${m.name}»(${m.id})`).join(', ')}; алиасов +${addAliases.length}`,
    );
    return { ok: true, city: updatedKeep, mergedCount: toMerge.length };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
};

// ---------------------------------------------------------------------------
// Настройки GeoNames (appSettings/geonames): чтение и запись (admin)
// ---------------------------------------------------------------------------

const GEONAMES_SETTINGS_PATH = 'appSettings/geonames';
const GEONAMES_LS_KEY = 'ratipa_geonames_settings';
let geonamesCache: GeonamesSettings | null = null;
const geonamesListeners = new Set<(s: GeonamesSettings) => void>();
let geonamesUnsub: (() => void) | null = null;

const emitGeonames = (): void => {
  const s = geonamesCache || resolveGeonamesSettings(null);
  geonamesListeners.forEach((cb) => cb(s));
};

/** Подписка на настройки GeoNames (страны ISO + пороги населения). */
export const subscribeGeonamesSettings = (cb: (s: GeonamesSettings) => void): (() => void) => {
  geonamesListeners.add(cb);
  if (geonamesCache) cb(geonamesCache);
  if (!geonamesUnsub) {
    if (!useFirebase) {
      geonamesCache = resolveGeonamesSettings(getLocalStorageData<GeonamesSettings | null>(GEONAMES_LS_KEY, null));
      queueMicrotask(emitGeonames);
    } else {
      geonamesUnsub = onValue(
        ref(database, GEONAMES_SETTINGS_PATH),
        (snap: { val: () => unknown }) => {
          geonamesCache = resolveGeonamesSettings(snap.val());
          emitGeonames();
        },
        () => {
          geonamesCache = geonamesCache || resolveGeonamesSettings(null);
          emitGeonames();
        },
      );
    }
  }
  return () => {
    geonamesListeners.delete(cb);
  };
};

export const geonamesSettingsSnapshot = (): GeonamesSettings => geonamesCache || resolveGeonamesSettings(null);

/** Сохранить настройки GeoNames. Только администратор. */
export const saveGeonamesSettings = (
  settings: GeonamesSettings,
  user: string,
  role: string,
): { ok: boolean; error?: string; settings?: GeonamesSettings } => {
  if (!isCityAdmin(role)) {
    return { ok: false, error: 'Недостаточно прав: настройки GeoNames — только администратор' };
  }
  const clean = resolveGeonamesSettings(settings);
  try {
    const payload = {
      countries: clean.countries,
      threshold: clean.threshold,
      smallThreshold: clean.smallThreshold,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    };
    if (useFirebase) {
      update(ref(database, GEONAMES_SETTINGS_PATH), payload).catch((err) => {
        console.error('[citiesService] saveGeonamesSettings failed:', err);
      });
    } else {
      writeLocal(GEONAMES_LS_KEY, payload);
    }
    geonamesCache = clean;
    emitGeonames();
    dbService.logAction(
      user, role, 'Настройки GeoNames', GEONAMES_SETTINGS_PATH, 'geonames',
      `Страны: ${clean.countries.join(', ')}; порог ${clean.threshold}/${clean.smallThreshold}`,
    );
    return { ok: true, settings: clean };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
};
