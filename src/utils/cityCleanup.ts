/**
 * Починка справочника городов: ЧИСТАЯ логика (без базы и сети) — опечатки,
 * склейки в полях мест, защищённые значения и перевывод алиасов строго из
 * своего geonameId. Используется scripts/fix-cities-cleanup.ts и юнит-тестами.
 *
 * Правила опечаток (решение владельца): значение связывается с городом только
 * если (а) кандидат РОВНО один, (б) само значение не является именем/алиасом
 * другой записи (иначе это не опечатка), (в) расстояние Левенштейна ≤2 после
 * нормализации, первая буква и алфавит совпадают. Иначе — не трогать и
 * вынести в отчёт (напр. «Ульяновка» — может быть настоящей деревней).
 */
import { normalizeCityName, levenshtein, hasCyrillic } from './cityDirectory';
import { buildGeonamesCity, type GeonamesRow } from './geonames';

// ---------------------------------------------------------------------------
// Защищённые значения: условные пометки и заметки — НЕ ТРОГАТЬ ВООБЩЕ
// ---------------------------------------------------------------------------

/** Условные пометки (Московская обл., Нижний Новгород-сокращение, РБ). */
export const PROTECTED_TOKENS = ['мо', 'нн', 'рб'];

/** Заметки/свободный текст, которые владелец запретил трогать. */
export const PROTECTED_NOTES = ['без водителя', 'нет водителя', 'хз "тп"', 'тп "хз"'];

/** Нормализованные формы защищённых заметок (кавычки нормализация срезает). */
const PROTECTED_NOTE_NORMS = PROTECTED_NOTES.map((v) => normalizeCityName(v)).filter(Boolean);

/** Регулярные заметки про отпуска/больничные — не места. */
export const NOTE_PATTERNS: RegExp[] = [/отпуск/, /больничн/];

/** Числовые значения — на решение владельца (не трогаем и не чистим). */
export const isNumericValue = (raw: string): boolean => /^\d+$/.test(normalizeCityName(raw));

/** Значение защищено от любой автоматической правки. */
export function isProtectedValue(raw: string): boolean {
  const norm = normalizeCityName(raw);
  if (!norm) return false;
  if (PROTECTED_TOKENS.includes(norm)) return true;
  if (PROTECTED_NOTE_NORMS.includes(norm)) return true;
  if (NOTE_PATTERNS.some((re) => re.test(norm))) return true;
  return false;
}

/**
 * «Мягкая» нормализация для эвристик склеек: регистр/ё/пробелы — БЕЗ свёртки
 * тире и вырезания пунктуации (склейки живут именно на тире и запятых:
 * «Брест - МИНСК», «КЗ/УЗ/РФ», «Москва, на КЗ, УЗ»).
 */
const lightNorm = (raw: string): string =>
  String(raw || '')
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Склейки («Минск+Гомель», «КЗ/УЗ/РФ», «Брест - МИНСК», «на второй круг»)
// ---------------------------------------------------------------------------

/** Явный список склеек из отчёта владельцу (нормализованные формы). */
export const GLUE_VALUES: string[] = [
  'минск+гомель',
  'мосты+борисов',
  'ростов+минск',
  'брест - минск',
  'москва, на кз, уз, кг, мнг',
  'ростов на армению',
  'челябинск - на кз',
  'на арм, тр',
  'кз/уз/рф',
  'на второй круг',
  'курган + тюмень',
];

/** Нормализованные формы явного списка склеек («Брест - МИНСК» → «брест-минск»). */
const GLUE_NORMS = new Set(GLUE_VALUES.map((v) => normalizeCityName(v)).filter(Boolean));

const COUNTRY_CODE_TOKEN = /\b(кз|уз|рф|арм|тр|мнг)\b/;

/**
 * Склейка двух мест/страны-кода в одном значении поля места. Обобщение списка
 * владельца: «+», «/», «на <страна-код>», код страны рядом с запятой,
 * «<город> - <код/столица>». Обычные составные названия («Ростов-на-Дону»,
 * «Забайкальск - Маньчжурия») под правило не попадают.
 */
export function isGluedValue(raw: string): boolean {
  const norm = normalizeCityName(raw);
  if (!norm) return false;
  if (GLUE_NORMS.has(norm)) return true;
  const light = lightNorm(raw);
  if (light.includes('+') || light.includes('/')) return true;
  if (/\bна\s+(второй\s+круг|армению|арм|кз|уз|рф|тр|мнг)\b/.test(light)) return true;
  if (/[,;]\s*[а-яе]{0,3}\s?\b(кз|уз|рф|арм|тр|мнг)\b/.test(light)) return true;
  if (/\s-\s/.test(light) && COUNTRY_CODE_TOKEN.test(light)) return true;
  if (/\s-\s/.test(light) && /\bминск\b/.test(light)) return true; // «Брест - МИНСК»
  return false;
}

// ---------------------------------------------------------------------------
// Опечатки: подбор единственного безопасного кандидата
// ---------------------------------------------------------------------------

export interface CleanupCatalogEntry {
  id: string;
  name: string;
  aliases?: string[];
}

export interface TypoCandidate {
  id: string;
  /** Форма записи, к которой привязались. */
  form: string;
  distance: number;
}

/** Значения, которые владелец запретил трогать, даже если они «похожи». */
export const TYPO_DENYLIST = ['ульяновка', 'самра', 'астана', 'астара'];

export interface TypoOptions {
  /** Имена-кандидаты на запрет (норм. формы). */
  denylist?: string[];
  /** Максимальное расстояние Левенштейна (по умолчанию 2). */
  maxDistance?: number;
  /** Минимальная длина значения (короткие пометки не трогаем). */
  minLength?: number;
}

/**
 * Кандидат-город для опечаточного значения. null — если точной формы нет,
 * кандидат не единственный, нарушены правила безопасности, или значение
 * защищено/является склейкой.
 */
export function findTypoCandidate(
  value: string,
  catalog: CleanupCatalogEntry[],
  options: TypoOptions = {},
): TypoCandidate | null {
  const nv = normalizeCityName(value);
  if (!nv) return null;
  const minLen = options.minLength ?? 4;
  if (nv.length < minLen) return null;
  if (isProtectedValue(value) || isGluedValue(value) || isNumericValue(value)) return null;
  const denylist = [...TYPO_DENYLIST, ...(options.denylist || [])];
  if (denylist.includes(nv)) return null;
  const maxDistance = options.maxDistance ?? 2;

  const results = new Map<string, TypoCandidate>();
  for (const rec of catalog) {
    const forms = [rec.name, ...(rec.aliases || [])].map(normalizeCityName).filter(Boolean);
    for (const f of forms) {
      // (б) само значение — точная форма записи: это не опечатка, а имя города
      if (f === nv) return null;
      if (hasCyrillic(nv) !== hasCyrillic(f)) continue;
      if (nv.charAt(0) !== f.charAt(0)) continue;
      const d = levenshtein(nv, f, maxDistance);
      if (d >= 1 && d <= maxDistance) {
        const cur = results.get(rec.id);
        if (!cur || d < cur.distance) results.set(rec.id, { id: rec.id, form: f, distance: d });
      }
    }
  }
  // (а) кандидат ровно один — берём БЛИЖАЙШИЙ: единственная запись на
  // минимальном расстоянии. Если на минимуме несколько записей — не трогаем.
  const list = Array.from(results.values());
  if (!list.length) return null;
  const minDistance = Math.min(...list.map((c) => c.distance));
  const best = list.filter((c) => c.distance === minDistance);
  if (best.length !== 1) return null;
  return best[0];
}

// ---------------------------------------------------------------------------
// Перевывод алиасов из своего geonameId (+ что заведомо «чужое»)
// ---------------------------------------------------------------------------

/** «Свои» формы строки дампа: основное имя (ru/ascii) и её собственные алиасы. */
export function ownFormsOf(row: GeonamesRow, ruNames: string[] | undefined): string[] {
  const city = buildGeonamesCity(row, ruNames);
  return Array.from(new Set([city.name, city.asciiName, ...city.aliases].filter(Boolean)));
}

export interface AliasRebuildPlan {
  /** Убрать из алиасов (чужие формы, выводимые из ДРУГИХ geonameId). */
  remove: string[];
  /** Добавить (свои формы, потерянные при склейке). */
  add: string[];
  newAliases: string[];
}

/**
 * Перевывод алиасов записи строго из своего geonameId.
 * Форма остаётся, если она своя (норм. форма в ownKeepForms — имя/ascii/свои
 * алиасы) ИЛИ не выводится ни из какого чужого geonameId (значит, пришла из
 * миграции/ручного ввода — напр. «улан уде» у записи, дополненной из дампа).
 * Чужие формы, выводимые из ДРУГИХ строк дампа/alternateNamesV2 (dumpDomain),
 * удаляются. Добавляются ровно те формы, что создал бы свежий импорт
 * (rebuiltForms = buildGeonamesCity(...).aliases — с теми же лимитами).
 */
export function planAliasRebuild(
  currentAliases: string[],
  ownKeepForms: string[],
  rebuiltForms: string[],
  dumpDomainNorms: ReadonlySet<string>,
  /** Норм. форма имени записи — она «и так есть» и в алиасы не дублируется. */
  nameNorm?: string,
): AliasRebuildPlan | null {
  const nameN = nameNorm ? normalizeCityName(nameNorm) : '';
  const own = new Set(ownKeepForms.map((f) => normalizeCityName(f)).filter(Boolean));
  const keep: string[] = [];
  const remove: string[] = [];
  const present = new Set<string>();
  for (const f of currentAliases) {
    const n = normalizeCityName(f);
    if (!n) continue;
    if (present.has(n)) {
      // пунктуационный дубль — не наша забота, оставляем как есть
      keep.push(f);
      continue;
    }
    present.add(n);
    if (own.has(n) || !dumpDomainNorms.has(n)) keep.push(f);
    else remove.push(f);
  }
  const add = rebuiltForms.filter((f) => {
    const n = normalizeCityName(f);
    return n && n !== nameN && !present.has(n);
  });
  if (!remove.length && !add.length) return null;
  return { remove, add, newAliases: [...keep, ...add] };
}

/**
 * Слить записи одного города: «канон» (geonames-запись с country/координатами/
 * населением) получает usageCount/type/aliases миграции, след mergedFrom.
 * Возвращает поля канона для записи (без id/name/country/координат — их не трогаем).
 */
export function mergeIntoCanonPatch(
  canon: CleanupCatalogEntry & { usageCount?: number; type?: string; mergedFrom?: string[] },
  merged: CleanupCatalogEntry & { usageCount?: number; type?: string },
  when: string,
): Record<string, unknown> {
  const have = new Set([canon.name, ...(canon.aliases || [])].map((f) => normalizeCityName(f)).filter(Boolean));
  const addAliases: string[] = [];
  [merged.name, ...(merged.aliases || [])].forEach((f) => {
    const n = normalizeCityName(f);
    if (n && !have.has(n)) {
      have.add(n);
      addAliases.push(f);
    }
  });
  const patch: Record<string, unknown> = {
    aliases: [...(canon.aliases || []), ...addAliases],
    usageCount: (canon.usageCount || 0) + (merged.usageCount || 0),
    mergedFrom: Array.from(new Set([...(canon.mergedFrom || []), merged.id])),
    updatedAt: when,
  };
  if (merged.type) patch.type = merged.type;
  return patch;
}
