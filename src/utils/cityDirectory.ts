/**
 * Города: чистая логика (нормализация, транслит, Левенштейн, группировка),
 * общая для миграционного скрипта (scripts/migrate-cities.ts) и интерфейса
 * (CityAutocomplete). Никаких зависимостей от React и базы — только строки.
 *
 * Принципы:
 *  - нормализация НЕ меняет сами данные — это только ключ сравнения;
 *  - похожесть строгая: разные города не должны склеиваться (Минск ≠ Пинск);
 *  - каноническое название выбирается по частоте, спорные пары попадают в
 *    отчёт для ручного решения, а не в автоматическую склейку.
 */

export type CityKind = 'город' | 'граница' | 'терминал' | 'таможня';

export const CITY_KINDS: CityKind[] = ['город', 'граница', 'терминал', 'таможня'];

/** Класс источника (влияет только на отчёт и защиту от мусора). */
export type CitySourceClass = 'place' | 'checkpoint' | 'location' | 'free-text';

export interface CityCandidate {
  /** Нормализованный ключ (см. normalizeCityName). */
  norm: string;
  /** Исходное (trim) написание одного из вариантов. */
  name: string;
  /** Всего вхождений значения во всех источниках. */
  count: number;
  /** Вхождений в «реальные рейсы» (вес тай-брейка канонического имени). */
  tripCount: number;
  /** Класс самого частого источника. */
  kind: CitySourceClass;
  /** Подсказки типа из контекста (этап-граница → «граница» и т.п.). */
  typeHints: CityKind[];
  /** Страны, встреченные рядом в справочных данных (BY, RU, TR, ...). */
  countries: string[];
}

export interface CityGroupVariant {
  /** Исходное написание варианта. */
  name: string;
  norm: string;
  count: number;
  tripCount: number;
  kind: CitySourceClass;
}

export interface CityGroup {
  /** Каноническое название (по частоте; при равенстве — по рейсам). */
  canonical: string;
  norm: string;
  /** Все варианты группы, от частого к редкому. */
  variants: CityGroupVariant[];
  /** Суммарное число вхождений по группе. */
  count: number;
  tripCount: number;
  typeHints: CityKind[];
  countries: string[];
  /** Группа содержит более одного варианта написания (дубли). */
  isDuplicate: boolean;
  /** Совокупность классов источников. */
  kinds: CitySourceClass[];
}

export interface BorderlinePair {
  a: string;
  b: string;
  /** Расстояние Левенштейна по нормализованным формам. */
  distance: number;
  countA: number;
  countB: number;
}

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

/** Служебные приставки, которые не являются частью названия. */
const LEADING_PREFIXES = [
  /^г\.\s*/,
  /^г\s+/,
  /^город\s+/,
  /^пгт\.?\s*/,
  /^пос\.\s*/,
  /^посёлок\s+/,
  /^поселок\s+/,
  /^с\.\s*/,
  /^ст\.\s*/,
  /^рп\.\s*/,
];

/**
 * Ключ сравнения городов: trim, регистр, ё→е, пунктуация и пробелы.
 * Применяется ТОЛЬКО для сравнения/поиска — сами данные не переписываются.
 */
export function normalizeCityName(raw: string): string {
  if (!raw) return '';
  let s = String(raw).normalize('NFC');
  // мягкий перенос и неразрывные пробелы
  s = s.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ');
  s = s.trim();
  // единые тире и кавычки
  s = s.replace(/[–—−―]/g, '-').replace(/[«»“”„‟‘’`´]/g, '"');
  // приставки «г.», «город», «пос.» и т.п. — не часть названия
  for (const re of LEADING_PREFIXES) {
    if (re.test(s.toLowerCase())) {
      s = s.replace(re, '');
      break;
    }
  }
  // скобочные уточнения НЕ выкидываем (могут быть значимы: «Козловичи (Брест)»),
  // но пунктуацию и пробелы приводим к единому виду
  s = s.replace(/\s+([,;:"'()])/g, '$1').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')');
  s = s.replace(/([,;:])(?=[^\s\d)])/g, '$1 ');
  s = s.replace(/\.\s+/g, '. ');
  s = s.replace(/\s*-\s*/g, '-');
  // схлопываем пробелы и убираем висящую пунктуацию по краям
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[,;:."'\-\s]+/, '').replace(/[,;:."'\s]+$/, '').replace(/-+$/, '').trim();
  s = s.toLowerCase().replace(/ё/g, 'е');
  // финальная схлопка пробелов (после замен)
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Есть ли в строке кириллица. */
export const hasCyrillic = (s: string): boolean => /[а-яё]/i.test(s);

/** Есть ли в строке латиница. */
export const hasLatin = (s: string): boolean => /[a-z]/i.test(s);

// ---------------------------------------------------------------------------
// Транслит (сравнение кириллица ↔ латиница и стабильные id)
// ---------------------------------------------------------------------------

/** Основные соответствия ru→lat (упрощённый практический транслит). */
const RU_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Альтернативные прочтения букв, встречающиеся в реальных записях. */
const ALT: Record<string, string[]> = {
  х: ['h', 'kh'],
  ц: ['ts', 'c'],
  щ: ['shch', 'sch'],
  я: ['ya', 'ia'],
  ю: ['yu', 'iu'],
  ы: ['y', 'i'],
  й: ['y', 'i'],
  ж: ['zh'],
  ё: ['e'],
};

/** Максимум вариантов транслита, чтобы не взрываться на длинных названиях. */
const MAX_VARIANTS = 24;

/** Базовый транслит: кириллица → латиница, остальное как есть (lowercase). */
export function ruToLatin(raw: string): string {
  const s = String(raw || '').toLowerCase();
  let out = '';
  for (const ch of s) out += RU_LAT[ch] ?? ch;
  return out;
}

const expand = (s: string, map: Record<string, string[]>): string[] => {
  let variants = [''];
  for (const ch of s) {
    const alts = map[ch];
    if (!alts || alts.length <= 1) {
      const add = alts ? alts[0] : null;
      variants = variants.map((v) => v + (add != null ? add : ch));
      continue;
    }
    const next: string[] = [];
    for (const v of variants) {
      for (const a of alts) {
        next.push(v + a);
        if (next.length >= MAX_VARIANTS * 2) break;
      }
      if (next.length >= MAX_VARIANTS * 2) break;
    }
    variants = next.slice(0, MAX_VARIANTS * 2);
  }
  return Array.from(new Set(variants.map((v) => v.replace(/[^a-z0-9]+/g, '')))).filter(Boolean);
};

/** Дополнительные прочтения латинской записи (kh→h и т.п.). */
export const latinFolds = (raw: string): string[] => {
  const base = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!base) return [];
  const out = new Set<string>([base]);
  const rules: Array<[RegExp, string]> = [
    [/kh/g, 'h'],
    [/ya/g, 'ia'],
    [/yu/g, 'iu'],
    [/sch/g, 'shch'],
    [/ts/g, 'c'],
  ];
  // по одному правилу и все вместе — небольшой обозримый набор
  rules.forEach(([re, to]) => out.add(base.replace(re, to)));
  let all = base;
  rules.forEach(([re, to]) => { all = all.replace(re, to); });
  out.add(all);
  return Array.from(out);
};

/** Набор сравнимых латинских форм строки (кириллица → транслит-варианты). */
export function translitVariants(raw: string): string[] {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return [];
  if (hasCyrillic(s)) {
    const cyr = s.normalize('NFC');
    const map: Record<string, string[]> = {};
    for (const ch of cyr) map[ch] = ALT[ch] ?? (RU_LAT[ch] ? [RU_LAT[ch]] : [ch]);
    return expand(cyr, map);
  }
  return latinFolds(s);
}

/** Стабильный id города: латинский слаг (кросс-раскладочная идемпотентность). */
export function citySlug(raw: string): string {
  const norm = normalizeCityName(raw);
  const lat = hasCyrillic(norm) ? ruToLatin(norm) : norm;
  const slug = lat
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'city';
}

// ---------------------------------------------------------------------------
// Левенштейн и правила похожести
// ---------------------------------------------------------------------------

/** Левенштейн с ограничением сверху: если больше max — вернётся max+1. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[lb];
}

/** Тип совпадения значений (строго, чтобы не склеивать разные города). */
export type CityMatchKind = 'exact' | 'translit' | 'typo' | null;

const firstChar = (s: string): string => s.charAt(0);

/**
 * Безопасные короткие правки (d=1 при длине < 8): автосклейка только если
 * вставлена/удалена ДУБЛИРУЮЩАЯ буква («Хоргосс»→«Хоргос») или короткое
 * значение является точным префиксом длинного («Иркутс»→«Иркутск»).
 * Обычная замена буквы в коротком названии автосклейку НЕ даёт: «Астана» и
 * «Астара» — разные города, вопрос решает человек (список «пограничных»).
 */
const shortEditSafe = (a: string, b: string): boolean => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true; // лишняя буква на конце
  if (long.length !== short.length + 1) return false; // не одиночная вставка — не безопасно
  for (let i = 0; i < long.length; i += 1) {
    if (long.slice(0, i) + long.slice(i + 1) === short) {
      const ch = long[i];
      return (i > 0 && long[i - 1] === ch) || (i + 1 < long.length && long[i + 1] === ch);
    }
  }
  return false;
};

/**
 * Похожесть двух НОРМАЛИЗОВАННЫХ названий.
 *  - exact — совпали после нормализации (регистр/ё/пунктуация);
 *  - translit — кросс-раскладочное совпадение (Алашанькоу ↔ Alashankou);
 *  - typo — опечатка: d≤1 при длине ≥8 или безопасная короткая правка
 *    (удвоенная буква/усечение) ИЛИ d≤2 при длине ≥8 с совпадающими первыми
 *    двумя буквами; первая буква должна совпадать (иначе «Минск»/«Пинск»
 *    склеились бы);
 *  - null — похожими не считаются (в отчёте попадут в «пограничные пары»).
 * Кириллица и латиница напрямую по Левенштейну НЕ сравниваются (только транслит).
 */
export function cityMatchKind(a: string, b: string): CityMatchKind {
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const sameScript = hasCyrillic(a) === hasCyrillic(b);
  if (!sameScript) {
    const ta = translitVariants(a);
    const tb = translitVariants(b);
    const setB = new Set(tb);
    const hit = ta.some((v) => setB.has(v));
    return hit ? 'translit' : null;
  }
  const minLen = Math.min(a.length, b.length);
  if (firstChar(a) !== firstChar(b)) return null;
  const d = levenshtein(a, b, 2);
  if (d === 1) {
    if (minLen >= 8) return 'typo';
    return shortEditSafe(a, b) ? 'typo' : null;
  }
  if (d === 2 && minLen >= 8 && a.charAt(1) === b.charAt(1)) return 'typo';
  return null;
}

// ---------------------------------------------------------------------------
// Проверка «похоже на место» (защита от мусора в свободных текстах)
// ---------------------------------------------------------------------------

const JUNK_WORDS = [
  'отпуск', 'больничн', 'ждем', 'ждём', 'запчаст', 'простой', 'ремонт',
  'мойка', 'диагност', 'готовност', 'выехал', 'приехал', 'уехал', 'можно',
  'нельзя', 'срок', 'день', 'дня', 'сутки', 'тонн', 'загрузк', 'выгрузк',
];

/**
 * Похоже ли значение на название места (город/граница/терминал/таможня).
 * Консервативно: пропускаем всё, что явно не место, — такие значения идут в
 * отчёт «сомнительные», а не в справочник.
 */
export function looksLikePlaceName(norm: string): boolean {
  if (!norm) return false;
  if (norm.length < 3 || norm.length > 60) return false;
  if (/\d/.test(norm)) {
    // цифры допустимы максимум как малая добавка («Дорноговь 2»), но не основа
    const digits = (norm.match(/\d/g) || []).length;
    const letters = (norm.match(/[a-zа-я]/g) || []).length;
    if (digits >= 3 || letters < 4) return false;
  }
  if (!/[a-zа-я]{2}/i.test(norm)) return false;
  if (/[@#$%^&*_=+[\]{}|\\<>~`]/.test(norm)) return false;
  const words = norm.split(/[\s-]+/).filter(Boolean);
  if (words.length > 8) return false;
  const wordCount = words.length;
  const junk = JUNK_WORDS.some((w) => norm.includes(w));
  if (junk && wordCount >= 2) return false;
  return true;
}

/**
 * Значение свободного текста похоже на отдельное место, а не на фразу?
 * Короткие значения («Хоргос») — кандидаты; длинные фразы («день приезда —
 * можно») в справочник не идут — только в отчёт как свободный текст.
 */
export function isShortPlaceText(raw: string): boolean {
  const norm = normalizeCityName(raw);
  if (!norm || norm.length > 30) return false;
  if (/[.!?;:]/.test(raw.trim()) && norm.split(' ').length > 3) return false;
  return looksLikePlaceName(norm);
}

// ---------------------------------------------------------------------------
// Каноническое имя и группировка
// ---------------------------------------------------------------------------

const ruCompare = (a: string, b: string): number =>
  a.localeCompare(b, 'ru', { sensitivity: 'base' });

/** Каноническое отображаемое имя из самого частого варианта (регистр бережно). */
export function canonicalCityDisplay(variant: string): string {
  const s = String(variant || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const isAllUpper = s.length > 3 && s === s.toUpperCase() && /[А-ЯЁA-Z]/.test(s);
  const base = isAllUpper ? s.toLowerCase() : s;
  return base
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join('-'),
    )
    .join(' ');
}

const variantRank = (x: CityGroupVariant): [number, number, number, number] => [
  x.count,
  x.tripCount,
  x.kind === 'place' ? 1 : 0,
  // дальше — стабильный порядок: cyrillic-вариант предпочтительнее латинского
  hasCyrillic(x.name) ? 1 : 0,
];

const compareRank = (a: CityGroupVariant, b: CityGroupVariant): number => {
  const ra = variantRank(a);
  const rb = variantRank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] !== rb[i]) return rb[i] - ra[i];
  }
  return ruCompare(a.name, b.name);
};

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export interface GroupingResult {
  groups: CityGroup[];
  /**
   * Пары значений, близких по написанию (d ≤ 3 при совпадающих первых
   * символах), которые автоматически НЕ склеены (не прошли строгие правила
   * или разные скрипты без транслит-совпадения) — ручное решение.
   */
  borderline: BorderlinePair[];
}

/** Сводит кандидатов (по нормализованному ключу) в группы. */
export function groupCityCandidates(candidates: CityCandidate[]): GroupingResult {
  // Кандидаты уже уникальны по norm (вызывающий слой агрегирует).
  const byNorm = new Map<string, CityCandidate>();
  candidates.forEach((c) => {
    if (!c.norm) return;
    const prev = byNorm.get(c.norm);
    if (!prev) {
      byNorm.set(c.norm, { ...c, countries: [...c.countries], typeHints: [...c.typeHints] });
    } else {
      prev.count += c.count;
      prev.tripCount += c.tripCount;
      prev.countries = Array.from(new Set([...prev.countries, ...c.countries]));
      prev.typeHints = Array.from(new Set([...prev.typeHints, ...c.typeHints]));
    }
  });
  const list = Array.from(byNorm.values());

  // 1) компоненты связности по строгому правилу похожести
  const uf = new UnionFind(list.length);
  const norms = list.map((c) => c.norm);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (cityMatchKind(norms[i], norms[j])) uf.union(i, j);
    }
  }
  const components = new Map<number, number[]>();
  list.forEach((_, i) => {
    const root = uf.find(i);
    const arr = components.get(root) || [];
    arr.push(i);
    components.set(root, arr);
  });

  const groups: CityGroup[] = [];
  const borderline: BorderlinePair[] = [];
  const leftover: number[] = [];

  components.forEach((idxs) => {
    const members = idxs.map((i) => list[i]);
    const variants: CityGroupVariant[] = members.map((m) => ({
      name: m.name,
      norm: m.norm,
      count: m.count,
      tripCount: m.tripCount,
      kind: m.kind,
    }));
    variants.sort(compareRank);
    const best = variants[0];
    // 2) защита от транзитивных склеек: оставляем только те варианты, что
    //    похожи на самый частый НАПРЯМУЮ; остальные — в отдельный разбор
    const kept: CityGroupVariant[] = [];
    const dropped: CityGroupVariant[] = [];
    variants.forEach((v) => {
      if (v.norm === best.norm || cityMatchKind(best.norm, v.norm)) kept.push(v);
      else dropped.push(v);
    });
    const group: CityGroup = {
      canonical: canonicalCityDisplay(best.name),
      norm: best.norm,
      variants: kept,
      count: kept.reduce((s, v) => s + v.count, 0),
      tripCount: kept.reduce((s, v) => s + v.tripCount, 0),
      typeHints: Array.from(new Set(members.map((m) => m.typeHints).flat())),
      countries: Array.from(new Set(members.map((m) => m.countries).flat())),
      isDuplicate: kept.length > 1,
      kinds: Array.from(new Set(members.map((m) => m.kind))),
    };
    groups.push(group);
    dropped.forEach((v) => {
      const i = list.findIndex((c) => c.norm === v.norm);
      if (i >= 0) leftover.push(i);
    });
  });

  // 3) «висячие» варианты после транзитивной защиты — самостоятельные группы
  leftover.forEach((i) => {
    const m = list[i];
    groups.push({
      canonical: canonicalCityDisplay(m.name),
      norm: m.norm,
      variants: [{ name: m.name, norm: m.norm, count: m.count, tripCount: m.tripCount, kind: m.kind }],
      count: m.count,
      tripCount: m.tripCount,
      typeHints: [...m.typeHints],
      countries: [...m.countries],
      isDuplicate: false,
      kinds: [m.kind],
    });
  });

  // 4) «пограничные» пары: близко по написанию (d ≤ 3, общий префикс 3+),
  //    но не склеены правилами — отдельный список для ручного решения
  const seenPair = new Set<string>();
  for (const g of groups) {
    for (const h of groups) {
      if (g.norm >= h.norm) continue;
      const key = `${g.norm}::${h.norm}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      if (hasCyrillic(g.norm) !== hasCyrillic(h.norm)) continue;
      if (g.norm.slice(0, 3) !== h.norm.slice(0, 3)) continue;
      const d = levenshtein(g.norm, h.norm, 3);
      if (d <= 3 && d >= 1) {
        borderline.push({ a: g.canonical, b: h.canonical, distance: d, countA: g.count, countB: h.count });
      }
    }
  }
  borderline.sort((x, y) => x.distance - y.distance || (y.countA + y.countB) - (x.countA + x.countB));

  // порядок групп — по частоте
  groups.sort((a, b) => b.count - a.count || ruCompare(a.canonical, b.canonical));
  return { groups, borderline };
}

// ---------------------------------------------------------------------------
// Поиск похожих для интерфейса (CityAutocomplete)
// ---------------------------------------------------------------------------

export interface CityCatalogEntry {
  name: string;
  aliases?: string[];
}

export interface CitySuggestion<T extends CityCatalogEntry = CityCatalogEntry> {
  entry: T;
  /** Почему предложено: exact (имя/алиас), prefix, substring, similar. */
  reason: 'exact' | 'prefix' | 'substring' | 'similar';
  /** Для reason='similar' — расстояние Левенштейна/транслит-совпадение. */
  score?: number;
}

/**
 * Похожие записи справочника для введённого текста — по имени и алиасам,
 * без учёта регистра и ё, с транслит- и Левенштейн-терпимостью.
 * Сначала точные и префиксные совпадения, затем «похожие».
 */
export function findSimilarCities<T extends CityCatalogEntry>(
  query: string,
  entries: T[],
  limit = 8,
): CitySuggestion<T>[] {
  const q = normalizeCityName(query);
  if (!q) return [];
  const exact: CitySuggestion<T>[] = [];
  const prefix: CitySuggestion<T>[] = [];
  const substring: CitySuggestion<T>[] = [];
  const similar: CitySuggestion<T>[] = [];
  const seen = new Set<T>();
  entries.forEach((entry) => {
    const forms = [entry.name, ...(entry.aliases || [])].map((v) => normalizeCityName(v)).filter(Boolean);
    if (!forms.length) return;
    let best: CitySuggestion<T> | null = null;
    forms.forEach((f) => {
      if (f === q) {
        if (!best || best.reason !== 'exact') best = { entry, reason: 'exact' };
        return;
      }
      if (!best || best.reason === 'similar' || best.reason === 'substring') {
        if (f.startsWith(q)) {
          best = { entry, reason: 'prefix' };
          return;
        }
        if (f.includes(q)) {
          if (!best || best.reason !== 'prefix') best = { entry, reason: 'substring' };
          return;
        }
        const kind = cityMatchKind(q, f);
        if (kind === 'translit') {
          if (!best || best.reason === 'similar') best = { entry, reason: 'similar', score: 0 };
          return;
        }
        if (kind === 'typo') {
          const d = levenshtein(q, f, 2);
          if (!best || best.reason === 'similar') best = { entry, reason: 'similar', score: d };
        }
      }
    });
    if (best && !seen.has(entry)) {
      seen.add(entry);
      const bucket = best.reason === 'exact' ? exact : best.reason === 'prefix' ? prefix : best.reason === 'substring' ? substring : similar;
      bucket.push(best);
    }
  });
  similar.sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || ruCompare(a.entry.name, b.entry.name));
  return [...exact, ...prefix, ...substring, ...similar].slice(0, limit);
}
