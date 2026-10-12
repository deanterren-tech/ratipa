/**
 * Направление рейса — ОДНО поле `direction` записи со значением-КОДОМ:
 * «TR» (Турция) / «CN» (Китай) и коды добавленных вариантов.
 *
 * Требование владельца (дословно): в окнах «Добавить рейс» и «Просмотр рейса» —
 * один компактный переключатель Турция/Китай; в рейсе хранится одно значение
 * `direction` («TR»|«CN»); НИКАКИХ ставок, средних дней, пересчётов и
 * синхронизации с планом дохода. Список вариантов — из справочника Настроек
 * `directories/directions` (там есть Турция и Китай; им аддитивно добавлен
 * короткий `code` TR/CN — coeff/id/dbKey/label не тронуты).
 *
 * Старые записи (текст «Китай»/«Турция») читаются маппингом с фолбэком —
 * данные не ломаются и не мигрируются: см. normalizeTripDirection.
 *
 * Модуль ЧИСТЫЙ (без React и базы) — покрыт юнит-тестами
 * (scripts/test-directions.ts).
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
