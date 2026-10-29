/**
 * РУЧНАЯ миграция справочника городов: собирает все встречающиеся значения
 * мест из коллекций портала (включая архив), нормализует, группирует похожие
 * (Левенштейн + транслит), выбирает канонические имена по частоте и готовит
 * справочник `cities`. Скрипт НЕ запускается автоматически и НИЧЕГО не меняет
 * без явного `--apply`.
 *
 * Что делает
 *  - Читает источники мест (только чтение):
 *      · рейсы «Плана дохода» trips_dashboard/<id>.legs[].from/.to (+ архив);
 *      · легаси-рейсы trips/<id> (routes[].from/.to, legs[].from/.to);
 *      · факт-рейсы current_trips/<id>.legs[].from/.to;
 *      · история расчётов calculationsHistory/<id>.legs[].from/.to;
 *      · этапы рейсов tripTimeline/tripStages/<planId>/<stageId>.label
 *        и ручные рейсы tripTimeline/trips/<id>/stages[].label;
 *      · справочники мест: knownDistancesList, directories/standardDistances,
 *        distanceDb, checkpoints, locationsDB;
 *      · свободные тексты: baza/baza_cars/archive comment, события
 *        baza/<id>/events/<eid>.text, tripTimeline/vehicleEvents note,
 *        driverTasks customsDest/customsSend (только отчёт/короткие значения).
 *  - Нормализует (trim, регистр, ё→е, тире/кавычки, пробелы) и группирует
 *    похожие значения: точные совпадения, транслит-пары (Алашанькоу ↔
 *    Alashankou), опечатки по строгим правилам (Минск ≠ Пинск).
 *  - Каноническое имя — по частоте; при равенстве — больше вхождений в
 *    реальные рейсы (см. TRIP_BRANCHES), затем кириллица.
 *  - По умолчанию — только ОТЧЁТ (dry-run): текст + JSON в каталог отчётов
 *    (по умолчанию /Users/sergei/.hermes/cache/scratch/cities2).
 *  - С `--verify` — ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ (только чтение): повторный обход,
 *    сверка cityId рядом со старыми текстами и явный список остатка непривязанных
 *    с причинами. Ничего не пишет.
 *  - С `--apply` (и подтверждением владельца) — БЭКАП затронутых веток в файл,
 *    затем запись справочника `cities` (верхний уровень) и ТОЛЬКО добавление
 *    полей cityId/fromCityId/toCityId рядом со старыми текстовыми значениями
 *    (старые поля не изменяются). Идемпотентно: повторный прогон не плодит
 *    дубликаты и не перезаписывает уже проставленные cityId.
 *
 * Запуск
 *   npx tsx scripts/migrate-cities.ts                          # отчёт (ничего не пишет)
 *   npx tsx scripts/migrate-cities.ts --json                   # только машинный отчёт
 *   npx tsx scripts/migrate-cities.ts --out=DIR                # каталог отчётов
 *   npx tsx scripts/migrate-cities.ts --verify                 # проверка после применения
 *   npx tsx scripts/migrate-cities.ts --apply                  # запись (спросит подтверждение)
 *   npx tsx scripts/migrate-cities.ts --apply --yes --match=X  # без вопроса, только id с X
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { adminDb } from '../server/firebaseAdmin.ts';
import {
  citySlug,
  looksLikePlaceName,
  normalizeCityName,
  groupCityCandidates,
  type CityCandidate,
  type CityGroup,
  type CityKind,
  type CitySourceClass,
} from '../src/utils/cityDirectory.ts';
import {
  AFFECTED_BRANCHES,
  collectSources,
  sideFieldOf,
  TRIP_BRANCHES,
  type Reader,
} from './cities-walk.ts';


const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const VERIFY = ARGS.includes('--verify');
const SAY_YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
/** Ограничение прогона: только записи, в id которых есть этот текст. */
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
/** Каталог отчётов (текст + JSON + бэкап). */
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities2';

const TOP = 40; // сколько строк дублей печатать в текстовом отчёте
const SRC_SAMPLE = 15; // сколько примеров источников хранить на значение в JSON
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const objOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

function main(): Promise<number> {
  return run();
}

async function run(): Promise<number> {
  if (!adminDb) {
    console.error('[migrate-cities] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }

  const read: Reader = async (path: string): Promise<unknown> => (await adminDb!.ref(path).get()).val();

  // -------------------------------------------------------------------------
  // 0. Режим --verify: проверка после применения (только чтение)
  // -------------------------------------------------------------------------
  if (VERIFY) {
    return runVerify(read);
  }

  const { occurrences, statsList, freeText, emptyOcc, rawDistinct } = await collectSources(read, { match: MATCH });

  // -------------------------------------------------------------------------
  // 5. Кандидаты: агрегация по нормализованному ключу
  // -------------------------------------------------------------------------
  interface Agg {
    norm: string;
    variants: Map<string, { name: string; count: number; tripCount: number; klass: CitySourceClass }>;
    countries: Set<string>;
    typeHints: Set<CityKind>;
    klassCounts: Record<CitySourceClass, number>;
    tripCount: number;
    count: number;
    sources: Array<{ branch: string; path: string; field: string; value: string }>;
    sourcesTotal: number;
  }
  const aggs = new Map<string, Agg>();
  let normEmpty = 0;
  occurrences.forEach((o) => {
    const norm = normalizeCityName(o.value);
    if (!norm) {
      normEmpty += 1;
      return;
    }
    let agg = aggs.get(norm);
    if (!agg) {
      agg = {
        norm,
        variants: new Map(),
        countries: new Set(),
        typeHints: new Set(),
        klassCounts: { place: 0, checkpoint: 0, location: 0, 'free-text': 0 },
        tripCount: 0,
        count: 0,
        sources: [],
        sourcesTotal: 0,
      };
      aggs.set(norm, agg);
    }
    agg.count += 1;
    agg.klassCounts[o.klass] += 1;
    const isTrip = TRIP_BRANCHES.includes(o.branch);
    if (isTrip) agg.tripCount += 1;
    if (o.country) agg.countries.add(o.country);
    if (o.typeHint) agg.typeHints.add(o.typeHint);
    const variantKey = o.value;
    const variant = agg.variants.get(variantKey);
    if (variant) {
      variant.count += 1;
      if (isTrip) variant.tripCount += 1;
    } else {
      agg.variants.set(variantKey, { name: variantKey, count: 1, tripCount: isTrip ? 1 : 0, klass: o.klass });
    }
    agg.sourcesTotal += 1;
    if (agg.sources.length < SRC_SAMPLE) {
      agg.sources.push({ branch: o.branch, path: o.path, field: o.field, value: o.value });
    }
  });

  const candidates: CityCandidate[] = [];
  /** Причины, почему значение не стало кандидатом (норм → причина). */
  const rejectReasons = new Map<string, string>();
  const suspicious: Array<{ value: string; norm: string; count: number; reason: string; path: string }> = [];
  const GENERIC = ['база', 'граница', 'таможня', 'склад', 'терминал', 'офис', 'дом', 'порт', 'аэропорт', 'рынок', 'депо', 'стоянка', 'заправка', 'пост', 'переход', 'круг', 'точка'];
  aggs.forEach((agg) => {
    const bestVariant = Array.from(agg.variants.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
    const klass: CitySourceClass =
      agg.klassCounts.place >= 1 ? 'place'
        : agg.klassCounts.checkpoint >= 1 ? 'checkpoint'
          : agg.klassCounts.location >= 1 ? 'location'
            : 'free-text';
    const reject = (reason: string): void => {
      rejectReasons.set(agg.norm, reason);
      suspicious.push({ value: bestVariant.name, norm: agg.norm, count: agg.count, reason, path: agg.sources[0]?.path || '' });
    };
    if (!looksLikePlaceName(agg.norm)) {
      reject('не похоже на название места');
      return;
    }
    if (GENERIC.includes(agg.norm)) {
      reject('слишком общее слово (не место)');
      return;
    }
    if (agg.count === 1 && klass === 'free-text') {
      reject('одиночное значение из свободного текста');
      return;
    }
    candidates.push({
      norm: agg.norm,
      name: bestVariant.name,
      count: agg.count,
      tripCount: agg.tripCount,
      kind: klass,
      typeHints: Array.from(agg.typeHints.values()),
      countries: Array.from(agg.countries.values()),
    });
  });

  const { groups, borderline } = groupCityCandidates(candidates);

  const TYPE_PRIORITY: CityKind[] = ['граница', 'таможня', 'терминал', 'город'];
  const typeOf = (g: CityGroup): CityKind =>
    TYPE_PRIORITY.find((t) => g.typeHints.includes(t)) || 'город';

  // id справочника: слаг канонического имени; коллизии — детерминированные суффиксы
  const usedIds = new Map<string, string>(); // id → norm
  const planned = groups.map((g) => {
    let id = citySlug(g.canonical);
    const owner = usedIds.get(id);
    if (owner && owner !== g.norm) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    usedIds.set(id, g.norm);
    return {
      id,
      name: g.canonical,
      country: g.countries[0] || '',
      // алиасы — все прочие варианты написания (канонический — первый в списке)
      aliases: g.variants.slice(1).map((v) => v.name).filter((v) => v !== g.canonical),
      type: typeOf(g),
      usageCount: g.count,
      source: 'migration' as const,
      norm: g.norm,
      tripCount: g.tripCount,
      variants: g.variants.map((v) => ({ name: v.name, count: v.count })),
      countries: g.countries,
      kinds: g.kinds,
    };
  });

  const duplicates = planned.filter((p) => p.variants.length > 1);
  const singles = groups.filter((g) => g.count === 1);
  const noCountry = planned.filter((p) => !p.country);
  /** Нормализованные формы, попадающие в справочник (для ссылок cityId). */
  const candidateNorms = new Set<string>(candidates.map((c) => c.norm));
  const groupNorms = new Set<string>(groups.map((g) => g.norm));
  const normToVariant = new Map<string, string>(planned.map((p) => [p.norm, p.name]));

  // -------------------------------------------------------------------------
  // 5б. Привязано / не привязано (с ПРИЧИНОЙ)
  // -------------------------------------------------------------------------
  const normInGroup = (norm: string): boolean => candidateNorms.has(norm) || groupNorms.has(norm);
  const notAttached = new Map<string, { reason: string; count: number; examples: string[]; branches: Set<string> }>();
  let attachedCount = 0;
  occurrences.forEach((o) => {
    const norm = normalizeCityName(o.value);
    if (!norm) return;
    if (normInGroup(norm)) {
      attachedCount += 1;
      return;
    }
    const reason = rejectReasons.get(norm) || (o.value.length > 60 ? 'длинная фраза — свободный текст' : 'не прошло проверку места');
    let entry = notAttached.get(reason);
    if (!entry) {
      entry = { reason, count: 0, examples: [], branches: new Set() };
      notAttached.set(reason, entry);
    }
    entry.count += 1;
    entry.branches.add(o.branch);
    if (entry.examples.length < 10 && !entry.examples.includes(o.value)) entry.examples.push(o.value);
  });
  const unattachedTotal = occurrences.length - attachedCount;

  // -------------------------------------------------------------------------
  // 6. Отчёт
  // -------------------------------------------------------------------------
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    takenAt: new Date().toISOString(),
    match: MATCH || null,
    sources: statsList,
    totals: {
      occurrences: occurrences.length,
      empty: emptyOcc + normEmpty,
      uniqueRaw: rawDistinct.size,
      uniqueNorms: aggs.size,
      attached: attachedCount,
      unattached: unattachedTotal,
      candidates: candidates.length,
      groups: groups.length,
      duplicates: duplicates.length,
      singles: singles.length,
      suspicious: suspicious.length,
      freeTextSkipped: freeText.length,
      borderlinePairs: borderline.length,
      noCountry: noCountry.length,
    },
    unattachedByReason: Array.from(notAttached.values())
      .sort((a, b) => b.count - a.count)
      .map((u) => ({ reason: u.reason, count: u.count, branches: Array.from(u.branches), examples: u.examples })),
    duplicates: duplicates.map((d) => ({
      id: d.id,
      canonical: d.name,
      usageCount: d.usageCount,
      tripCount: d.tripCount,
      type: d.type,
      country: d.country,
      variants: d.variants,
    })),
    noCountry: noCountry.map((p) => ({ id: p.id, name: p.name, usageCount: p.usageCount })),
    suspicious,
    freeTextHead: freeText.slice(0, 100),
    freeTextTotal: freeText.length,
    borderline,
    plannedIds: planned.map((p) => ({ id: p.id, name: p.name, country: p.country, type: p.type, usageCount: p.usageCount })),
    plannedDetails: planned.map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      type: p.type,
      usageCount: p.usageCount,
      variants: p.variants.map((v) => v.name),
      countries: p.countries,
      kinds: p.kinds,
    })),
    sourcesSample: Array.from(aggs.values()).slice(0, 200).map((a) => ({
      norm: a.norm,
      value: Array.from(a.variants.keys())[0],
      count: a.count,
      sources: a.sources,
    })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(OUT_DIR, APPLY ? `cities-apply-${stamp}` : `cities-dry-run-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1), 'utf8');

  const lines: string[] = [];
  const log = (s: string): void => { lines.push(s); console.log(s); };
  log(`[migrate-cities] Режим: ${APPLY ? 'ЗАПИСЬ (--apply)' : 'ОТЧЁТ (dry-run; запись только с --apply)'}${MATCH ? ` (match=${MATCH})` : ''}`);
  log(`[migrate-cities] Источники (непустых значений/всего, просмотрено записей):`);
  statsList.forEach((s) => log(`    ${s.branch} · ${s.field}: ${s.nonEmpty}/${s.values}, записей ${s.records}`));
  const t = report.totals;
  log(`[migrate-cities] Всего значений: ${t.occurrences} (пустых ${t.empty}); уникальных до нормализации: ${t.uniqueRaw}; после нормализации: ${t.uniqueNorms}; кандидатов: ${t.candidates}`);
  log(`[migrate-cities] Привязано: ${t.attached}; НЕ привязано: ${t.unattached} (причины ниже)`);
  log(`[migrate-cities] Групп: ${t.groups}; дублей (2+ вариантов): ${t.duplicates}; одиночных: ${t.singles}; подозрительных: ${t.suspicious}; свободный текст (не место): ${t.freeTextSkipped}`);
  log(`[migrate-cities] Без страны: ${t.noCountry}; неоднозначных пар (Левенштейн на грани): ${t.borderlinePairs}`);
  log('');
  log(`НЕ привязано — по причинам (всего ${t.unattached}):`);
  report.unattachedByReason.forEach((u) => {
    log(`  ${u.reason}: ${u.count} (${u.branches.join(', ')}) — напр. ${u.examples.slice(0, 6).map((e) => `«${e}»`).join(', ')}`);
  });
  log('');
  log(`Группы дублей (топ ${Math.min(TOP, duplicates.length)} из ${duplicates.length}):`);
  duplicates.slice(0, TOP).forEach((d) => {
    log(`  ${d.name}  [${d.variants.map((v) => `${v.name}×${v.count}`).join(' + ')}]  → id=${d.id}, тип=${d.type}${d.country ? `, страна=${d.country}` : ', страна НЕ ОПРЕДЕЛЕНА'}`);
  });
  log('');
  log(`Без страны (топ ${Math.min(TOP, noCountry.length)} из ${noCountry.length}): ${noCountry.slice(0, TOP).map((p) => `${p.name}×${p.usageCount}`).join(', ')}`);
  log('');
  log(`Подозрительные (топ ${Math.min(TOP, suspicious.length)} из ${suspicious.length}):`);
  suspicious.slice(0, TOP).forEach((s) => log(`  «${s.value}» ×${s.count} — ${s.reason} @ ${s.path}`));
  log('');
  log(`Свободный текст (не место; топ ${Math.min(10, freeText.length)} из ${freeText.length}):`);
  freeText.slice(0, 10).forEach((f) => log(`  «${f.value}» @ ${f.path}`));
  log('');
  log(`Неоднозначные пары (топ ${Math.min(TOP, borderline.length)} из ${borderline.length}): ${borderline.slice(0, TOP).map((b) => `${b.a}↔${b.b} (d=${b.distance})`).join('; ')}`);
  log('');
  log(`Плановые id справочника (первые ${Math.min(20, planned.length)}): ${planned.slice(0, 20).map((p) => `${p.id}=${p.name}`).join(', ')}${planned.length > 20 ? ` … всего ${planned.length}` : ''}`);
  log(`[migrate-cities] Отчёт сохранён: ${base}.json`);

  // -------------------------------------------------------------------------
  // 7. Запись (только --apply, после подтверждения владельца)
  // -------------------------------------------------------------------------
  let wrote = 0;
  let refs = 0;
  if (APPLY) {
    if (!SAY_YES) {
      if (!process.stdin.isTTY) {
        console.error('[migrate-cities] --apply без --yes в неинтерактивном запуске: запись отменена. Подтверждение владельца — флаг --yes.');
        return 3;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question('[migrate-cities] Записать справочник cities и cityId-ссылки? Введите ДА: ')).trim().toLowerCase();
      rl.close();
      if (answer !== 'да' && answer !== 'yes') {
        console.log('[migrate-cities] Отменено владельцем — ничего не записано.');
        writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
        return 0;
      }
    }

    // --- свежие снимки затронутых веток: бэкап ДО записи + чтение текущих значений ---
    const existingCities = objOf(await read('cities'));
    const roots = new Map<string, unknown>();
    roots.set('cities', existingCities);
    for (const branch of AFFECTED_BRANCHES) {
      roots.set(branch, objOf(await read(branch)));
    }
    const backupFile = `${OUT_DIR}/cities-apply-backup-${stamp}.json`;
    const backupPayload: Record<string, unknown> = {};
    roots.forEach((v, k) => { backupPayload[k] = v; });
    writeFileSync(backupFile, JSON.stringify({
      takenAt: new Date().toISOString(),
      note: 'Бэкап затронутых веток ДО записи (старые поля не меняются — только добавляются cityId).',
      branches: backupPayload,
    }, null, 1), 'utf8');
    console.log(`[migrate-cities] Бэкап до записи: ${backupFile}`);

    const rootPrefixes = Array.from(roots.keys()).sort((a, b) => b.length - a.length);
    /** Текущее значение по пути (по свежему снимку ветки). */
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

    // --- справочник cities: идемпотентно, записи norm→id ---
    const updates: Record<string, unknown> = {};
    const now = new Date().toISOString();
    const existingByNorm = new Map<string, string>();
    Object.entries(existingCities).forEach(([id, recRaw]) => {
      const norm = normalizeCityName(str(objOf(recRaw).name));
      if (norm) existingByNorm.set(norm, id);
    });
    planned.forEach((p) => {
      const existingId = existingByNorm.get(p.norm);
      if (existingId) return; // значение уже в справочнике — не дублируем
      updates[`cities/${p.id}`] = {
        id: p.id,
        name: p.name,
        country: p.country,
        aliases: p.aliases,
        type: p.type,
        usageCount: p.usageCount,
        createdAt: now,
        source: 'migration',
      };
      wrote += 1;
    });

    // --- ссылки cityId рядом со старыми текстовыми значениями (старые поля не трогаем) ---
    const normToId = new Map<string, string>();
    planned.forEach((p) => normToId.set(p.norm, existingByNorm.get(p.norm) || p.id));
    occurrences.forEach((o) => {
      if (o.noRef) return; // значения из массивов строк — только в справочник
      const norm = normalizeCityName(o.value);
      if (!norm || !candidateNorms.has(norm)) return;
      const field = sideFieldOf(o.field);
      updates[`${o.path}/${field}`] = normToId.get(norm);
      refs += 1;
    });

    // уже проставленные значения не перезаписываем (идемпотентность)
    const cleanUpdates: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (valueAt(path) === value) continue;
      cleanUpdates[path] = value;
    }
    if (Object.keys(cleanUpdates).length) await adminDb.ref().update(cleanUpdates);
    log(`[migrate-cities] ЗАПИСЬ: cities-записей ${wrote}, cityId-ссылок ${refs}, фактически обновлено путей ${Object.keys(cleanUpdates).length} (идемпотентно).`);
  } else {
    log('[migrate-cities] Ничего не записано (dry-run). Запись — только `--apply` после подтверждения владельца.');
  }

  writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
  if (ONLY_JSON) {
    console.log(JSON.stringify(report.totals, null, 1));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Режим --verify: повторный обход и остаток непривязанных (после --apply)
// ---------------------------------------------------------------------------
async function runVerify(read: Reader): Promise<number> {
  const { occurrences, statsList } = await collectSources(read, { match: MATCH });

  const citiesRaw = objOf(await read('cities'));
  /**
   * норм. форма → id записи справочника. Приоритет у ИМЁН: если форма —
   * имя одной записи и алиас другой, значение относится к той, для которой
   * это имя (иначе «Карасу»-алиас Ильичёвска перебивал город Карасу).
   */
  const byName = new Map<string, string>();
  const byAlias = new Map<string, string>();
  Object.entries(citiesRaw).forEach(([id, recRaw]) => {
    const rec = objOf(recRaw);
    const nameNorm = normalizeCityName(str(rec.name));
    if (nameNorm && !byName.has(nameNorm)) byName.set(nameNorm, id);
    (Array.isArray(rec.aliases) ? rec.aliases : []).forEach((aRaw) => {
      const n = normalizeCityName(str(aRaw));
      if (n && !byName.has(n) && !byAlias.has(n)) byAlias.set(n, id);
    });
  });
  const resolveId = (norm: string): string | undefined => byName.get(norm) || byAlias.get(norm);
  const citiesFormCount = new Set([...byName.keys(), ...byAlias.keys()]).size;

  // свежие снимки затронутых веток — проверяем фактическое значение рядом
  const roots = new Map<string, unknown>();
  for (const branch of AFFECTED_BRANCHES) {
    roots.set(branch, objOf(await read(branch)));
  }
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
  let refsExpected = 0;
  let refsOk = 0;
  let noRefValues = 0;
  const refsMissing: Array<{ path: string; field: string; value: string; expectedId: string }> = [];
  const refsWrong: Array<{ path: string; field: string; value: string; expectedId: string; actual: string }> = [];
  const unattached: Array<{ branch: string; path: string; field: string; value: string; reason: string }> = [];
  const unattachedByReason = new Map<string, number>();

  occurrences.forEach((o) => {
    if (o.noRef) {
      // значения из массивов строк: ссылка не предусмотрена конструкцией
      noRefValues += 1;
      return;
    }
    const norm = normalizeCityName(o.value);
    if (!norm) return;
    const expectedId = resolveId(norm);
    if (!expectedId) {
      // значения нет в справочнике — остаток непривязанных
      const reason = 'нет записи в cities (не мигрировано)';
      unattached.push({ branch: o.branch, path: o.path, field: o.field, value: o.value, reason });
      unattachedByReason.set(reason, (unattachedByReason.get(reason) || 0) + 1);
      return;
    }
    refsExpected += 1;
    const field = sideFieldOf(o.field);
    const actual = valueAt(`${o.path}/${field}`);
    if (actual == null || actual === '') {
      refsMissing.push({ path: o.path, field, value: o.value, expectedId });
    } else if (String(actual) !== expectedId) {
      refsWrong.push({ path: o.path, field, value: o.value, expectedId, actual: String(actual) });
    } else {
      refsOk += 1;
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `cities-verify-${stamp}`);
  const report = {
    mode: 'verify',
    takenAt: new Date().toISOString(),
    cities: citiesFormCount,
    occurrences: occurrences.length,
    refsExpected,
    refsOk,
    noRefValues,
    refsMissing: refsMissing.slice(0, 1000),
    refsMissingTotal: refsMissing.length,
    refsWrong: refsWrong.slice(0, 1000),
    refsWrongTotal: refsWrong.length,
    unattachedTotal: unattached.length,
    unattachedByReason: Array.from(unattachedByReason.entries()).map(([reason, count]) => ({ reason, count })),
    unattached: unattached.slice(0, 1000),
    sources: statsList,
  };
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1), 'utf8');

  const log = (s: string): void => console.log(s);
  const lines: string[] = [];
  const logBoth = (s: string): void => { lines.push(s); log(s); };
  logBoth(`[migrate-cities --verify] Форм в справочнике: ${citiesFormCount}; значений-мест: ${occurrences.length}`);
  logBoth(`[migrate-cities --verify] Ссылок ожидается: ${refsExpected}; на месте: ${refsOk}; НЕТ: ${refsMissing.length}; указывают на другой id: ${refsWrong.length}`);
  logBoth(`[migrate-cities --verify] Значений из массивов строк (ссылка не предусмотрена): ${noRefValues}`);
  logBoth(`[migrate-cities --verify] Остаток непривязанных: ${unattached.length}`);
  report.unattachedByReason.forEach((u) => logBoth(`    ${u.reason}: ${u.count}`));
  refsMissing.slice(0, TOP).forEach((r) => logBoth(`    НЕТ cityId: ${r.path}/${r.field} = «${r.value}» (ожидался ${r.expectedId})`));
  refsWrong.slice(0, TOP).forEach((r) => logBoth(`    НЕВЕРНО: ${r.path}/${r.field} = «${r.value}» → ${r.actual}, ожидался ${r.expectedId}`));
  const uniqUnatt = new Map<string, number>();
  unattached.forEach((u) => uniqUnatt.set(u.value, (uniqUnatt.get(u.value) || 0) + 1));
  Array.from(uniqUnatt.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP)
    .forEach(([v, c]) => logBoth(`    без записи: «${v}» ×${c}`));
  writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
  console.log(`[migrate-cities --verify] Отчёт: ${base}.json`);
  if (ONLY_JSON) console.log(JSON.stringify({ refsExpected, refsOk, refsMissing: refsMissing.length, refsWrong: refsWrong.length, unattached: unattached.length }, null, 1));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[migrate-cities] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
