/**
 * tl-audit-core — ЧИСТАЯ логика для скриптов аудита таймлайна (без React и базы):
 *
 *  · разбор дат (ISO и DD.MM.YYYY / DD/MM/YYYY — аудит показывает оба фактически);
 *  · ключ машины (первый сегмент госномера, кириллица→латиница — как в lib/bazaDedupe);
 *  · ПРАВИЛО ПЕРЕСЕЧЕНИЙ ТЗ: конфликт, если s <= e0 и e >= s0; РОВНО 1 общий день —
 *    «стык» (разрешён, не конфликт); открытый период (нет конца) — конец в +∞;
 *  · размещение ремонта внутри собственного периода базы (ремонт внутри базы —
 *    штатное сочетание данных, а не конфликт);
 *  · нормализация КОДОВ направлений (по ТЗ): CNH-RUS / HN-RUS → CHN-RUS;
 *    RUS-By → RUS-BY; BY-AM → BY-ARM. Общее правило: верхний регистр, страна —
 *    трёхбуквенный канонический код (канонический набор — COUNTRY_CANON),
 *    неизвестные токены не выдумываются, а помечаются;
 *  · симуляция ключей детерминированных ID (период/этап/событие) и
 *    детектор коллизий — только расчёт, без записи;
 *  · карта «город → страна» (фрагмент ТОЛЬКО по городам, реально встречающимся
 *    в данных; неизвестные города честно остаются null).
 *
 * Модуль используется тремя скриптами:
 *   scripts/audit-timeline-dups.ts, scripts/migrate-directions.ts,
 *   scripts/test-tl-guards.ts (юнит-проверки — scripts запускают их вместе).
 */
// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

export const DAY_MS = 86400000;

export interface ParsedDate {
  /** YYYY-MM-DD */
  iso: string;
  /** Номер дня (UTC), как в lib/timeline.dayNum. */
  day: number;
}

const isRealYmd = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** Разбор даты: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY. null — пусто/битая. */
export const parseLooseDate = (v: unknown): ParsedDate | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = /^(\d{4})/.test(s)
    ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
    : { y: Number(m[3]), mo: Number(m[2]), d: Number(m[1]) };
  if (!isRealYmd(iso.y, iso.mo, iso.d)) return null;
  const day = Math.round(Date.UTC(iso.y, iso.mo - 1, iso.d) / DAY_MS);
  return { iso: dayToIso(day), day };
};

/** Номер дня → YYYY-MM-DD. */
export const dayToIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Формат даты-значения «как в данных» (для отчёта «форматы дат»). */
export const dateFormatOf = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!s) return 'пусто';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'ISO';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return 'DD.MM.YYYY';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return 'DD/MM/YYYY';
  return `иное:${s.slice(0, 14)}`;
};

// ---------------------------------------------------------------------------
// Машины
// ---------------------------------------------------------------------------

/** Кириллица → латиница (раскладка клавиатуры) — то же правило, что lib/bazaDedupe. */
export const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E',
};

/** Номер → скелет A-Z0-9 с фолдингом раскладки. */
export const foldPlate = (s: unknown): string =>
  String(s ?? '')
    .toUpperCase()
    .split('')
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join('')
    .replace(/[^A-Z0-9]/g, '');

/**
 * Ключ машины для сопоставления веток: ПЕРВЫЙ сегмент номера (тягач до «/»),
 * скелет A-Z0-9 с фолдингом раскладки. «АВ 9271-7 / A 2416 E-7» и
 * «AB 9271-7» дают один ключ «AB92717».
 */
export const vehicleKey = (carNumber: unknown): string => foldPlate(String(carNumber ?? '').split('/')[0]);

/** Нормализация свободного текста для сравнения (регистр, ё→е, пробелы). */
export const normText = (s: unknown): string =>
  String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Нормализация телефона: только цифры (последние 10 значимых). */
export const normPhone = (s: unknown): string => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

/** Пометка «тестовые данные параллельных агентов»: probe в id/авторе/заметке. */
export const looksProbe = (parts: Array<unknown>): boolean =>
  parts.some((p) => /probe|проб/i.test(String(p ?? '')));

// ---------------------------------------------------------------------------
// Правило пересечений ТЗ
// ---------------------------------------------------------------------------

export type IntervalKind = 'trip' | 'base';

export interface IntervalRef {
  /** id записи в RTDB. */
  id: string;
  branch: 'trips_dashboard' | 'baza';
  kind: IntervalKind;
  carNumber: string;
  carKey: string;
  /** Начало (номер дня); null — дата начала не определена. */
  startDay: number | null;
  /** Конец (номер дня); null — конец открыт (+∞). */
  endDay: number | null;
  /** Открытый период: конец не указан. */
  openEnd: boolean;
  archived: boolean;
  probe: boolean;
  /** Короткая подпись (маршрут/тип) — без персональных данных. */
  label: string;
}

export type PairVerdict = 'none' | 'styk' | 'conflict' | 'no-start';

export interface PairClassification {
  verdict: PairVerdict;
  /** Дней пересечения; null — оба интервала открыты (пересечение бесконечно). */
  overlapDays: number | null;
}

/**
 * Правило ТЗ: конфликт если `s <= e0 && e >= s0` (дни включительно), открытый
 * конец = +∞. РОВНО 1 общий день (конец одного = начало другого) — «стык»
 * (разрешён, но перечисляется отдельно). Больше 1 дня — конфликт.
 */
export const classifyPair = (a: IntervalRef, b: IntervalRef): PairClassification => {
  if (a.startDay == null || b.startDay == null) return { verdict: 'no-start', overlapDays: null };
  const s = a.startDay;
  const s0 = b.startDay;
  const e = a.endDay == null ? Number.POSITIVE_INFINITY : a.endDay;
  const e0 = b.endDay == null ? Number.POSITIVE_INFINITY : b.endDay;
  if (!(s <= e0 && e >= s0)) return { verdict: 'none', overlapDays: 0 };
  const lo = Math.max(s, s0);
  const hi = Math.min(e, e0);
  if (!Number.isFinite(hi)) return { verdict: 'conflict', overlapDays: null }; // оба конца открыты
  const days = hi - lo + 1;
  return days <= 1 ? { verdict: 'styk', overlapDays: 1 } : { verdict: 'conflict', overlapDays: days };
};

// ---------------------------------------------------------------------------
// Ремонт внутри периода базы (фактические сочетания данных)
// ---------------------------------------------------------------------------

export type RepairPlacement =
  | 'no-repair'
  | 'inside-own-base'
  | 'open-repair' // ремонт начат, конца ремонта нет, выезда тоже нет — открытый ремонт
  | 'capped-by-departure' // конца ремонта нет, но выезд есть — ремонт показывается до выезда
  | 'end-without-start'
  | 'before-arrival'
  | 'after-departure';

/** Размещение ремонта относительно СВОЕГО периода базы (ремонт внутри — штатно). */
export const classifyRepairPlacement = (
  arrivalDay: number | null,
  departureDay: number | null,
  repairStartDay: number | null,
  repairEndDay: number | null,
): RepairPlacement => {
  if (repairStartDay == null && repairEndDay == null) return 'no-repair';
  if (repairEndDay != null && repairStartDay == null) return 'end-without-start';
  if (repairStartDay != null && repairEndDay == null) {
    return departureDay == null ? 'open-repair' : 'capped-by-departure';
  }
  const rs = repairStartDay as number;
  const re = repairEndDay as number;
  if (arrivalDay != null && rs < arrivalDay) return 'before-arrival';
  if (departureDay != null && re > departureDay) return 'after-departure';
  return 'inside-own-base';
};

// ---------------------------------------------------------------------------
// Направления: канонические страны и нормализация кодов
// ---------------------------------------------------------------------------

/**
 * Канонические коды стран портала (верхний регистр). Часть стран — трёхбуквенные
 * (CHN, RUS, TUR…), BY остаётся двухбуквенным — ровно как в примерах ТЗ
 * («RUS-By → RUS-BY»). LT/PL добавлены по фактическим данным (Литва, Польша),
 * их в списке ТЗ не было — это расширение, помечено в отчёте.
 */
export const COUNTRY_CANON = [
  'BY', 'RUS', 'CHN', 'TUR', 'KAZ', 'UZB', 'TJK', 'KGZ', 'MNG', 'IRN', 'GEO', 'ARM', 'AZE', 'LT', 'PL',
] as const;

export type CountryCode = (typeof COUNTRY_CANON)[number];

/** Токен (верхний регистр, как вводят) → канонический код. Неизвестный — нет записи. */
export const COUNTRY_ALIASES: Record<string, CountryCode> = {
  // Беларусь (по примеру ТЗ остаётся BY)
  BY: 'BY', BLR: 'BY', BEL: 'BY', BELARUS: 'BY', БЕЛ: 'BY', БЕЛАРУСЬ: 'BY', РБ: 'BY',
  // Россия
  RU: 'RUS', RUS: 'RUS', RF: 'RUS', RUSSIA: 'RUS', РФ: 'RUS', РОССИЯ: 'RUS',
  // Китай (CNH/HN/CN → CHN — примеры ТЗ)
  CN: 'CHN', CHN: 'CHN', CNH: 'CHN', HN: 'CHN', CHIN: 'CHN', CHINA: 'CHN', КНР: 'CHN', КИТАЙ: 'CHN',
  // Турция
  TR: 'TUR', TUR: 'TUR', TURKEY: 'TUR', ТУРЦИЯ: 'TUR',
  // Казахстан
  KZ: 'KAZ', KAZ: 'KAZ', KAZAKHSTAN: 'KAZ', КАЗАХСТАН: 'KAZ',
  // Узбекистан
  UZ: 'UZB', UZB: 'UZB', UZBEKISTAN: 'UZB', УЗБЕКИСТАН: 'UZB',
  // Таджикистан
  TJ: 'TJK', TJK: 'TJK', TAJIKISTAN: 'TJK', ТАДЖИКИСТАН: 'TJK',
  // Киргизия
  KG: 'KGZ', KGZ: 'KGZ', KYRGYZSTAN: 'KGZ', КЫРГЫЗСТАН: 'KGZ',
  // Монголия
  MN: 'MNG', MNG: 'MNG', MONGOLIA: 'MNG', МОНГОЛИЯ: 'MNG',
  // Иран
  IR: 'IRN', IRN: 'IRN', IRAN: 'IRN', ИРАН: 'IRN',
  // Грузия
  GE: 'GEO', GEO: 'GEO', GEORGIA: 'GEO', ГРУЗИЯ: 'GEO',
  // Армения (AM → ARM — пример ТЗ)
  AM: 'ARM', ARM: 'ARM', ARMENIA: 'ARM', АРМЕНИЯ: 'ARM',
  // Азербайджан
  AZ: 'AZE', AZE: 'AZE', AZERBAIJAN: 'AZE', АЗЕРБАЙДЖАН: 'AZE',
  // Литва, Польша (в данных есть; в списке ТЗ не упомянуты — расширение)
  LT: 'LT', LTU: 'LT', ЛИТВА: 'LT',
  PL: 'PL', POL: 'PL', POLAND: 'PL', ПОЛЬША: 'PL',
};

export interface CountryTokenResult {
  raw: string;
  canonical: CountryCode | null;
}

export interface CodeNormResult {
  /** Исходная строка. */
  input: string;
  /** Нормализованный код «XXX-YYY» или null, если пара не собирается. */
  code: string | null;
  tokens: CountryTokenResult[];
  /** Изменилось ли значение относительно ввода (после strip/uppercase). */
  changed: boolean;
  /** Неизвестные токены (не выдумываем код — владельцу на решение). */
  unknown: string[];
  notes: string[];
}

/** Разделители кода направления: дефисы любые, подчёркивания, слэши, пробелы. */
const CODE_SPLIT_RE = /[\s\-–—_/]+/;

/**
 * Нормализация одного токена страны. Верхний регистр, ё→е, обрезка пробелов;
 * поиск в COUNTRY_ALIASES. Неизвестный токен → null (без выдумывания).
 */
export const normalizeCountryToken = (tok: string): CountryCode | null => {
  const up = String(tok ?? '').trim().toUpperCase().replace(/Ё/g, 'Е');
  if (!up) return null;
  return COUNTRY_ALIASES[up] ?? null;
};

/**
 * Нормализация кода направления по ТЗ: верхний регистр, страна — канонический
 * код. Примеры (закреплены юнит-тестами):
 *   CNH-RUS → CHN-RUS;  HN-RUS → CHN-RUS;  RUS-By → RUS-BY;  BY-AM → BY-ARM.
 * Неизвестные токены НЕ подменяются: code = null (сначала — решение владельца),
 * список unknown заполняется. Одиночный токен нормализуется как есть и помечается.
 */
export const normalizeDirectionCode = (raw: string): CodeNormResult => {
  const input = String(raw ?? '');
  const parts = input.trim().split(CODE_SPLIT_RE).filter((p) => p.length > 0);
  const tokens: CountryTokenResult[] = parts.map((p) => ({ raw: p, canonical: normalizeCountryToken(p) }));
  const unknown = tokens.filter((t) => t.canonical == null).map((t) => t.raw);
  const notes: string[] = [];
  let code: string | null = null;
  if (!parts.length) {
    notes.push('пустая строка');
  } else if (tokens.every((t) => t.canonical != null)) {
    code = tokens.map((t) => t.canonical).join('-');
    if (parts.length === 1) notes.push('одиночный код (без пары «откуда-куда»)');
    if (parts.length > 2) notes.push('больше двух сегментов — код собран как есть');
  } else {
    notes.push('есть неизвестные токены — код не собирается без решения владельца');
  }
  const changed = code != null && code !== input.trim();
  return { input, code, tokens, changed, unknown, notes };
};

// ---------------------------------------------------------------------------
// Симуляция детерминированных ID (ТЗ второй задачи) — только расчёт
// ---------------------------------------------------------------------------

/**
 * Симуляция ключа ПЕРИОДА: vehicleId_type_startDate.
 * Пустые части → null (запись не готова к схеме), не «склеиваем» дырки.
 */
export const periodKeySim = (vehicleId: unknown, type: unknown, startIso: unknown): string | null => {
  const v = String(vehicleId ?? '').trim();
  const t = String(type ?? '').trim();
  const d = String(startIso ?? '').trim();
  if (!v || !t || !d) return null;
  return `${v}_${t}_${d}`;
};

/**
 * Симуляция ключа ЭТАПА: departureId_stageType_date_seq.
 * seq обязателен (в схеме ТЗ он есть; если у записи нет собственного seq —
 * вызывающий подставляет миграционный порядок и отдельно это считает).
 */
export const stageKeySim = (
  departureId: unknown,
  stageType: unknown,
  dateIso: unknown,
  seq: unknown,
): string | null => {
  const v = String(departureId ?? '').trim();
  const t = String(stageType ?? '').trim();
  const d = String(dateIso ?? '').trim();
  const n = Number(seq);
  if (!v || !t || !d || !Number.isFinite(n)) return null;
  return `${v}_${t}_${d}_${Math.floor(n)}`;
};

/** FNV-1a 32 бита → 8 hex. Симуляционный хэш текста для ключа события. */
export const fnv1a32 = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** Текст события → стабильный хэш (нормализация текста + FNV-1a). */
export const hashEventText = (text: unknown): string => fnv1a32(normText(text));

/**
 * Симуляция ключа СОБЫТИЯ: periodId_date_type_hash(text) по ТЗ.
 * Хэш-функция владельцем не зафиксирована — здесь симуляция на FNV-1a
 * (детерминированная, без записи); при внедрении хэш заменить на согласованный.
 */
export const eventKeySim = (periodId: unknown, dateIso: unknown, type: unknown, text: unknown): string | null => {
  const p = String(periodId ?? '').trim();
  const d = String(dateIso ?? '').trim();
  const t = String(type ?? '').trim();
  if (!p || !d || !t) return null;
  return `${p}_${d}_${t}_${hashEventText(text)}`;
};

/** Группы значений по ключу (для поиска дублей и коллизий). */
export const groupBy = <T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  items.forEach((it) => {
    const k = keyOf(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  });
  return map;
};

/** Группы >1 (дубли/коллизии), стабильно отсортированные по ключу. */
export const collisionsOf = <T>(items: T[], keyOf: (t: T) => string | null): Array<{ key: string; items: T[] }> =>
  [...groupBy(items.filter((it) => keyOf(it) != null), (it) => String(keyOf(it)))
    .entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ key, items: arr }))
    .sort((a, b) => a.key.localeCompare(b.key));

// ---------------------------------------------------------------------------
// Статистика (для черновых ставок/дней направлений)
// ---------------------------------------------------------------------------

export interface NumStats {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Сумма (для методики) */
  sum: number | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Числовая сводка по конечным числам (null-ы отбрасываются). */
export const numStats = (values: Array<number | null | undefined>): NumStats => {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return { n: 0, mean: null, median: null, min: null, max: null, sum: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: nums.length,
    mean: round2(sum / nums.length),
    median: round2(median),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    sum: round2(sum),
  };
};

// ---------------------------------------------------------------------------
// Города → страны (фрагмент карты ТОЛЬКО по городам из данных портала)
// ---------------------------------------------------------------------------

/**
 * Ключ — нормализованное имя города (normCityName). Карта сознательно узкая:
 * включены только города, которые реально встречаются в рейсах портала и
 * однозначно относятся к стране. Неизвестный город → null (страна не
 * выдумывается), такие города перечисляются в отчёте миграции.
 */
export const CITY_COUNTRY: Record<string, CountryCode> = {
  // Беларусь
  'минск': 'BY', 'гродно': 'BY', 'ивацевичи': 'BY', 'могилев': 'BY', 'брест': 'BY', 'заславль': 'BY',
  'мосты': 'BY', 'подосье': 'BY', 'сморгонь': 'BY', 'барановичи': 'BY', 'витебск': 'BY', 'гомель': 'BY',
  'лида': 'BY', 'борисов': 'BY', 'речица': 'BY', 'смолевичи': 'BY', 'дукора': 'BY', 'раков': 'BY',
  'узда': 'BY', 'червень': 'BY', 'михановичи': 'BY', 'пуховичи': 'BY', 'мозырь': 'BY', 'миоры': 'BY',
  'фаниполь': 'BY', 'брузги': 'BY', 'стабна': 'BY', 'колодищи': 'BY', 'марьина горка': 'BY',
  // Россия
  'москва': 'RUS', 'екатеринбург': 'RUS', 'чита': 'RUS', 'казань': 'RUS', 'забайкальск': 'RUS',
  'тобольск': 'RUS', 'новосибирск': 'RUS', 'барнаул': 'RUS', 'иркутск': 'RUS', 'нижний новгород': 'RUS',
  'копейск': 'RUS', 'санкт-петербург': 'RUS', 'омск': 'RUS', 'челябинск': 'RUS', 'самара': 'RUS',
  'нижнекамск': 'RUS', 'красноярск': 'RUS', 'рязань': 'RUS', 'томск': 'RUS', 'иваново': 'RUS',
  'ишим': 'RUS', 'братск': 'RUS', 'тольятти': 'RUS', 'тула': 'RUS', 'ульяновск': 'RUS',
  'первоуральск': 'RUS', 'великие луки': 'RUS', 'верхняя пышма': 'RUS', 'балакирево': 'RUS',
  'пермь': 'RUS', 'рыбинск': 'RUS', 'волжск': 'RUS', 'егорьевск': 'RUS', 'саратов': 'RUS',
  'долгопрудный': 'RUS', 'домодедово': 'RUS', 'уфа': 'RUS', 'мытищи': 'RUS', 'краснодар': 'RUS',
  'воронеж': 'RUS', 'дзержинск': 'RUS', 'рассказово': 'RUS', 'киржач': 'RUS', 'обнинск': 'RUS',
  'ворсино': 'RUS', 'ковров': 'RUS', 'кострома': 'RUS', 'электросталь': 'RUS', 'томилино': 'RUS',
  'тверь': 'RUS', 'магнитогорск': 'RUS', 'усть-луга': 'RUS', 'ярцево': 'RUS', 'старая купавна': 'RUS',
  'орехово-зуево': 'RUS', 'ростов-на-дону': 'RUS', 'лебедянь': 'RUS', 'выборг': 'RUS', 'ярославль': 'RUS',
  'камешково': 'RUS', 'одинцово': 'RUS', 'икша': 'RUS', 'ясногорск': 'RUS', 'новотроицк': 'RUS',
  'брянск': 'RUS', 'энгельс': 'RUS', 'кольчугино': 'RUS', 'златоуст': 'RUS', 'владимир': 'RUS',
  'боровичи': 'RUS', 'курган': 'RUS', 'тюмень': 'RUS', 'химки': 'RUS', 'краснознаменск': 'RUS',
  'подольск': 'RUS', 'гусь-хрустальный': 'RUS', 'ишня': 'RUS', 'новокузнецк': 'RUS', 'канск': 'RUS',
  'троицк': 'RUS', 'улан-удэ': 'RUS', 'батайск': 'RUS', 'вязьма': 'RUS', 'набережные челны': 'RUS',
  'верхняя синячиха': 'RUS',
  // Казахстан
  'алматы': 'KAZ', 'астана': 'KAZ', 'достык': 'KAZ', 'павлодар': 'KAZ', 'петропавловск': 'KAZ',
  'усть-каменогорск': 'KAZ', 'сарань': 'KAZ', 'тараз': 'KAZ', 'капшагай': 'KAZ', 'шиели': 'KAZ',
  'шелковка': 'KAZ', 'акбакай': 'KAZ', 'бахты': 'KAZ', 'уральск': 'KAZ',
  // Узбекистан
  'ташкент': 'UZB', 'чирчик': 'UZB', 'самарканд': 'UZB', 'джизак': 'UZB', 'сырдарья': 'UZB', 'шымкент': 'UZB',
  // Таджикистан
  'душанбе': 'TJK',
  // Киргизия
  'бишкек': 'KGZ',
  // Монголия
  'улан-батор': 'MNG',
  // Китай
  'алашанькоу': 'CHN', 'маньчжурия': 'CHN',
  // Турция
  'стамбул': 'TUR', 'кайсери': 'TUR', 'адана': 'TUR', 'черкезкей': 'TUR', 'текирдаг': 'TUR',
  'дюздже': 'TUR', 'гемлик': 'TUR', 'газиантеп': 'TUR', 'эсеньюрт': 'TUR', 'кыркларелли': 'TUR',
  // Армения
  'ереван': 'ARM', 'гюмри': 'ARM', 'аргаванд': 'ARM',
};

/** Алиасы-опечатки/варианты городов (нормализованное написание → канонический ключ карты). */
export const CITY_ALIASES: Record<string, string> = {
  'алашенкоу': 'алашанькоу', 'алашенькоу': 'алашанькоу', 'алашенкоц': 'алашанькоу', 'алаш': 'алашанькоу',
  'манчжурия': 'маньчжурия',
  'кайсерри': 'кайсери', 'черкезкёй': 'черкезкей', 'черкизкей': 'черкезкей', 'эссеньюрт': 'эсеньюрт',
  'кыркларели': 'кыркларелли',
  'ераван': 'ереван',
  'екаьтеринбург': 'екатеринбург', 'екатеренбург': 'екатеринбург',
  'новомоссковск': 'новомосковск', 'новоосибирск': 'новосибирск',
  'питер': 'санкт-петербург', 'спб': 'санкт-петербург', 'санкт-петребург': 'санкт-петербург',
  'миннск': 'минск', 'миинск': 'минск',
  'киржачь': 'киржач', 'краноярск': 'красноярск', 'крвсноярск': 'красноярск',
  'улан уде': 'улан-удэ', 'улан-уде': 'улан-удэ',
  'гродно -': 'гродно', 'ярцеов': 'ярцево', 'смогонь': 'сморгонь', 'cморгонь': 'сморгонь',
  'усть каменогорск': 'усть-каменогорск', 'шимкент': 'шымкент',
  'нижний  новгород': 'нижний новгород',
  'верхняя  пышма': 'верхняя пышма', 'в. пышма': 'верхняя пышма', 'пышма': 'верхняя пышма',
  'нн': 'нижний новгород', 'мо': 'москва', 'тлц брест': 'брест', 'рб': 'минск',
};

/** Нормализация имени города: регистр, ё→е, пробелы, скобки, алиасы. */
export const normCityName = (raw: unknown): string => {
  let s = normText(raw).replace(/\(.*?\)/g, ' ').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = CITY_ALIASES[s] ?? s;
  return s;
};

/**
 * Страна города: сначала точное совпадение, затем алиас. Составные значения
 * («Минск+Гомель», «Уральск - Ереван», «…-…-…») не разбираются — null.
 */
export const cityCountryOf = (raw: unknown): CountryCode | null => {
  const s = normCityName(raw);
  if (!s) return null;
  if (/\s-\s|\+/.test(s)) return null; // составной маршрут — не город
  const direct = CITY_COUNTRY[s];
  if (direct) return direct;
  const alias = CITY_ALIASES[s];
  return alias ? CITY_COUNTRY[alias] ?? null : null;
};
