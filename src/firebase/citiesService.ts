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
import { ref, set } from 'firebase/database';
import { database, useFirebase, onValue, getLocalStorageData, dbService } from '../firebase';
import { citySlug, normalizeCityName, CITY_KINDS, type CityKind } from '../utils/cityDirectory';

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
  /** 'migration' — из миграции, 'user' — добавлен пользователем. */
  source: string;
  author?: string;
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
  author: raw.author != null ? String(raw.author) : undefined,
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
