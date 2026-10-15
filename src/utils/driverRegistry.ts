/**
 * ЕДИНЫЙ РЕЕСТР ВОДИТЕЛЕЙ — общие правила для всех форм и списков портала.
 *
 * Основной источник: ветка RTDB `drivers`, постоянный идентификатор — ключ
 * записи (он же `id`). Все места выбора водителя (основной, второй,
 * авто+водитель, зарплата, учёт выезда) обязаны строить список ТОЛЬКО через
 * эти функции — тогда правила фильтра, поиска, порядка и подписей совпадают.
 *
 * Явные правила:
 *  - «Без водителя» — это ОТСУТСТВИЕ назначения (пустой id), а не человек.
 *    Записи-заглушки («без В.», «нет водителя»…), попавшие в реестр исторически,
 *    из выбора скрываются (isServiceDriver).
 *  - Архивные (`archived: true` / `active: false`) в новые назначения не
 *    предлагаются; уже назначенный архивный показывается с пометкой.
 *  - Ссылка на отсутствующую запись — видимая проблема связи
 *    (resolveDriverLink → status 'missing'), НЕ повод создать нового водителя.
 *  - Телефоны — только из единого поля `phones` (или старого `phone`);
 *    в записях портала независимые копии не создаются.
 */
import type { Driver, PhoneNumber } from '../types';

/**
 * «Фамилия И.О.» — та же форма, что у общего formatDriverShortName
 * (utils/driverSync), но БЕЗ импорта этого модуля: реестр водителей остаётся
 * чистым утилитарным кодом без цепочки firebase (его можно юнит-тестировать).
 */
function shortNameFromParts(last: unknown, first: unknown, middle: unknown): string {
  const l = String(last ?? '').trim();
  const f = String(first ?? '').trim();
  const m = String(middle ?? '').trim();
  if (!l) return '';
  let initials = '';
  if (f) {
    initials += ' ' + f[0].toUpperCase() + '.';
    if (m) initials += m[0].toUpperCase() + '.';
  }
  return `${l}${initials}`;
}

/**
 * Структурный тип записи реестра: обычный `Driver` ему удовлетворяет, а записи,
 * прочитанные из БД «как есть», не требуют грубых кастов.
 */
export interface DriverLike {
  id: string;
  name?: string;
  nameLat?: string;
  lastNameRu?: string;
  firstNameRu?: string;
  middleNameRu?: string;
  lastNameLat?: string;
  firstNameLat?: string;
  middleNameLat?: string;
  shortNameRu?: string;
  shortNameLat?: string;
  phone?: string;
  phones?: Array<{ id?: string; number?: string; isPrimary?: boolean; type?: string }>;
  license?: string;
  licenseNumber?: string;
  passport?: string;
  passportNumber?: string;
  personalId?: string;
  birthDate?: string;
  passportStart?: string;
  passportEnd?: string;
  passportIssued?: string;
  rateGroupId?: string;
  dispatcher?: string;
  dispatcherName?: string;
  dispatcherId?: string;
  comment?: string;
  /** Архивная запись: не предлагается в новых назначениях. */
  archived?: boolean;
  isArchived?: boolean;
  active?: boolean;
  /** Служебная запись-заглушка («без В.» и т.п.) — не человек. */
  service?: boolean;
  isService?: boolean;
}

/** Запись, у которой есть назначение водителя (машина, сцепка, рейс…). */
export interface DriverLinkCarrier {
  driverId?: string;
  driver2Id?: string;
  driverName?: string;
  driverNameRu?: string;
  driver2?: string;
  driver2Name?: string;
}

export type DriverRecord = DriverLike;

/** Состояние связи «запись ↔ водитель реестра» для форм и карточек. */
export type DriverLinkStatus = 'empty' | 'ok' | 'service' | 'archived' | 'missing';

export interface DriverLink {
  status: DriverLinkStatus;
  id: string;
  /** Имя для показа: из реестра, иначе сохранённый текст записи. */
  displayName: string;
  /** Телефон из реестра (основной), если есть. */
  phone: string;
}

/** Строка выпадающего списка выбора водителя. */
export interface DriverOption {
  id: string;
  name: string;
  shortNameRu: string;
  phone: string;
  archived: boolean;
}

const normText = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

/** Единая нормализация ФИО для сопоставлений (как в справочнике диспетчеров). */
export const normalizeDriverName = normText;

/** Цифры номера телефона — для поиска и сравнения (единая нормализация). */
export const normalizePhoneDigits = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

/** Нормализация телефона с ведущей 8 → 7 для поиска российских номеров. */
export const normalizePhone = (value: unknown): string => {
  const digits = normalizePhoneDigits(value);
  if (digits.length === 11 && digits.startsWith('8')) return '7' + digits.slice(1);
  return digits;
};

/** Телефоны водителя из единого поля `phones`, иначе — из старого `phone`. */
export type DriverPhone = PhoneNumber & { type?: string };

export function driverPhones(d: DriverLike | null | undefined): DriverPhone[] {
  if (!d) return [];
  const raw = Array.isArray(d.phones) ? d.phones : [];
  const list: DriverPhone[] = raw
    .map((p, i) => {
      const item: DriverPhone = {
        id: String(p?.id || `phone_${i + 1}`),
        number: String(p?.number ?? '').trim(),
        isPrimary: !!p?.isPrimary,
      };
      if (p?.type) item.type = String(p.type);
      return item;
    })
    .filter((p) => p.number !== '');
  if (list.length > 0) {
    if (!list.some((p) => p.isPrimary)) list[0].isPrimary = true;
    return list;
  }
  const legacy = String(d.phone ?? '').trim();
  if (legacy) return [{ id: 'phone_1', number: legacy, isPrimary: true }];
  return [];
}

export function primaryPhone(d: DriverLike | null | undefined): string {
  const phones = driverPhones(d);
  return (phones.find((p) => p.isPrimary) || phones[0])?.number || '';
}

/** Полное ФИО (рус): явное поле `name`, иначе сборка из частей. */
export function driverFullName(d: DriverLike | null | undefined): string {
  if (!d) return '';
  const explicit = String(d.name ?? '').trim();
  if (explicit) return explicit;
  const parts = [d.lastNameRu, d.firstNameRu, d.middleNameRu]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return parts.join(' ');
}

/** ФИО латиницей: явное `nameLat`, иначе сборка из частей. */
export function driverNameLat(d: DriverLike | null | undefined): string {
  if (!d) return '';
  const explicit = String(d.nameLat ?? '').trim();
  if (explicit) return explicit;
  return [d.lastNameLat, d.firstNameLat, d.middleNameLat]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Короткое имя «Фамилия И.О.» (вычисляется, если не сохранено). */
export function driverShortName(d: DriverLike | null | undefined): string {
  if (!d) return '';
  const explicit = String(d.shortNameRu ?? '').trim();
  if (explicit) return explicit;
  let last = String(d.lastNameRu ?? '').trim();
  let first = String(d.firstNameRu ?? '').trim();
  let middle = String(d.middleNameRu ?? '').trim();
  if (!last) {
    const parts = String(d.name ?? '').trim().split(/\s+/).filter(Boolean);
    last = parts[0] || '';
    first = parts[1] || '';
    middle = parts[2] || '';
  }
  return shortNameFromParts(last, first, middle) || driverFullName(d);
}

/**
 * Служебная запись-заглушка («без В.», «нет водителя»…) — это НЕ человек:
 * такие записи исторически создавалась текстом в полях, из списков выбора
 * должны исключаться (и показываться как «нет назначения»).
 */
export function isServiceDriver(d: DriverLike | null | undefined): boolean {
  if (!d) return false;
  if (d.service === true || d.isService === true) return true;
  const n = normText(driverFullName(d) || d.name);
  if (!n) return false;
  return /^(без\s*в\.?|без\s*водител[ья]|нет\s*водител[ья]|не\s*назначен[а]?|водитель\s*не\s*назначен|-+|—+|\.+|·)$/.test(n);
}

/** Архивная/неактивная запись: не предлагается в новых назначениях. */
export function isArchivedDriver(d: DriverLike | null | undefined): boolean {
  if (!d) return false;
  return d.archived === true || d.isArchived === true || d.active === false;
}

/** Годится ли запись для НОВОГО назначения (явный фильтр выбора). */
export function isSelectableDriver(d: DriverLike | null | undefined): boolean {
  if (!d) return false;
  if (!String(d.id ?? '').trim()) return false;
  if (driverFullName(d).trim().length < 2) return false;
  if (isServiceDriver(d)) return false;
  if (isArchivedDriver(d)) return false;
  return true;
}

/** Единый порядок списка: по ФИО, русская локаль (без учёта регистра). */
export function sortDrivers<T extends DriverLike>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    driverFullName(a).localeCompare(driverFullName(b), 'ru', { sensitivity: 'base' }),
  );
}

/** Кандидаты для выбора: явный фильтр + явный порядок. */
export function selectableDrivers<T extends DriverLike>(list: T[]): T[] {
  return sortDrivers((list || []).filter(isSelectableDriver));
}

/** Строка списка: ФИО + телефон (+ пометка архива). */
export function toDriverOption(d: DriverLike): DriverOption {
  return {
    id: String(d.id),
    name: driverFullName(d),
    shortNameRu: driverShortName(d),
    phone: primaryPhone(d),
    archived: isArchivedDriver(d),
  };
}

/** Поиск: по ФИО (рус/лат, любые части) и по нормализованному телефону. */
export function driverMatchesQuery(d: DriverLike, query: string): boolean {
  const q = String(query ?? '').trim();
  if (!q) return true;
  const qNorm = normText(q);
  const haystack = [
    driverFullName(d),
    driverNameLat(d),
    d.shortNameRu,
    d.shortNameLat,
    d.lastNameRu,
    d.firstNameRu,
    d.middleNameRu,
  ]
    .map((v) => normText(v))
    .filter(Boolean);
  if (haystack.some((h) => h.includes(qNorm))) return true;
  const qDigits = qNorm.replace(/[^\d+]/g, '');
  if (qDigits.length >= 3) {
    const qPhone = normalizePhone(qDigits);
    return driverPhones(d).some((p) => {
      const ph = normalizePhone(p.number);
      return ph.length > 0 && (ph.includes(qPhone) || qPhone.includes(ph));
    });
  }
  return false;
}

// ---------------------------------------------------------------------------
// Справочник и связь записей с ним (по образцу utils/dispatcher.ts)
// ---------------------------------------------------------------------------

export interface DriverDirectory {
  list: DriverLike[];
  byId: Map<string, DriverLike>;
  byName: Map<string, DriverLike>;
}

export function buildDriverDirectory(records: DriverLike[] = []): DriverDirectory {
  const list = (records || []).filter((d) => d && String(d.id ?? '').trim());
  const byId = new Map(list.map((d) => [String(d.id), d]));
  const byName = new Map<string, DriverLike>();
  for (const d of list) {
    const full = normText(driverFullName(d));
    if (full && !byName.has(full)) byName.set(full, d);
    const short = normText(d.shortNameRu || driverShortName(d));
    if (short && !byName.has(short)) byName.set(short, d);
  }
  return { list, byId, byName };
}

/**
 * Идентификатор водителя из записи: явное поле (driverId / driver2Id), затем
 * сопоставление по сохранённому имени. Пусто, если связи нет, — НЕ создаём
 * нового водителя из текста.
 */
export function resolveDriverId(
  rec: DriverLinkCarrier | null | undefined,
  dir: DriverDirectory,
  field: 'driver' | 'driver2' = 'driver',
): string {
  if (!rec) return '';
  const explicit = field === 'driver' ? rec.driverId : rec.driver2Id;
  if (explicit && dir.byId.has(String(explicit))) return String(explicit);
  const text = field === 'driver'
    ? rec.driverNameRu || rec.driverName || ''
    : rec.driver2 || rec.driver2Name || '';
  const norm = normText(text);
  if (norm) {
    const found = dir.byName.get(norm);
    if (found) return String(found.id);
  }
  return explicit ? String(explicit) : '';
}

/** Поля, которые сохраняются в запись при выборе водителя (стабильная связь + имя для показа). */
export function driverFieldsFor(
  idOrName: string,
  dir: DriverDirectory,
  field: 'driver' | 'driver2' = 'driver',
): Record<string, string> {
  const value = String(idOrName || '').trim();
  const byId = dir.byId.get(value);
  const byName = dir.byName.get(normText(value));
  const found = byId || byName || null;
  if (field === 'driver2') {
    return {
      driver2Id: found ? String(found.id) : '',
      driver2: found ? driverFullName(found) : value,
    };
  }
  return {
    driverId: found ? String(found.id) : value,
    driverNameRu: found ? driverFullName(found) : value,
    driverName: found ? driverFullName(found) : value,
  };
}

/**
 * Состояние связи записи со справочником: карточки и формы показывают разницу
 * между «водителя нет» (empty), «нормальной связью» (ok), «служебной/архивной
 * записью» и «битой ссылкой на отсутствующую запись» (missing).
 */
export function resolveDriverLink(
  rec: DriverLinkCarrier | null | undefined,
  dir: DriverDirectory,
  field: 'driver' | 'driver2' = 'driver',
): DriverLink {
  if (!rec) return { status: 'empty', id: '', displayName: '', phone: '' };
  const id = resolveDriverId(rec, dir, field);
  const storedName = String(
    field === 'driver'
      ? rec.driverNameRu || rec.driverName || ''
      : rec.driver2 || rec.driver2Name || '',
  ).trim();
  if (!id) {
    if (storedName) {
      const byName = dir.byName.get(normText(storedName));
      if (!byName) return { status: 'missing', id: '', displayName: storedName, phone: '' };
    }
    return { status: 'empty', id: '', displayName: '', phone: '' };
  }
  const found = dir.byId.get(id);
  if (!found) {
    return { status: 'missing', id, displayName: storedName || id, phone: '' };
  }
  if (isServiceDriver(found)) {
    return { status: 'service', id, displayName: driverFullName(found), phone: primaryPhone(found) };
  }
  if (isArchivedDriver(found)) {
    return { status: 'archived', id, displayName: driverFullName(found), phone: primaryPhone(found) };
  }
  return { status: 'ok', id, displayName: driverFullName(found), phone: primaryPhone(found) };
}

/** Подпись проблемы связи для интерфейса. */
export function driverLinkNotice(link: DriverLink, field: 'driver' | 'driver2' = 'driver'): string {
  const who = field === 'driver2' ? 'Второй водитель' : 'Водитель';
  switch (link.status) {
    case 'missing':
      return `${who} «${link.displayName}» отсутствует в справочнике — связь нарушена. Выберите водителя из списка или добавьте его.`;
    case 'service':
      return `В назначении стоит служебное значение «${link.displayName}» — это не водитель. Выберите водителя из списка или очистите назначение.`;
    case 'archived':
      return `${who} «${link.displayName}» — архивная запись. Для новых рейсов выберите активного водителя.`;
    default:
      return '';
  }
}

/** Создать запись водителя из введённого ФИО (явное действие пользователя). */
export function buildNewDriver(id: string, fullName: string): Driver {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const last = parts[0] || '';
  const first = parts[1] || '';
  const middle = parts[2] || '';
  const rec: Driver = {
    id,
    name: [last, first, middle].filter(Boolean).join(' '),
    lastNameRu: last,
    firstNameRu: first,
    middleNameRu: middle,
  };
  rec.shortNameRu = shortNameFromParts(last, first, middle) || rec.name;
  return rec;
}
