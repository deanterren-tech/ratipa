/**
 * audit-timeline-dups — АУДИТ текущих данных таймлайна (ТОЛЬКО ЧТЕНИЕ):
 * дубли, пересечения по правилу ТЗ, открытые периоды, готовность к
 * детерминированным ID. НИЧЕГО не пишет в RTDB; по умолчанию пишет только
 * JSON-отчёт в каталог отчётов (не в базу).
 *
 * Правило пересечений (ТЗ): конфликт, если `s <= e0 && e >= s0` (дни
 * включительно); РОВНО 1 общий день — «стык» (разрешён, перечисляется
 * отдельно); открытый период (нет конца) — конец в +∞. Ремонт внутри
 * СВОЕГО периода базы — штатное сочетание (не конфликт), пересечения ремонта
 * с ДРУГИМИ записями машины считаются.
 *
 * Что проверяет
 *  (а) дубли: периоды baza одной машины с одинаковыми (тип=status, дата начала);
 *      рядом лежащие (старт ±1 день; общий водитель/комментарий); рейсы
 *      trips_dashboard с той же машиной и датой старта; этапы с одинаковыми
 *      (рейс, тип, дата, label); события с одинаковыми (период, дата, тип, текст);
 *  (б) пересечения интервалов одной машины (рейсы × база × ремонт) — конфликты
 *      и стыки, с разбивкой «только живые пары» / «включая архив»;
 *  (в) несколько ОТКРЫТЫХ периодов на базе у одной машины (должен быть один);
 *  (г) симуляция детерминированных ID (период = vehicleId_type_startDate;
 *      этап = departureId_stageType_date_seq; событие = periodId_date_type_hash):
 *      у скольких записей не хватает полей и сколько было бы коллизий.
 *
 * Архив сканируется обязательно (по ТЗ); тестовые записи параллельных агентов
 * (id/автор/заметка «probe») в отчёте помечаются и даются отдельные числа.
 * Персональные данные (ФИО водителей) в отчёт НЕ выгружаются — только номера
 * машин, даты и id записей.
 *
 * Запуск
 *   npx tsx scripts/audit-timeline-dups.ts                # текст + JSON в tl-dups/
 *   npx tsx scripts/audit-timeline-dups.ts --json         # только машинный JSON
 *   npx tsx scripts/audit-timeline-dups.ts --out=DIR      # свой каталог отчётов
 *   npx tsx scripts/audit-timeline-dups.ts --limit=20     # примеров на таблицу
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb } from '../firebaseAdmin.ts';
import {
  classifyPair,
  classifyRepairPlacement,
  collisionsOf,
  dateFormatOf,
  eventKeySim,
  looksProbe,
  normText,
  normPhone,
  parseLooseDate,
  periodKeySim,
  stageKeySim,
  vehicleKey,
  type IntervalRef,
  type PairVerdict,
  type RepairPlacement,
} from './tl-audit-core.ts';

const ARGS = process.argv.slice(2);
const JSON_ONLY = ARGS.includes('--json');
const OUT_DIR = (ARGS.find((a) => a.startsWith('--out=')) || '').split('=')[1] || '/Users/sergei/.hermes/cache/scratch/tl-dups';
const LIMIT = Math.max(1, Number((ARGS.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 10);

const s = (v: unknown): string => String(v ?? '');
const objArr = (raw: unknown): Array<Record<string, unknown>> =>
  raw && typeof raw === 'object' ? (Object.values(raw as Record<string, unknown>) as Array<Record<string, unknown>>).filter((v) => v && typeof v === 'object') : [];

interface RecEntry {
  key: string;
  rec: Record<string, unknown>;
}

const entriesOf = (raw: unknown): RecEntry[] =>
  raw && typeof raw === 'object'
    ? Object.entries(raw as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([key, v]) => ({ key, rec: v as Record<string, unknown> }))
    : [];

interface TripRow {
  id: string;
  carNumber: string;
  carKey: string;
  startIso: string;
  endIso: string;
  startDay: number | null;
  endDay: number | null;
  archived: boolean;
  probe: boolean;
  direction: string;
  note: string;
  hidden: boolean;
  duplicateOf: string;
}

interface BazaRow {
  id: string;
  carNumber: string;
  carKey: string;
  status: string;
  arrivalIso: string;
  departureIso: string;
  arrivalDay: number | null;
  departureDay: number | null;
  repairStartIso: string;
  repairEndIso: string;
  repairStartDay: number | null;
  repairEndDay: number | null;
  hiddenKey: string;
  archived: boolean;
  probe: boolean;
  driverKey: string;
  phoneKey: string;
  comment: string;
  carId: string;
  couplingId: string;
}

interface StageRow {
  store: string;
  tripId: string;
  id: string;
  type: string;
  label: string;
  plannedIso: string;
  actualIso: string;
  order: number | null;
  seq: number | null;
  /** Позиция в массиве этапов СВОЕГО хранилища (1-based) — миграционный фолбэк seq. */
  posInStore: number;
  bufferDays: number | null;
}

interface EventRow {
  periodId: string;
  id: string;
  dateIso: string;
  type: string;
  text: string;
  author: string;
  seq: number | null;
  probe: boolean;
}

interface PairRow {
  carNumber: string;
  kind: 'trip-trip' | 'trip-base' | 'base-base' | 'repair-trip' | 'repair-base';
  verdict: PairVerdict;
  overlapDays: number | null;
  a: { id: string; span: string; archived: boolean; probe: boolean };
  b: { id: string; span: string; archived: boolean; probe: boolean };
  anyProbe: boolean;
  anyArchived: boolean;
}

const isoOfDay = (d: number | null): string => (d == null ? '' : new Date(d * 86400000).toISOString().slice(0, 10));

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[audit-timeline-dups] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }
  const takenAt = new Date().toISOString();
  const [tripsSnap, bazaSnap, stagesSnap, ttTripsSnap] = await Promise.all([
    adminDb.ref('trips_dashboard').get(),
    adminDb.ref('baza').get(),
    adminDb.ref('tripTimeline/tripStages').get(),
    adminDb.ref('tripTimeline/trips').get(),
  ]);

  // ── строки рейсов ────────────────────────────────────────────────────────
  const trips: TripRow[] = entriesOf(tripsSnap.val()).map(({ key, rec }) => {
    const start = parseLooseDate(rec.dateStart);
    const end = parseLooseDate(rec.dateEnd);
    const id = s(rec.id) || key;
    const note = s(rec.tripNote);
    return {
      id,
      carNumber: s(rec.carNumber),
      carKey: vehicleKey(rec.carNumber),
      startIso: start?.iso ?? '',
      endIso: end?.iso ?? '',
      startDay: start?.day ?? null,
      endDay: end?.day ?? null,
      archived: rec.isArchived === true,
      probe: looksProbe([id, note, rec.createdBy]),
      direction: s(rec.direction),
      note,
      hidden: rec.hiddenFromTimeline === true,
      duplicateOf: s(rec.duplicateOf),
    };
  });

  // ── строки периодов базы ────────────────────────────────────────────────
  const baza: BazaRow[] = entriesOf(bazaSnap.val()).map(({ key, rec }) => {
    const arrival = parseLooseDate(rec.dateArrival);
    const departure = parseLooseDate(rec.dateDeparture);
    const rs = parseLooseDate(rec.dateRepairStart);
    const re = parseLooseDate(rec.dateRepairEnd);
    const id = s(rec.id) || key;
    const driver = normText(rec.driverNameRu) || normText(rec.driverName) || normText(rec.driverRaw) || normText(rec.driverShortNameRu);
    return {
      id,
      carNumber: s(rec.carNumber),
      carKey: vehicleKey(rec.carNumber),
      status: s(rec.status),
      arrivalIso: arrival?.iso ?? '',
      departureIso: departure?.iso ?? '',
      arrivalDay: arrival?.day ?? null,
      departureDay: departure?.day ?? null,
      repairStartIso: rs?.iso ?? '',
      repairEndIso: re?.iso ?? '',
      repairStartDay: rs?.day ?? null,
      repairEndDay: re?.day ?? null,
      hiddenKey: key,
      archived: rec.isArchived === true || s(rec.status) === 'archive',
      probe: looksProbe([key, id, rec.comment]),
      driverKey: driver,
      phoneKey: normPhone(rec.phone ?? rec.driverPhone),
      comment: normText(rec.comment),
      carId: s(rec.carId || rec.couplingId || ''),
      couplingId: s(rec.couplingId),
    };
  });

  // ── этапы ────────────────────────────────────────────────────────────────
  const stages: StageRow[] = [];
  const stageStores = new Map<string, number>();
  const stageStoresList: Array<{ store: string; tripId: string; raw: unknown }> = entriesOf(stagesSnap.val()).map(({ key, rec }) => ({ store: `plan:${key}`, tripId: key, raw: rec }));
  entriesOf(ttTripsSnap.val()).forEach(({ key, rec }) => stageStoresList.push({ store: `manual:${key}`, tripId: key, raw: rec.stages }));
  stageStoresList.forEach(({ store, tripId, raw }) => {
    const list = Array.isArray(raw) ? raw : objArr(raw);
    stageStores.set(store, list.length);
    list.forEach((st, i) => {
      stages.push({
        store,
        tripId,
        id: s(st.id) || `${tripId}~${i + 1}`,
        type: s(st.type),
        label: s(st.label),
        plannedIso: parseLooseDate(st.plannedDate)?.iso ?? '',
        actualIso: parseLooseDate(st.actualDate)?.iso ?? '',
        order: Number.isFinite(Number(st.order)) ? Math.floor(Number(st.order)) : null,
        seq: Number.isFinite(Number(st.seq)) && Number(st.seq) >= 1 ? Math.floor(Number(st.seq)) : null,
        posInStore: i + 1,
        bufferDays: Number.isFinite(Number(st.bufferDays)) ? Number(st.bufferDays) : null,
      });
    });
  });

  // ── события ─────────────────────────────────────────────────────────────
  const events: EventRow[] = [];
  entriesOf(bazaSnap.val()).forEach(({ key, rec }) => {
    objArr(rec.events).forEach((ev) => {
      const id = s(ev.id) || key;
      events.push({
        periodId: key,
        id,
        dateIso: parseLooseDate(ev.date)?.iso ?? s(ev.date).slice(0, 10),
        type: s(ev.type),
        text: s(ev.text),
        author: s(ev.author),
        seq: Number.isFinite(Number(ev.seq)) ? Math.floor(Number(ev.seq)) : null,
        probe: looksProbe([key, id, ev.author]),
      });
    });
  });

  const probeCounts = {
    trips: trips.filter((t) => t.probe).length,
    baza: baza.filter((b) => b.probe).length,
    stages: stages.filter((st) => looksProbe([st.store, st.id])).length,
    events: events.filter((e) => e.probe).length,
  };

  // ── форматы дат (эвиденс) ────────────────────────────────────────────────
  const fmtDist = (list: Array<Record<string, unknown>>, field: string): Record<string, number> => {
    const m: Record<string, number> = {};
    list.forEach((r) => { const k = dateFormatOf(r[field]); m[k] = (m[k] || 0) + 1; });
    return m;
  };
  const raws = { trips: entriesOf(tripsSnap.val()).map((e) => e.rec), baza: entriesOf(bazaSnap.val()).map((e) => e.rec) };
  const dateFormats = {
    trip_dateStart: fmtDist(raws.trips, 'dateStart'),
    trip_dateEnd: fmtDist(raws.trips, 'dateEnd'),
    baza_dateArrival: fmtDist(raws.baza, 'dateArrival'),
    baza_dateDeparture: fmtDist(raws.baza, 'dateDeparture'),
  };

  // ═══ (а) ДУБЛИ ══════════════════════════════════════════════════════════
  // Периоды: одна машина + тип(status) + дата начала.
  const periodsExact = collisionsOf(
    baza.filter((b) => b.arrivalIso),
    (b) => `${b.carKey}|${b.status || '(пусто)'}|${b.arrivalIso}`,
  );

  // Периоды рядом: та же машина, старт ±1 день (или тот же старт при разных типах).
  const periodsNear: Array<{ a: BazaRow; b: BazaRow; startDiff: number; sameDriver: boolean; samePhone: boolean; sameComment: boolean; sameCar: boolean }> = [];
  const byCarBaza = new Map<string, BazaRow[]>();
  baza.forEach((b) => { if (b.carKey) byCarBaza.set(b.carKey, [...(byCarBaza.get(b.carKey) || []), b]); });
  byCarBaza.forEach((list) => {
    const withStart = list.filter((b) => b.arrivalDay != null).sort((x, y) => (x.arrivalDay ?? 0) - (y.arrivalDay ?? 0));
    for (let i = 0; i < withStart.length; i += 1) {
      for (let j = i + 1; j < withStart.length; j += 1) {
        const diff = Math.abs((withStart[i].arrivalDay ?? 0) - (withStart[j].arrivalDay ?? 0));
        if (diff > 1) break;
        periodsNear.push({
          a: withStart[i], b: withStart[j], startDiff: diff,
          sameDriver: !!withStart[i].driverKey && withStart[i].driverKey === withStart[j].driverKey,
          samePhone: !!withStart[i].phoneKey && withStart[i].phoneKey === withStart[j].phoneKey,
          sameComment: !!withStart[i].comment && withStart[i].comment === withStart[j].comment,
          sameCar: withStart[i].carNumber === withStart[j].carNumber,
        });
      }
    }
  });
  /** Поля телефона в текущих записях baza нет — сравнение телефонов вырождается в «нет данных». */
  const phoneFieldPresent = baza.some((b) => !!b.phoneKey);

  // Рейсы: та же машина + дата старта. (±1 день — отдельным списком.)
  const tripsExact = collisionsOf(trips.filter((t) => t.startIso), (t) => `${t.carKey}|${t.startIso}`);
  const tripsNear: Array<{ a: TripRow; b: TripRow; startDiff: number }> = [];
  const byCarTrips = new Map<string, TripRow[]>();
  trips.forEach((t) => { if (t.carKey) byCarTrips.set(t.carKey, [...(byCarTrips.get(t.carKey) || []), t]); });
  byCarTrips.forEach((list) => {
    const withStart = list.filter((t) => t.startDay != null).sort((x, y) => (x.startDay ?? 0) - (y.startDay ?? 0));
    for (let i = 0; i < withStart.length; i += 1) {
      for (let j = i + 1; j < withStart.length; j += 1) {
        const diff = Math.abs((withStart[i].startDay ?? 0) - (withStart[j].startDay ?? 0));
        if (diff > 1) break;
        tripsNear.push({ a: withStart[i], b: withStart[j], startDiff: diff });
      }
    }
  });
  const tripsHidden = trips.filter((t) => t.hidden || t.duplicateOf).map((t) => ({ id: t.id, carNumber: t.carNumber, start: t.startIso, duplicateOf: t.duplicateOf }));

  // Этапы: одинаковые (рейс, тип, дата, label). Дата — плановая (фолбэк — факт).
  const stageDate = (st: StageRow): string => st.plannedIso || st.actualIso;
  const stagesExact = collisionsOf(
    stages.filter((st) => stageDate(st)),
    (st) => `${st.tripId}|${st.type}|${stageDate(st)}|${normText(st.label)}`,
  );
  const stagesSameDateDiffLabel = collisionsOf(
    stages.filter((st) => stageDate(st)),
    (st) => `${st.tripId}|${st.type}|${stageDate(st)}`,
  ).filter((g) => g.items.length > 1);

  // События: одинаковые (период, дата, тип, текст).
  const eventsExact = collisionsOf(
    events.filter((e) => e.dateIso),
    (e) => `${e.periodId}|${e.dateIso}|${e.type}|${normText(e.text)}`,
  );

  // ═══ (б) ПЕРЕСЕЧЕНИЯ ════════════════════════════════════════════════════
  const tripInterval = (t: TripRow): IntervalRef => ({
    id: t.id, branch: 'trips_dashboard', kind: 'trip', carNumber: t.carNumber, carKey: t.carKey,
    startDay: t.startDay, endDay: t.endDay, openEnd: t.endDay == null, archived: t.archived, probe: t.probe,
    label: `рейс ${t.direction || '—'}`,
  });
  const baseInterval = (b: BazaRow): IntervalRef => ({
    id: b.id, branch: 'baza', kind: 'base', carNumber: b.carNumber, carKey: b.carKey,
    startDay: b.arrivalDay, endDay: b.departureDay, openEnd: b.departureDay == null, archived: b.archived, probe: b.probe,
    label: `учёт (${b.status || 'без статуса'})`,
  });

  const allIntervals: IntervalRef[] = [...trips.map(tripInterval), ...baza.map(baseInterval)];
  const byCarAll = new Map<string, IntervalRef[]>();
  allIntervals.forEach((iv) => { if (iv.carKey) byCarAll.set(iv.carKey, [...(byCarAll.get(iv.carKey) || []), iv]); });

  const pairRows: PairRow[] = [];
  let pairsChecked = 0;
  let pairsNoStart = 0;
  byCarAll.forEach((list) => {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.branch === b.branch && a.id === b.id) continue;
        pairsChecked += 1;
        const cl = classifyPair(a, b);
        if (cl.verdict === 'no-start') { pairsNoStart += 1; continue; }
        if (cl.verdict === 'none') continue;
        const kind: PairRow['kind'] = a.kind === 'trip' && b.kind === 'trip' ? 'trip-trip' : a.kind === 'base' && b.kind === 'base' ? 'base-base' : 'trip-base';
        pairRows.push({
          carNumber: a.carNumber || b.carNumber,
          kind,
          verdict: cl.verdict,
          overlapDays: cl.overlapDays,
          a: { id: a.id, span: `${isoOfDay(a.startDay) || '??'}..${isoOfDay(a.endDay) || '∞'}`, archived: a.archived, probe: a.probe },
          b: { id: b.id, span: `${isoOfDay(b.startDay) || '??'}..${isoOfDay(b.endDay) || '∞'}`, archived: b.archived, probe: b.probe },
          anyProbe: a.probe || b.probe,
          anyArchived: a.archived || b.archived,
        });
      }
    }
  });

  const conflicts = pairRows.filter((p) => p.verdict === 'conflict');
  const styks = pairRows.filter((p) => p.verdict === 'styk');
  const summarizePairs = (list: PairRow[]) => ({
    all: list.length,
    livePairs: list.filter((p) => !p.anyArchived).length,
    nonProbe: list.filter((p) => !p.anyProbe).length,
    liveNonProbe: list.filter((p) => !p.anyArchived && !p.anyProbe).length,
    byKind: list.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {} as Record<string, number>),
  });

  // Ремонт × чужие записи машины (свой период исключён — это штатное вложение).
  const repairPairs: PairRow[] = [];
  baza.forEach((b) => {
    if (b.repairStartDay == null) return;
    const repairIv: IntervalRef = {
      id: `${b.id}~repair`, branch: 'baza', kind: 'base', carNumber: b.carNumber, carKey: b.carKey,
      startDay: b.repairStartDay, endDay: b.repairEndDay, openEnd: b.repairEndDay == null, archived: b.archived, probe: b.probe,
      label: 'ремонт',
    };
    (byCarAll.get(b.carKey) || []).forEach((other) => {
      if (other.branch === 'baza' && other.id === b.id) return; // свой период базы
      const cl = classifyPair(repairIv, other);
      if (cl.verdict !== 'conflict' && cl.verdict !== 'styk') return;
      repairPairs.push({
        carNumber: b.carNumber,
        kind: other.kind === 'trip' ? 'repair-trip' : 'repair-base',
        verdict: cl.verdict,
        overlapDays: cl.overlapDays,
        a: { id: `${b.id}~repair`, span: `${b.repairStartIso}..${b.repairEndIso || '∞'}`, archived: b.archived, probe: b.probe },
        b: { id: other.id, span: `${isoOfDay(other.startDay) || '??'}..${isoOfDay(other.endDay) || '∞'}`, archived: other.archived, probe: other.probe },
        anyProbe: b.probe || other.probe,
        anyArchived: b.archived || other.archived,
      });
    });
  });

  // Фактические сочетания ремонта со СВОИМ периодом (ремонт внутри — штатно).
  const repairCombos: Record<RepairPlacement, number> = {
    'no-repair': 0, 'inside-own-base': 0, 'open-repair': 0, 'capped-by-departure': 0,
    'end-without-start': 0, 'before-arrival': 0, 'after-departure': 0,
  };
  const repairExamples: Record<string, Array<{ id: string; carNumber: string; arrival: string; departure: string; repairStart: string; repairEnd: string }>> = {};
  baza.forEach((b) => {
    const place = classifyRepairPlacement(b.arrivalDay, b.departureDay, b.repairStartDay, b.repairEndDay);
    repairCombos[place] += 1;
    if (place !== 'no-repair' && place !== 'inside-own-base') {
      const ex = (repairExamples[place] ||= []);
      if (ex.length < LIMIT) ex.push({ id: b.id, carNumber: b.carNumber, arrival: b.arrivalIso, departure: b.departureIso, repairStart: b.repairStartIso, repairEnd: b.repairEndIso });
    }
  });

  // ═══ (в) НЕСКОЛЬКО ОТКРЫТЫХ ПЕРИОДОВ НА БАЗЕ ═══════════════════════════
  const openBaza = baza.filter((b) => b.departureDay == null);
  const openActive = openBaza.filter((b) => !b.archived);
  const openActiveNonProbe = openActive.filter((b) => !b.probe);
  const openByCar = new Map<string, BazaRow[]>();
  openActive.forEach((b) => { if (b.carKey) openByCar.set(b.carKey, [...(openByCar.get(b.carKey) || []), b]); });
  const openViolations = [...openByCar.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([carKey, list]) => ({
      carKey,
      carNumber: list[0].carNumber,
      items: list.map((b) => ({ id: b.id, arrival: b.arrivalIso, status: b.status, probe: b.probe })),
      nonProbe: list.filter((b) => !b.probe).length,
    }));
  const openNoDates = openActive.filter((b) => b.arrivalDay == null).map((b) => ({ id: b.id, carNumber: b.carNumber, status: b.status, probe: b.probe }));

  // ═══ (г) ДЕТЕРМИНИРОВАННЫЕ ID — СИМУЛЯЦИЯ ══════════════════════════════
  const periodMissing = {
    /** Нет vehicleId: ни carId, ни couplingId, ни номера машины. */
    vehicleId: baza.filter((b) => !b.carId && !b.couplingId && !b.carKey).length,
    /** Нет типа (status пуст). */
    type: baza.filter((b) => !b.status).length,
    /** Нет даты начала (dateArrival пуст/битая). */
    start: baza.filter((b) => !b.arrivalIso).length,
  };
  const periodKeyed = baza.map((b) => ({ b, key: periodKeySim(b.carId || b.couplingId || b.carKey, b.status || 'base', b.arrivalIso) }));
  const periodCollisions = collisionsOf(periodKeyed.filter((x) => x.key != null), (x) => x.key).map((g) => ({
    key: g.key, items: g.items.map((x) => ({ id: x.b.id, carNumber: x.b.carNumber, arrival: x.b.arrivalIso, status: x.b.status, probe: x.b.probe })),
  }));
  const vehicleIdSource = {
    carId: baza.filter((b) => b.carId && s(b.carId) === s(b.id)).length,
    couplingId: baza.filter((b) => !b.carId && b.couplingId).length,
    carNumberFallback: baza.filter((b) => !b.carId && !b.couplingId && b.carKey).length,
  };

  const stageMissing = {
    /** Нет собственного seq (в схеме ТЗ seq обязателен — понадобится миграционный порядок). */
    ownSeq: stages.filter((st) => st.seq == null).length,
    type: stages.filter((st) => !st.type).length,
    date: stages.filter((st) => !st.plannedIso && !st.actualIso).length,
    label: stages.filter((st) => !st.label).length,
  };
  const stageKeyed = stages.map((st) => ({
    st,
    // Миграционный фолбэк seq — как читает приложение: seq → order → позиция в своём хранилище.
    key: stageKeySim(st.tripId, st.type, stageDate(st), st.seq ?? st.order ?? st.posInStore),
  }));
  const stageCollisions = collisionsOf(stageKeyed.filter((x) => x.key != null), (x) => x.key).map((g) => ({
    key: g.key,
    items: g.items.map((x) => ({ store: x.st.store, id: x.st.id, type: x.st.type, date: stageDate(x.st), label: x.st.label, seq: x.st.seq, order: x.st.order })),
  }));
  // Дубли seq внутри одного рейса (для схемы с seq это первейший источник коллизий ключа).
  const seqDupWithinTrip = collisionsOf(
    stages.filter((st) => st.seq != null),
    (st) => `${st.tripId}|${st.seq}`,
  ).map((g) => ({ key: g.key, ids: g.items.map((st) => st.id) }));

  const eventMissing = {
    date: events.filter((e) => !e.dateIso).length,
    type: events.filter((e) => !e.type).length,
    text: events.filter((e) => !e.text).length,
  };
  const eventKeyed = events.map((e) => ({ e, key: eventKeySim(e.periodId, e.dateIso, e.type, e.text) }));
  const eventCollisions = collisionsOf(eventKeyed.filter((x) => x.key != null), (x) => x.key).map((g) => ({
    key: g.key,
    items: g.items.map((x) => ({ periodId: x.e.periodId, id: x.e.id, date: x.e.dateIso, type: x.e.type, text: x.e.text, probe: x.e.probe })),
  }));

  // ═══ JSON ОТЧЁТ ═════════════════════════════════════════════════════════
  const report = {
    takenAt,
    mode: 'dry-run (read-only)',
    rule: 'пересечение: s <= e0 && e >= s0 (дни включительно); 1 общий день = стык (разрешён); открытый конец = +∞',
    counts: {
      trips: { total: trips.length, archived: trips.filter((t) => t.archived).length, probe: probeCounts.trips, noStart: trips.filter((t) => t.startDay == null).length, openEnd: trips.filter((t) => t.endDay == null).length },
      baza: { total: baza.length, archived: baza.filter((b) => b.archived).length, probe: probeCounts.baza, noArrival: baza.filter((b) => b.arrivalDay == null).length, open: openBaza.length, openActive: openActive.length, openActiveNonProbe: openActiveNonProbe.length },
      stages: { total: stages.length, stores: stageStoresList.length, storesWithStages: [...stageStores.values()].filter((n) => n > 0).length, probe: probeCounts.stages },
      events: { total: events.length, periodsWithEvents: new Set(events.map((e) => e.periodId)).size, probe: probeCounts.events },
    },
    dateFormats,
    duplicates: {
      periodsExact: periodsExact.map((g) => ({ key: g.key, items: g.items.map((b) => ({ id: b.id, carNumber: b.carNumber, status: b.status, arrival: b.arrivalIso, departure: b.departureIso, archived: b.archived, probe: b.probe })) })),
      periodsNear: periodsNear.map((p) => ({ a: p.a.id, b: p.b.id, carNumber: p.a.carNumber, startDiff: p.startDiff, sameDriver: p.sameDriver, samePhone: p.samePhone, sameComment: p.sameComment })),
      periodsNearNote: phoneFieldPresent ? null : 'поля телефона в записях baza нет — сравнение телефона недоступно',
      periodsWithoutStart: baza.filter((b) => b.arrivalDay == null).map((b) => ({ id: b.id, carNumber: b.carNumber, status: b.status, probe: b.probe })),
      tripsExact: tripsExact.map((g) => ({ key: g.key, items: g.items.map((t) => ({ id: t.id, carNumber: t.carNumber, start: t.startIso, end: t.endIso, direction: t.direction, archived: t.archived, probe: t.probe })) })),
      tripsNear: tripsNear.map((p) => ({ a: p.a.id, b: p.b.id, carNumber: p.a.carNumber, startDiff: p.startDiff })),
      tripsHidden,
      stagesExact: stagesExact.map((g) => ({ key: g.key, items: g.items.map((st) => ({ store: st.store, id: st.id, type: st.type, date: stageDate(st), label: st.label, seq: st.seq, order: st.order })) })),
      stagesSameDateDiffLabel: stagesSameDateDiffLabel.map((g) => ({ key: g.key, ids: g.items.map((st) => st.id), labels: g.items.map((st) => st.label) })),
      eventsExact: eventsExact.map((g) => ({ key: g.key, items: g.items.map((e) => ({ id: e.id, periodId: e.periodId, date: e.dateIso, type: e.type, text: e.text, probe: e.probe })) })),
    },
    overlaps: {
      pairsChecked,
      pairsSkippedNoStart: pairsNoStart,
      conflicts: summarizePairs(conflicts),
      styks: summarizePairs(styks),
      conflictExamples: conflicts
        .sort((a, b) => ((b.overlapDays ?? 99999) - (a.overlapDays ?? 99999)) || a.carNumber.localeCompare(b.carNumber))
        .slice(0, LIMIT),
      stykExamples: styks.sort((a, b) => a.a.span.localeCompare(b.a.span)).slice(0, LIMIT),
      repairVsOthers: {
        conflicts: summarizePairs(repairPairs.filter((p) => p.verdict === 'conflict')),
        styks: summarizePairs(repairPairs.filter((p) => p.verdict === 'styk')),
        examples: repairPairs.slice(0, LIMIT),
      },
    },
    repairCombos: { counts: repairCombos, examples: repairExamples },
    openBasePerCar: {
      openActive: openActive.length,
      openActiveNonProbe: openActiveNonProbe.length,
      carsWithOpen: openByCar.size,
      violations: openViolations,
      violationsNonProbe: openViolations.filter((v) => v.nonProbe > 1).length,
      openWithoutArrival: openNoDates,
    },
    deterministicIds: {
      note: 'симуляция без записи; хэш текста события — FNV-1a (функция владельцем не зафиксирована)',
      period: {
        scheme: 'vehicleId_type_startDate',
        total: baza.length,
        missing: periodMissing,
        vehicleIdSource,
        keysGenerated: periodKeyed.filter((x) => x.key != null).length,
        collisions: periodCollisions,
        collisionCount: periodCollisions.length,
      },
      stage: {
        scheme: 'departureId_stageType_date_seq',
        total: stages.length,
        missing: stageMissing,
        keysGenerated: stageKeyed.filter((x) => x.key != null).length,
        collisions: stageCollisions,
        collisionCount: stageCollisions.length,
        /** Дубли seq внутри рейса (до коллизий ключа доходит, только если совпадут и дата/тип). */
        seqDupWithinTrip,
      },
      event: {
        scheme: 'periodId_date_type_hash(text)',
        total: events.length,
        missing: eventMissing,
        keysGenerated: eventKeyed.filter((x) => x.key != null).length,
        collisions: eventCollisions,
        collisionCount: eventCollisions.length,
      },
    },
    privacy: 'ФИО водителей в отчёт не выгружаются; номера машин и даты — можно (ТЗ).',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = takenAt.replace(/[:.]/g, '-');
  const file = join(OUT_DIR, `audit-timeline-dups-${stamp}.json`);
  const latest = join(OUT_DIR, 'audit-timeline-dups.latest.json');
  const json = JSON.stringify(report, null, 1);
  writeFileSync(file, json + '\n');
  writeFileSync(latest, json + '\n');

  if (JSON_ONLY) {
    console.log(json);
    return 0;
  }

  // ═══ ТЕКСТОВЫЙ ОТЧЁТ ════════════════════════════════════════════════════
  const L: string[] = [];
  const say = (line = ''): void => { L.push(line); };
  const pct = (n: number, d: number): string => (d ? ` (${Math.round((n / d) * 100)}%)` : '');
  say('=== АУДИТ ТАЙМЛАЙНА (dry-run, только чтение) ===');
  say(`снято: ${takenAt}; JSON: ${file}`);
  say('');
  say(`Записи: рейсы trips_dashboard ${trips.length} (архив ${report.counts.trips.archived}, пробные ${probeCounts.trips}); база ${baza.length} (архив ${report.counts.baza.archived}, пробные ${probeCounts.baza}); этапов ${stages.length} в ${stageStoresList.length} хранилищах (пробные ${probeCounts.stages}); событий ${events.length} (пробные ${probeCounts.events}).`);
  say(`Форматы дат: dateStart ${JSON.stringify(dateFormats.trip_dateStart)}; dateEnd ${JSON.stringify(dateFormats.trip_dateEnd)}; учёт dateArrival ${JSON.stringify(dateFormats.baza_dateArrival)}.`);
  say('');
  say('── (а) ДУБЛИ ──────────────────────────────────────────────');
  say(`1) Периоды базы с одинаковыми (машина, тип, дата начала): групп ${periodsExact.length}, всего записей в них ${periodsExact.reduce((n, g) => n + g.items.length, 0)}.`);
  periodsExact.slice(0, LIMIT).forEach((g) => say(`   · ${g.items[0].carNumber} ${g.items.map((i) => `[${i.id} ${i.arrivalIso}${i.status ? ' ' + i.status : ''}${i.archived ? ' архив' : ''}${i.probe ? ' probe' : ''}]`).join(' ')}`));
  if (periodsExact.length > LIMIT) say(`   … ещё ${periodsExact.length - LIMIT}`);
  const noStartBaza = baza.filter((b) => b.arrivalDay == null);
  if (noStartBaza.length) say(`   (без даты начала — в группы не входят: ${noStartBaza.map((b) => `${b.carNumber} [${b.id}${b.status ? ' ' + b.status : ''}]`).join('; ')})`);
  say(`2) Периоды рядом (машина та же, старт ±1 день): пар ${periodsNear.length}${pct(periodsNear.filter((p) => p.startDiff === 0).length, periodsNear.length)} с точным совпадением; с тем же водителем ${periodsNear.filter((p) => p.sameDriver).length}, с тем же комментарием ${periodsNear.filter((p) => p.sameComment).length}${phoneFieldPresent ? `, с тем же телефоном ${periodsNear.filter((p) => p.samePhone).length}` : ' (телефон: поля в данных нет — сравнение недоступно)'}.`);
  periodsNear.slice(0, LIMIT).forEach((p) => say(`   · ${p.a.carNumber} [${p.a.id} ${p.a.arrivalIso}] ↔ [${p.b.id} ${p.b.arrivalIso}] Δ${p.startDiff}д${p.sameDriver ? ' · водитель совпал' : ''}${p.sameComment ? ' · комментарий совпал' : ''}`));
  if (periodsNear.length > LIMIT) say(`   … ещё ${periodsNear.length - LIMIT}`);
  say(`3) Рейсы с одинаковыми (машина, дата старта): групп ${tripsExact.length}; рядом (±1 день): пар ${tripsNear.length}. Скрытые дубли (hiddenFromTimeline/duplicateOf): ${tripsHidden.length}.`);
  tripsExact.slice(0, LIMIT).forEach((g) => say(`   · ${g.items[0].carNumber} ${g.items.map((i) => `[${i.id} ${i.startIso}→${i.endIso || '∞'}${i.archived ? ' архив' : ''}]`).join(' ')}`));
  say(`4) Этапы с одинаковыми (рейс, тип, дата, label): групп ${stagesExact.length}, записей ${stagesExact.reduce((n, g) => n + g.items.length, 0)}; та же (рейс, тип, дата) с разными label: групп ${stagesSameDateDiffLabel.length} (возможные не-дубли — проверить глазами).`);
  stagesExact.slice(0, LIMIT).forEach((g) => say(`   · ${g.key} → ${g.items.map((st) => st.id).join(', ')}`));
  say(`5) События с одинаковыми (период, дата, тип, текст): групп ${eventsExact.length}, событий ${eventsExact.reduce((n, g) => n + g.items.length, 0)}.`);
  eventsExact.slice(0, LIMIT).forEach((g) => say(`   · ${g.key} → ${g.items.map((e) => e.id).join(', ')}`));
  say('');
  say('── (б) ПЕРЕСЕЧЕНИЯ ИНТЕРВАЛОВ (правило ТЗ) ────────────────');
  say(`Проверено пар одной машины: ${pairsChecked}; пропущено без даты начала: ${pairsNoStart}.`);
  const cs = report.overlaps.conflicts;
  const ss = report.overlaps.styks;
  const kind = (m: Record<string, number>, k: string): number => m[k] ?? 0;
  say(`КОНФЛИКТЫ (>1 общего дня): ${cs.all} пар = рейс↔рейс ${kind(cs.byKind, 'trip-trip')}, рейс↔база ${kind(cs.byKind, 'trip-base')}, база↔база ${kind(cs.byKind, 'base-base')}. Из них обе записи живые: ${cs.livePairs}; без пробных записей: ${cs.nonProbe}; живые и не пробные: ${cs.liveNonProbe}.`);
  say(`СТЫКИ (ровно 1 общий день — разрешены): ${ss.all} пар = рейс↔рейс ${kind(ss.byKind, 'trip-trip')}, рейс↔база ${kind(ss.byKind, 'trip-base')}, база↔база ${kind(ss.byKind, 'base-base')}. Живых: ${ss.livePairs}; без пробных: ${ss.nonProbe}; живых без пробных: ${ss.liveNonProbe}.`);
  report.overlaps.conflictExamples.forEach((p) => say(`   КОНФЛИКТ ${p.kind} [${p.carNumber}] ${p.a.span} (${p.a.id}${p.a.archived ? ', архив' : ''}${p.a.probe ? ', probe' : ''}) ↔ ${p.b.span} (${p.b.id}${p.b.archived ? ', архив' : ''}${p.b.probe ? ', probe' : ''}) — ${p.overlapDays == null ? 'оба открыты' : p.overlapDays + ' дн'}`));
  report.overlaps.stykExamples.forEach((p) => say(`   стык ${p.kind} [${p.carNumber}] ${p.a.span} (${p.a.id}) ↔ ${p.b.span} (${p.b.id})`));
  const rv = report.overlaps.repairVsOthers;
  say(`Ремонт × другие записи машины (свой период исключён): конфликтов ${rv.conflicts.all} (живых ${rv.conflicts.livePairs}, без пробных ${rv.conflicts.nonProbe}), стыков ${rv.styks.all}.`);
  rv.examples.slice(0, LIMIT).forEach((p) => say(`   ${p.verdict === 'conflict' ? 'КОНФЛИКТ' : 'стык'} ${p.kind} [${p.carNumber}] ${p.a.span} (${p.a.id}) ↔ ${p.b.span} (${p.b.id}) — ${p.overlapDays == null ? 'оба открыты' : p.overlapDays + ' дн'}`));
  say(`Сочетания ремонта со СВОИМ периодом: внутри базы ${repairCombos['inside-own-base']}, открытый ремонт ${repairCombos['open-repair']}, до выезда (без конца) ${repairCombos['capped-by-departure']}, конец без начала ${repairCombos['end-without-start']}, раньше приезда ${repairCombos['before-arrival']}, позже выезда ${repairCombos['after-departure']} — ремонт внутри базы штатен.`);
  Object.entries(repairExamples).forEach(([place, list]) => list.forEach((e) => say(`   ${place}: ${e.carNumber} ${e.arrival}→${e.departure || '∞'} ремонт ${e.repairStart}→${e.repairEnd || '∞'} (${e.id})`)));
  say('');
  say('── (в) ОТКРЫТЫЕ ПЕРИОДЫ НА БАЗЕ ───────────────────────────');
  say(`Открытых всего ${openBaza.length}; из них живых (не архив) ${openActive.length}, живых без пробных ${openActiveNonProbe.length}. Машин с открытым периодом: ${openByCar.size}.`);
  say(`НАРУШЕНИЙ «больше одного открытого у машины»: ${openViolations.length} машин (без пробных: ${openViolations.filter((v) => v.nonProbe > 1).length}).`);
  openViolations.forEach((v) => say(`   · ${v.carNumber} → ${v.items.map((i) => `[${i.id} с ${i.arrival}${i.status ? ' ' + i.status : ''}${i.probe ? ' probe' : ''}]`).join(' ')}`));
  say(`Открытые без даты приезда: ${openNoDates.length}${openNoDates.length ? ' — ' + openNoDates.map((o) => o.id).join(', ') : ''}.`);
  say('');
  say('── (г) ГОТОВНОСТЬ К ДЕТЕРМИНИРОВАННЫМ ID (симуляция) ──────');
  say(`Период = vehicleId_type_startDate: записей ${baza.length}; нет vehicleId (carId/couplingId/номер) ${periodMissing.vehicleId}; нет типа (status пуст) ${periodMissing.type}; нет даты начала ${periodMissing.start}; ключ собрался у ${report.deterministicIds.period.keysGenerated}. КОЛЛИЗИЙ: ${periodCollisions.length}.`);
  periodCollisions.slice(0, LIMIT).forEach((g) => say(`   · ${g.key} → ${g.items.map((i) => i.id).join(', ')}`));
  say(`Этап = departureId_stageType_date_seq: этапов ${stages.length}; без собственного seq ${stageMissing.ownSeq} (подставится order/позиция); без типа ${stageMissing.type}; без даты ${stageMissing.date}; ключ собрался у ${report.deterministicIds.stage.keysGenerated}. КОЛЛИЗИЙ: ${stageCollisions.length}; дублей seq внутри рейса: ${seqDupWithinTrip.length}.`);
  stageCollisions.slice(0, LIMIT).forEach((g) => say(`   · ${g.key} → ${g.items.map((i) => `${i.store}/${i.id}`).join(', ')}`));
  say(`Событие = periodId_date_type_hash(text): событий ${events.length}; без даты ${eventMissing.date}; без типа ${eventMissing.type}; без текста ${eventMissing.text}; ключ собрался у ${report.deterministicIds.event.keysGenerated}. КОЛЛИЗИЙ: ${eventCollisions.length}.`);
  eventCollisions.slice(0, LIMIT).forEach((g) => say(`   · ${g.key} → ${g.items.map((i) => i.id).join(', ')}`));
  say('');
  say(`[audit-timeline-dups] JSON записан: ${file} (и ${latest}). Записей в базу — 0 (dry-run).`);
  console.log(L.join('\n'));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[audit-timeline-dups] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
