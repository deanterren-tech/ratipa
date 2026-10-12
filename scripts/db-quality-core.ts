/**
 * db-quality-core — ЧИСТАЯ логика аудита качества базы RATIPA (без базы и без React).
 *
 * Модуль используется скриптами:
 *   · scripts/audit-db-quality.ts   — аудит реальной базы (ТОЛЬКО ЧТЕНИЕ);
 *   · scripts/test-db-quality-audit.ts — юнит-проверки этих детекторов.
 *
 * Детекторы (все — чистые функции, детерминированные):
 *   · скрипт букв в значениях (кириллица/латиница/смешанный);
 *   · разбор госномера: скелет, проблемы ввода (смешанные алфавиты,
 *     «цифровые близнецы», ведущие префиксы «1) », двойные/краевые пробелы,
 *     только-цифры, подозрительная длина/символы);
 *   · классификация пар «одна и та же сущность, разное написание»:
 *     spacing / case / script / format;
 *   · проверки чисел (не число, число-строкой, отрицательное, несоразмерное);
 *   · проверки дат (пусто, битый формат, далёкое будущее/прошлое,
 *     конец раньше начала);
 *   · мусор прошлых прогонов (probe/qa/test/tmp/demo) и тестовые номера;
 *   · доверие к «белому» мусору не выдумывается: неизвестное — не мусор.
 *
 * ВАЖНО: модуль ничего не пишет и не читает диск/сеть. Только функции.
 */
import {
  DAY_MS,
  dayToIso,
  foldPlate,
  normCityName,
  normText,
  parseLooseDate,
  vehicleKey,
  type ParsedDate,
} from './tl-audit-core.ts';

export {
  DAY_MS,
  dayToIso,
  foldPlate,
  normCityName,
  normText,
  parseLooseDate,
  vehicleKey,
};
export type { ParsedDate };

// ---------------------------------------------------------------------------
// Алфавиты и «цифровые близнецы»
// ---------------------------------------------------------------------------

const CYR_RE = /[А-ЯЁа-яё]/;
const LAT_RE = /[A-Za-z]/;
export const CYR_LETTERS = 'АВЕКМНОРСТУХІЁ';
export const LAT_LETTERS = 'ABEKMHOPCTYXIE';

/** Скрипт букв значения: none | cyr | lat | mixed. */
export type LetterKind = 'none' | 'cyr' | 'lat' | 'mixed';

export interface LetterMix {
  kind: LetterKind;
  cyr: number;
  lat: number;
  /** Позиции (индексы) букв разного скрипта — для примеров. */
  mixedPositions: number[];
}

/** Разбор букв строки по алфавитам. Цифры и разделители не считаются. */
export const letterMix = (raw: unknown): LetterMix => {
  const s = String(raw ?? '');
  let cyr = 0;
  let lat = 0;
  const mixedPositions: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const isCyr = CYR_RE.test(ch);
    const isLat = LAT_RE.test(ch);
    if (isCyr) cyr += 1;
    if (isLat) lat += 1;
    if (isCyr || isLat) continue;
    // разделители/цифры — не влияют
  }
  const kind: LetterKind = cyr > 0 && lat > 0 ? 'mixed' : cyr > 0 ? 'cyr' : lat > 0 ? 'lat' : 'none';
  if (kind === 'mixed') {
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (CYR_RE.test(ch) || LAT_RE.test(ch)) {
        // запомним только буквы «чужого» для строки набора? Здесь — все буквы при смешении.
        mixedPositions.push(i);
      }
    }
  }
  return { kind, cyr, lat, mixedPositions };
};

// ---------------------------------------------------------------------------
// Госномера
// ---------------------------------------------------------------------------

/** Проблемы ввода госномера (коды). */
export type PlateIssue =
  | 'empty'
  | 'mixed-script'
  | 'edge-space'
  | 'double-space'
  | 'numbered-prefix'
  | 'digits-only'
  | 'too-short'
  | 'too-long'
  | 'weird-chars'
  | 'latin-only-suspect';

export interface PlateInfo {
  raw: string;
  /** Скелет A-Z0-9 с фолдингом раскладки (как vehicleKey для первой части — здесь для всего значения). */
  skeleton: string;
  /** Скелет первой части (тягач до «/») — ключ сопоставления машин. */
  tractorKey: string;
  letters: LetterMix;
  issues: PlateIssue[];
}

/** Одна часть номера: буквы латиницей, цифры сохранены, прочее убрано. */
export const platePartKey = (part: string): string => foldPlate(part);

const looksLikePlateText = (s: string): boolean => CYR_RE.test(s) || LAT_RE.test(s);

/**
 * Разбор значения госномера. Ожидаемые формы: «АО 3921-7»,
 * «AO39217 / A3981B7», «АО 3921-7 / А 3981 В-7». Проблемы НЕ выдумываются:
 * необычная, но состоящая из букв/цифр/разделителей строка проблем не даёт.
 */
export const plateInfo = (raw: unknown): PlateInfo => {
  const s = String(raw ?? '');
  const issues: PlateIssue[] = [];
  if (!s.trim()) return { raw: s, skeleton: '', tractorKey: '', letters: letterMix(s), issues: ['empty'] };

  const letters = letterMix(s);
  if (letters.kind === 'mixed') issues.push('mixed-script');
  if (s !== s.trim()) issues.push('edge-space');
  if (/\s{2,}/.test(s)) issues.push('double-space');
  if (/^\s*\d+\s*\)\s*/.test(s)) issues.push('numbered-prefix');

  // Ведущий «1) » не входит в скелет/ключ машины (это нумерация ввода, не номер).
  const clean = s.replace(/^\s*\d+\s*\)\s*/, '');
  const skeleton = foldPlate(clean);
  if (!looksLikePlateText(clean) && skeleton.length >= 1) issues.push('digits-only');
  if (skeleton.length > 0 && skeleton.length < 4) issues.push('too-short');
  if (skeleton.length > 24) issues.push('too-long');
  if (/[^\w\sА-ЯЁа-яё/\\\-–—.,()'«»]/.test(s)) issues.push('weird-chars');
  // Латиница в номере — сама по себе нормальна (часть БД ведётся латиницей),
  // но отмечаем «чисто латинский» как потенциальный близнец кириллических записей.
  if (letters.kind === 'lat') issues.push('latin-only-suspect');

  const tractorKey = platePartKey(clean.split('/')[0] || clean);
  return { raw: s, skeleton, tractorKey, letters, issues };
};

/** Вид «близнеца»: та же сущность, другое написание. */
export type PlateTwinKind = 'spacing' | 'case' | 'script' | 'format';

/**
 * Классифицирует ПАРУ значений как «близнецов» (или null, если это разные сущности):
 *   spacing — отличаются только пробелами/разделителями («АО 3921-7» vs «АО39217»);
 *   case    — только регистром;
 *   script  — совпадают буквы, но алфавит разный (АО vs AO) — «цифровые близнецы»;
 *   format  — скелет совпадает, различие в группировке/прочем (например лишний префикс).
 * Если скелеты не совпадают — null: утверждать тождество нельзя.
 */
export const classifyPlatePair = (a: string, b: string): PlateTwinKind | null => {
  const ra = String(a ?? '').trim();
  const rb = String(b ?? '').trim();
  if (!ra || !rb || ra === rb) return null;
  const fa = foldPlate(ra);
  const fb = foldPlate(rb);
  if (!fa || !fb || fa !== fb) return null;
  // 1) Скрипт букв: кириллица vs латиница («цифровые близнецы»).
  const ka = letterMix(ra).kind;
  const kb = letterMix(rb).kind;
  if (ka !== kb) return 'script';
  // 2) Только регистр.
  if (ra.toLowerCase() === rb.toLowerCase()) return 'case';
  const wsNorm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  // 3) Только пробелы (краевые/двойные).
  if (wsNorm(ra).toLowerCase() === wsNorm(rb).toLowerCase()) return 'spacing';
  // 4) Пробелы/разделители.
  const sepFree = (s: string): string => s.replace(/[\s/\-–—_]/g, '').toUpperCase();
  if (sepFree(ra) === sepFree(rb)) return 'spacing';
  return 'format';
};

/** Группы «близнецов»: ключ — скелет, значения — разные написания одной сущности. */
export interface TwinGroup {
  skeleton: string;
  kind: PlateTwinKind;
  variants: string[];
}

/**
 * Группировка значений по скелету; группы, где скелет один, а написания
 * различаются, классифицируются. Детерминированный порядок.
 */
export const twinGroups = (values: Array<{ key: string; value: string }>): TwinGroup[] => {
  const bySkeleton = new Map<string, Map<string, string[]>>(); // skeleton → value → keys
  values.forEach(({ key, value }) => {
    const info = plateInfo(value);
    if (!info.skeleton || info.issues.includes('empty')) return;
    const m = bySkeleton.get(info.skeleton) ?? new Map();
    const arr = m.get(info.raw) ?? [];
    arr.push(key);
    m.set(info.raw, arr);
    bySkeleton.set(info.skeleton, m);
  });
  const groups: TwinGroup[] = [];
  [...bySkeleton.entries()].forEach(([skeleton, m]) => {
    const variants = [...m.keys()];
    if (variants.length < 2) return;
    // вид группы: самый «серьёзный» из парных различий (script > format > case > spacing)
    const found = new Set<PlateTwinKind>();
    for (let i = 0; i < variants.length; i += 1) {
      for (let j = i + 1; j < variants.length; j += 1) {
        const k = classifyPlatePair(variants[i], variants[j]);
        if (k) found.add(k);
      }
    }
    const kind: PlateTwinKind = (['script', 'format', 'case', 'spacing'] as const).find((k) => found.has(k)) ?? 'spacing';
    groups.push({ skeleton, kind, variants: variants.sort() });
  });
  return groups.sort((a, b) => a.skeleton.localeCompare(b.skeleton));
};

// ---------------------------------------------------------------------------
// Мусор прошлых прогонов
// ---------------------------------------------------------------------------

export interface JunkHit {
  pattern: string;
  value: string;
}

/**
 * Поиск признаков мусора в наборе значений (id/автор/заметка/текст).
 * Консервативно: срабатывают только явные маркеры. Возвращает найденные
 * пары «маркер → значение», отсортированные.
 */
const JUNK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'probe', re: /(^|[^a-zа-яё])probe/i },
  { name: 'проб', re: /проб(н|а|ы|ой)/i },
  { name: 'тест', re: /(^|[^а-яё])тест/i },
  { name: 'qa', re: /(^|[^a-zа-яё])qa[_\-\s]|(^|[^a-zа-яё])qa$/i },
  { name: 'test', re: /(^|[^a-zа-яё])test([^a-zа-яё]|$)/i },
  { name: 'tmp', re: /(^|[^a-zа-яё])tmp[_\-\s]|(^|[^a-zа-яё])tmp$/i },
  { name: 'demo', re: /demo/i },
  { name: 'sample', re: /(^|[^a-zа-яё])sample/i },
  { name: 'foo', re: /(^|[^a-z0-9])foo([^a-z0-9]|$)/i },
  { name: 'asdf', re: /asdf|фыва/i },
  { name: 'digits-noise', re: /(412412|123123|135135|1234567890|3515351)/ },
  { name: 'placeholder-1234', re: /(^|[^a-zа-яё0-9])1234([^0-9]|$)/ },
];

export const looksJunk = (parts: Array<unknown>): JunkHit[] => {
  const hits: JunkHit[] = [];
  parts.forEach((p) => {
    const s = String(p ?? '');
    if (!s) return;
    JUNK_PATTERNS.forEach(({ name, re }) => {
      if (re.test(s)) hits.push({ pattern: name, value: s.slice(0, 80) });
    });
  });
  return hits.sort((a, b) => (a.pattern + a.value).localeCompare(b.pattern + b.value));
};

/** Тестовый латинский номер вида AA1234BB / HH4567KK (используется только в демо-данных). */
export const isTestPlate = (s: unknown): boolean => /^[A-Z]{2}\d{4}[A-Z]{2}$/.test(String(s ?? '').trim().toUpperCase());

// ---------------------------------------------------------------------------
// Числа
// ---------------------------------------------------------------------------

export type NumIssueKind = 'non-numeric' | 'numeric-string' | 'negative' | 'absurd';

export interface NumIssue {
  field: string;
  value: unknown;
  kind: NumIssueKind;
  note?: string;
}

export interface NumOpts {
  /** Разрешить отрицательные значения (например profit). */
  allowNegative?: boolean;
  /** Верхняя граница правдоподобия (суммы/км). */
  max?: number;
  /** Значение обязательно (пусто → non-numeric). */
  required?: boolean;
}

/** Число, записанное строкой («14», «1 250,50»). */
export const numericString = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const t = v.trim().replace(/\s/g, '').replace(',', '.');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t);
};

/** Проверка числового поля. Пустое значение — отдельная тема (обязательность), здесь не шумим. */
export const numIssues = (field: string, v: unknown, opts: NumOpts = {}): NumIssue[] => {
  const out: NumIssue[] = [];
  if (v === undefined || v === null || v === '') {
    if (opts.required) out.push({ field, value: v, kind: 'non-numeric', note: 'пустое обязательное' });
    return out;
  }
  if (typeof v === 'string') {
    if (numericString(v)) out.push({ field, value: v, kind: 'numeric-string', note: 'число записано строкой' });
    else out.push({ field, value: v, kind: 'non-numeric', note: 'не число' });
    return out;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    out.push({ field, value: v, kind: 'non-numeric' });
    return out;
  }
  if (v < 0 && !opts.allowNegative) out.push({ field, value: v, kind: 'negative' });
  if (opts.max !== undefined && Math.abs(v) > opts.max) out.push({ field, value: v, kind: 'absurd', note: `> ${opts.max}` });
  return out;
};

// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

export type DateIssueKind = 'missing' | 'bad-format' | 'far-future' | 'far-past' | 'end-before-start';

export interface DateIssue {
  field: string;
  value: unknown;
  kind: DateIssueKind;
  note?: string;
}

export interface DateCtx {
  todayDay: number;
  /** Максимально допустимое удаление в будущее (дней), по умолчанию ~2 года. */
  maxFutureDays?: number;
  /** Минимальная разумная дата (ISO), по умолчанию 2015-01-01. */
  minIso?: string;
  required?: boolean;
}

const DEFAULT_MAX_FUTURE = 800; // ≈ 2 года
const DEFAULT_MIN_ISO = '2015-01-01';

const minIsoDay = (iso: string): number => {
  const p = parseLooseDate(iso);
  return p ? p.day : 0;
};

/** Проверка даты-значения. Формат «пусто» — missing; не парсится — bad-format. */
export const dateIssues = (field: string, v: unknown, ctx: DateCtx): DateIssue[] => {
  const s = String(v ?? '').trim();
  if (!s) {
    return ctx.required ? [{ field, value: v, kind: 'missing' }] : [];
  }
  const p = parseLooseDate(s);
  if (!p) return [{ field, value: v, kind: 'bad-format', note: 'не разбирается как дата' }];
  const out: DateIssue[] = [];
  const maxFuture = ctx.maxFutureDays ?? DEFAULT_MAX_FUTURE;
  if (p.day > ctx.todayDay + maxFuture) out.push({ field, value: v, kind: 'far-future', note: p.iso });
  const minDay = minIsoDay(ctx.minIso ?? DEFAULT_MIN_ISO);
  if (p.day < minDay) out.push({ field, value: v, kind: 'far-past', note: p.iso });
  return out;
};

/** Для пары «начало—конец»: конец раньше начала (оба должны парситься). */
export const endBeforeStart = (startV: unknown, endV: unknown): boolean => {
  const a = parseLooseDate(startV);
  const b = parseLooseDate(endV);
  if (!a || !b) return false;
  return b.day < a.day;
};

/** Возраст даты в днях относительно «сегодня» (null — не разобралась). */
export const ageDays = (v: unknown, todayDay: number): number | null => {
  const p = parseLooseDate(v);
  if (!p) return null;
  return todayDay - p.day;
};

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

/** Значения с одинаковым ключом (нормализация) — группы > 1, стабильный порядок. */
export const dupGroups = <T>(items: T[], keyOf: (t: T) => string | null): Array<{ key: string; items: T[] }> => {
  const m = new Map<string, T[]>();
  items.forEach((it) => {
    const k = keyOf(it);
    if (k == null || k === '') return;
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  });
  return [...m.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ key, items: arr }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

/** Нормализованный ключ «имя-фамилия» (RU): ё→е, регистр, пробелы, латиница→кириллица не делается. */
export const personKeyRu = (name: unknown): string =>
  normText(String(name ?? '').replace(/[().,]/g, ' ').replace(/\s+/g, ' '));

/** Двойные пробелы/краевые пробелы в строке. */
export const hasSpaceNoise = (v: unknown): boolean => {
  const s = String(v ?? '');
  return s !== s.trim() || /\s{2,}/.test(s);
};

export const normEscape = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
