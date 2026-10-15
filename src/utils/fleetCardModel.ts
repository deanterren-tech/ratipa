/**
 * ЕДИНАЯ МОДЕЛЬ ПОЛНЫХ КАРТОЧЕК АВТОМОБИЛЯ И ВОДИТЕЛЯ.
 *
 * Чистый модуль без firebase: собирает карточку из записей БД, переданных
 * вызывающим (tractors + couplings + trailers + drivers + диспетчеры + тарифы).
 * Один и тот же построитель используется любым местом портала, где открывается
 * автомобиль или водитель, поэтому «одна карточка на весь портал» — это одна
 * модель + один компонент, а не внешне похожие копии.
 *
 * Правила:
 *  - связь с водителем — ТОЛЬКО по стабильному id (текстовые копии имён в
 *    записях машины — запасной вариант ДЛЯ ПОКАЗА, с видимой пометкой связи);
 *  - пустое пользовательское поле не исчезает: displayValue() отдаёт «Не указано»;
 *  - служебные id и технические поля (id, couplingId, tractorId, trailerId,
 *    mergedFrom/mergedAt) в секции карточки не попадают;
 *  - старые имена полей поддерживаются наравне с новыми:
 *    passport/passportNumber, passportIssued/passportIssuedBy,
 *    license/licenseNumber, phones/phone, name/части ФИО, driver2/driver2Id.
 */
import {
  buildDriverDirectory,
  driverFullName,
  driverNameLat,
  driverPhones,
  isArchivedDriver,
  isServiceDriver,
  resolveDriverLink,
  type DriverLike,
  type DriverLink,
  type DriverLinkStatus,
} from './driverRegistry';
import { displayDate } from './dateText';

/** Подпись пустого пользовательского поля — одна на все карточки портала. */
export const NOT_SPECIFIED = 'Не указано';

/** Состояние загрузки полной карточки. */
export type CardLoadPhase = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Фазa карточки: пока основные источники не ответили — «загрузка»; по их ответу
 * либо «готова», либо «не найдено»; если ответа нет дольше отведённого времени —
 * «ошибка» (интерфейс показывает повторную попытку).
 */
export function resolveCardPhase(primaryReady: boolean, found: boolean, timedOut: boolean): CardLoadPhase {
  if (primaryReady) return found ? 'ready' : 'not-found';
  return timedOut ? 'error' : 'loading';
}

export type RawRecord = Record<string, unknown>;

export interface FleetCardField {
  key: string;
  label: string;
  /** Человеческое значение в исходном виде ('' — не заполнено). */
  value: string;
  /** true — поле не заполнено (интерфейс показывает «Не указано»). */
  empty: boolean;
  /** Номера, серии, даты — моноширинный стиль значения. */
  mono?: boolean;
}

export interface FleetCardSection {
  key: string;
  title: string;
  fields: FleetCardField[];
}

export interface VehicleDriverSlot {
  role: 'main' | 'second';
  label: string;
  status: DriverLinkStatus;
  driverId: string;
  displayName: string;
  phone: string;
  /** Пометка проблемы связи (missing/service/archived) — '' когда всё в порядке. */
  notice: string;
  archived: boolean;
}

export interface VehicleRateInfo {
  id: string;
  name: string;
  rate: string;
  perDiemRate: string;
}

export interface VehicleBazaInfo {
  inBaza: boolean;
  statusLabel: string;
  dateDeparture: string;
  dateLoading: string;
}

export interface VehicleCardModel {
  /** Ключ, по которому карточку открыли (id записи или номер). */
  vehicleId: string;
  /** id записи в БД (tractors/couplings), когда найден. */
  recordId: string;
  carNumber: string;
  statusLabel: string;
  sections: FleetCardSection[];
  drivers: VehicleDriverSlot[];
  rate: VehicleRateInfo | null;
  passportVerificationYear: number | null;
  baza: VehicleBazaInfo | null;
}

export interface DriverAssignment {
  carNumber: string;
  role: 'main' | 'second';
}

export interface DriverPhoneItem {
  id: string;
  number: string;
  primary: boolean;
}

export interface DriverCardModel {
  driverId: string;
  /** Запись найдена в реестре `drivers`. */
  found: boolean;
  archived: boolean;
  service: boolean;
  displayName: string;
  sections: FleetCardSection[];
  phones: DriverPhoneItem[];
  assignments: DriverAssignment[];
}

// ---------------------------------------------------------------------------
// служебные нормализации / выбор значений
// ---------------------------------------------------------------------------

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};

/**
 * Канонический ключ автомобиля: верхний регистр, без пробелов/дефисов,
 * кириллица → латиница (как у ключей БД: «АК 3186-7» → AK31867).
 */
export function normalizeCardKey(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .split('')
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join('')
    .replace(/[^A-Z0-9]/g, '');
}

/** Первая часть составного номера «тягач / прицеп» (без внешних пробелов). */
export function firstPlatePart(value: unknown): string {
  return (String(value ?? '').split('/')[0] || '').trim();
}

/** Текстовое значение поля записи (числа приводятся к строке, объекты — нет). */
export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

/**
 * Первое непустое значение по списку записей и списку ключей (по порядку).
 * Порядок источников задаёт вызывающий — «не выбираем произвольно»: приоритет
 * источника там, где он документирован (справка в шапке каждой сборки).
 */
function pick(records: Array<RawRecord | null | undefined>, keys: string[]): string {
  for (const rec of records) {
    if (!rec) continue;
    for (const key of keys) {
      const value = text(rec[key]);
      if (value) return value;
    }
  }
  return '';
}

/**
 * Значение поля со всеми списками ключей: pickMany([[rec1, ['a','b']], ...]).
 * Удобно для «сначала связка, потом тягач, потом прицеп».
 */
function pickIn(groups: Array<[RawRecord | null | undefined, string[]]>): string {
  for (const [rec, keys] of groups) {
    const value = pick([rec], keys);
    if (value) return value;
  }
  return '';
}

/** Текстовое значение по имени поля из записи, прочитанной «как есть» (legacy-имена). */
function legacyText(rec: unknown, key: string): string {
  if (!rec || typeof rec !== 'object') return '';
  return text((rec as Record<string, unknown>)[key]);
}

export function makeField(key: string, label: string, raw: unknown, mono = false): FleetCardField {
  const value = text(raw);
  return { key, label, value, empty: value === '', mono };
}

/** Отображаемое значение поля: пустое пользовательское поле — «Не указано». */
export function displayValue(field: FleetCardField): string {
  return field.empty ? NOT_SPECIFIED : field.value;
}

/** Значение поля по ключу (для тестов и выборочного показа). */
export function fieldValue(model: { sections: FleetCardSection[] }, key: string): FleetCardField | null {
  for (const section of model.sections) {
    for (const field of section.fields) {
      if (field.key === key) return field;
    }
  }
  return null;
}

/**
 * Найти запись автомобиля по каноническому ключу: id записи, номер тягача,
 * составной номер («тягач / прицеп» — берём первую часть) или vehicleNumbers.
 * Сборка — по идентификаторам записи, а не по текстовым копиям из вызывающих мест.
 */
export function findVehicleRecord(records: RawRecord[], key: string): RawRecord | null {
  if (!key) return null;
  for (const rec of records) {
    if (normalizeCardKey(rec.id) === key) return rec;
    if (normalizeCardKey(rec.carNumber) === key) return rec;
    if (normalizeCardKey(rec.vehicleNumbers) === key) return rec;
    if (normalizeCardKey(firstPlatePart(rec.carNumber)) === key) return rec;
  }
  return null;
}

/**
 * Найти водителя: сначала по стабильному id; имя — только когда id вообще нет
 * (точное совпадение ФИО, без «похожих» совпадений по фамилии). Никогда не
 * создаёт новую запись.
 */
export function findDriverRecord(
  registry: DriverLike[],
  driverId: string,
  driverName?: string,
): DriverLike | null {
  const id = text(driverId);
  if (id) return registry.find((d) => String(d.id) === id) || null;
  const name = text(driverName).toLowerCase();
  if (!name) return null;
  return registry.find((d) => driverFullName(d).trim().toLowerCase() === name) || null;
}

/**
 * Группа ставок в том виде, в каком её отдают справочники.
 * В базе живут ДВЕ ветки: `directories/rateGroups` (справочник — из него выбирает
 * форма сцепки, каноническая для couplings.rateGroupId) и легаси `carsPool`.
 */
export interface RateGroupOption {
  id?: string;
  name?: string;
  rate?: number | string;
  perDiemRate?: number | string | null;
}

/**
 * Единый список групп ставок для карточек: при конфликте одинаковых id
 * приоритет — справочнику (тем источником id и записан); группы, которых в
 * справочнике нет, добавляются из легаси-ветки, чтобы старые записи не «пустели».
 * Произвольного выбора между конфликтующими значениями нет.
 */
export function mergeRateGroups(directory: RateGroupOption[], legacy: RateGroupOption[]): RateGroupOption[] {
  const seen = new Set<string>();
  const out: RateGroupOption[] = [];
  for (const g of directory || []) {
    const id = text(g?.id);
    if (id) seen.add(id);
    out.push(g);
  }
  for (const g of legacy || []) {
    const id = text(g?.id);
    if (id && seen.has(id)) continue;
    out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------
// АВТОМОБИЛЬ
// ---------------------------------------------------------------------------

export interface VehicleCardInput {
  vehicleId: string;
  tractor?: RawRecord | null;
  coupling?: RawRecord | null;
  trailer?: RawRecord | null;
  drivers?: DriverLike[];
  dispatchers?: Array<{ id?: string; name?: string }>;
  rateGroups?: Array<{ id?: string; name?: string; rate?: number | string; perDiemRate?: number | string | null }>;
  baza?: RawRecord | null;
}

const DISPATCHER_NAME_KEYS = ['dispatcherName', 'dispatcher'];

function resolveDispatcherName(
  dispatchers: Array<{ id?: string; name?: string }>,
  dispatcherId: string,
  fallbackName: string,
): string {
  if (dispatcherId) {
    const found = dispatchers.find((d) => String(d.id || '') === dispatcherId);
    if (found && text(found.name)) return text(found.name);
  }
  return fallbackName;
}

function buildDriverSlot(
  role: 'main' | 'second',
  link: DriverLink,
  phone: string,
): VehicleDriverSlot {
  return {
    role,
    label: role === 'main' ? 'Основной водитель' : 'Второй водитель',
    status: link.status,
    driverId: link.id,
    displayName: link.displayName,
    phone,
    notice: '',
    archived: link.status === 'archived',
  };
}

export function buildVehicleCardModel(input: VehicleCardInput): VehicleCardModel {
  const { tractor, coupling, trailer, baza } = input;
  const drivers = input.drivers || [];
  const dispatchers = input.dispatchers || [];
  const rateGroups = input.rateGroups || [];
  const dir = buildDriverDirectory(drivers);

  const carNumber = pick([coupling, tractor], ['carNumber', 'vehicleNumbers']) || text(input.vehicleId);
  const recordId = text(coupling?.id) || text(tractor?.id) || text(input.vehicleId);

  // Связь с реестром: id из связки (её назначение — истина), иначе из карточки тягача.
  const mainCarrier = {
    driverId: text(coupling?.driverId) || text(tractor?.driverId),
    driverNameRu: pickIn([
      [coupling, ['driverNameRu', 'driverName']],
      [tractor, ['driverNameRu', 'driverName']],
    ]),
    driverName: pickIn([
      [coupling, ['driverNameRu', 'driverName']],
      [tractor, ['driverNameRu', 'driverName']],
    ]),
  };
  const secondCarrier = {
    driver2Id: text(coupling?.driver2Id) || text(tractor?.driver2Id),
    driver2: pick([coupling, tractor], ['driver2', 'driver2Name']),
    driver2Name: pick([coupling, tractor], ['driver2', 'driver2Name']),
  };
  const mainLink = resolveDriverLink(mainCarrier, dir, 'driver');
  const secondLink = resolveDriverLink(secondCarrier, dir, 'driver2');

  // Телефоны водителей — из ЕДИНОГО реестра (drivers.phones/phone); копия в
  // карточке тягача — только запасной вариант для записей без связи с реестром.
  const registryDriver = mainLink.id ? dir.byId.get(String(mainLink.id)) || null : null;
  const registryDriver2 = secondLink.id ? dir.byId.get(String(secondLink.id)) || null : null;
  const mainPhone = registryDriver
    ? mainLink.phone
    : (pick([tractor, coupling], ['driverPhone', 'phone']) || (Array.isArray(tractor?.phones) && tractor.phones.length > 0 ? text((tractor.phones[0] as RawRecord)?.number) : ''));
  const secondPhone = registryDriver2 ? secondLink.phone : '';

  const mainSlot = buildDriverSlot('main', mainLink, mainPhone);
  const secondSlot = buildDriverSlot('second', secondLink, secondPhone);

  // Диспетчер: стабильный id → справочник; имя в записи — запасной вариант показа.
  const dispatcherId = text(coupling?.dispatcherId) || text(tractor?.dispatcherId);
  const dispatcherFallback = pickIn([
    [coupling, DISPATCHER_NAME_KEYS],
    [tractor, DISPATCHER_NAME_KEYS],
  ]);
  const dispatcherName = resolveDispatcherName(dispatchers, dispatcherId, dispatcherFallback);

  // Тариф: группа ставок по id; значение ставки — группа, иначе поле записи.
  const rateGroupId = pickIn([
    [coupling, ['rateGroupId']],
    [tractor, ['rateGroupId']],
  ]);
  const rateGroup = rateGroupId
    ? rateGroups.find((g) => String(g.id || '') === rateGroupId) || null
    : null;
  const rawRate = pickIn([
    [coupling, ['rate']],
    [tractor, ['rate']],
  ]);
  const rateName = rateGroup ? text(rateGroup.name) : '';
  const rateValue = rateGroup && text(rateGroup.rate) ? text(rateGroup.rate) : rawRate;
  const rate: VehicleRateInfo | null = rateName || rateValue
    ? {
        id: rateName ? rateGroupId : '',
        name: rateName,
        rate: rateValue,
        perDiemRate: rateGroup ? text(rateGroup.perDiemRate) : '',
      }
    : null;

  const statusRaw = pickIn([
    [coupling, ['status']],
    [tractor, ['status']],
  ]);
  const statusLabel = statusRaw === 'base'
    ? 'На базе'
    : statusRaw === 'trip'
      ? 'В рейсе'
      : statusRaw;

  const sections: FleetCardSection[] = [
    {
      key: 'vehicle',
      title: 'Автомобиль',
      fields: [
        makeField('carNumber', 'Госномер тягача', carNumber, true),
        // Марка тягача: связка приоритетнее карточки тягача — у части тягачей
        // поле марки пустое, а в связке заполнено (см. services/fleetService).
        makeField('brandModel', 'Марка тягача', pickIn([
          [coupling, ['brandModel', 'brand', 'brands', 'brandRu']],
          [tractor, ['brandModel', 'brands', 'brand', 'brandRu', 'brandsRu']],
        ])),
        makeField('trailerBrand', 'Марка прицепа', pickIn([
          [coupling, ['trailerBrand', 'trailerMake']],
          [tractor, ['trailerBrand', 'trailerMake']],
          [trailer, ['trailerBrand', 'brand', 'brands']],
        ])),
        makeField('trailerNumber', 'Номер прицепа', pickIn([
          [coupling, ['trailerNumber']],
          [tractor, ['trailerNumber']],
          [trailer, ['trailerNumber', 'number']],
        ]), true),
        makeField('vehicleType', 'Тип ТС', pickIn([
          [coupling, ['vehicleType']],
          [tractor, ['vehicleType']],
        ])),
        makeField('year', 'Год выпуска', pickIn([
          [tractor, ['year']],
          [coupling, ['year']],
        ])),
        makeField('dimensions', 'Габариты', pickIn([
          [coupling, ['dimensions']],
          [tractor, ['dimensions']],
        ])),
        makeField('weight', 'Вес (тягач+пп)', pickIn([
          [coupling, ['weight']],
          [tractor, ['weight']],
        ])),
      ],
    },
    {
      key: 'operation',
      title: 'Эксплуатация и тариф',
      fields: [
        makeField('status', 'Статус сцепки', statusLabel),
        makeField('dispatcher', 'Диспетчер', dispatcherName),
        makeField('rateGroup', 'Группа ставок', rateName),
        makeField('rate', 'Ставка', rateValue ? `${rateValue} €/км` : ''),
      ],
    },
  ];

  const verification = tractor?.lastPassportVerificationYear;
  const verificationYear = typeof verification === 'number' && verification > 0
    ? verification
    : (text(verification) ? Number(verification) : null);

  let bazaInfo: VehicleBazaInfo | null = null;
  if (baza) {
    const bazaStatus = text(baza.status);
    bazaInfo = {
      inBaza: true,
      statusLabel: bazaStatus === 'base' ? 'На базе' : bazaStatus === 'departure' || bazaStatus === 'trip' ? 'В рейсе' : (bazaStatus || 'В учёте выезда'),
      dateDeparture: text(baza.dateDeparture),
      dateLoading: text(baza.dateLoading),
    };
  }

  return {
    vehicleId: text(input.vehicleId),
    recordId,
    carNumber,
    statusLabel,
    sections,
    drivers: [mainSlot, secondSlot],
    rate,
    passportVerificationYear: verificationYear && Number.isFinite(verificationYear) ? verificationYear : null,
    baza: bazaInfo,
  };
}

// ---------------------------------------------------------------------------
// ВОДИТЕЛЬ
// ---------------------------------------------------------------------------

export interface DriverCardInput {
  driverId: string;
  /**
   * Запись реестра `drivers`. В живых записях встречаются и исторические имена
   * полей (passportIssuedBy и т.п.) — модель читает их через legacy-доступ.
   */
  driver?: DriverLike | null;
  /** Записи с назначением водителя (couplings/tractors): связь ищется по id. */
  linkCarriers?: Array<RawRecord | null | undefined>;
  dispatchers?: Array<{ id?: string; name?: string }>;
  rateGroups?: Array<{ id?: string; name?: string; rate?: number | string }>;
}

function archivedLabel(archived: boolean, service: boolean): string {
  if (service) return 'Служебная запись (не водитель)';
  return archived ? 'Архивная запись' : 'Активная запись';
}

export function buildDriverCardModel(input: DriverCardInput): DriverCardModel {
  const d = input.driver || null;
  const dispatchers = input.dispatchers || [];
  const rateGroups = input.rateGroups || [];
  const driverId = text(input.driverId) || text(d?.id);

  if (!d) {
    return {
      driverId,
      found: false,
      archived: false,
      service: false,
      displayName: '',
      sections: [],
      phones: [],
      assignments: [],
    };
  }

  const phones = driverPhones(d).map((p) => ({
    id: String(p.id),
    number: p.number,
    primary: !!p.isPrimary,
  }));

  // Диспетчер: стабильный id → справочник; имя в записи — запасной вариант.
  const dispatcherId = text(d.dispatcherId);
  const fallbackDisp = text(d.dispatcherName) || text(d.dispatcher);
  const dispatcherName = resolveDispatcherName(dispatchers, dispatcherId, fallbackDisp);

  const rateGroupId = text(d.rateGroupId);
  const rateGroup = rateGroupId ? rateGroups.find((g) => String(g.id || '') === rateGroupId) || null : null;
  const rateGroupLabel = rateGroup
    ? [text(rateGroup.name), text(rateGroup.rate) ? `€${text(rateGroup.rate)}/км` : ''].filter(Boolean).join(' · ')
    : '';

  const archived = isArchivedDriver(d);
  const service = isServiceDriver(d);

  // Назначения — по стабильному id: основным (driverId) или вторым (driver2Id).
  const assignments: DriverAssignment[] = [];
  const seen = new Set<string>();
  for (const rec of input.linkCarriers || []) {
    if (!rec) continue;
    const carNumber = text(rec.carNumber) || text(rec.vehicleNumbers) || text(rec.couplingId);
    if (!carNumber) continue;
    const role: DriverAssignment['role'] | null =
      text(rec.driverId) === driverId ? 'main'
        : text(rec.driver2Id) === driverId ? 'second'
          : null;
    if (!role) continue;
    const key = `${role}:${normalizeCardKey(carNumber)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ carNumber, role });
  }

  const contactsSection: FleetCardSection = {
    key: 'contacts',
    title: 'Контакты',
    fields: phones.map((p, i) => makeField(
      p.primary ? 'phone_primary' : `phone_${i + 1}`,
      p.primary ? 'Телефон (основной)' : 'Телефон',
      p.number,
      true,
    )),
  };
  if (contactsSection.fields.length === 0) {
    contactsSection.fields.push(makeField('phone_primary', 'Телефон (основной)', '', true));
  }

  const sections: FleetCardSection[] = [
    {
      key: 'main',
      title: 'Основные сведения',
      fields: [
        makeField('fullName', 'ФИО (рус)', driverFullName(d)),
        makeField('nameLat', 'ФИО (лат)', driverNameLat(d)),
        makeField('recordStatus', 'Статус записи', archivedLabel(archived, service)),
      ],
    },
    {
      key: 'documents',
      title: 'Паспорт и документы',
      fields: [
        makeField('birthDate', 'Дата рождения', displayDate(text(d.birthDate)), true),
        // Старое имя поля passport — новый passportNumber; поддерживаются оба.
        makeField('passport', 'Серия и номер паспорта', text(d.passport) || text(d.passportNumber), true),
        makeField('passportIssued', 'Кем выдан', text(d.passportIssued) || legacyText(d, 'passportIssuedBy')),
        makeField('passportStart', 'Дата выдачи', displayDate(text(d.passportStart)), true),
        makeField('passportEnd', 'Срок действия (до)', displayDate(text(d.passportEnd)), true),
        makeField('personalId', 'Личный номер', text(d.personalId), true),
        makeField('license', 'Вод. удостоверение', text(d.licenseNumber) || text(d.license), true),
      ],
    },
    contactsSection,
    {
      key: 'organization',
      title: 'Организация',
      fields: [
        makeField('dispatcher', 'Диспетчер', dispatcherName),
        makeField('rateGroup', 'Группа ставок', rateGroupLabel),
        makeField('comment', 'Комментарий', text(d.comment)),
      ],
    },
  ];

  return {
    driverId,
    found: true,
    archived,
    service,
    displayName: driverFullName(d),
    sections,
    phones,
    assignments,
  };
}
