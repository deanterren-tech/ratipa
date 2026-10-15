/**
 * Направление рейса — ОДНО поле `direction` записи.
 *
 * «План дохода» и «Таймлайн рейсов» используют ОДИН справочник направлений
 * (`directories/directions`: Турция TR, Китай CN и добавленные варианты) и
 * ОДНО каноническое значение в поле `direction` записи — НАЗВАНИЕ варианта
 * («Турция»/«Китай»/…): именно название читает и пишет «План дохода»
 * (выпадающий список, табы, цвет точки). Короткий КОД («TR»/«CN») — единица
 * переключателя в окнах рейса и старых записей; он читается маппингом с
 * фолбэком, данные не мигрируются (normalizeTripDirection).
 *
 * Синхронизация направления между модулями — по СТАБИЛЬНОМУ id записи
 * (`pd:<planId>` ↔ `trips_dashboard/<planId>`), не по номеру машины: запись
 * одна, поэтому «расходиться» стороны могут только представлением значения —
 * от этого и защищают directionStoreValue / directionWriteValue
 * (сравнение перед записью; «TR» и «Турция» — одно направление).
 *
 * Модуль ЧИСТЫЙ (без React и базы) — покрыт юнит-тестами
 * (scripts/test-directions.ts, scripts/test-direction-sync.ts).
 */

export interface DirectionOption {
  /** Стабильный id записи справочника. */
  id: string;
  /** Короткий код — ЗНАЧЕНИЕ поля `direction` рейса («TR», «CN», …). */
  code: string;
  /** Название для интерфейса («Турция», «Китай»). */
  name: string;
  /** Порядок в переключателе/справочнике. */
  order: number;
  /** Активно (отсутствие поля = активна — старые записи не ломаются). */
  active: boolean;
}

/** Встроенный фолбэк: два варианта владельца, если справочник ещё пуст. */
export const BUILTIN_DIRECTIONS: DirectionOption[] = [
  { id: 'turkey', code: 'TR', name: 'Турция', order: 1, active: true },
  { id: 'china', code: 'CN', name: 'Китай', order: 2, active: true },
];

/** Старые ТЕКСТОВЫЕ значения рейсов → коды (фолбэк совместимости). */
const LEGACY_NAME_TO_CODE: Record<string, string> = {
  'китай': 'CN',
  'турция': 'TR',
};

/** Код → название (фолбэк, когда записи справочника нет). */
const CODE_TO_NAME: Record<string, string> = { CN: 'Китай', TR: 'Турция' };

const str = (v: unknown): string => String(v ?? '').trim();

/** Код направления: верхний регистр, без пробелов/длинных тире. */
export const normalizeDirectionCode = (raw: unknown): string =>
  str(raw)
    .toUpperCase()
    .replace(/[–—_]/g, '-')
    .replace(/\s+/g, '');

/** Код из названия варианта без явного code — первые две буквы (верхний регистр). */
const autoCode = (name: string): string => str(name).slice(0, 2).toUpperCase();

/** Порядок варианта по умолчанию: известная пара Турция→1, Китай→2 (как
 *  называет варианты владелец), прочие — после них, в порядке справочника. */
const DEFAULT_CODE_ORDER: Record<string, number> = { TR: 1, CN: 2 };

/** Запись справочника `directories/directions` → вариант переключателя. */
export const directionOptionsFromDb = (
  dbList: Array<Record<string, unknown>> | null | undefined,
): DirectionOption[] =>
  (dbList || [])
    .filter((d) => d && typeof d === 'object')
    .map((d, i) => {
      const name = str(d.name) || str(d.label) || str(d.id);
      const code = normalizeDirectionCode(d.code) || autoCode(name);
      const order = Number(d.order);
      return {
        id: str(d.id) || str(d.dbKey) || str(d.key) || `dir_${i}`,
        code,
        name,
        order: Number.isFinite(order) && order > 0 ? order : DEFAULT_CODE_ORDER[code] ?? 100 + i,
        active: d.active !== false,
      } satisfies DirectionOption;
    })
    .filter((d) => d.code && d.name)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));

/** Только активные варианты — список переключателя. */
export const activeDirectionOptions = (list: DirectionOption[]): DirectionOption[] =>
  (list || []).filter((d) => d.active && d.code && d.name);

/**
 * Эффективный список вариантов: справочник Настроек, а при пустом — встроенная
 * пара Турция/Китай (переключатель работает даже до заполнения справочника).
 */
export const effectiveDirectionOptions = (dbOptions: DirectionOption[]): DirectionOption[] => {
  const active = activeDirectionOptions(dbOptions);
  return active.length ? active : BUILTIN_DIRECTIONS;
};

/** Список направлений: варианты + встроенная пара как фолбэк для TR/CN. */
const withBuiltinFallback = (options?: DirectionOption[]): DirectionOption[] => {
  const list = (options || []).filter((o) => o && o.code);
  const extra = BUILTIN_DIRECTIONS.filter(
    (b) => !list.some((o) => normalizeDirectionCode(o.code) === b.code),
  );
  return [...list, ...extra];
};

/**
 * Значение поля `direction` рейса из произвольного сохранённого значения:
 * код справочника → название («Китай»/«Турция», регистр не важен) → старый
 * текстовый фолбэк → короткий латинский код как есть. Понять нельзя — ''
 * (не выдумываем; старые данные не ломаются — поле просто не меняется).
 */
export const normalizeTripDirection = (
  raw: unknown,
  options?: DirectionOption[],
): string => {
  const text = str(raw);
  if (!text) return '';
  const list = withBuiltinFallback(options);
  const code = normalizeDirectionCode(text);
  const byCode = list.find((o) => normalizeDirectionCode(o.code) === code);
  if (byCode) return normalizeDirectionCode(byCode.code);
  const lower = text.toLowerCase();
  const byName = list.find((o) => o.name.toLowerCase() === lower);
  if (byName) return normalizeDirectionCode(byName.code);
  if (LEGACY_NAME_TO_CODE[lower]) return LEGACY_NAME_TO_CODE[lower];
  const byInclude = list.find((o) => o.name.length >= 3 && lower.includes(o.name.toLowerCase()));
  if (byInclude) return normalizeDirectionCode(byInclude.code);
  if (/^[A-Z]{2,4}$/.test(code)) return code;
  return '';
};

/** Вариант по сохранённому значению рейса (код или старое название). */
export const directionOptionOf = (
  options: DirectionOption[] | null | undefined,
  value: unknown,
): DirectionOption | null => {
  const text = str(value);
  if (!text) return null;
  const list = withBuiltinFallback(options || []);
  const code = normalizeTripDirection(text, list);
  return list.find((o) => normalizeDirectionCode(o.code) === code) || null;
};

/** Название для интерфейса: справочник → фолбэк CN/TR → исходный текст → ''. */
export const directionLabelOf = (
  options: DirectionOption[] | null | undefined,
  value: unknown,
): string => {
  const opt = directionOptionOf(options, value);
  if (opt) return opt.name;
  const code = normalizeTripDirection(value);
  if (CODE_TO_NAME[code]) return CODE_TO_NAME[code];
  return str(value);
};

/**
 * Каноническое ЗНАЧЕНИЕ поля `direction` записи — то, что пишется в базу и
 * читается обоими модулями: НАЗВАНИЕ варианта справочника («Турция»/«Китай»).
 * Код («TR») приводится к названию; уже название — остаётся; неизвестное
 * значение сохраняется как есть (не выдумываем), пустое — '' (поле не пишется
 * / очищается вызывающим кодом).
 */
export const directionStoreValue = (
  options: DirectionOption[] | null | undefined,
  value: unknown,
): string => {
  const text = str(value);
  if (!text) return '';
  const opt = directionOptionOf(options, value);
  return opt ? opt.name : text;
};

/** Ключ сравнения значений поля `direction` (регистр/пробелы не значимы). */
const storeKey = (options: DirectionOption[] | null | undefined, value: unknown): string =>
  directionStoreValue(options, value).trim().toLowerCase();

/**
 * «Одно и то же направление?» — сравнение В ПРОСТРАНСТВЕ ЗАПИСИ: «TR» и
 * «Турция» равны (одно направление), пустое и пустое равны. Используется как
 * защита от лишних записей и как условие выхода из двусторонней синхронизации
 * (значение уже совпало — писать нечего, цикла нет).
 */
export const sameTripDirection = (
  a: unknown,
  b: unknown,
  options?: DirectionOption[] | null,
): boolean => storeKey(options, a) === storeKey(options, b);

export interface DirectionWriteDecision {
  /** false — значение уже совпадает (в т.ч. «TR» vs «Турция»): НЕ писать. */
  write: boolean;
  /** Значение для точечной записи; null — очистить поле (пустое направление). */
  value: string | null;
}

/**
 * Решение о записи направления в СВЯЗАННУЮ запись: сравниваем текущее
 * сохранённое значение с желаемым в каноническом пространстве и пишем только
 * при реальном расхождении (было «TR», выбрали «Турция» — это одно и то же
 * направление, записи нет). Возвращает только поле `direction` — остальные
 * поля записи (диспетчер, водитель, даты, машина) не затрагиваются.
 */
export const directionWriteValue = (
  stored: unknown,
  desired: unknown,
  options?: DirectionOption[] | null,
): DirectionWriteDecision => {
  if (storeKey(options, stored) === storeKey(options, desired)) {
    return { write: false, value: null };
  }
  return { write: true, value: directionStoreValue(options, desired) || null };
};
