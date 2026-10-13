/**
 * Общий обход источников мест портала (только чтение) — используется
 * миграцией справочника (scripts/migrate-cities.ts) и починкой справочника
 * (scripts/fix-cities-cleanup.ts). Списки источников и счётчики совпадают
 * во всех режимах, чтобы dry-run/--apply/--verify считали одно и то же.
 *
 * Ветки: рейсы («Плана дохода», легаси, факт, история расчётов, этапы),
 * справочники мест (knownDistancesList, standardDistances, distanceDb,
 * checkpoints, locationsDB), «План загрузок», RouteDesk, driverTasks,
 * свободные тексты (baza/baza_cars/archive comment+events, vehicleEvents).
 * Ничего не пишет.
 */
import { isShortPlaceText, type CityKind, type CitySourceClass } from '../src/utils/cityDirectory.ts';

/** Ветки «реальных рейсов» — вес тай-брейка канонического имени. */
export const TRIP_BRANCHES = ['trips_dashboard', 'trips', 'tripTimeline/tripStages', 'tripTimeline/trips'];

/**
 * Имя поля-ссылки рядом со старым текстом — по имени исходного поля.
 * Старое текстовое поле НЕ переименовывается и НЕ перезаписывается.
 */
export function sideFieldOf(field: string): string {
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
export const AFFECTED_BRANCHES = [
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

export interface Occurrence {
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

export interface SourceStat {
  branch: string;
  field: string;
  values: number;
  nonEmpty: number;
  /** Просмотрено записей (рейсов/строк справочника/периодов) этой ветки. */
  records: number;
}

export interface CollectResult {
  occurrences: Occurrence[];
  statsList: SourceStat[];
  freeText: Array<{ value: string; path: string; branch: string }>;
  /** Пустых значений (ещё до кандидатов). */
  emptyOcc: number;
  /** Все сырые (trim) значения со счётчиками — «уникальных до нормализации». */
  rawDistinct: Map<string, number>;
}

const SRC_SAMPLE = 15; // сколько примеров источников хранить на значение в JSON

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

export type Reader = (path: string) => Promise<unknown>;

/**
 * Полный обход источников мест. `match` — ограничение прогона (подстрока id).
 * Ничего не пишет.
 */
export async function collectSources(read: Reader, options: { match?: string } = {}): Promise<CollectResult> {
  const match = options.match || '';
  const matched = (id: string): boolean => !match || id.includes(match);

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
