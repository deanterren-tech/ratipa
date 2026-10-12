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
const VERIFY = ARGS.includes('--verify');
const SAY_YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
/** Ограничение прогона: только записи, в id которых есть этот текст. */
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
/** Каталог отчётов (текст + JSON + бэкап). */
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities2';
const matched = (id: string): boolean => !MATCH || id.includes(MATCH);

/** Ветки «реальных рейсов» — вес тай-брейка канонического имени. */
const TRIP_BRANCHES = ['trips_dashboard', 'trips', 'tripTimeline/tripStages', 'tripTimeline/trips'];

/**
 * Имя поля-ссылки рядом со старым текстом — по имени исходного поля.
 * Старое текстовое поле НЕ переименовывается и НЕ перезаписывается.
 */
function sideFieldOf(field: string): string {
  switch (field) {
    case 'from':
    case 'fromName':
      return 'fromCityId';
    case 'to':
    case 'toName':
      return 'toCityId';
    case 'fromPoint':
      return 'fromPointCityId';
    case 'toPoint':
      return 'toPointCityId';
    case 'origin':
      return 'originCityId';
    case 'destination':
      return 'destinationCityId';
    case 'name':
    case 'label':
      return 'cityId';
    default:
      return `${field}CityId`;
  }
}

/** Ветки, которые может затронуть --apply: бэкап и чтение текущих значений. */
const AFFECTED_BRANCHES = [
  'trips_dashboard',
  'trips',
  'current_trips',
  'calculationsHistory',
  'tripTimeline/tripStages',
  'tripTimeline/trips',
  'tripTimeline/vehicleEvents',
  'multiTemplates',
  'knownDistancesList',
  'directories/standardDistances',
  'distanceDb',
  'checkpoints',
  'locationsDB',
  'ratipa_loading_plan',
  'routedesk',
  'driverTasks',
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
  /** Значение из массива строк: в справочник попадает, cityId рядом не пишется. */
  noRef?: boolean;
}

interface SourceStat {
  branch: string;
  field: string;
  values: number;
  nonEmpty: number;
  /** Просмотрено записей (рейсов/строк справочника/периодов) этой ветки. */
  records: number;
}

interface CollectResult {
  occurrences: Occurrence[];
  statsList: SourceStat[];
  freeText: Array<{ value: string; path: string; branch: string }>;
  /** Пустых значений (ещё до кандидатов). */
  emptyOcc: number;
  /** Все сырые (trim) значения со счётчиками — «уникальных до нормализации». */
  rawDistinct: Map<string, number>;
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

type Reader = (path: string) => Promise<unknown>;

/**
 * Полный обход источников мест. Используется всеми режимами (dry-run/--verify/
 * --apply), чтобы списки и счётчики совпадали. Ничего не пишет.
 */
async function collectSources(read: Reader): Promise<CollectResult> {
  const occurrences: Occurrence[] = [];
  const statMap = new Map<string, SourceStat>();
  const freeText: Array<{ value: string; path: string; branch: string }> = [];
  const rawDistinct = new Map<string, number>();
  let emptyOcc = 0;

  const push = (o: Occurrence): void => {
    if (!o.value) {
      emptyOcc += 1;
      return;
    }
    occurrences.push(o);
    rawDistinct.set(o.value, (rawDistinct.get(o.value) || 0) + 1);
  };
  const pushFree = (o: Omit<Occurrence, 'klass'> & { klass?: CitySourceClass }): void => {
    const v = o.value;
    if (!v) return;
    if (isShortPlaceText(v)) {
      push({ ...o, klass: o.klass || 'free-text' });
    } else if (v.length <= 200) {
      // длинные фразы — только в отчёт (в справочник не попадают)
      if (freeText.length < 500) freeText.push({ value: v, path: o.path, branch: o.branch });
    }
  };

  const stat = (branch: string, field: string, values: number, nonEmpty: number, records: number): void => {
    const key = `${branch}|${field}`;
    const prev = statMap.get(key);
    if (prev) {
      prev.values += values;
      prev.nonEmpty += nonEmpty;
      prev.records += records;
    } else {
      statMap.set(key, { branch, field, values, nonEmpty, records });
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
  ): number => {
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
    if (values) stat(branch, 'legs.from/to', values, nonEmpty, 1);
    return values ? 1 : 0;
  };

  const tripsDashboard = objOf(await read('trips_dashboard'));
  let dashboardTrips = 0;
  {
    let plValues = 0;
    let plNonEmpty = 0;
    let plRecords = 0;
    let wpValues = 0;
    let wpNonEmpty = 0;
    Object.entries(tripsDashboard).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      const rec = objOf(recRaw);
      dashboardTrips += 1;
      collectLegs('trips_dashboard', id, rec.legs, 'place');
      // промежуточные точки плеча (массив строк) — значения в справочник, без cityId
      listOf(rec.legs).forEach((legRaw, i) => {
        listOf(objOf(legRaw).waypoints).forEach((w, wi) => {
          wpValues += 1;
          const v = str(w);
          if (v) wpNonEmpty += 1;
          push({
            branch: 'trips_dashboard',
            path: `trips_dashboard/${id}/legs/${i}/waypoints/${wi}`,
            field: '_waypoint',
            value: v,
            klass: 'place',
            noRef: true,
          });
        });
      });
      // потенциальные грузы: legs[].from/to
      listOf(rec.potentialLoads).forEach((plRaw, pi) => {
        const pl = objOf(plRaw);
        if (listOf(pl.legs).length) plRecords += 1;
        listOf(pl.legs).forEach((legRaw, li) => {
          const leg = objOf(legRaw);
          (['from', 'to'] as const).forEach((side) => {
            plValues += 1;
            const v = str(leg[side]);
            if (v) plNonEmpty += 1;
            push({
              branch: 'trips_dashboard',
              path: `trips_dashboard/${id}/potentialLoads/${pi}/legs/${li}`,
              field: side,
              value: v,
              klass: 'place',
            });
          });
        });
      });
    });
    stat('trips_dashboard', 'legs.waypoints[]', wpValues, wpNonEmpty, dashboardTrips);
    stat('trips_dashboard', 'potentialLoads[].legs.from/to', plValues, plNonEmpty, plRecords);
  }

  const legacyTrips = objOf(await read('trips'));
  let legacyCount = 0;
  Object.entries(legacyTrips).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    legacyCount += 1;
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
    if (values) stat('trips', 'routes.from/to', values, nonEmpty, 1);
  });

  const currentTrips = objOf(await read('current_trips'));
  let currentCount = 0;
  Object.entries(currentTrips).forEach(([id, recRaw]) => {
    if (!matched(id)) return;
    currentCount += 1;
    collectLegs('current_trips', id, objOf(recRaw).legs, 'place');
  });

  const calcHistory = objOf(await read('calculationsHistory'));
  let calcCount = 0;
  {
    let odValues = 0;
    let odNonEmpty = 0;
    let segValues = 0;
    let segNonEmpty = 0;
    let rsegValues = 0;
    let rsegNonEmpty = 0;
    Object.entries(calcHistory).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      calcCount += 1;
      const rec = objOf(recRaw);
      collectLegs('calculationsHistory', id, rec.legs, 'place');
      listOf(rec.legs).forEach((legRaw, i) => {
        const leg = objOf(legRaw);
        // origin/destination — те же места, что from/to (другое имя поля)
        ([['origin', 'origin'], ['destination', 'destination']] as const).forEach(([field]) => {
          odValues += 1;
          const v = str(leg[field]);
          if (v) odNonEmpty += 1;
          push({
            branch: 'calculationsHistory',
            path: `calculationsHistory/${id}/legs/${i}`,
            field,
            value: v,
            klass: 'place',
          });
        });
        // сегменты расчёта (плоские и внутри routes[])
        listOf(leg.segments).forEach((sRaw, si) => {
          const s = objOf(sRaw);
          (['from', 'to'] as const).forEach((side) => {
            segValues += 1;
            const v = str(s[side]);
            if (v) segNonEmpty += 1;
            push({
              branch: 'calculationsHistory',
              path: `calculationsHistory/${id}/legs/${i}/segments/${si}`,
              field: side,
              value: v,
              klass: 'place',
            });
          });
        });
        listOf(leg.routes).forEach((rRaw, ri) => {
          listOf(objOf(rRaw).segments).forEach((sRaw, si) => {
            const s = objOf(sRaw);
            (['from', 'to'] as const).forEach((side) => {
              rsegValues += 1;
              const v = str(s[side]);
              if (v) rsegNonEmpty += 1;
              push({
                branch: 'calculationsHistory',
                path: `calculationsHistory/${id}/legs/${i}/routes/${ri}/segments/${si}`,
                field: side,
                value: v,
                klass: 'place',
              });
            });
          });
        });
      });
    });
    stat('calculationsHistory', 'legs.origin/destination', odValues, odNonEmpty, calcCount);
    stat('calculationsHistory', 'legs.segments.from/to', segValues, segNonEmpty, calcCount);
    stat('calculationsHistory', 'legs.routes.segments.from/to', rsegValues, rsegNonEmpty, calcCount);
  }

  // -------------------------------------------------------------------------
  // 2. Этапы (tripTimeline/tripStages, tripTimeline/trips/*/stages)
  // -------------------------------------------------------------------------
  const stagesStore = objOf(await read('tripTimeline/tripStages'));
  {
    let values = 0;
    let nonEmpty = 0;
    let tripRecords = 0;
    Object.entries(stagesStore).forEach(([tripId, storeRaw]) => {
      if (!matched(tripId)) return;
      tripRecords += 1;
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
    stat('tripTimeline/tripStages', 'label', values, nonEmpty, tripRecords);
  }

  const manualTrips = objOf(await read('tripTimeline/trips'));
  {
    let values = 0;
    let nonEmpty = 0;
    let tripRecords = 0;
    Object.entries(manualTrips).forEach(([tripId, tripRaw]) => {
      if (!matched(tripId)) return;
      tripRecords += 1;
      listOf(objOf(tripRaw).stages).forEach((sRaw, i) => {
        const stage = objOf(sRaw);
        values += 1;
        const v = str(stage.label);
        if (v) nonEmpty += 1;
        push({
          branch: 'tripTimeline/trips',
          path: `tripTimeline/trips/${tripId}/stages/${i}`,
          field: 'label',
          value: v,
          klass: 'place',
          typeHint: HINT_BY_STAGE_TYPE[str(stage.type)],
        });
      });
    });
    if (values || tripRecords) stat('tripTimeline/trips', 'stages.label', values, nonEmpty, tripRecords);
  }

  // -------------------------------------------------------------------------
  // 3. Справочники мест (только чтение)
  // -------------------------------------------------------------------------
  const known = objOf(await read('knownDistancesList'));
  {
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    let cpValues = 0;
    let cpNonEmpty = 0;
    Object.entries(known).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      records += 1;
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
      // пары КПП (массив строк) — значения в справочник, без cityId
      listOf(rec.checkpoints).forEach((cpRaw, ci) => {
        cpValues += 1;
        const v = str(cpRaw);
        if (v) cpNonEmpty += 1;
        push({
          branch: 'knownDistancesList',
          path: `knownDistancesList/${id}/checkpoints/${ci}`,
          field: '_checkpoint',
          value: v,
          klass: 'checkpoint',
          typeHint: 'граница',
          noRef: true,
        });
      });
      // cpInput — одиночная строка КПП
      values += 1;
      const cpi = str(rec.cpInput);
      if (cpi) nonEmpty += 1;
      push({
        branch: 'knownDistancesList',
        path: `knownDistancesList/${id}`,
        field: 'cpInput',
        value: cpi,
        klass: 'checkpoint',
        typeHint: 'граница',
      });
    });
    stat('knownDistancesList', 'from/to', values, nonEmpty, records);
    stat('knownDistancesList', 'checkpoints[]/cpInput', cpValues, cpNonEmpty, records);
  }

  const standardDistances = objOf(await read('directories/standardDistances'));
  {
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    Object.entries(standardDistances).forEach(([id, recRaw]) => {
      records += 1;
      const rec = objOf(recRaw);
      (['from', 'to'] as const).forEach((side) => {
        values += 1;
        const v = str(rec[side]);
        if (v) nonEmpty += 1;
        push({ branch: 'directories/standardDistances', path: `directories/standardDistances/${id}`, field: side, value: v, klass: 'place' });
      });
    });
    stat('directories/standardDistances', 'from/to', values, nonEmpty, records);
  }

  const distanceDb = objOf(await read('distanceDb'));
  {
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    Object.entries(distanceDb).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      records += 1;
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
    stat('distanceDb', 'fromName/toName', values, nonEmpty, records);
  }

  const checkpoints = objOf(await read('checkpoints'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(checkpoints).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      const rec = objOf(recRaw);
      values += 1;
      const v = str(rec.name);
      if (v) nonEmpty += 1;
      push({
        branch: 'checkpoints',
        path: `checkpoints/${id}`,
        field: 'name',
        value: v,
        klass: 'checkpoint',
        country: countryOf(rec.countryFrom) || countryOf(rec.countryTo),
        typeHint: 'граница',
      });
    });
    stat('checkpoints', 'name', values, nonEmpty, values);
  }

  const locations = objOf(await read('locationsDB'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(locations).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      values += 1;
      const v = str(objOf(recRaw).name);
      if (v) nonEmpty += 1;
      push({
        branch: 'locationsDB',
        path: `locationsDB/${id}`,
        field: 'name',
        value: v,
        klass: 'location',
        typeHint: 'терминал',
      });
    });
    stat('locationsDB', 'name', values, nonEmpty, values);
  }

  // -------------------------------------------------------------------------
  // 4. Периоды базы и события (свободные тексты — короткие значения-места)
  // -------------------------------------------------------------------------
  for (const branch of ['baza', 'baza_cars', 'archive']) {
    const store = objOf(await read(branch));
    let records = 0;
    let values = 0;
    let nonEmpty = 0;
    Object.entries(store).forEach(([id, recRaw]) => {
      if (!matched(id)) return;
      records += 1;
      const rec = objOf(recRaw);
      values += 1;
      const c = str(rec.comment);
      if (c) nonEmpty += 1;
      pushFree({ branch, path: `${branch}/${id}`, field: 'comment', value: c });
      Object.entries(objOf(rec.events)).forEach(([evId, evRaw]) => {
        const ev = objOf(evRaw);
        values += 1;
        const t = str(ev.text);
        if (t) nonEmpty += 1;
        pushFree({ branch, path: `${branch}/${id}/events/${evId}`, field: 'text', value: t });
      });
    });
    if (records) stat(branch, 'comment/events[].text', values, nonEmpty, records);
  }

  const vehicleEvents = objOf(await read('tripTimeline/vehicleEvents'));
  {
    let values = 0;
    let nonEmpty = 0;
    Object.entries(vehicleEvents).forEach(([id, evRaw]) => {
      if (!matched(id)) return;
      values += 1;
      const v = str(objOf(evRaw).note);
      if (v) nonEmpty += 1;
      pushFree({ branch: 'tripTimeline/vehicleEvents', path: `tripTimeline/vehicleEvents/${id}`, field: 'note', value: v });
    });
    stat('tripTimeline/vehicleEvents', 'note', values, nonEmpty, values);
  }

  const driverTasks = objOf(await read('driverTasks'));
  {
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    let rpValues = 0;
    let rpNonEmpty = 0;
    Object.entries(driverTasks).forEach(([id, taskRaw]) => {
      if (!matched(id)) return;
      records += 1;
      const t = objOf(taskRaw);
      ([['customsDest', str(t.customsDest)], ['customsSend', str(t.customsSend)]] as const).forEach(([field, v]) => {
        values += 1;
        if (v) nonEmpty += 1;
        pushFree({ branch: 'driverTasks', path: `driverTasks/${id}`, field, value: v });
      });
      // точки маршрута задания водителю (routePoints[].name)
      listOf(t.routePoints).forEach((pRaw, pi) => {
        const p = objOf(pRaw);
        rpValues += 1;
        const v = str(p.name);
        if (v) rpNonEmpty += 1;
        const typeHint: CityKind | undefined =
          str(p.type) === 'border' ? 'граница' : str(p.type) === 'port' ? 'терминал' : undefined;
        push({
          branch: 'driverTasks',
          path: `driverTasks/${id}/routePoints/${pi}`,
          field: 'name',
          value: v,
          klass: 'place',
          typeHint,
        });
      });
    });
    if (records) stat('driverTasks', 'customsDest/customsSend', values, nonEmpty, records);
    stat('driverTasks', 'routePoints[].name', rpValues, rpNonEmpty, records);
  }

  // -------------------------------------------------------------------------
  // 4б. Мультишаблоны, «План загрузок» и RouteDesk (источники мест по инвентарю)
  // -------------------------------------------------------------------------
  {
    // multiTemplates/<id>/legs[].from/.to («Минск (BY)» и т.п.)
    const multi = objOf(await read('multiTemplates'));
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    Object.entries(multi).forEach(([id, tRaw]) => {
      if (!matched(id)) return;
      records += 1;
      const t = objOf(tRaw);
      listOf(t.legs).forEach((legRaw, i) => {
        const leg = objOf(legRaw);
        (['from', 'to'] as const).forEach((side) => {
          values += 1;
          const v = str(leg[side]);
          if (v) nonEmpty += 1;
          push({ branch: 'multiTemplates', path: `multiTemplates/${id}/legs/${i}`, field: side, value: v, klass: 'place' });
        });
      });
    });
    if (records) stat('multiTemplates', 'legs.from/to', values, nonEmpty, records);
  }
  {
    // ratipa_loading_plan: items[].rounds[r][s].from/.to (+loadFrom/loadTo как заметки) и taken_loads.*.from/.to
    const lp = objOf(await read('ratipa_loading_plan'));
    const items = objOf(lp.items);
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    let notesValues = 0;
    let notesNonEmpty = 0;
    Object.entries(items).forEach(([id, itRaw]) => {
      if (!matched(id)) return;
      records += 1;
      const it = objOf(itRaw);
      listOf(it.rounds).forEach((roundRaw, ri) => {
        listOf(roundRaw).forEach((stepRaw, si) => {
          const step = objOf(stepRaw);
          (['from', 'to'] as const).forEach((side) => {
            values += 1;
            const v = str(step[side]);
            if (v) nonEmpty += 1;
            push({
              branch: 'ratipa_loading_plan',
              path: `ratipa_loading_plan/items/${id}/rounds/${ri}/${si}`,
              field: side,
              value: v,
              klass: 'place',
            });
          });
          ([['loadFrom', str(step.loadFrom)], ['loadTo', str(step.loadTo)]] as const).forEach(([field, v]) => {
            notesValues += 1;
            if (v) notesNonEmpty += 1;
            pushFree({
              branch: 'ratipa_loading_plan',
              path: `ratipa_loading_plan/items/${id}/rounds/${ri}/${si}`,
              field,
              value: v,
            });
          });
        });
      });
    });
    const taken = objOf(lp.taken_loads);
    let tkValues = 0;
    let tkNonEmpty = 0;
    let tkRecords = 0;
    Object.entries(taken).forEach(([id, tRaw]) => {
      if (!matched(id)) return;
      tkRecords += 1;
      const t = objOf(tRaw);
      (['from', 'to'] as const).forEach((side) => {
        tkValues += 1;
        const v = str(t[side]);
        if (v) tkNonEmpty += 1;
        push({ branch: 'ratipa_loading_plan', path: `ratipa_loading_plan/taken_loads/${id}`, field: side, value: v, klass: 'place' });
      });
    });
    if (records) stat('ratipa_loading_plan', 'items.rounds.from/to', values, nonEmpty, records);
    stat('ratipa_loading_plan', 'items.rounds.loadFrom/loadTo (заметки)', notesValues, notesNonEmpty, records);
    stat('ratipa_loading_plan', 'taken_loads.from/to', tkValues, tkNonEmpty, tkRecords);
  }
  {
    // routedesk: справочники и задания (fromPoint/toPoint, city контрагента, таможни)
    const rd = objOf(await read('routedesk'));
    const refs = objOf(rd.references);
    let values = 0;
    let nonEmpty = 0;
    let records = 0;
    const pointPair = (owner: Record<string, unknown>, path: string): void => {
      (['fromPoint', 'toPoint'] as const).forEach((side) => {
        values += 1;
        const v = str(owner[side]);
        if (v) nonEmpty += 1;
        push({ branch: 'routedesk', path, field: side, value: v, klass: 'place' });
      });
    };
    listOf(refs.distances).forEach((rRaw, i) => {
      records += 1;
      pointPair(objOf(rRaw), `routedesk/references/distances/${i}`);
    });
    listOf(refs.routeTemplates).forEach((tRaw, ti) => {
      records += 1;
      const t = objOf(tRaw);
      listOf(t.sections).forEach((sRaw, si) => {
        pointPair(objOf(sRaw), `routedesk/references/routeTemplates/${ti}/sections/${si}`);
      });
    });
    listOf(refs.customs).forEach((cRaw, i) => {
      records += 1;
      const c = objOf(cRaw);
      values += 1;
      const name = str(c.name);
      if (name) nonEmpty += 1;
      push({ branch: 'routedesk', path: `routedesk/references/customs/${i}`, field: 'name', value: name, klass: 'place', typeHint: 'таможня' });
      values += 1;
      const bc = str(c.borderCrossing);
      if (bc) nonEmpty += 1;
      push({ branch: 'routedesk', path: `routedesk/references/customs/${i}`, field: 'borderCrossing', value: bc, klass: 'checkpoint', typeHint: 'граница', noRef: true });
    });
    listOf(refs.counterparties).forEach((cRaw, i) => {
      records += 1;
      values += 1;
      const v = str(objOf(cRaw).city);
      if (v) nonEmpty += 1;
      push({ branch: 'routedesk', path: `routedesk/references/counterparties/${i}`, field: 'city', value: v, klass: 'place' });
    });
    listOf(rd.tasks).forEach((tRaw, ti) => {
      records += 1;
      const t = objOf(tRaw);
      listOf(t.sections).forEach((sRaw, si) => {
        pointPair(objOf(sRaw), `routedesk/tasks/${ti}/sections/${si}`);
      });
    });
    listOf(rd.trips).forEach((tRaw, ti) => {
      records += 1;
      const t = objOf(tRaw);
      listOf(t.legs).forEach((lRaw, li) => {
        pointPair(objOf(lRaw), `routedesk/trips/${ti}/legs/${li}`);
      });
    });
    stat('routedesk', 'points/city/customs', values, nonEmpty, records);
  }

  void dashboardTrips; void legacyCount; void currentCount; void calcCount;

  const statsList = Array.from(statMap.values()).sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.field.localeCompare(b.field),
  );
  return { occurrences, statsList, freeText, emptyOcc, rawDistinct };
}

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

  const { occurrences, statsList, freeText, emptyOcc, rawDistinct } = await collectSources(read);

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
  const { occurrences, statsList } = await collectSources(read);

  const citiesRaw = objOf(await read('cities'));
  /** норм. форма (имя+алиасы) → id записи справочника */
  const citiesByNorm = new Map<string, string>();
  Object.entries(citiesRaw).forEach(([id, recRaw]) => {
    const rec = objOf(recRaw);
    const forms: string[] = [str(rec.name), ...(Array.isArray(rec.aliases) ? rec.aliases.map((a) => str(a)) : [])];
    forms.forEach((f) => {
      const norm = normalizeCityName(f);
      if (norm && !citiesByNorm.has(norm)) citiesByNorm.set(norm, id);
    });
  });

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
    const expectedId = citiesByNorm.get(norm);
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
    cities: citiesByNorm.size,
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
  logBoth(`[migrate-cities --verify] Записей в справочнике: ${citiesByNorm.size}; значений-мест: ${occurrences.length}`);
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
