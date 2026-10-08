/**
 * Чистая логика «Таймлайн рейсов по машинам» — порт прототипа truck-timeline.html
 * на TypeScript. Здесь нет React и обращений к базе: все функции вычислимые,
 * поэтому статус дедлайна можно переиспользовать во вне — например, из Cloud
 * Function для Telegram-уведомлений (см. getDeadlineStatus).
 *
 * Даты — строки YYYY-MM-DD (без времени и часовых поясов). День — число
 * (Unix-day: Date.UTC(y, m, d) / 86400000), как в прототипе.
 */
import type {
  TimelineStage,
  TimelineStageType,
  TimelineTrip,
  TimelineVehicleEvent,
} from '../../../../types';

export const DAY_MS = 86400000;

/** YYYY-MM-DD → номер дня (UTC). null для пустых/битых значений. */
export const dayNum = (s?: string | null): number | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const n = Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  return Number.isFinite(n) ? n : null;
};

/** Номер дня → YYYY-MM-DD. */
export const dayStr = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Сегодняшний день как номер (локальная дата пользователя). */
export const todayNum = (): number => {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
};

/** Сегодня как YYYY-MM-DD. */
export const todayStr = (): string => dayStr(todayNum());

/** +N дней к дате YYYY-MM-DD. */
export const addDaysStr = (iso: string, delta: number): string => {
  const n = dayNum(iso);
  return dayStr((n == null ? todayNum() : n) + delta);
};

/** ДД/ММ для коротких подписей. */
export const fmtDM = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const d = new Date(n * DAY_MS);
  return `${('0' + d.getUTCDate()).slice(-2)}/${('0' + (d.getUTCMonth() + 1)).slice(-2)}`;
};

/** ДД/ММ/ГГГГ — формат дат интерфейса портала. */
export const fmtFull = (iso?: string | null): string => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
};

/** Нормализация номера машины для сопоставления строк/записей. */
export const normPlate = (s?: string | null): string =>
  String(s || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');

export const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Метка дня в шапке таймлайна: «1 сен» для первого числа, иначе день. */
export const dayHeaderLabel = (n: number): string => {
  const d = new Date(n * DAY_MS);
  const day = d.getUTCDate();
  if (day === 1) return `1 ${MONTHS_RU[d.getUTCMonth()]}`;
  return String(day);
};

// ---------------------------------------------------------------------------
// Этапы и статус дедлайнов
// ---------------------------------------------------------------------------

/** Защитная нормализация этапов: RTDB может вернуть объект-map вместо массива. */
export const normalizeStages = (raw: unknown): TimelineStage[] => {
  const arr: TimelineStage[] = Array.isArray(raw)
    ? (raw as TimelineStage[])
    : raw && typeof raw === 'object'
      ? Object.keys(raw as Record<string, TimelineStage>).map((k) => ({ ...(raw as Record<string, TimelineStage>)[k], id: (raw as Record<string, TimelineStage>)[k]?.id || k }))
      : [];
  return arr
    .filter((s) => s && typeof s === 'object')
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
};

/**
 * Безопасный fallback для старых рейсов без этапов: один этап «Загрузка» по
 * датам рейса (startDate/dateStart). В базу не пишется — только отображение.
 */
export const withFallbackStages = (trip: TimelineTrip): TimelineTrip => {
  if (normalizeStages(trip.stages).length > 0) return trip;
  const extra = trip as TimelineTrip & { dateStart?: string; dateEnd?: string };
  const start = extra.startDate || extra.dateStart;
  if (!start) return trip;
  const stage: TimelineStage = {
    id: `${trip.id}-fallback-load`,
    type: 'load',
    label: '',
    plannedDate: start,
    actualDate: '',
    isCritical: false,
    reason: '',
    action: '',
    order: 1,
  };
  return { ...trip, stages: [stage] };
};

/** Отклонение факта от плана, дней: + позже, − раньше, null если нет пары. */
export const stageDeviation = (s: TimelineStage): number | null => {
  const p = dayNum(s.plannedDate);
  const f = dayNum(s.actualDate);
  return p != null && f != null ? f - p : null;
};

/** Этап просрочен: факт позже плана, или факта нет и план уже прошёл. */
export const isStageLate = (s: TimelineStage, today: number): boolean => {
  const dev = stageDeviation(s);
  if (dev != null && dev > 0) return true;
  const f = dayNum(s.actualDate);
  const p = dayNum(s.plannedDate);
  return f == null && p != null && today > p;
};

/** Все этапы с критическим сроком. */
export const criticalStages = (trip: TimelineTrip): TimelineStage[] =>
  trip.stages.filter((s) => s.isCritical);

export interface DeadlineStatus {
  /** 0 — критических этапов нет; 1 — в норме; 2 — под угрозой; 3 — нарушен. */
  level: 0 | 1 | 2 | 3;
  label: string;
}

/**
 * Статус рейса по критическим срокам. Точка расширения для уведомлений:
 * чистая функция от рейса и текущей даты — можно вызывать из Cloud Function.
 * `stageName` — необязательный маппинг имени этапа (в UI передаётся справочник
 * типов), по умолчанию уточнение или ключ типа.
 */
export const getDeadlineStatus = (
  trip: TimelineTrip,
  today: number,
  stageName?: (s: TimelineStage) => string,
): DeadlineStatus => {
  const nameOf = (s: TimelineStage): string => (stageName ? stageName(s) : s.label || s.type || 'этап');
  const dls = criticalStages(trip);
  if (!dls.length) return { level: 0, label: 'нет крит. срока' };
  let out: DeadlineStatus = { level: 1, label: 'в норме' };
  dls.forEach((s) => {
    const p = dayNum(s.plannedDate);
    const f = dayNum(s.actualDate);
    if (f != null) {
      if (p != null && f > p) out = { level: 3, label: `срок нарушен: ${nameOf(s)}` };
    } else if (p != null && today > p) {
      out = { level: 3, label: `срок нарушен: ${nameOf(s)}` };
    } else if (p != null && p - today <= 1) {
      if (out.level < 2) out = { level: 2, label: `под угрозой: ${nameOf(s)}` };
    }
  });
  return out;
};

/** Этапы с просрочкой (для статистики «просрочек без причины»). */
export const getLateStages = (trip: TimelineTrip, today: number): TimelineStage[] =>
  trip.stages.filter((s) => isStageLate(s, today));

/** Рейс завершён по факту: у ПОСЛЕДНЕГО этапа (по порядку) заполнена фактическая
 *  дата. Отсутствие данных не трактуется как завершение или задержка. */
export const tripFactEnd = (trip: TimelineTrip): number | null => {
  const stages = [...(trip.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!stages.length) return null;
  return dayNum(stages[stages.length - 1].actualDate);
};

/** Рейс начат (есть фактический старт), но фактически не завершён. */
export const isTripFactOngoing = (trip: TimelineTrip): boolean =>
  tripSpan(trip).fMin != null && tripFactEnd(trip) == null;

/** Рейс завершён по факту (в архив автоматически не уходит). */
export const isTripDone = (trip: TimelineTrip): boolean => tripFactEnd(trip) != null;

export interface TripSpan {
  pMin: number | null;
  pMax: number | null;
  fMin: number | null;
  fMax: number | null;
}

/** Переопределение плановых границ (рейс из «Плана дохода»: границы живут в
 *  источнике, а не в этапах). Не меняет ручные рейсы. */
export interface SpanOverride {
  pMin?: number | null;
  pMax?: number | null;
}

const spanOverrideOf = (trip: unknown): SpanOverride | null => {
  const ov = (trip as { spanOverride?: SpanOverride } | null)?.spanOverride;
  return ov && typeof ov === 'object' ? ov : null;
};

/** Диапазоны рейса по плановым и фактическим датам этапов (+ переопределение
 *  плановых границ из внешнего источника, если он есть). */
export const tripSpan = (trip: TimelineTrip): TripSpan => {
  const ps = trip.stages.map((s) => dayNum(s.plannedDate)).filter((v): v is number => v != null);
  const fs = trip.stages.map((s) => dayNum(s.actualDate)).filter((v): v is number => v != null);
  const ov = spanOverrideOf(trip);
  const pMin = ov && ov.pMin != null ? ov.pMin : ps.length ? Math.min(...ps) : null;
  const pMax = ov && ov.pMax != null ? ov.pMax : ps.length ? Math.max(...ps) : null;
  return {
    pMin,
    pMax,
    fMin: fs.length ? Math.min(...fs) : null,
    fMax: fs.length ? Math.max(...fs) : null,
  };
};

/** Начало рейса: минимум по плану и факту. */
export const tripStart = (trip: TimelineTrip): number | null => {
  const s = tripSpan(trip);
  const list = [s.pMin, s.fMin].filter((v): v is number => v != null);
  return list.length ? Math.min(...list) : null;
};

/** Конец рейса: максимум по плану и факту. */
export const tripEnd = (trip: TimelineTrip): number | null => {
  const s = tripSpan(trip);
  const list = [s.pMax, s.fMax].filter((v): v is number => v != null);
  return list.length ? Math.max(...list) : null;
};

/** Вычисляемый диапазон для хранения в рейсе (startDate/endDate) — обновляется
 *  при любом изменении этапов, чтобы окно грузилось по датам. */
export const computeStoredRange = (trip: TimelineTrip): { startDate?: string; endDate?: string } => {
  const s = tripStart(trip);
  const e = tripEnd(trip);
  return {
    ...(s != null ? { startDate: dayStr(s) } : {}),
    ...(e != null ? { endDate: dayStr(e) } : {}),
  };
};

/** Рейс/событие пересекается с окном [from, to] (номера дней). */
export const tripOverlaps = (trip: TimelineTrip, from: number, to: number): boolean => {
  const s = tripStart(trip);
  const e = tripEnd(trip);
  if (s == null || e == null) return false;
  return e >= from && s <= to;
};

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

export interface TimelineKpi {
  total: number;
  withCritical: number;
  violated: number;
  atRisk: number;
  avgDeviation: number | null;
  lateWithoutReason: number;
}

export const computeKpi = (trips: TimelineTrip[], today: number): TimelineKpi => {
  let withCritical = 0;
  let violated = 0;
  let atRisk = 0;
  let lateWithoutReason = 0;
  const devs: number[] = [];
  trips.forEach((tr) => {
    const ds = getDeadlineStatus(tr, today);
    if (criticalStages(tr).length) withCritical += 1;
    if (ds.level === 3) violated += 1;
    else if (ds.level === 2 && !tr.archived) atRisk += 1;
    getLateStages(tr, today).forEach((s) => {
      if (!s.reason) lateWithoutReason += 1;
    });
    tr.stages.forEach((s) => {
      const d = stageDeviation(s);
      if (d != null) devs.push(d);
    });
  });
  return {
    total: trips.length,
    withCritical,
    violated,
    atRisk,
    avgDeviation: devs.length ? devs.reduce((x, y) => x + y, 0) / devs.length : null,
    lateWithoutReason,
  };
};

export interface StageTypeStat {
  key: string;
  name: string;
  count: number;
  avg: number;
  maxDelay: number;
  onTimePct: number;
}

export const computeStageTypeStats = (trips: TimelineTrip[], types: TimelineStageType[]): StageTypeStat[] => {
  const by: Record<string, number[]> = {};
  trips.forEach((tr) => {
    tr.stages.forEach((s) => {
      const d = stageDeviation(s);
      if (d == null) return;
      (by[s.type] = by[s.type] || []).push(d);
    });
  });
  return types
    .filter((t) => by[t.key] && by[t.key].length)
    .map((t) => {
      const v = by[t.key];
      return {
        key: t.key,
        name: t.name,
        count: v.length,
        avg: v.reduce((x, y) => x + y, 0) / v.length,
        maxDelay: Math.max(0, ...v),
        onTimePct: Math.round((v.filter((x) => x <= 0).length / v.length) * 100),
      };
    });
};

export interface FleetLoadRow {
  plate: string;
  tripDays: number;
  repairDays: number;
  baseDays: number;
  loadPct: number;
}

/**
 * Загрузка машин за окно [from, to] (обычно до сегодня).
 * `plates` — машины из отфильтрованного списка рейсов (по вкладке диспетчера);
 * день считается «в рейсе», если его покрывает ЛЮБОЙ рейс машины (как в
 * прототипе — загрузка смотрит на фактическую занятость, не на фильтр).
 * `repairs` — сегменты ремонта из «Учёта выезда» по номеру машины.
 */
export const computeFleetLoad = (
  plates: string[],
  allTrips: TimelineTrip[],
  allEvents: TimelineVehicleEvent[],
  repairs: Record<string, Array<{ a: number; b: number }>>,
  from: number,
  to: number,
): FleetLoadRow[] => {
  if (to < from) return [];
  return [...plates].sort().map((plate) => {
    const mine = allTrips.filter((t) => t.carNumber === plate);
    const myEvents = allEvents.filter((e) => e.carNumber === plate);
    const myRepairs = repairs[plate] || [];
    let tripDays = 0;
    let repairDays = 0;
    for (let d = from; d <= to; d += 1) {
      const inTrip = mine.some((t) => {
        const s = tripStart(t);
        const e = tripEnd(t);
        return s != null && e != null && d >= s && d <= e;
      });
      if (inTrip) {
        tripDays += 1;
      } else if (
        myRepairs.some((r) => d >= r.a && d <= r.b) ||
        myEvents.some(
          (e) =>
            e.kind === 'repair' &&
            dayNum(e.dateFrom) != null &&
            d >= (dayNum(e.dateFrom) as number) &&
            d <= (dayNum(e.dateTo) != null ? (dayNum(e.dateTo) as number) : (dayNum(e.dateFrom) as number)),
        )
      ) {
        repairDays += 1;
      }
    }
    const total = to - from + 1;
    const baseDays = total - tripDays - repairDays;
    return {
      plate,
      tripDays,
      repairDays,
      baseDays,
      loadPct: total ? Math.round((tripDays / total) * 100) : 0,
    };
  });
};

/** Среднее отклонение в днях, формат «+1.2 / −0.4 / —». */
export const fmtAvg = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
};

/** Календарный сдвиг ISO-даты на месяцы с корректным концом месяца
 *  (31.01 + 1 мес → 28.02/29.02, без «условных 30 дней»). */
export const addMonthsIso = (iso: string, months: number): string => {
  const n = dayNum(iso);
  if (n == null) return iso;
  const d = new Date(n * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
};

/** Пресеты периода отображения: 1 месяц (по умолчанию), 45 дней, 2/3/6 месяцев. */
export type PeriodPreset = '1m' | '45' | '2m' | '3m' | '6m';

export const PERIOD_PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: '1m', label: '1 месяц' },
  { key: '45', label: '45 дней' },
  { key: '2m', label: '2 месяца' },
  { key: '3m', label: '3 месяца' },
  { key: '6m', label: '6 месяцев' },
];

/** Сколько ДНЕЙ в диапазоне: месячные пресеты — календарные месяцы от начала (включительно). */
export const rangeDaysForPreset = (preset: PeriodPreset, vsDay: number): number => {
  if (preset === '45') return 45;
  const months = preset === '1m' ? 1 : preset === '2m' ? 2 : preset === '3m' ? 3 : 6;
  const vsIso = dayStr(vsDay);
  const endIso = addMonthsIso(vsIso, months);
  const end = dayNum(endIso);
  if (end == null) return 45;
  return Math.max(1, end - vsDay); // конечная дата не включается — лишнего дня нет
};

/** Человеческий текст отклонения в днях (календарные дни, без вымышленного времени). */
export const deviationWords = (diff: number): string => {
  if (diff === 0) return 'в срок';
  const days = Math.abs(diff);
  const word = days % 10 === 1 && days % 100 !== 11 ? 'день' : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20) ? 'дня' : 'дней';
  return `${diff > 0 ? 'позже' : 'раньше'} на ${days} ${word}`;
};

/** Выходной ли день (сб/вс). Мягкая подсказка при планировании — не запрет. */
export const isWeekendDay = (n: number): boolean => {
  const wd = new Date(n * DAY_MS).getUTCDay();
  return wd === 0 || wd === 6;
};

/** Есть ли в интервале [from, to] хотя бы один выходной. */
export const hasWeekendInRange = (from: number | null, to: number | null): boolean => {
  if (from == null || to == null || to < from) return false;
  for (let d = from; d <= to && d - from < 400; d += 1) {
    if (isWeekendDay(d)) return true;
  }
  return false;
};

/** Текст ненавязчивой подсказки для даты на выходном (не блокирует сохранение). */
export const WEEKEND_HINT =
  'Дата приходится на выходной. Проверьте график работы загрузки, выгрузки или другого объекта';

/** Сравнение факта с планом — подписи спецификации. */
export interface PlanFactCompare {
  label: 'По плану' | 'Раньше плана' | 'Позже плана' | 'Нет фактических данных';
  /** Отклонение в днях (факт − план); null если данных нет. */
  diffDays: number | null;
}

export const comparePlanFact = (planDay: number | null, factDay: number | null): PlanFactCompare => {
  if (planDay == null || factDay == null) return { label: 'Нет фактических данных', diffDays: null };
  const diff = factDay - planDay;
  if (diff === 0) return { label: 'По плану', diffDays: 0 };
  return { label: diff < 0 ? 'Раньше плана' : 'Позже плана', diffDays: diff };
};

/** Отклонение этапа для ячейки таблицы: «+2 дн» красным / «−1 дн» зелёным. */
export const fmtDev = (d: number | null): string => {
  if (d == null) return '—';
  return `${d > 0 ? '+' : ''}${d} дн`;
};
