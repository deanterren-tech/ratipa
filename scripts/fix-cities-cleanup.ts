/**
 * ПОЧИНКА справочника городов и cityId-привязок после бага импорта GeoNames
 * (импорт склеивал города по ОБЩЕМУ альтернативному имени: «Gorki» у Горок (BY)
 * и историческое «Gorki» у Нижнего Новгорода, «Kaliningrad» у Королёва,
 * «Podolsk» у Полоцка и т.п. — из-за чего записи получали чужие алиасы, а
 * города исчезали из справочника).
 *
 * Что делает (все ветки — как у scripts/migrate-cities.ts, общий обход из
 * scripts/cities-walk.ts; заметки/логи не трогаются):
 *  1. АЛИАСЫ: перевыводит алиасы записей source='geonames' строго из своего
 *     geonameId (дамп cities5000 + alternateNamesV2/ru-кэш): чужие формы
 *     удаляются, свои недостающие добавляются. Записи source 'user'/'migration'
 *     НЕ трогаются (кроме явного слияния двойников ниже).
 *  2. ВОССТАНОВЛЕНИЕ: строки дампа, чья запись пропала (была проглочена при
 *     склейке), восстанавливаются: слиянием в одноимённую migration-запись
 *     (канон получает geonameId/страну/координаты/население; usageCount/type/
 *     алиасы миграции сохраняются) или новой записью geonames.
 *  3. ДВОЙНИКИ: «тот же город под двумя id» (geonames-запись + migration-запись):
 *     канон — geonames-запись; в неё переливаются usageCount/type/aliases
 *     миграции, ссылки cityId перепроверяются на канон, лишняя запись удаляется
 *     ТОЛЬКО ПОСЛЕ перепривязки ссылок.
 *  4. ССЫЛКИ: полная перепроверка cityId рядом со старыми текстами (закрывает
 *     «17 нет» и «53 неверных»): недостающие проставляются, неверные исправляются
 *     на канон по итоговому справочнику.
 *  5. ОПЕЧАТКИ: значения, не найденные в справочнике, при выполнении строгих
 *     правил (единственный кандидат, значение не является городом/алиасом,
 *     Левенштейн ≤2 после нормализации) связываются с верным городом, и ТЕКСТ
 *     исправляется («Иркутс» → «Иркутск»); иначе — в отчёт.
 *  6. СКЛЕЙКИ в полях мест («Минск+Гомель», «КЗ/УЗ/РФ», «Брест - МИНСК»,
 *     «на второй круг», …) очищаются в пустую строку (список владельца +
 *     найденные при обходе — все перечисляются в отчёте).
 *  7. НЕ ТРОГАЮТСЯ вовсе: условные пометки «МО»/«НН»/«РБ», заметки
 *     («без водителя»/«Нет водителя»/«ХЗ "ТП"»/«ТП "ХЗ"», отпуска) и числа
 *     («2142»/«24124») — выносятся отдельным списком «на решение владельца».
 *
 * Режимы
 *   npx tsx scripts/fix-cities-cleanup.ts                 # СУХОЙ ПРОГОН (ничего не пишет):
 *                                                         # ПОЛНЫЙ список операций path/поле/было→стало
 *   npx tsx scripts/fix-cities-cleanup.ts --apply --yes   # запись: бэкап затронутых путей в файл → фазы записи
 *   npx tsx scripts/fix-cities-cleanup.ts --verify        # проверка после применения (только чтение)
 * Флаги: --out=DIR, --data-dir=DIR, --json,
 *        --skip-aliases --skip-restore --skip-doubles --skip-walk (для отладки),
 *        --match=X (ограничение обхода по id).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { adminDb } from '../server/firebaseAdmin.ts';
import {
  citySlug,
  cityMatchKind,
  hasCyrillic,
  levenshtein,
  normalizeCityName,
} from '../src/utils/cityDirectory.ts';
import {
  GEONAMES_DEFAULT_COUNTRIES,
  GEONAMES_SMALL_COUNTRIES,
  GEONAMES_DEFAULT_THRESHOLD,
  GEONAMES_SMALL_THRESHOLD,
  buildGeonamesCity,
  parseCitiesRow,
  resolveGeonamesSettings,
  type GeonamesRow,
  type GeonamesSettings,
} from '../src/utils/geonames.ts';
import {
  findTypoCandidate,
  isGluedValue,
  isNumericValue,
  isProtectedValue,
  ownFormsOf,
  planAliasRebuild,
  mergeIntoCanonPatch,
  type CleanupCatalogEntry,
} from '../src/utils/cityCleanup.ts';
import {
  AFFECTED_BRANCHES,
  collectSources,
  sideFieldOf,
  type Reader,
} from './cities-walk.ts';

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const VERIFY = ARGS.includes('--verify');
const SAY_YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
const SKIP_ALIASES = ARGS.includes('--skip-aliases');
const SKIP_RESTORE = ARGS.includes('--skip-restore');
const SKIP_DOUBLES = ARGS.includes('--skip-doubles');
const SKIP_WALK = ARGS.includes('--skip-walk');
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/fix-cities';
const DATA_DIR =
  (ARGS.find((a) => a.startsWith('--data-dir=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities2/geonames';

/** Ручные правки текста: нормализованное значение → канонический текст (решения владельца). */
const CURATED_TEXT_FIXES: Record<string, { text: string; cityId: string }> = {
  алашенькоу: { text: 'Алашанькоу', cityId: 'alashankou' },
  алашенкоу: { text: 'Алашанькоу', cityId: 'alashankou' },
  алшанькоу: { text: 'Алашанькоу', cityId: 'alashankou' },
};

/** Двойники-опечатки, подтверждённые вручную (миграция → канон). */
const CURATED_DOUBLES: Array<{ id: string; canonId: string; note: string }> = [
  { id: 'shimkent', canonId: 'shymkent', note: '«Шимкент» — транслитерационная опечатка «Шымкент» (тот же город)' },
  {
    id: 'rostov',
    canonId: 'rostov-na-donu',
    note: '«Ростов»(17) в рейсах — Ростов-на-Дону (южные рейсы, пары с КЗ/Кавказом); Ростов Великий добавлен отдельной записью (501183) и остаётся',
  },
];

/**
 * Неоднозначные формы (2+ записи и после починки) — курированное решение.
 * «Калининград»: у Королёва это собственное историческое имя (1938–1996) из
 * дампа, но значение в данных — город Калининград.
 */
const CURATED_AMBIGUITY: Record<string, { cityId: string; note: string }> = {
  калининград: { cityId: 'kaliningrad', note: 'у Королёва «Калининград» — историческое имя из дампа; значение — город Калининград' },
  ростов: { cityId: 'rostov-na-donu', note: '«Ростов» в рейсах — Ростов-на-Дону; Ростов Великий (501183) остаётся отдельной записью, у обоих городов есть короткое имя «Ростов»' },
};

const BATCH = 500;

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------
interface CityRec {
  id: string;
  name: string;
  country: string;
  aliases: string[];
  type: string;
  usageCount: number;
  source: string;
  geonameId?: number;
  lat?: number;
  lng?: number;
  population?: number;
  mergedFrom?: string[];
  createdAt?: string;
  [k: string]: unknown;
}

type CityOpKind =
  | 'alias-rebuild'
  | 'restore-merge'
  | 'restore-create'
  | 'double-canon'
  | 'double-delete';

interface CityOp {
  kind: CityOpKind;
  path: string;
  reason: string;
  before?: unknown;
  after?: unknown;
}

interface FieldOp {
  kind: 'ref' | 'text' | 'clear';
  path: string;
  field: string;
  value: string;
  before: unknown;
  after: unknown;
  reason: string;
  /** id города, к которому привязано (для ref). */
  cityId?: string;
}

interface Plan {
  cityOps: CityOp[];
  fieldOps: FieldOp[];
  /** Итоговый справочник (после применения плана) — для перепроверки ссылок. */
  finalCatalog: CleanupCatalogEntry[];
  /** Разделы отчёта. */
  report: Record<string, unknown>;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const objOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

const toRec = (id: string, raw: Record<string, unknown>): CityRec => ({
  ...raw,
  id,
  name: str(raw.name),
  country: str(raw.country),
  aliases: Array.isArray(raw.aliases) ? (raw.aliases as unknown[]).map(String) : [],
  type: str(raw.type) || 'город',
  usageCount: Number(raw.usageCount) || 0,
  source: str(raw.source),
  geonameId: raw.geonameId != null ? Number(raw.geonameId) || undefined : undefined,
  lat: raw.lat != null && raw.lat !== '' ? Number(raw.lat) : undefined,
  lng: raw.lng != null && raw.lng !== '' ? Number(raw.lng) : undefined,
  population: raw.population != null ? Number(raw.population) || 0 : undefined,
  mergedFrom: Array.isArray(raw.mergedFrom) ? (raw.mergedFrom as unknown[]).map(String) : undefined,
  createdAt: raw.createdAt != null ? String(raw.createdAt) : undefined,
});

const formsOfRec = (r: { name: string; aliases?: string[] }): string[] =>
  [r.name, ...(r.aliases || [])].map((f) => normalizeCityName(f)).filter(Boolean);

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------
async function loadRows(): Promise<{ rowsById: Map<number, GeonamesRow>; selected: GeonamesRow[]; settings: GeonamesSettings }> {
  const citiesTxt = join(DATA_DIR, 'cities5000.txt');
  if (!existsSync(citiesTxt)) throw new Error(`cities5000.txt не найден в ${DATA_DIR}`);
  const rowsById = new Map<number, GeonamesRow>();
  const settings = resolveGeonamesSettings(null); // тот же отбор, что у импорта (настройки в базе отсутствуют)
  const countries = new Set(settings.countries);
  const thresholdFor = (cc: string): number =>
    GEONAMES_SMALL_COUNTRIES.includes(cc) ? settings.smallThreshold : settings.threshold;
  const selected: GeonamesRow[] = [];
  const rl = createInterface({ input: createReadStream(citiesTxt, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const r = parseCitiesRow(line);
    if (!r) continue;
    rowsById.set(r.geonameId, r);
    if (!countries.has(r.country) || r.featureClass !== 'P') continue;
    if (r.featureCode !== 'PPLC' && r.population < thresholdFor(r.country)) continue;
    selected.push(r);
  }
  rl.close();
  return { rowsById, selected, settings };
}

function readRuCache(): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const p = join(DATA_DIR, 'ru-names-cache.json');
  if (!existsSync(p)) return out;
  const cached = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string[]>;
  Object.entries(cached).forEach(([k, v]) => {
    const id = Number(k);
    if (Number.isFinite(id) && Array.isArray(v)) out.set(id, v);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Планирование
// ---------------------------------------------------------------------------
async function buildPlan(read: Reader, opts: { walking: boolean }): Promise<Plan> {
  const { rowsById, selected, settings } = await loadRows();
  const ruCache = readRuCache();

  const citiesRaw = objOf(await read('cities'));
  const records = new Map<string, CityRec>();
  Object.entries(citiesRaw).forEach(([id, raw]) => records.set(id, toRec(id, objOf(raw))));

  // Область «чужих» форм: все формы выбранных строк дампа + русские имена из
  // alternateNamesV2 (ru-кэш). Форма из этой области, не выводимая из своего
  // geonameId, — чужая (её приписала склейка).
  const dumpDomainNorms = new Set<string>();
  const domainAdd = (s: string): void => {
    const n = normalizeCityName(s);
    if (n) dumpDomainNorms.add(n);
  };
  selected.forEach((r) => {
    domainAdd(r.name);
    domainAdd(r.asciiname);
    r.alternateNames.forEach(domainAdd);
  });
  ruCache.forEach((names) => names.forEach(domainAdd));

  const now = new Date().toISOString();
  const cityOps: CityOp[] = [];
  const fieldOps: FieldOp[] = [];
  const report: Record<string, unknown> = {};

  // --- рабочие «плановые» алиасы: стартуем от текущих ---
  const planAliases = new Map<string, string[]>();
  records.forEach((r, id) => planAliases.set(id, [...r.aliases]));

  // =========================================================================
  // 1. АЛИАСЫ: перевывод из своего geonameId (source='geonames')
  // =========================================================================
  const aliasRebuilds: Array<{ id: string; remove: string[]; add: string[] }> = [];
  const aliasMismatchSkipped: Array<{ id: string; name: string; note: string }> = [];
  if (!SKIP_ALIASES) {
    records.forEach((rec) => {
      if (rec.source !== 'geonames' || !rec.geonameId) return;
      const row = rowsById.get(rec.geonameId);
      if (!row) {
        aliasMismatchSkipped.push({ id: rec.id, name: rec.name, note: `строки geonameId ${rec.geonameId} нет в дампе` });
        return;
      }
      const own = ownFormsOf(row, ruCache.get(rec.geonameId));
      const rebuilt = buildGeonamesCity(row, ruCache.get(rec.geonameId)).aliases;
      const ownNorms = new Set(own.map((f) => normalizeCityName(f)).filter(Boolean));
      if (!ownNorms.has(normalizeCityName(rec.name))) {
        aliasMismatchSkipped.push({
          id: rec.id,
          name: rec.name,
          note: `имя записи не выводится из geonameId ${rec.geonameId} (дамп: «${own[0]}») — не трогаем`,
        });
        return;
      }
      const plan = planAliasRebuild(rec.aliases, own, rebuilt, dumpDomainNorms, rec.name);
      if (!plan) return;
      aliasRebuilds.push({ id: rec.id, remove: plan.remove, add: plan.add });
      planAliases.set(rec.id, plan.newAliases);
      cityOps.push({
        kind: 'alias-rebuild',
        path: `cities/${rec.id}`,
        reason: `чужих алиасов ${plan.remove.length}, своих добавлено ${plan.add.length}`,
        before: rec.aliases,
        after: plan.newAliases,
      });
    });
    // после правок — последовательные dedupe по норме (стабильно)
    aliasRebuilds.forEach(({ id }) => {
      const list = planAliases.get(id) || [];
      const seen = new Set<string>();
      const clean: string[] = [];
      list.forEach((f) => {
        const n = normalizeCityName(f);
        if (!n || seen.has(n)) {
          return;
        }
        seen.add(n);
        clean.push(f);
      });
      planAliases.set(id, clean);
    });
  }
  report.aliasRebuild = {
    touched: aliasRebuilds.length,
    foreignRemoved: aliasRebuilds.reduce((s, a) => s + a.remove.length, 0),
    ownAdded: aliasRebuilds.reduce((s, a) => s + a.add.length, 0),
    skipped: aliasMismatchSkipped,
    samples: aliasRebuilds.slice(0, 40).map((a) => ({ id: a.id, remove: a.remove.slice(0, 6), add: a.add.slice(0, 6) })),
  };

  // =========================================================================
  // 2. ВОССТАНОВЛЕНИЕ проглоченных строк дампа
  // =========================================================================
  const gidToRecord = new Map<number, string>();
  records.forEach((r) => {
    if (r.geonameId) gidToRecord.set(r.geonameId, r.id);
  });
  const restoreMerges: Array<{ id: string; row: GeonamesRow; cityName: string; note: string }> = [];
  const restoreCreates: Array<{ id: string; row: GeonamesRow; cityName: string }> = [];
  const restoreSkipped: Array<{ gid: number; name: string; note: string }> = [];
  const plannedIds = new Set<string>(records.keys());

  if (!SKIP_RESTORE) {
    // кандидаты-цели: только НЕ-geonames записи (миграция/пользователь)
    const targets = Array.from(records.values())
      .filter((r) => r.source !== 'geonames')
      .map((r) => ({ id: r.id, name: r.name, norm: normalizeCityName(r.name), country: r.country, geonameId: r.geonameId }));
    const usedTargets = new Set<string>();

    selected.forEach((row) => {
      if (gidToRecord.has(row.geonameId)) return;
      const city = buildGeonamesCity(row, ruCache.get(row.geonameId));
      const prim = Array.from(new Set([normalizeCityName(city.name), normalizeCityName(city.asciiName)].filter(Boolean)));
      const exact = targets.filter((t) => prim.includes(t.norm) && !usedTargets.has(t.id));
      const translit = targets.filter(
        (t) => !exact.includes(t) && !usedTargets.has(t.id) && prim.some((p) => cityMatchKind(p, t.norm) === 'translit'),
      );
      const label = `${row.country} ${row.geonameId} pop=${row.population} «${city.name}»`;
      const pick = exact.length === 1 ? exact[0] : exact.length === 0 && translit.length === 1 ? translit[0] : null;
      if (!pick && (exact.length > 1 || translit.length > 1)) {
        restoreSkipped.push({ gid: row.geonameId, name: city.name, note: `неоднозначная цель: ${[...exact, ...translit].map((t) => t.id).join(', ')}` });
        return;
      }
      if (pick) {
        if (pick.geonameId) {
          restoreSkipped.push({ gid: row.geonameId, name: city.name, note: `цель ${pick.id} уже привязана к geonameId ${pick.geonameId}` });
          return;
        }
        if (pick.country && pick.country !== row.country) {
          restoreSkipped.push({ gid: row.geonameId, name: city.name, note: `конфликт страны: запись ${pick.id} — ${pick.country}, строка дампа — ${row.country}` });
          return;
        }
        usedTargets.add(pick.id);
        restoreMerges.push({ id: pick.id, row, cityName: city.name, note: `${label} → слияние в migration-запись «${pick.name}»` });
        // план: канон получает geoname-поля; алиасы = union(текущие, свои формы)
        const rec = records.get(pick.id)!;
        const own = ownFormsOf(row, ruCache.get(row.geonameId));
        const have = new Set(formsOfRec(rec));
        const aliases = [...rec.aliases];
        const nameNorm = normalizeCityName(rec.name);
        own.forEach((f) => {
          const n = normalizeCityName(f);
          if (!n || n === nameNorm || have.has(n)) return;
          have.add(n);
          aliases.push(f);
        });
        planAliases.set(rec.id, aliases);
        rec.country = row.country;
        rec.geonameId = row.geonameId;
        gidToRecord.set(row.geonameId, rec.id);
        cityOps.push({
          kind: 'restore-merge',
          path: `cities/${rec.id}`,
          reason: `${label} → слияние в migration-запись «${pick.name}»`,
          before: { name: rec.name, country: '', aliases: rec.aliases },
          after: { name: rec.name, country: row.country, geonameId: row.geonameId, lat: row.lat, lng: row.lng, population: row.population, aliases },
        });
        return;
      }
      // цели нет: дубль по имени с существующей записью?
      const nameDup = Array.from(records.values()).filter((r) => {
        const fs = new Set(formsOfRec({ name: r.name, aliases: [] }));
        return prim.some((p) => fs.has(p) || cityMatchKind(p, normalizeCityName(r.name)) === 'translit');
      });
      if (nameDup.length) {
        restoreSkipped.push({ gid: row.geonameId, name: city.name, note: `одноимённая запись уже есть: ${nameDup.map((r) => r.id).slice(0, 3).join(', ')}` });
        return;
      }
      // новая запись
      let id = citySlug(city.name);
      if (plannedIds.has(id)) {
        let n = 2;
        while (plannedIds.has(`${id}-${n}`)) n += 1;
        id = `${id}-${n}`;
      }
      plannedIds.add(id);
      gidToRecord.set(row.geonameId, id);
      const newRec: CityRec = {
        id,
        name: city.name,
        country: row.country,
        aliases: city.aliases,
        type: 'город',
        usageCount: 0,
        geonameId: row.geonameId,
        lat: row.lat,
        lng: row.lng,
        population: row.population,
        source: 'geonames',
        createdAt: now,
      };
      records.set(id, newRec);
      planAliases.set(id, [...city.aliases]);
      restoreCreates.push({ id, row, cityName: city.name });
      cityOps.push({
        kind: 'restore-create',
        path: `cities/${id}`,
        reason: `${label} → новая запись`,
        before: null,
        // полный payload записи (пишется как cities/<id> одним объектом)
        after: { ...newRec, aliases: [...city.aliases] },
      });
    });
  }
  report.restore = {
    merged: restoreMerges.length,
    created: restoreCreates.length,
    skipped: restoreSkipped,
    mergedSamples: restoreMerges.map((m) => m.note).slice(0, 60),
    createdSamples: restoreCreates.slice(0, 60).map((c) => `${c.row.country} ${c.row.geonameId} → cities/${c.id} «${c.cityName}»`),
  };

  // =========================================================================
  // 3. ДВОЙНИКИ: migration-запись ↔ geonames-запись (тот же город)
  // =========================================================================
  const doublePairs: Array<{ mergedId: string; canonId: string; note: string }> = [];
  /** id удаляемых записей-двойников → канон (для перепривязки ссылок). */
  const mergeRedirect = new Map<string, string>();
  if (!SKIP_DOUBLES) {
    const geoRecs = Array.from(records.values()).filter((r) => r.source === 'geonames');
    const geoForms = new Map<string, { rec: CityRec; forms: Set<string> }>();
    geoRecs.forEach((r) => {
      const forms = new Set([...(planAliases.get(r.id) || []), r.name].map(normalizeCityName).filter(Boolean));
      geoForms.set(r.id, { rec: r, forms });
    });
    const candidates = Array.from(records.values()).filter(
      (r) => r.source !== 'geonames' && !restoreMerges.some((m) => m.id === r.id),
    );
    // точное совпадение формы миграции с формой geonames-записи
    candidates.forEach((m) => {
      const mForms = formsOfRec({ name: m.name, aliases: m.aliases });
      for (const { rec: g, forms } of geoForms.values()) {
        if (g.id === m.id) continue;
        const inter = mForms.filter((f) => forms.has(f));
        if (inter.length) {
          doublePairs.push({ mergedId: m.id, canonId: g.id, note: `«${m.name}»(${m.usageCount}) → «${g.name}» по форме ${inter.slice(0, 3).join(' | ')}` });
        }
      }
    });
    const curatedCanon = new Map(CURATED_DOUBLES.map((c) => [c.id, c.canonId]));
    CURATED_DOUBLES.forEach(({ id, canonId, note }) => {
      if (records.has(id) && records.has(canonId) && !doublePairs.some((p) => p.mergedId === id)) {
        doublePairs.push({ mergedId: id, canonId, note: `[вручную] ${note}` });
      }
    });
    // отбрасываем дубли пар, канон — geonames; конфликтные (два канона) — в отчёт
    const byMerged = new Map<string, typeof doublePairs>();
    doublePairs.forEach((p) => {
      const arr = byMerged.get(p.mergedId) || [];
      arr.push(p);
      byMerged.set(p.mergedId, arr);
    });
    const chosenPairs: typeof doublePairs = [];
    const conflicted: typeof doublePairs = [];
    byMerged.forEach((arr, mergedId) => {
      if (arr.length === 1) chosenPairs.push(arr[0]);
      else {
        // вручную подтверждённый канон решает конфликт
        const curated = curatedCanon.get(mergedId);
        const manual = curated ? arr.find((p) => p.canonId === curated) : undefined;
        if (manual) chosenPairs.push(manual);
        else conflicted.push(...arr);
      }
    });
    chosenPairs.forEach((p) => {
      const m = records.get(p.mergedId)!;
      const g = records.get(p.canonId)!;
      mergeRedirect.set(m.id, g.id);
      const patch = mergeIntoCanonPatch(
        { ...g, aliases: planAliases.get(g.id) || g.aliases },
        m,
        now,
      );
      planAliases.set(g.id, (patch.aliases as string[]) || g.aliases);
      g.aliases = (patch.aliases as string[]) || g.aliases;
      g.usageCount = Number(patch.usageCount) || g.usageCount;
      g.mergedFrom = (patch.mergedFrom as string[]) || g.mergedFrom;
      g.type = String(patch.type || g.type);
      records.delete(m.id);
      planAliases.delete(m.id);
      // Перелитые формы двойника обязаны подчиняться тем же правилам, что и
      // перевывод алиасов: форма из чужого geonameId (dumpDomain) в канон не
      // остаётся (напр. «Шимкент» — её уберёт следующий перевывод, поэтому
      // снимаем сразу — иначе второй прогон не был бы идемпотентен).
      const canonRow = g.geonameId ? rowsById.get(g.geonameId) : undefined;
      if (canonRow) {
        const own2 = ownFormsOf(canonRow, ruCache.get(g.geonameId!));
        const rebuilt2 = buildGeonamesCity(canonRow, ruCache.get(g.geonameId!)).aliases;
        const plan2 = planAliasRebuild(planAliases.get(g.id) || g.aliases, own2, rebuilt2, dumpDomainNorms, g.name);
        if (plan2) {
          planAliases.set(g.id, plan2.newAliases);
          g.aliases = plan2.newAliases;
        }
      }
      cityOps.push({
        kind: 'double-canon',
        path: `cities/${g.id}`,
        reason: `слияние двойника ${m.id}: usageCount ${g.usageCount - m.usageCount}+${m.usageCount}, алиасы +…`,
        before: { aliases: undefined, usageCount: g.usageCount - m.usageCount },
        after: { aliases: g.aliases, usageCount: g.usageCount, mergedFrom: g.mergedFrom },
      });
      cityOps.push({
        kind: 'double-delete',
        path: `cities/${m.id}`,
        reason: `двойник удаляется после перепривязки ссылок на ${g.id}`,
        before: m,
        after: null,
      });
    });
    report.doubles = {
      merged: chosenPairs.length,
      pairs: chosenPairs.map((p) => p.note),
      conflicted: conflicted.map((p) => p.note),
    };
  } else {
    report.doubles = { merged: 0, pairs: [], skipped: true };
  }

  // =========================================================================
  // 4–6. Прогон по источникам: ссылки, опечатки, склейки
  // =========================================================================
  const finalCatalog: CleanupCatalogEntry[] = Array.from(records.values()).map((r) => ({
    id: r.id,
    name: r.name,
    aliases: planAliases.get(r.id) || r.aliases,
  }));
  // норм. форма → множество id (для проверки однозначности)
  const formToIds = new Map<string, Set<string>>();
  finalCatalog.forEach((c) => {
    [c.name, ...(c.aliases || [])].forEach((f) => {
      const n = normalizeCityName(f);
      if (!n) return;
      const set = formToIds.get(n) || new Set<string>();
      set.add(c.id);
      formToIds.set(n, set);
    });
  });
  const catalogById = new Map(finalCatalog.map((c) => [c.id, c]));
  const ambiguousForms = Array.from(formToIds.entries())
    .filter(([, set]) => set.size > 1)
    .map(([norm, set]) => ({ norm, ids: Array.from(set) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.norm.localeCompare(b.norm));

  const reportBuckets: Record<string, Array<{ value: string; count: number; sample: string }>> = {
    typosLinked: [],
    gluesCleared: [],
    protectedUntouched: [],
    doublesRepointed: [],
    curatedAmbiguity: [],
    ambiguous: [],
    unresolved: [],
  };
  const bucketCounts = new Map<string, Map<string, { count: number; sample: string }>>();
  const addBucket = (bucket: string, value: string, sample: string): void => {
    let m = bucketCounts.get(bucket);
    if (!m) {
      m = new Map();
      bucketCounts.set(bucket, m);
    }
    const cur = m.get(value) || { count: 0, sample };
    cur.count += 1;
    m.set(value, cur);
  };

  let walkStats: Record<string, unknown> = { skipped: true };
  if (opts.walking && !SKIP_WALK) {
    const { occurrences, statsList } = await collectSources(read, { match: MATCH });
    // текущие значения полей-ссылок (для «было → стало»)
    const roots = new Map<string, unknown>();
    for (const branch of AFFECTED_BRANCHES) roots.set(branch, objOf(await read(branch)));
    const rootPrefixes = Array.from(roots.keys()).sort((a, b) => b.length - a.length);
    const valueAt = (path: string): unknown => {
      const prefix = rootPrefixes.find((p) => path === p || path.startsWith(`${p}/`));
      if (!prefix) return undefined;
      const rest = path === prefix ? [] : path.slice(prefix.length + 1).split('/');
      let cur: unknown = roots.get(prefix);
      for (const seg of rest) {
        if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
        else return undefined;
      }
      return cur;
    };

    let refsOk = 0;
    let refsWritten = 0;
    occurrences.forEach((o) => {
      const value = o.value;
      const norm = normalizeCityName(value);
      if (!norm) return;
      const ids = formToIds.get(norm);
      let uniqueId = ids && ids.size === 1 ? Array.from(ids)[0] : null;
      if (!uniqueId && ids && ids.size > 1) {
        // приоритет: форма — ИМЯ записи (а не алиас): «Калининград» у Калининграда
        const nameOwners = Array.from(ids).filter(
          (id) => !mergeRedirect.has(id) && normalizeCityName(catalogById.get(id)?.name || '') === norm,
        );
        if (nameOwners.length === 1) uniqueId = nameOwners[0];
      }
      const refField = sideFieldOf(o.field);
      const refPath = `${o.path}/${refField}`;
      const curRef = o.noRef ? undefined : valueAt(refPath);

      if (uniqueId) {
        // значение известно справочнику
        if (!o.noRef && str(curRef) !== uniqueId) {
          fieldOps.push({ kind: 'ref', path: o.path, field: refField, value, before: curRef ?? null, after: uniqueId, reason: 'перепроверка ссылки на канон', cityId: uniqueId });
          refsWritten += 1;
        } else if (!o.noRef) {
          refsOk += 1;
        }
        // ручные правки текста (алаш*-варианты)
        const fix = CURATED_TEXT_FIXES[norm];
        if (fix && uniqueId === fix.cityId && value !== fix.text) {
          fieldOps.push({ kind: 'text', path: o.path, field: o.field, value, before: value, after: fix.text, reason: 'опечатка (решение владельца)', cityId: uniqueId });
        }
        return;
      }
      if (ids && ids.size > 1) {
        // значение ссылалось на удаляемую запись-двойника — перепривязка на канон
        const redirect = !o.noRef ? mergeRedirect.get(str(curRef)) : undefined;
        if (redirect) {
          addBucket('doublesRepointed', value, `${o.path} → ${redirect}`);
          fieldOps.push({ kind: 'ref', path: o.path, field: refField, value, before: curRef ?? null, after: redirect, reason: `ссылка на двойника ${str(curRef)} → канон ${redirect}`, cityId: redirect });
          refsWritten += 1;
          return;
        }
        const curated = CURATED_AMBIGUITY[norm];
        if (curated && catalogById.has(curated.cityId)) {
          const before = curRef ?? null;
          addBucket('curatedAmbiguity', value, `${o.path} → ${curated.cityId} (${curated.note})`);
          if (!o.noRef && str(curRef) !== curated.cityId) {
            fieldOps.push({ kind: 'ref', path: o.path, field: refField, value, before, after: curated.cityId, reason: `неоднозначно (решение владельца): ${curated.note}`, cityId: curated.cityId });
            refsWritten += 1;
          }
          return;
        }
        addBucket('ambiguous', value, o.path);
        return;
      }
      // курированные неоднозначные значения, вообще не находимые точно
      if (CURATED_AMBIGUITY[norm] && catalogById.has(CURATED_AMBIGUITY[norm].cityId)) {
        const curated = CURATED_AMBIGUITY[norm];
        addBucket('curatedAmbiguity', value, `${o.path} → ${curated.cityId} (${curated.note})`);
        if (!o.noRef && str(curRef) !== curated.cityId) {
          fieldOps.push({ kind: 'ref', path: o.path, field: refField, value, before: curRef ?? null, after: curated.cityId, reason: `неоднозначно (решение владельца): ${curated.note}`, cityId: curated.cityId });
          refsWritten += 1;
        }
        return;
      }
      // не найдено: склейка / защищённое / опечатка / остаток
      if (isGluedValue(value)) {
        addBucket('gluesCleared', value, o.path);
        fieldOps.push({ kind: 'clear', path: o.path, field: o.field, value, before: value, after: '', reason: 'склейка в поле места — очищено' });
        return;
      }
      if (isProtectedValue(value) || isNumericValue(value)) {
        addBucket('protectedUntouched', value, o.path);
        return;
      }
      const typo = findTypoCandidate(value, finalCatalog);
      if (typo) {
        const rec = catalogById.get(typo.id)!;
        addBucket('typosLinked', value, `${o.path} → ${typo.id}`);
        if (!o.noRef && str(curRef) !== typo.id) {
          fieldOps.push({ kind: 'ref', path: o.path, field: refField, value, before: curRef ?? null, after: typo.id, reason: `опечатка → ${typo.id} (d=${typo.distance})`, cityId: typo.id });
          refsWritten += 1;
        }
        // текст правим только если имя записи «чистое» и близкое к значению
        const nameOk =
          !!rec &&
          normalizeCityName(rec.name) === typo.form &&
          !/[()\d]/.test(rec.name) &&
          hasCyrillic(value) === hasCyrillic(rec.name) &&
          levenshtein(norm, normalizeCityName(rec.name), 2) <= 2;
        if (nameOk && value !== rec.name) {
          fieldOps.push({ kind: 'text', path: o.path, field: o.field, value, before: value, after: rec.name, reason: `опечатка: текст → «${rec.name}»`, cityId: typo.id });
        }
        return;
      }
      addBucket('unresolved', value, o.path);
    });

    reportBuckets.typosLinked = bucketToList('typosLinked');
    reportBuckets.gluesCleared = bucketToList('gluesCleared');
    reportBuckets.protectedUntouched = bucketToList('protectedUntouched');
    reportBuckets.doublesRepointed = bucketToList('doublesRepointed');
    reportBuckets.curatedAmbiguity = bucketToList('curatedAmbiguity');
    reportBuckets.ambiguous = bucketToList('ambiguous');
    reportBuckets.unresolved = bucketToList('unresolved');
    walkStats = {
      occurrences: occurrences.length,
      refsOk,
      refsWritten,
      sources: statsList,
    };
  }
  report.walk = { ...walkStats, buckets: reportBuckets };
  report.catalogForms = {
    total: finalCatalog.length,
    ambiguousCount: ambiguousForms.length,
    ambiguous: ambiguousForms.slice(0, 100),
  };

  function bucketToList(bucket: string): Array<{ value: string; count: number; sample: string }> {
    const m = bucketCounts.get(bucket) || new Map();
    return Array.from(m.entries())
      .map(([value, v]) => ({ value, count: v.count, sample: v.sample }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return { cityOps, fieldOps, finalCatalog, report };

}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------
async function applyPlan(read: Reader, plan: Plan): Promise<Record<string, unknown>> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // --- бэкап: снимки веток + значения затронутых путей ---
  const roots = new Map<string, unknown>();
  roots.set('cities', objOf(await read('cities')));
  for (const branch of AFFECTED_BRANCHES) roots.set(branch, objOf(await read(branch)));
  const prefixList = Array.from(roots.keys()).sort((a, b) => b.length - a.length);
  const valueAt = (path: string): unknown => {
    const prefix = prefixList.find((p) => path === p || path.startsWith(`${p}/`));
    if (!prefix) return undefined;
    const rest = path === prefix ? [] : path.slice(prefix.length + 1).split('/');
    let cur: unknown = roots.get(prefix);
    for (const seg of rest) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg];
      else return undefined;
    }
    return cur;
  };
  const affectedPaths = new Map<string, unknown>();
  plan.cityOps.forEach((op) => {
    if (op.kind === 'restore-create') return;
    affectedPaths.set(op.path, valueAt(op.path));
  });
  plan.fieldOps.forEach((op) => affectedPaths.set(`${op.path}/${op.field}`, valueAt(`${op.path}/${op.field}`)));
  const backupFile = `${OUT_DIR}/fix-cities-backup-${stamp}.json`;
  writeFileSync(
    backupFile,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        note: 'Бэкап ДО починки: полные снимки веток + значения всех затронутых путей (было →).',
        branches: Object.fromEntries(roots),
        affected: Object.fromEntries(affectedPaths),
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log(`[fix-cities] Бэкап до записи: ${backupFile}`);

  const flush = async (updates: Record<string, unknown>, label: string): Promise<number> => {
    const paths = Object.keys(updates);
    let done = 0;
    for (let i = 0; i < paths.length; i += BATCH) {
      const slice = paths.slice(i, i + BATCH);
      const payload: Record<string, unknown> = {};
      slice.forEach((p) => {
        payload[p] = updates[p];
      });
      await adminDb!.ref().update(payload);
      done += slice.length;
      if (paths.length > BATCH) console.log(`[fix-cities] ${label}: ${done}/${paths.length} путей…`);
    }
    if (paths.length) console.log(`[fix-cities] ${label}: записано ${done} путей.`);
    return done;
  };

  // Фаза 1: записи справочника (создание/обновление) — без удалений!
  const phase1: Record<string, unknown> = {};
  let created = 0;
  let updated = 0;
  plan.cityOps.forEach((op) => {
    if (op.kind === 'double-delete') return;
    if (op.kind === 'restore-create') {
      phase1[op.path] = op.after; // полная новая запись
      created += 1;
      return;
    }
    const rec = (op.after || {}) as Record<string, unknown>;
    if (op.kind === 'alias-rebuild') {
      phase1[`${op.path}/aliases`] = rec; // массив новых алиасов
      phase1[`${op.path}/updatedAt`] = new Date().toISOString();
      updated += 1;
      return;
    }
    if (op.kind === 'restore-merge') {
      const after = op.after as Record<string, unknown>;
      phase1[`${op.path}/geonameId`] = after.geonameId;
      phase1[`${op.path}/country`] = after.country;
      phase1[`${op.path}/lat`] = after.lat;
      phase1[`${op.path}/lng`] = after.lng;
      phase1[`${op.path}/population`] = after.population;
      phase1[`${op.path}/aliases`] = after.aliases;
      phase1[`${op.path}/source`] = 'geonames';
      phase1[`${op.path}/updatedAt`] = new Date().toISOString();
      updated += 1;
      return;
    }
    if (op.kind === 'double-canon') {
      const after = op.after as Record<string, unknown>;
      phase1[`${op.path}/aliases`] = after.aliases;
      phase1[`${op.path}/usageCount`] = after.usageCount;
      phase1[`${op.path}/mergedFrom`] = after.mergedFrom;
      phase1[`${op.path}/updatedAt`] = new Date().toISOString();
      updated += 1;
    }
  });
  Object.keys(phase1).forEach((k) => {
    if (phase1[k] === undefined) delete phase1[k];
  });
  await flush(phase1, 'фаза 1 (записи справочника)');

  // Фаза 2: поля (ссылки/тексты/склейки) — до удалений, чтобы «перепривязка» была раньше
  const phase2: Record<string, unknown> = {};
  plan.fieldOps.forEach((op) => {
    phase2[`${op.path}/${op.field}`] = op.after;
  });
  await flush(phase2, 'фаза 2 (ссылки/тексты/склейки)');

  // Фаза 3: удаление «лишних» записей двойников — только теперь
  const phase3: Record<string, unknown> = {};
  plan.cityOps.forEach((op) => {
    if (op.kind === 'double-delete') phase3[op.path] = null;
  });
  await flush(phase3, 'фаза 3 (удаление двойников)');

  return { backupFile, created, updated, refsAndFields: plan.fieldOps.length, deleted: Object.keys(phase3).length };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[fix-cities] Firebase Admin недоступен (нет service-account).');
    return 2;
  }
  const read: Reader = async (path: string): Promise<unknown> => (await adminDb!.ref(path).get()).val();
  mkdirSync(OUT_DIR, { recursive: true });

  const plan = await buildPlan(read, { walking: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = APPLY ? 'apply' : VERIFY ? 'verify' : 'dry-run';
  const base = join(OUT_DIR, `fix-cities-${mode}-${stamp}`);

  const counts = {
    aliasRebuild: plan.cityOps.filter((o) => o.kind === 'alias-rebuild').length,
    restoreMerge: plan.cityOps.filter((o) => o.kind === 'restore-merge').length,
    restoreCreate: plan.cityOps.filter((o) => o.kind === 'restore-create').length,
    doubleCanon: plan.cityOps.filter((o) => o.kind === 'double-canon').length,
    doubleDelete: plan.cityOps.filter((o) => o.kind === 'double-delete').length,
    refs: plan.fieldOps.filter((o) => o.kind === 'ref').length,
    texts: plan.fieldOps.filter((o) => o.kind === 'text').length,
    clears: plan.fieldOps.filter((o) => o.kind === 'clear').length,
  };

  const report = {
    mode,
    takenAt: new Date().toISOString(),
    counts,
    ops: {
      city: plan.cityOps,
      fields: plan.fieldOps,
    },
    ...plan.report,
  };
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1), 'utf8');

  const lines: string[] = [];
  const log = (s: string): void => {
    lines.push(s);
    console.log(s);
  };
  log(`[fix-cities] Режим: ${mode === 'apply' ? 'ЗАПИСЬ (--apply)' : mode === 'verify' ? 'ПРОВЕРКА (--verify)' : 'СУХОЙ ПРОГОН (ничего не пишется)'}`);
  log(`[fix-cities] Операций: алиасы ${counts.aliasRebuild}; восстановление ${counts.restoreMerge} слияний + ${counts.restoreCreate} новых; двойники ${counts.doubleCanon}/${counts.doubleDelete}; ссылки ${counts.refs}; тексты ${counts.texts}; очистка склеек ${counts.clears}`);
  const walk = plan.report.walk as Record<string, unknown>;
  const buckets = (walk?.buckets || {}) as Record<string, Array<{ value: string; count: number; sample: string }>>;
  Object.entries(buckets).forEach(([k, v]) => {
    log(`[fix-cities] ${k}: значений ${v.length}, вхождений ${v.reduce((s, x) => s + x.count, 0)}`);
  });
  log('[fix-cities] Остаток «не тронуто» (явный список):');
  (buckets.protectedUntouched || []).forEach((b) => log(`    пометка/заметка/число: «${b.value}» ×${b.count}`));
  (buckets.unresolved || []).forEach((b) => log(`    не найдено в справочнике: «${b.value}» ×${b.count} (${b.sample})`));
  const restore = plan.report.restore as { skipped?: Array<{ gid: number; name: string; note: string }> };
  if (restore?.skipped?.length) {
    log(`[fix-cities] Восстановление пропущено (${restore.skipped.length}) — на решение владельца:`);
    restore.skipped.slice(0, 60).forEach((s) => log(`    ${s.gid} «${s.name}»: ${s.note}`));
  }
  const dbl = plan.report.doubles as { pairs?: string[]; conflicted?: string[] };
  (dbl?.pairs || []).forEach((p) => log(`[fix-cities] двойник: ${p}`));
  (dbl?.conflicted || []).forEach((p) => log(`[fix-cities] двойник НЕ слит (неоднозначно): ${p}`));
  log(`[fix-cities] Отчёт: ${base}.json; операций всего: ${plan.cityOps.length + plan.fieldOps.length}`);

  if (VERIFY) {
    const ok = plan.cityOps.length === 0 && plan.fieldOps.length === 0;
    log(ok
      ? '[fix-cities --verify] OK: расхождений нет (0 операций) — справочник и ссылки сошлись.'
      : `[fix-cities --verify] ОСТАЛИСЬ расхождения: ${plan.cityOps.length} записей + ${plan.fieldOps.length} полей — см. отчёт.`);
    writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
    if (ONLY_JSON) console.log(JSON.stringify({ ok, counts }, null, 1));
    return ok ? 0 : 1;
  }

  if (!APPLY) {
    log('[fix-cities] Ничего не записано (сухой прогон). Запись — `--apply --yes` после подтверждения.');
    writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
    if (ONLY_JSON) console.log(JSON.stringify({ counts }, null, 1));
    return 0;
  }

  if (!SAY_YES) {
    if (!process.stdin.isTTY) {
      console.error('[fix-cities] --apply без --yes в неинтерактивном запуске: запись отменена.');
      return 3;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('[fix-cities] Применить починку справочника и ссылок? Введите ДА: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'да' && answer !== 'yes') {
      console.log('[fix-cities] Отменено — ничего не записано.');
      return 0;
    }
  }

  const applied = await applyPlan(read, plan);
  log(`[fix-cities] ЗАПИСЬ: записей создано ${applied.created}, обновлено ${applied.updated}, полей ${applied.refsAndFields}, удалено ${applied.deleted}.`);
  log(`[fix-cities] Бэкап: ${applied.backupFile}`);
  writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
  if (ONLY_JSON) console.log(JSON.stringify({ counts, applied }, null, 1));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[fix-cities] ошибка:', (e as Error)?.stack || (e as Error)?.message || e);
    process.exit(1);
  });
