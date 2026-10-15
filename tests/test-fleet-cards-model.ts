/**
 * test-fleet-cards-model — юнит-проверки СОБРАННОЙ МОДЕЛИ полных карточек
 * автомобиля и водителя (src/utils/fleetCardModel.ts):
 *
 *  · какие поля откуда берутся (связка приоритетнее карточки тягача, прицеп —
 *    из связки/тягача/реестра прицепов, ставка — из группы ставок или записи);
 *  · «Не указано» для пустых пользовательских полей (displayValue);
 *  · сборка ПО ID, а не по текстовым копиям (findVehicleRecord / findDriverRecord /
 *    нормализация ключа кириллица→латиница);
 *  · совместимость старых имён полей: passport/passportNumber,
 *    passportIssued/passportIssuedBy, license/licenseNumber, phones/phone,
 *    name/части ФИО, driver2/driver2Id;
 *  · связь с водителем: найден по id, отсутствует (missing, запись НЕ создаётся),
 *    служебная, архивная; телефоны — только из реестра;
 *  · служебные id и технические поля (mergedFrom/mergedAt/id/couplingId) в
 *    секции карточки не попадают.
 *
 * Запуск: npx tsx tests/test-fleet-cards-model.ts   (или npm run test:fleet-cards)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import {
  NOT_SPECIFIED,
  buildDriverCardModel,
  buildVehicleCardModel,
  displayValue,
  fieldValue,
  findDriverRecord,
  findVehicleRecord,
  firstPlatePart,
  mergeRateGroups,
  normalizeCardKey,
  resolveCardPhase,
  type RawRecord,
} from '../src/utils/fleetCardModel.ts';
import type { DriverLike } from '../src/utils/driverRegistry.ts';

let checks = 0;
const fails: string[] = [];

const ok = (cond: boolean, name: string): void => {
  checks += 1;
  if (!cond) fails.push(name);
};
const eq = <T>(actual: T, expected: T, name: string): void => {
  checks += 1;
  if (actual !== expected) fails.push(`${name}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
};
/** Значение поля карточки как его видит интерфейс (с «Не указано»). */
const shown = (model: {sections: {
  key: string;
  title: string;
  fields: {key: string; label: string; value: string; empty: boolean; mono?: boolean}[];
}[]}, key: string): string => {
  const f = fieldValue(model, key);
  return f ? displayValue(f) : '<нет поля>';
};

/* ── 1. Нормализация ключей и поиск по id ────────────────────────────────── */

eq(normalizeCardKey('АК 3186-7'), 'AK31867', 'нормализация кириллического номера в ключ БД');
eq(normalizeCardKey('ap 9696-7'), 'AP96967', 'нормализация латиницы и регистра');
eq(firstPlatePart('АО 3921-7 / А 3981 В-7'), 'АО 3921-7', 'первая часть составного номера');

const tractors: RawRecord[] = [
  {id: 'AP96967', carNumber: 'AP 9696-7', driverId: 'D1', brandModel: 'Mercedes-Benz'},
  {id: 'AB92717', carNumber: 'AB 9271-7', driverId: 'D2'},
];
eq(findVehicleRecord(tractors, 'AP96967')?.id, 'AP96967', 'поиск машины по id записи');
eq(findVehicleRecord(tractors, normalizeCardKey('ap 9696-7'))?.id, 'AP96967', 'поиск машины по номеру (канонический ключ)');
eq(findVehicleRecord(tractors, 'НЕТТАКОГО'), null, 'отсутствующая машина — null (без записи)');
eq(findVehicleRecord([], 'AP96967'), null, 'пустой список — null');

const registry: DriverLike[] = [
  {id: 'D1', name: 'Бархатов Денис Владимирович', lastNameRu: 'Бархатов'},
  {id: 'D2', name: 'Потапович Евгений Цезарович'},
];
eq(findDriverRecord(registry, 'D1')?.id, 'D1', 'поиск водителя по стабильному id');
eq(findDriverRecord(registry, 'MISSING'), null, 'битая ссылка: записи нет — null (не создаём)');
eq(findDriverRecord(registry, '', 'Потапович Евгений Цезарович')?.id, 'D2', 'поиск по точному ФИО — только когда id нет');
eq(findDriverRecord(registry, '', 'Потапович Евгений')?.id ?? null, null, 'ФИО не совпало точно — не открываем чужого');
eq(findDriverRecord(registry, 'D1', 'Потапович Евгений Цезарович')?.id, 'D1', 'при наличии id имя не может перебить связь');

/* ── 2. Модель автомобиля: поля из правильных источников ─────────────────── */

const coupling: RawRecord = {
  id: 'AP96967',
  carNumber: 'AP 9696-7',
  tractorId: 'AP96967',
  trailerId: 'A1595E7',
  trailerNumber: 'A1595E-7',
  brand: 'MERCEDES',
  trailerBrand: 'KOGEL',
  vehicleType: 'Тенты 90м3',
  dimensions: '13,6м x 2,45м x 2,7м',
  weight: '14,6т',
  driverId: 'D1',
  driverNameRu: 'Бархатов Денис Владимирович',
  dispatcherName: 'Матвей Солодкий',
  dispatcherId: 'u-disp-1',
  rate: 0.125,
  rateGroupId: 'c2',
  status: 'base',
};
const tractor: RawRecord = {
  id: 'AP96967',
  carNumber: 'AP 9696-7',
  vehicleNumbers: 'AP 9696-7',
  // В карточке тягача марка пустая — приоритет связки документирован в fleetService
  brand: '',
  brandModel: '',
  brands: '',
  trailerMake: 'KOGEL',
  driverId: 'D1',
  driverName: 'Бархатов Денис Владимирович',
  driverPhone: '+375 29 319-17-97',
  passports: undefined,
  birthDate: '01.02.1978',
  personalId: '3010278М083РВ4',
  lastPassportVerificationYear: 2026,
  year: '2019',
  status: 'base',
  mergedFrom: ['AP 9696-7'],
  mergedAt: '2026-10-15T16-35-49',
};
const model = buildVehicleCardModel({
  vehicleId: 'AP96967',
  tractor,
  coupling,
  trailer: {id: 'A1595E7', trailerNumber: 'A1595E-7', trailerBrand: 'KOGEL'},
  drivers: registry,
  dispatchers: [{id: 'u-disp-1', name: 'Матвей Солодкий'}],
  rateGroups: [{id: 'c2', name: 'Группа 0.125', rate: 0.125}],
  baza: {id: 'b1', carNumber: 'АО 3921-7 / А 3981 В-7', status: 'base', dateDeparture: '2026-07-28', driverId: 'D1'},
});

eq(model.carNumber, 'AP 9696-7', 'номер: из связки');
eq(shown(model, 'brandModel'), 'MERCEDES', 'марка тягача: связка приоритетнее пустой карточки тягача');
eq(shown(model, 'trailerBrand'), 'KOGEL', 'марка прицепа: из связки');
eq(shown(model, 'trailerNumber'), 'A1595E-7', 'номер прицепа: из связки');
eq(shown(model, 'vehicleType'), 'Тенты 90м3', 'тип ТС: из связки');
eq(shown(model, 'year'), '2019', 'год выпуска: из карточки тягача');
eq(shown(model, 'dimensions'), '13,6м x 2,45м x 2,7м', 'габариты');
eq(shown(model, 'weight'), '14,6т', 'вес');
eq(shown(model, 'status'), 'На базе', 'статус base → «На базе»');
eq(shown(model, 'dispatcher'), 'Матвей Солодкий', 'диспетчер: по dispatcherId из справочника');
eq(shown(model, 'rateGroup'), 'Группа 0.125', 'группа ставок: по rateGroupId');
eq(shown(model, 'rate'), '0.125 €/км', 'ставка: из группы ставок');
eq(model.passportVerificationYear, 2026, 'год сверки паспорта — из карточки тягача');
ok(model.baza?.inBaza === true, 'связанная запись «Учёт выезда» подхвачена');
eq(model.baza?.statusLabel, 'На базе', 'статус учёта выезда');

/* ── 3. Модель автомобиля: пустые поля и служебные id ────────────────────── */

eq(shown(model, 'нет-такого'), '<нет поля>', 'несуществующее поле не изобретается');
const sparse = buildVehicleCardModel({
  vehicleId: 'AB92717',
  tractor: {id: 'AB92717', carNumber: 'AB 9271-7', mergedFrom: ['АВ 9271-7'], mergedAt: 'x', tractorId: 'AB92717', couplingId: 'AB92717'},
  coupling: {id: 'AB92717', carNumber: 'AB 9271-7', driverId: '', driverName: ''},
  drivers: registry,
  dispatchers: [],
  rateGroups: [],
});
eq(shown(sparse, 'brandModel'), NOT_SPECIFIED, 'пустая марка → «Не указано»');
eq(shown(sparse, 'year'), NOT_SPECIFIED, 'пустой год → «Не указано»');
eq(shown(sparse, 'dispatcher'), NOT_SPECIFIED, 'пустой диспетчер → «Не указано»');
eq(shown(sparse, 'rate'), NOT_SPECIFIED, 'пустая ставка → «Не указано»');
const sparseKeys = sparse.sections.flatMap((s) => s.fields.map((f) => f.key)).join(',');
ok(!sparseKeys.includes('merged'), 'технические отметки миграции не выводятся как сведения');
ok(!sparseKeys.includes('id'), 'служебные id не выводятся как обычные сведения');
ok(sparse.sections.every((s) => s.fields.every((f) => !['couplingId', 'tractorId', 'trailerId'].includes(f.key))), 'служебные id сцепки скрыты');
eq(sparse.drivers.length, 2, 'в карточке всегда два слота водителей (основной и второй)');
eq(sparse.drivers[0].status, 'empty', 'без назначения — статус empty');
eq(shown(sparse, 'status'), NOT_SPECIFIED, 'пустой статус → «Не указано»');

/* ── 4. Связь с водителем: найден / битая ссылка / служебная / архивная ──── */

eq(model.drivers[0].status, 'ok', 'основной водитель найден по id');
eq(model.drivers[0].displayName, 'Бархатов Денис Владимирович', 'имя водителя — из реестра');
eq(model.drivers[1].status, 'empty', 'второй водитель не назначен');
eq(model.drivers[1].displayName, '', 'второй водитель: пусто, «Не назначен» — в интерфейсе');

const broken = buildVehicleCardModel({
  vehicleId: 'BR1',
  coupling: {id: 'BR1', carNumber: 'BR 1', driverId: 'GHOST', driverName: 'Призрак Призракович'},
  drivers: registry,
});
eq(broken.drivers[0].status, 'missing', 'ссылка на отсутствующую запись — видимая ошибка связи');
eq(broken.drivers[0].displayName, 'Призрак Призракович', 'при битой ссылке показывается сохранённый текст');
eq(broken.drivers[0].driverId, 'GHOST', 'id битой ссылки не подменяется');

const serviceDriver: DriverLike = {id: 'S1', name: 'без В.', service: true};
const serviceModel = buildVehicleCardModel({
  vehicleId: 'SV1',
  coupling: {id: 'SV1', carNumber: 'SV 1', driverId: 'S1'},
  drivers: [...registry, serviceDriver],
});
eq(serviceModel.drivers[0].status, 'service', 'служебная запись распознана как service');

const archivedDriver: DriverLike = {id: 'A1', name: 'Архивный Водитель', archived: true};
const archivedModel = buildVehicleCardModel({
  vehicleId: 'AV1',
  coupling: {id: 'AV1', carNumber: 'AV 1', driverId: 'A1', driver2Id: 'D2'},
  drivers: [...registry, archivedDriver],
});
eq(archivedModel.drivers[0].status, 'archived', 'архивный водитель помечен');
ok(archivedModel.drivers[0].archived, 'флаг архива у слота');
eq(archivedModel.drivers[1].status, 'ok', 'второй водитель найден по driver2Id');
eq(archivedModel.drivers[1].displayName, 'Потапович Евгений Цезарович', 'второй водитель — верная запись');

// driver2 без id (старое имя field driver2) — по точному совпадению ФИО, без создания
const legacyDriver2 = buildVehicleCardModel({
  vehicleId: 'L1',
  coupling: {id: 'L1', carNumber: 'L 1', driver2: 'Потапович Евгений Цезарович'},
  drivers: registry,
});
eq(legacyDriver2.drivers[1].status, 'ok', 'старое назначение driver2 (без id) разрешено по точному ФИО');
eq(legacyDriver2.drivers[1].driverId, 'D2', 'старое назначение получает стабильный id реестра');

// Телефоны: только из реестра водителей
const withPhones: DriverLike = {
  id: 'D3', name: 'Телефонный Тест',
  phones: [
    {id: 'p2', number: '+375 11 000-00-00', isPrimary: false},
    {id: 'p1', number: '+375 29 111-11-11', isPrimary: true},
  ],
};
const phoneModel = buildVehicleCardModel({
  vehicleId: 'PH1',
  coupling: {id: 'PH1', carNumber: 'PH 1', driverId: 'D3', driverPhone: '+375 00 000-00-00'},
  drivers: [withPhones],
});
eq(phoneModel.drivers[0].phone, '+375 29 111-11-11', 'телефон основного водителя — основной из реестра, не копия машины');
const legacyPhoneModel = buildVehicleCardModel({
  vehicleId: 'PH2',
  coupling: {id: 'PH2', carNumber: 'PH 2', driverId: 'D4'},
  drivers: [{id: 'D4', name: 'Старый Телефон', phone: '+375 44 222-22-22'}],
});
eq(legacyPhoneModel.drivers[0].phone, '+375 44 222-22-22', 'старое поле phone реестра поддержано');

/* ── 5. Модель водителя: полная запись и старые имена ────────────────────── */

const fullDriver: DriverLike = {
  id: 'D1',
  name: 'Бархатов Денис Владимирович',
  lastNameRu: 'Бархатов', firstNameRu: 'Денис', middleNameRu: 'Владимирович',
  nameLat: 'BARKHATOV DENIS',
  passport: 'МР5070640',
  passportIssued: 'УВД Бобруйского горисполкома',
  passportStart: '27.05.2020',
  passportEnd: '27.05.2030',
  personalId: '3010278М083РВ4',
  licenseNumber: '3ВК0025663',
  birthDate: '01.02.1978',
  phones: [{id: 'p1', number: '+375 29 319-17-97', isPrimary: true}, {id: 'p2', number: '+7 925 299-83-44', isPrimary: false}],
  dispatcherId: 'u-disp-1',
  rateGroupId: 'c2',
  comment: 'второй водитель',
};
const dm = buildDriverCardModel({
  driverId: 'D1',
  driver: fullDriver,
  linkCarriers: [
    {id: 'AP96967', carNumber: 'AP 9696-7', driverId: 'D1'},
    {id: 'AB92717', carNumber: 'AB 9271-7', driver2Id: 'D1', driver2: 'Бархатов Денис Владимирович'},
    {id: 'XX', carNumber: 'XX 0000-0', driverId: 'КТО-ТО', driver2Id: 'ДРУГОЙ'},
  ],
  dispatchers: [{id: 'u-disp-1', name: 'Матвей Солодкий'}],
  rateGroups: [{id: 'c2', name: 'Группа 0.125', rate: 0.125}],
});
ok(dm.found, 'водитель найден');
eq(shown(dm, 'fullName'), 'Бархатов Денис Владимирович', 'ФИО (рус)');
eq(shown(dm, 'nameLat'), 'BARKHATOV DENIS', 'ФИО (лат)');
eq(shown(dm, 'birthDate'), '01/02/1978', 'дата рождения приведена к ДД/ММ/ГГГГ');
eq(shown(dm, 'passport'), 'МР5070640', 'паспорт: старое имя passport');
eq(shown(dm, 'passportIssued'), 'УВД Бобруйского горисполкома', 'кем выдан');
eq(shown(dm, 'personalId'), '3010278М083РВ4', 'личный номер');
eq(shown(dm, 'license'), '3ВК0025663', 'ВУ: licenseNumber');
eq(shown(dm, 'dispatcher'), 'Матвей Солодкий', 'диспетчер водителя: по dispatcherId');
eq(shown(dm, 'rateGroup'), 'Группа 0.125 · €0.125/км', 'группа ставок водителя');
eq(shown(dm, 'comment'), 'второй водитель', 'комментарий');
eq(shown(dm, 'recordStatus'), 'Активная запись', 'статус активной записи');
eq(dm.phones.length, 2, 'оба телефона показаны');
eq(dm.phones[0].number, '+375 29 319-17-97', 'основной телефон — первым');
ok(dm.phones[0].primary, 'основной помечен');
eq(dm.assignments.length, 2, 'назначения: основным и вторым — по id, чужие отфильтрованы');
eq(dm.assignments[0].role, 'main', 'первое назначение — основным водителем');
eq(dm.assignments[1].role, 'second', 'второе назначение — вторым водителем');

// Новые имена полей (passportNumber/passportIssuedBy/license) — та же карточка.
// В записи допускаются дополнительные/исторические ключи (runtime-поля БД).
const newNamesDriver: DriverLike = Object.assign(
  {id: 'N1', name: 'Новый Н.Н.'},
  {passportNumber: 'MP1111111', passportIssuedBy: 'ОВД Тестовое', license: 'LIC-1', phone: '+375 33 333-33-33'},
);
const newNames = buildDriverCardModel({
  driverId: 'N1',
  driver: newNamesDriver,
});
eq(shown(newNames, 'passport'), 'MP1111111', 'новое имя passportNumber поддержано');
eq(shown(newNames, 'passportIssued'), 'ОВД Тестовое', 'новое имя passportIssuedBy поддержано');
eq(shown(newNames, 'license'), 'LIC-1', 'новое имя license поддержано');
eq(newNames.phones[0]?.number, '+375 33 333-33-33', 'старое одиночное поле phone → один основной телефон');

// Сборка ФИО из частей, если name не заполнено
const partsOnly = buildDriverCardModel({
  driverId: 'P1',
  driver: {id: 'P1', lastNameRu: 'Частный', firstNameRu: 'Пётр', middleNameRu: 'Сергеевич'},
});
eq(shown(partsOnly, 'fullName'), 'Частный Пётр Сергеевич', 'ФИО собирается из частей');

// Пустые поля водителя → «Не указано», а не скрытие
const emptyDriver = buildDriverCardModel({driverId: 'E1', driver: {id: 'E1', name: 'Пустой П.П.'}});
eq(shown(emptyDriver, 'birthDate'), NOT_SPECIFIED, 'пустая дата рождения → «Не указано»');
eq(shown(emptyDriver, 'passport'), NOT_SPECIFIED, 'пустой паспорт → «Не указано»');
eq(shown(emptyDriver, 'phone_primary'), NOT_SPECIFIED, 'пустой телефон → «Не указано»');
eq(shown(emptyDriver, 'license'), NOT_SPECIFIED, 'пустое ВУ → «Не указано»');

// Запись не найдена — модель не создаёт нового водителя
const notFound = buildDriverCardModel({driverId: 'GHOST'});
ok(!notFound.found, 'отсутствующая запись: found=false');
eq(notFound.sections.length, 0, 'отсутствующая запись: никаких выдуманных секций');
eq(notFound.assignments.length, 0, 'отсутствующая запись: назначений нет');

// Архивная и служебная записи
const archivedModelD = buildDriverCardModel({driverId: 'A1', driver: {id: 'A1', name: 'Архивный', archived: true}});
eq(shown(archivedModelD, 'recordStatus'), 'Архивная запись', 'архивная запись помечена');
const serviceModelD = buildDriverCardModel({driverId: 'S1', driver: {id: 'S1', name: 'нет водителя', service: true}});
eq(shown(serviceModelD, 'recordStatus'), 'Служебная запись (не водитель)', 'служебная запись помечена');

/* ── 6. Машина без связки (только карточка тягача) ───────────────────────── */

const standAlone = buildVehicleCardModel({
  vehicleId: 'AO88077',
  tractor: {id: 'AO88077', carNumber: 'AO 8807-7', brand: 'MERCEDES', brandsLat: 'Schwarzmuller', year: '2015'},
  coupling: null,
  drivers: registry,
});
eq(standAlone.carNumber, 'AO 8807-7', 'карточка открывается и без записи связки');
eq(shown(standAlone, 'brandModel'), 'MERCEDES', 'марка из карточки тягача, когда связки нет');
eq(shown(standAlone, 'year'), '2015', 'год из карточки тягача');

/* ── 7. Состояния загрузки полной карточки ──────────────────────────────── */

eq(resolveCardPhase(false, false, false), 'loading', 'нет ответа источников — «загрузка»');
eq(resolveCardPhase(false, false, true), 'error', 'нет ответа дольше таймаута — «ошибка» с повторной попыткой');
eq(resolveCardPhase(true, true, false), 'ready', 'источники ответили, запись есть — «готова»');
eq(resolveCardPhase(true, false, false), 'not-found', 'источники ответили, записи нет — «не найдено»');
eq(resolveCardPhase(true, false, true), 'not-found', 'таймаут не перебивает точный ответ «не найдено»');

/* ── 8. Две ветки групп ставок: приоритет справочника, не произвольный выбор ── */

const merged = mergeRateGroups(
  [{id: 'c2', name: 'Группа 0.125', rate: 0.125}],
  [{id: 'c2', name: 'Группа 0.15', rate: 0.15}, {id: 'c9', name: 'Старая группа', rate: 0.2}],
);
eq(merged.length, 2, 'конфликтующий id не дублируется');
eq(merged[0].name, 'Группа 0.125', 'при конфликте id побеждает справочник (источник, которым id записан)');
eq(merged[1].name, 'Старая группа', 'группа только из легаси-ветки сохраняется (не «пустеет»)');
eq(mergeRateGroups([], [{id: 'c9', name: 'Только легаси'}]).length, 1, 'без справочника используется легаси-ветка');
eq(mergeRateGroups([{id: 'c1', name: 'Справочник'}], []).length, 1, 'без легаси-ветки используется справочник');

/* ── Итог ───────────────────────────────────────────────────────────────── */

if (fails.length === 0) {
  console.log(`[test-fleet-cards-model] OK: ${checks} проверок пройдено.`);
  process.exit(0);
}
console.error(`[test-fleet-cards-model] ПРОВАЛЕНО ${fails.length} из ${checks}:`);
for (const f of fails) console.error('  ✗ ' + f);
process.exit(1);
