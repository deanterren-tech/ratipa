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
export const MONTHS_RU_FULL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
export const WEEKDAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Метка дня в шапке таймлайна: «1 сен» для первого числа, иначе день. */
export const dayHeaderLabel = (n: number): string => {
  const d = new Date(n * DAY_MS);
  const day = d.getUTCDate();
  if (day === 1) return `1 ${MONTHS_RU[d.getUTCMonth()]}`;
  return String(day);
};

// ---------------------------------------------------------------------------
// Единая геометрия календаря: «дата → координата»
// ---------------------------------------------------------------------------

/**
 * ЕДИНАЯ функция преобразования даты в X внутри ленты календаря.
 * Общий origin для шапки, сетки и полос: номер дня vs ≡ X = 0.
 * Ширина дня = colW. Используется и основным таймлайном, и встроенным.
 */
export const dayToX = (day: number, vs: number, colW: number): number => Math.round((day - vs) * colW);

/** Видимый отрезок [a, b] в окне [vs, ve]; конечная дата включается. null — вне окна. */
export const clampSpanToWindow = (
  a: number,
  b: number,
  vs: number,
  ve: number,
): { a: number; b: number } | null => {
  if (b < vs || a > ve) return null;
  return { a: Math.max(a, vs), b: Math.min(b, ve) };
};

/**
 * Прямоугольник полосы в пикселях по её РЕАЛЬНЫМ датам.
 * Одинаковое включение конечной даты: [a, b] занимает (b − a + 1) дней
 * (полоса одного дня имеет ширину одного дня). Частично выходящая за окно
 * полоса обрезается по краям окна без изменения исходных дат.
 */
export const barRectInWindow = (
  a: number,
  b: number,
  vs: number,
  ve: number,
  colW: number,
): { left: number; width: number } | null => {
  const v = clampSpanToWindow(a, b, vs, ve);
  if (!v) return null;
  return { left: dayToX(v.a, vs, colW), width: Math.round((v.b - v.a + 1) * colW) };
};

// ---------------------------------------------------------------------------
// Вертикальные дорожки подстроки: разведение пересекающихся полос
// ---------------------------------------------------------------------------

/**
 * Полоса для раскладки по дорожкам: интервал дней + группа типа + высота.
 * Горизонтальная геометрия здесь НЕ участвует: left/width считаются только
 * из дат (dayToX/barRectInWindow), дорожки — чисто вертикальное разведение.
 */
export interface LaneTrackItem {
  /**
   * Группа типа полосы. Каждая группа (рейс / база / ремонт / факт) занимает
   * свою дорожку: элементы разных групп никогда не делят вертикальное место.
   */
  group: number;
  /** Первый день интервала (включительно). */
  a: number;
  /** Последний день интервала (включительно). */
  b: number;
  /** Высота полосы (px). */
  h: number;
}

export interface LaneTrackZone {
  /** Номер группы. */
  key: number;
  /** Верх зоны группы (px от верха подстроки). */
  top: number;
  /** Высота зоны группы (все её под-дорожки + зазоры между ними). */
  h: number;
}

export interface LaneTrackLayout {
  /** top (px) каждой полосы — в порядке входного массива. */
  tops: number[];
  /** Высота всей подстроки (px): сетка и закреплённые ячейки берут её же. */
  laneH: number;
  /** Зоны групп (для маркеров-наложений, которым нужен верх дорожки). */
  zones: LaneTrackZone[];
}

/**
 * Раскладка полос подстроки («План» или «Факт») по ВЕРТИКАЛЬНЫМ дорожкам:
 *  - каждая группа типов получает свою дорожку (рейс / база / ремонт / факт);
 *  - пересекающиеся интервалы ВНУТРИ группы жадная раскладка разводит на
 *    под-дорожки: ни одна полоса не скрыта под другой, обе читаемы и кликабельны;
 *  - высота подстроки = сумма дорожек + отступы (подстраивается под число
 *    дорожек); горизонтальные координаты и ширины не меняются — только top.
 * Полосы одной дорожки не пересекаются по датам: конец одной строго раньше
 * начала следующей, поэтому обрезка чужими полосами невозможна.
 */
export const layoutLaneTracks = (
  items: LaneTrackItem[],
  opts: { padTop: number; padBottom: number; gap: number },
): LaneTrackLayout => {
  const { padTop, padBottom, gap } = opts;
  const tops: number[] = new Array(items.length).fill(padTop);
  const zones: LaneTrackZone[] = [];
  if (!items.length) return { tops, laneH: padTop + padBottom, zones };

  // 1. Группы — в порядке номера; каждая получает свою вертикальную зону.
  const order: number[] = [];
  const byGroup = new Map<number, number[]>();
  items.forEach((it, i) => {
    let arr = byGroup.get(it.group);
    if (!arr) {
      arr = [];
      byGroup.set(it.group, arr);
      order.push(it.group);
    }
    arr.push(i);
  });
  order.sort((x, y) => x - y);

  let y = padTop;
  order.forEach((g, gi) => {
    const idxs = byGroup.get(g) as number[];
    // 2. Под-дорожки внутри группы: жадный first-fit по началу интервала —
    //    первая дорожка, чей последний занятый день строго раньше начала полосы.
    const sorted = [...idxs].sort((x, z) => items[x].a - items[z].a || items[x].b - items[z].b || x - z);
    const ends: number[] = [];
    const trackOf = new Map<number, number>();
    sorted.forEach((i) => {
      const it = items[i];
      let t = ends.findIndex((end) => end < it.a);
      if (t === -1) {
        t = ends.length;
        ends.push(Number.NEGATIVE_INFINITY);
      }
      ends[t] = it.b;
      trackOf.set(i, t);
    });
    const trackH = ends.map(() => 0);
    idxs.forEach((i) => {
      const t = trackOf.get(i) as number;
      trackH[t] = Math.max(trackH[t], items[i].h);
    });
    // 3. Стек дорожек группы: полоса центрируется в своей дорожке.
    if (gi > 0) y += gap;
    const zoneTop = y;
    ends.forEach((_, t) => {
      if (t > 0) y += gap;
      idxs.forEach((i) => {
        if (trackOf.get(i) === t) tops[i] = y + Math.round((trackH[t] - items[i].h) / 2);
      });
      y += trackH[t];
    });
    zones.push({ key: g, top: zoneTop, h: y - zoneTop });
  });
  return { tops, laneH: y + padBottom, zones };
};

export interface MonthSegment {
  /** Ключ сегмента (год-месяц). */
  key: string;
  /** «Октябрь 2026» — подпись верхнего уровня шапки. */
  label: string;
  /** Первый день сегмента в окне (номер дня). */
  start: number;
  /** Последний день сегмента в окне. */
  end: number;
  /** Количество дней сегмента в окне (ширина сегмента = days × colW). */
  days: number;
}

/** Сегменты месяцев видимого окна: каждый — точно по ширине своих дней. */
export const monthSegments = (vs: number, vn: number): MonthSegment[] => {
  const ve = vs + vn - 1;
  const segs: MonthSegment[] = [];
  let cur = vs;
  while (cur <= ve) {
    const d = new Date(cur * DAY_MS);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthStart = Math.round(Date.UTC(y, m, 1) / DAY_MS);
    const nextStart = Math.round(Date.UTC(y, m + 1, 1) / DAY_MS);
    const start = Math.max(cur, monthStart);
    const end = Math.min(ve, nextStart - 1);
    segs.push({ key: `${y}-${m}`, label: `${MONTHS_RU_FULL[m]} ${y}`, start, end, days: end - start + 1 });
    cur = end + 1;
  }
  return segs;
};

/** Русские названия месяцев (нижний регистр) → номер месяца 0..11. */
const MONTH_LABEL_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS_RU_FULL.map((name, i) => [name.toLowerCase(), i]),
);

/** «Месяц Год» → числовой ключ (год × 12 + месяц); null — формат не распознан. */
export const monthLabelKey = (label: string): number | null => {
  const m = /^\s*([А-Яа-яЁё]+)\s+(\d{4})\s*$/.exec(String(label || ''));
  if (!m) return null;
  const idx = MONTH_LABEL_INDEX[m[1].toLowerCase()];
  if (idx == null) return null;
  return Number(m[2]) * 12 + idx;
};

/**
 * Хронологический порядок месячных вкладок архива: новые месяцы первыми,
 * далее последовательно более старые (Январь 2027 → Декабрь 2026 → Ноябрь 2026 …).
 * Сортировка строго по числовому году и месяцу — не по алфавиту и не по строкам.
 */
export const sortMonthLabelsDesc = (labels: string[]): string[] =>
  [...labels].sort((a, b) => {
    const ka = monthLabelKey(a);
    const kb = monthLabelKey(b);
    if (ka == null && kb == null) return a.localeCompare(b, 'ru');
    if (ka == null) return 1;
    if (kb == null) return -1;
    return kb - ka;
  });

// ---------------------------------------------------------------------------
// Масштаб календаря (ширина дня) и видимый диапазон
// ---------------------------------------------------------------------------

/**
 * Уровни масштаба — ширина дня в px. Единый параметр масштаба для сетки,
 * полос, маркеров и шапки. От 6px (обзор: несколько месяцев) до 48px
 * (подробно: отдельные дни и события). Ноль/отрицательная ширина невозможны.
 */
export const ZOOM_LEVELS: number[] = [6, 8, 10, 12, 16, 20, 24, 30, 36, 42, 48];
export const DEFAULT_ZOOM = 30;
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

/** Индекс уровня по ширине дня (ближайший допустимый). */
export const zoomIndexOf = (colW: number): number => {
  let best = 0;
  let bestD = Infinity;
  ZOOM_LEVELS.forEach((w, i) => {
    const d = Math.abs(w - colW);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
};

/** Ширина дня по индексу уровня (с защитой от выхода за границы). */
export const zoomColW = (index: number): number =>
  ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, Math.round(index)))];

/** Сегодня-независимая подпись уровня для подсказок ползунка. */
export const zoomLabel = (index: number): string => {
  const w = zoomColW(index);
  if (w >= 30) return 'подробно: дни и события';
  if (w >= 16) return 'обычный: недели и дни';
  return 'обзорно: месяцы и недели';
};

/** Родительный падеж месяцев: «9 октября». */
export const MONTHS_RU_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «9 октября» без года. */
export const fmtDayMonthGen = (n: number): string => {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS_RU_GEN[d.getUTCMonth()]}`;
};

/**
 * Фактический видимый диапазон: «9 октября — 24 ноября 2026».
 * Если год у концов разный — год указывается у обеих дат.
 */
export const visibleRangeText = (startDay: number, endDay: number): string => {
  const a = new Date(startDay * DAY_MS);
  const b = new Date(endDay * DAY_MS);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${fmtDayMonthGen(startDay)}${sameYear ? '' : ` ${a.getUTCFullYear()}`}`;
  const right = `${fmtDayMonthGen(endDay)} ${b.getUTCFullYear()}`;
  return `${left} — ${right}`;
};

/** День (номер дня) в контентной координате X ленты (0 = начало ленты до колонки). */
export const dayAtContentX = (x: number, vs: number, colW: number): number =>
  vs + Math.floor((x - TIMELINE_COL_W) / colW);

/** Ширина закреплённой колонки автомобилей (px) — общая константа раскладки. */
export const TIMELINE_COL_W = 170;
/** Ширина колонки встроенного (мини) таймлайна. */
export const TIMELINE_MINI_COL_W = 96;

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
  /** Точная природа статуса: подтверждённое опоздание отличается от «план прошёл, факта нет». */
  kind: 'none' | 'ok' | 'risk' | 'violated' | 'missed';
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
  if (!dls.length) return { level: 0, label: 'нет крит. срока', kind: 'none' };
  let out: DeadlineStatus = { level: 1, label: 'в норме', kind: 'ok' };
  dls.forEach((s) => {
    const p = dayNum(s.plannedDate);
    const f = dayNum(s.actualDate);
    if (f != null) {
      if (p != null && f > p) {
        out = { level: 3, label: `срок нарушен (подтверждён фактом): ${nameOf(s)}`, kind: 'violated' };
      }
    } else if (p != null && today > p) {
      out = { level: 3, label: `плановая дата прошла, факт не указан: ${nameOf(s)}`, kind: 'missed' };
    } else if (p != null && p - today <= 1) {
      if (out.level < 2) out = { level: 2, label: `под угрозой: ${nameOf(s)}`, kind: 'risk' };
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

/**
 * Состояние этапа словами (спецификация окна рейса):
 * «по плану» / «раньше плана» / «позже плана» / «запланировано, факт не указан» /
 * «плановая дата прошла, факт не указан» / «недостаточно данных для сравнения».
 * Отсутствие факта НЕ считается подтверждённой задержкой; плановая дата в факт
 * не подставляется. Точность — календарные дни (в модели хранятся только даты).
 */
export interface StageState {
  code: 'on' | 'early' | 'late' | 'planned' | 'missed' | 'nodata';
  label: string;
}

export const stageStateOf = (s: TimelineStage, today: number): StageState => {
  const p = dayNum(s.plannedDate);
  const f = dayNum(s.actualDate);
  if (p != null && f != null) {
    const dev = f - p;
    if (dev === 0) return { code: 'on', label: 'по плану' };
    if (dev < 0) return { code: 'early', label: `раньше плана на ${-dev} дн` };
    return { code: 'late', label: `позже плана на ${dev} дн` };
  }
  if (p != null) {
    return p < today
      ? { code: 'missed', label: 'плановая дата прошла, факт не указан' }
      : { code: 'planned', label: 'запланировано, факт не указан' };
  }
  if (f != null) return { code: 'nodata', label: 'факт без плановой даты — недостаточно данных' };
  return { code: 'nodata', label: 'недостаточно данных для сравнения' };
};

/** Отклонение этапа для ячейки таблицы: «+2 дн» красным / «−1 дн» зелёным. */
export const fmtDev = (d: number | null): string => {
  if (d == null) return '—';
  return `${d > 0 ? '+' : ''}${d} дн`;
};
