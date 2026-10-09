/**
 * Дубли активных записей «Учёта выезда»: чистая логика (без React и базы).
 *
 * Стабильный ключ записи — «машина + период + класс»: номер (в любой
 * раскладке кириллица/латиница) + дата приезда + активность (активная запись
 * или архив). Две АКТИВНЫЕ записи одной машины с одинаковым приездом — дубль:
 * он возникает при повторной отправке формы добавления и раньше приводил к
 * двум полосам на таймлайне при одной записи в модуле.
 *
 * Правила:
 *  - при создании (BazaModule) дубль не создаётся: findActiveDuplicate находит
 *    существующую активную запись с той же машиной и датой приезда;
 *  - при чтении/слиянии (bazaToBasePeriods) дубли схлопываются по тому же
 *    ключу: остаётся самая «живая» запись (свежайшее событие журнала, затем
 *    больше событий, затем стабильный id) — та же запись, что показывает модуль;
 *  - архивные записи с тем же приездом НЕ считаются дублем активной (это
 *    история), класс активности входит в ключ;
 *  - записи без даты приезда не группируются: период неизвестен.
 */

export interface BazaDedupeRecord {
  id: string;
  [key: string]: unknown;
}

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E',
};
const LAT_TO_CYR: Record<string, string> = Object.fromEntries(
  Object.entries(CYR_TO_LAT).map(([cyr, lat]) => [lat, cyr]),
);

const norm = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');

/** Варианты ключа номера: как есть + латиница + кириллица (раскладка клавиатуры). */
export const plateVariants = (s: unknown): string[] => {
  const raw = String(s ?? '');
  const out = new Set<string>();
  [raw, [...raw].map((ch) => CYR_TO_LAT[ch] || ch).join(''), [...raw].map((ch) => LAT_TO_CYR[ch] || ch).join('')].forEach(
    (v) => {
      const k = norm(v);
      if (k) out.add(k);
    },
  );
  const first = norm(raw.split('/')[0]);
  if (first) out.add(first);
  return [...out];
};

/** Совпадают ли номера машин с учётом раскладки. */
export const samePlate = (a: unknown, b: unknown): boolean => {
  const va = new Set(plateVariants(a));
  return plateVariants(b).some((k) => va.has(k));
};

export const isArchivedRecord = (r: BazaDedupeRecord): boolean =>
  String(r.status || '') === 'archive' || r.isArchived === true;

/** ISO-дата (YYYY-MM-DD) или '' — день приезда. */
const arrivalIso = (r: BazaDedupeRecord): string => String(r.dateArrival || '').slice(0, 10);

/** Стабильный ключ дубля: номер (нормализованный) + приезд + класс активности. */
export const bazaDupKey = (r: BazaDedupeRecord): string =>
  `${plateVariants(r.carNumber)[0] || ''}|${arrivalIso(r)}|${isArchivedRecord(r) ? 'arch' : 'act'}`;

const historyEntries = (r: BazaDedupeRecord): Array<{ date?: string }> => {
  const h = r.history;
  if (!h || typeof h !== 'object') return [];
  return Object.values(h as Record<string, { date?: string }>);
};

/** Время последнего события журнала записи (DD/MM/YYYY HH:mm), 0 — журнала нет. */
export const recordActivityMs = (r: BazaDedupeRecord): number => {
  let best = 0;
  historyEntries(r).forEach((h) => {
    const m = String(h?.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!m) return;
    const ms = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
    if (ms > best) best = ms;
  });
  return best;
};

const recordActivityCount = (r: BazaDedupeRecord): number => historyEntries(r).length;

/** Активная запись той же машины с той же датой приезда (дубль для формы создания). */
export const findActiveDuplicate = <T extends BazaDedupeRecord>(
  records: T[],
  carNumber: unknown,
  dateArrival: unknown,
): T | null => {
  const iso = String(dateArrival || '').slice(0, 10);
  if (!iso) return null;
  return (
    (records || []).find(
      (r) => r && !isArchivedRecord(r) && arrivalIso(r) === iso && samePlate(r.carNumber, carNumber),
    ) || null
  );
};

export interface BazaDedupeResult<T extends BazaDedupeRecord> {
  kept: T[];
  /** Схлопнутые дубли: что исключено из выборки и в пользу какой записи. */
  dropped: Array<{ dropped: T; keptId: string }>;
}

/** «Живее» ли a, чем b: свежайшее событие журнала → больше событий → стабильный id. */
const livelier = (a: BazaDedupeRecord, b: BazaDedupeRecord): boolean => {
  const ta = recordActivityMs(a);
  const tb = recordActivityMs(b);
  if (ta !== tb) return ta > tb;
  const ca = recordActivityCount(a);
  const cb = recordActivityCount(b);
  if (ca !== cb) return ca > cb;
  return a.id < b.id;
};

/**
 * Схлопывание дублей по стабильному ключу (машина + период + класс).
 * Возвращает записи без дублей и список схлопнутых — данные в базе не меняются.
 */
export const dedupeBazaRecords = <T extends BazaDedupeRecord>(records: T[]): BazaDedupeResult<T> => {
  const groups = new Map<string, T[]>();
  (records || []).forEach((r) => {
    if (!r || !r.id) return;
    if (!arrivalIso(r)) {
      // Период неизвестен — не дубль; уникальная группа на запись.
      groups.set(`noperiod|${r.id}`, [r]);
      return;
    }
    const key = bazaDupKey(r);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  });
  const kept: T[] = [];
  const dropped: Array<{ dropped: T; keptId: string }> = [];
  groups.forEach((list) => {
    if (list.length === 1) {
      kept.push(list[0]);
      return;
    }
    const winner = list.reduce((acc, cur) => (livelier(cur, acc) ? cur : acc), list[0]);
    kept.push(winner);
    list.forEach((r) => {
      if (r !== winner) dropped.push({ dropped: r, keptId: winner.id });
    });
  });
  return { kept, dropped };
};
