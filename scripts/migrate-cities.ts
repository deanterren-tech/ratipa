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
 *    (по умолчанию /Users/sergei/.hermes/cache/scratch/cities).
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
 *   npx tsx scripts/migrate-cities.ts --apply                  # запись (спросит подтверждение)
 *   npx tsx scripts/migrate-cities.ts --apply --yes --match=X  # без вопроса, только id с X
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { adminDb } from '../firebaseAdmin.ts';
import {
  citySlug,
  isShortPlaceText,
  looksLikePlaceName,
  normalizeCityName,
  groupCityCandidates,
  type CityCandidate,
  type CityGroup,
  type CityKind,
  type CitySourceClass,
} from '../src/utils/cityDirectory.ts';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const SAY_YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
/** Ограничение прогона: только записи, в id которых есть этот текст. */
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
/** Каталог отчётов (текст + JSON + бэкап). */
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities';
const matched = (id: string): boolean => !MATCH || id.includes(MATCH);

/** Ветки «реальных рейсов» — вес тай-брейка канонического имени. */
const TRIP_BRANCHES = ['trips_dashboard', 'trips', 'tripTimeline/tripStages', 'tripTimeline/trips'];

/** Ветки, которые может затронуть --apply: бэкап и чтение текущих значений. */
const AFFECTED_BRANCHES = [
  'trips_dashboard',
  'trips',
  'current_trips',
  'calculationsHistory',
  'tripTimeline/tripStages',
  'tripTimeline/trips',
  'tripTimeline/vehicleEvents',
  'knownDistancesList',
  'directories/standardDistances',
  'distanceDb',
  'checkpoints',
  'locationsDB',
  'baza',
  'baza_cars',
  'archive',
];

const TOP = 40; // сколько строк дублей печатать в текстовом отчёте
const SRC_SAMPLE = 15; // сколько примеров источников хранить на значение в JSON

interface Occurrence {
  branch: string;
  path: string;
  field: string;
  value: string;
  klass: CitySourceClass;
  /** Страна рядом (BY/RU/… или «Турция»), если есть. */
  country?: string;
  typeHint?: CityKind;
}

interface SourceStat {
  branch: string;
  field: string;
  values: number;
  nonEmpty: number;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const listOf = (raw: unknown): unknown[] =>
  Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
const objOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

/** Код страны (BY) или название («Турция») — как записано в источнике. */
const countryOf = (v: unknown): string => {
  const s = str(v);
  if (!s) return '';
  return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : s;
};

const HINT_BY_STAGE_TYPE: Record<string, CityKind> = {
  border: 'граница',
  cust_in: 'таможня',
  cust_out: 'таможня',
};

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[migrate-cities] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }

  const occurrences: Occurrence[] = [];
  const statMap = new Map<string, SourceStat>();
  const freeText: Array<{ value: string; path: string; branch: string }> = [];
  /** Значения, отброшенные как пустые (ещё до кандидатов). */
  let emptyOcc = 0;

  const push = (o: Occurrence): void => {
    if (!o.value) {
      emptyOcc += 1;
      return;
    }
    occurrences.push(o);
  };
  const pushFree = (o: Omit<Occurrence, 'klass'> & { klass?: CitySourceClass }, keepLong = false): void => {
    const v = o.value;
    if (!v) return;
    if (isShortPlaceText(v)) {
      push({ ...o, klass: o.klass || 'free-text' });
    } else if (v.length <= 200) {
      // длинные фразы — только в отчёт (в справочник не попадают)
      if (keepLong || freeText.length < 500) freeText.push({ value: v, path: o.path, branch: o.branch });
    }
  };

  const read = async (path: string): Promise<unknown> => (await adminDb!.ref(path).get()).val();
  const stat = (branch: string, field: string, values: number, nonEmpty: number): void => {
    const key = `${branch}|${field}`;
    const prev = statMap.get(key);
    if (prev) {
      prev.values += values;
      prev.nonEmpty += nonEmpty;
    } else {
      statMap.set(key, { branch, field, values, nonEmpty });
    }
  };

  // -------------------------------------------------------------------------
  // 1. Рейсы: trips_dashboard / trips / current_trips / calculationsHistory
  // -------------------------------------------------------------------------
  const collectLegs = (
    branch: string,
    id: string,
    rawLegs: unknown,
    kindOfSource: CitySourceClass,
  ): void => {
    let values = 0;
    let nonEmpty = 0;
    listOf(rawLegs).forEach((legRaw, i) => {
      const leg = objOf(legRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(leg[side]);
        if (v) nonEmpty += 1;
        push({
          branch,
          path: `${branch}/${id}/legs/${i}`,
          field: side,
          value: v,
          klass: kindOfSource,
        });
      });
    });
    if (values) stat(branch, 'legs.from/to', values, nonEmpty);
  };

  const tripsDashboard = objOf(await read('trips_dashboard'));
  let dashboardTrips = 0;
  Object.entries(tripsDashboard).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    const rec = objOf(recRaw);
    dashboardTrips += 1;
    collectLegs('trips_dashboard', id, rec.legs, 'place');
  });

  const legacyTrips = objOf(await read('trips'));
  Object.entries(legacyTrips).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    const rec = objOf(recRaw);
    collectLegs('trips', id, rec.legs, 'place');
    let values = 0;
    let nonEmpty = 0;
    listOf(rec.routes).forEach((rRaw, i) => {
      const r = objOf(rRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(r[side]);
        if (v) nonEmpty += 1;
        push({ branch: 'trips', path: `trips/${id}/routes/${i}`, field: side, value: v, klass: 'place' });
      });
    });
    if (values) stat('trips', 'routes.from/to', values, nonEmpty);
  });

  const currentTrips = objOf(await read('current_trips'));
  Object.entries(currentTrips).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    collectLegs('current_trips', id, objOf(recRaw).legs, 'place');
  });

  const calcHistory = objOf(await read('calculationsHistory'));
  Object.entries(calcHistory).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    collectLegs('calculationsHistory', id, objOf(recRaw).legs, 'place');
  });

  // -------------------------------------------------------------------------
  // 2. Этапы (tripTimeline/tripStages, tripTimeline/trips/*/stages)
  // -------------------------------------------------------------------------
  const stagesStore = objOf(await read('tripTimeline/tripStages'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(stagesStore).forEach(([tripId, storeRaw]) => {
      if (!matched(tripId)) return;
      Object.entries(objOf(storeRaw)).forEach(([stageId, stageRaw]) => {
        const stage = objOf(stageRaw);
        const label = str(stage.label);
        values += 1;
        if (label) nonEmpty += 1;
        const typeHint = HINT_BY_STAGE_TYPE[str(stage.type)];
        push({
          branch: 'tripTimeline/tripStages',
          path: `tripTimeline/tripStages/${tripId}/${stageId}`,
          field: 'label',
          value: label,
          klass: 'place',
          typeHint,
        });
      });
    });
    stat('tripTimeline/tripStages', 'label', values, nonEmpty);
  }

  const manualTrips = objOf(await read('tripTimeline/trips'));
  Object.entries(manualTrips).forEach(([tripId, tripRaw]) => {
    if (!matched(tripId)) return;
    listOf(objOf(tripRaw).stages).forEach((sRaw, i) => {
      const stage = objOf(sRaw);
      push({
        branch: 'tripTimeline/trips',
        path: `tripTimeline/trips/${tripId}/stages/${i}`,
        field: 'label',
        value: str(stage.label),
        klass: 'place',
        typeHint: HINT_BY_STAGE_TYPE[str(stage.type)],
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3. Справочники мест (только чтение)
  // -------------------------------------------------------------------------
  const known = objOf(await read('knownDistancesList'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(known).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      const rec = objOf(recRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(rec[side]);
        if (v) nonEmpty += 1;
        push({
          branch: 'knownDistancesList',
          path: `knownDistancesList/${id}`,
          field: side,
          value: v,
          klass: 'place',
          country: side === 'from' ? countryOf(rec.countryFrom) : countryOf(rec.countryTo),
        });
      });
    });
    stat('knownDistancesList', 'from/to', values, nonEmpty);
  }

  const standardDistances = objOf(await read('directories/standardDistances'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(standardDistances).forEach(([id, recRaw]) => {
      const rec = objOf(recRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(rec[side]);
        if (v) nonEmpty += 1;
        push({ branch: 'directories/standardDistances', path: `directories/standardDistances/${id}`, field: side, value: v, klass: 'place' });
      });
    });
    stat('directories/standardDistances', 'from/to', values, nonEmpty);
  }

  const distanceDb = objOf(await read('distanceDb'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(distanceDb).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      const rec = objOf(recRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(rec[side === 'from' ? 'fromName' : 'toName']);
        if (v) nonEmpty += 1;
        push({
          branch: 'distanceDb',
          path: `distanceDb/${id}`,
          field: side === 'from' ? 'fromName' : 'toName',
          value: v,
          klass: 'place',
          country: countryOf(rec[side === 'from' ? 'fromCountry' : 'toCountry']),
        });
      });
    });
    stat('distanceDb', 'fromName/toName', values, nonEmpty);
  }

  const checkpoints = objOf(await read('checkpoints'));
  Object.entries(checkpoints).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    const rec = objOf(recRaw);
    push({
      branch: 'checkpoints',
      path: `checkpoints/${id}`,
      field: 'name',
      value: str(rec.name),
      klass: 'checkpoint',
      country: countryOf(rec.countryFrom) || countryOf(rec.countryTo),
      typeHint: 'граница',
    });
  });

  const locations = objOf(await read('locationsDB'));
  Object.entries(locations).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    push({
      branch: 'locationsDB',
      path: `locationsDB/${id}`,
      field: 'name',
      value: str(objOf(recRaw).name),
      klass: 'location',
      typeHint: 'терминал',
    });
  });

  // -------------------------------------------------------------------------
  // 4. Периоды базы и события (свободные тексты — короткие значения-места)
  // -------------------------------------------------------------------------
  for (const branch of ['baza', 'baza_cars', 'archive']) {
    const store = objOf(await read(branch));
    Object.entries(store).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      const rec = objOf(recRaw);
      pushFree({ branch, path: `${branch}/${id}`, field: 'comment', value: str(rec.comment) });
      Object.entries(objOf(rec.events)).forEach(([evId, evRaw]) => {
        const ev = objOf(evRaw);
        pushFree({ branch, path: `${branch}/${id}/events/${evId}`, field: 'text', value: str(ev.text) });
      });
    });
  }

  const vehicleEvents = objOf(await read('tripTimeline/vehicleEvents'));
  Object.entries(vehicleEvents).forEach(([id, evRaw]) => {
    if (!matched(id)) return;
    pushFree({ branch: 'tripTimeline/vehicleEvents', path: `tripTimeline/vehicleEvents/${id}`, field: 'note', value: str(objOf(evRaw).note) });
  });

  const driverTasks = objOf(await read('driverTasks'));
  Object.entries(driverTasks).forEach(([id, taskRaw]) => {
    if (!matched(id)) return;
    const t = objOf(taskRaw);
    pushFree({ branch: 'driverTasks', path: `driverTasks/${id}`, field: 'customsDest', value: str(t.customsDest) });
    pushFree({ branch: 'driverTasks', path: `driverTasks/${id}`, field: 'customsSend', value: str(t.customsSend) });
  });

  // -------------------------------------------------------------------------
  // 5. Кандидаты: агрегация по нормализованному ключу
  // -------------------------------------------------------------------------
  const statsList = Array.from(statMap.values()).sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.field.localeCompare(b.field),
  );
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
  const suspicious: Array<{ value: string; norm: string; count: number; reason: string; path: string }> = [];
  const GENERIC = ['база', 'граница', 'таможня', 'склад', 'терминал', 'офис', 'дом', 'порт', 'аэропорт', 'рынок', 'депо', 'стоянка', 'заправка', 'пост', 'переход', 'круг', 'точка'];
  aggs.forEach((agg) => {
    const bestVariant = Array.from(agg.variants.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
    const klass: CitySourceClass =
      agg.klassCounts.place >= 1 ? 'place'
        : agg.klassCounts.checkpoint >= 1 ? 'checkpoint'
          : agg.klassCounts.location >= 1 ? 'location'
            : 'free-text';
    if (!looksLikePlaceName(agg.norm)) {
      suspicious.push({ value: bestVariant.name, norm: agg.norm, count: agg.count, reason: 'не похоже на название места', path: agg.sources[0]?.path || '' });
      return;
    }
    if (GENERIC.includes(agg.norm)) {
      suspicious.push({ value: bestVariant.name, norm: agg.norm, count: agg.count, reason: 'слишком общее слово (не место)', path: agg.sources[0]?.path || '' });
      return;
    }
    if (agg.count === 1 && klass === 'free-text') {
      suspicious.push({ value: bestVariant.name, norm: agg.norm, count: agg.count, reason: 'одиночное значение из свободного текста', path: agg.sources[0]?.path || '' });
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
      uniqueNorms: aggs.size,
      candidates: candidates.length,
      groups: groups.length,
      duplicates: duplicates.length,
      singles: singles.length,
      suspicious: suspicious.length,
      freeTextSkipped: freeText.length,
      borderlinePairs: borderline.length,
      noCountry: noCountry.length,
    },
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
  log(`[migrate-cities] Источники (значений/непустых):`);
  statsList.forEach((s) => log(`    ${s.branch} · ${s.field}: ${s.nonEmpty}/${s.values}`));
  const t = report.totals;
  log(`[migrate-cities] Всего значений: ${t.occurrences} (пустых ${t.empty}); уникальных форм после нормализации: ${t.uniqueNorms}; кандидатов: ${t.candidates}`);
  log(`[migrate-cities] Групп: ${t.groups}; дублей (2+ вариантов): ${t.duplicates}; одиночных: ${t.singles}; подозрительных: ${t.suspicious}; свободный текст (не место): ${t.freeTextSkipped}`);
  log(`[migrate-cities] Без страны: ${t.noCountry}; неоднозначных пар (Левенштейн на грани): ${t.borderlinePairs}`);
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
    const sideField = (branch: string, field: string): string => {
      if (branch === 'knownDistancesList' || branch === 'directories/standardDistances' || branch === 'distanceDb') {
        return field === 'to' || field === 'toName' ? 'toCityId' : 'fromCityId';
      }
      if (branch === 'trips_dashboard' || branch === 'trips' || branch === 'current_trips' || branch === 'calculationsHistory') {
        return field === 'from' ? 'fromCityId' : 'toCityId';
      }
      return 'cityId';
    };
    occurrences.forEach((o) => {
      const norm = normalizeCityName(o.value);
      if (!norm || !candidateNorms.has(norm)) return;
      const field = sideField(o.branch, o.field);
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

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[migrate-cities] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
