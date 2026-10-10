/**
 * ДЕЛЕНИЕ ЯЧЕЙКИ ДНЯ НА ПОЛОВИНЫ/ДОЛИ — ЕДИНОЕ правило для всего таймлайна.
 *
 * Если в одной ячейке дня встречаются несколько событий, ячейка делится по
 * вертикали слева направо по ходу времени: ЛЕВАЯ доля — предыдущее событие
 * (то, что закончилось/произошло раньше по логической последовательности),
 * ПРАВАЯ — следующее. Пример: выгрузка и начало ремонта/простоя в один день:
 * слева выгрузка, справа начало ремонта/простоя. Каждая доля занимает всю
 * высоту строки, не полоску.
 *
 * Порядок «предыдущее/следующее» — одна константа DAY_EVENT_PRIORITY (ниже):
 *   1) по жизненному циклу рейса и машины:
 *      загрузка → граница/таможня → выгрузка → прочие этапы → окончание рейса →
 *      простой на базе / ремонт → окончание ремонта → срок готовности → выезд →
 *      следующий рейс;
 *   2) если у событий есть время — по времени;
 *   3) больше двух событий — равные доли слева направо.
 *
 * Кроме порядка событий функция учитывает «якоря» дня смены (геометрия из
 * lib/overlap): если полоса рейса заканчивается на середине дня — события этого
 * рейса (этапы) остаются в ЛЕВОЙ половине, а начинающийся простой/ремонт — в
 * ПРАВОЙ, и наоборот (окончание простоя слева, начало рейса справа).
 *
 * Функция — ЕДИНСТВЕННОЕ место правила: ей пользуются основное полотно
 * (TimelineGrid), встроенный мини-таймлайн (TripCard) и демо-фрагменты гайда.
 * Данные и расчёты источников не меняются — только раскладка секций ячейки.
 */
import { stageFactRange, stagePlanRange, type StageFillInput } from './stageFills';
import type { BzMark, BzStripe } from './bzFills';
import type { RowOverlapResolution } from './overlapRow';

// ---------------------------------------------------------------------------
// Приоритет типов событий дня (ОДНА константа — используется везде)
// ---------------------------------------------------------------------------

export type DayEventCat =
  | 'stage-load'
  | 'stage-border'
  | 'stage-unload'
  | 'stage-other'
  | 'trip-end'
  | 'period-start'
  | 'repair-end'
  | 'ready'
  | 'departure'
  | 'trip-start';

/** Жизненный цикл (слева направо): от загрузки к следующему рейсу. */
export const DAY_EVENT_PRIORITY: DayEventCat[] = [
  'stage-load',
  'stage-border',
  'stage-unload',
  'stage-other',
  'trip-end',
  'period-start',
  'repair-end',
  'ready',
  'departure',
  'trip-start',
];

/** Человекочитаемые имена категорий (подсказки, «соседнее событие дня»). */
export const DAY_EVENT_CAT_LABEL: Record<DayEventCat, string> = {
  'stage-load': 'загрузка',
  'stage-border': 'граница/таможня',
  'stage-unload': 'выгрузка',
  'stage-other': 'этап',
  'trip-end': 'окончание рейса',
  'period-start': 'начало простоя/ремонта',
  'repair-end': 'окончание ремонта',
  ready: 'срок готовности',
  departure: 'выезд',
  'trip-start': 'начало рейса',
};

/** Категория этапа по его типу (типы — из справочника этапов, значения не меняем). */
export const stageCatOf = (type: string): DayEventCat => {
  const t = String(type || '');
  if (t === 'load') return 'stage-load';
  if (t === 'border' || t === 'cust_in' || t === 'cust_out') return 'stage-border';
  if (t === 'unl') return 'stage-unload';
  return 'stage-other';
};

const catIndex = (c: DayEventCat): number => {
  const i = DAY_EVENT_PRIORITY.indexOf(c);
  return i === -1 ? DAY_EVENT_PRIORITY.length : i;
};

// ---------------------------------------------------------------------------
// Слоты дня
// ---------------------------------------------------------------------------

export type DayCellRef =
  | { type: 'stage'; tripKey: string; stageId: string }
  | { type: 'period'; periodKey: string };

export interface DayCellEvent {
  /** Ключ слияния: этап — `st:<рейс>|<этап>`; полоса/отметка записи — `p:<ключ записи>`. */
  mergeKey: string;
  cat: DayEventCat;
  /** Время события (HH:MM), если в данных появится; иначе — по жизненному циклу. */
  time?: string | null;
  ref: DayCellRef;
  /** Короткая подпись события — для строки «в этот день также». */
  label: string;
  /** Якорь дня смены: 'left'/'right' — событие обязано встать в эту половину. */
  side?: 'left' | 'right' | null;
}

export interface DaySlot {
  day: number;
  /** Номер доли в дне (0..sections-1) и общее число долей. */
  section: number;
  sections: number;
  /** Доли ширины дня [0..1] — левая и правая границы доли. */
  left: number;
  right: number;
  /** Ключи слияния и ссылки на записи всех событий доли. */
  mergeKeys: string[];
  refs: DayCellRef[];
  /** Подписи событий доли (для подсказок). */
  labels: string[];
  cats: DayEventCat[];
}

/** Ключ слияния событий записи «Учёта выезда» (полосы, отметки, промежутки). */
export const periodMergeKey = (periodKey: string | null, a?: number, b?: number): string =>
  periodKey ? `p:${periodKey}` : `g:${a ?? 0}-${b ?? 0}`;

/** Ключ слияния событий этапа. */
export const stageMergeKeyOf = (tripKey: string, stageId: string): string => `st:${tripKey}|${stageId}`;

/**
 * Раскладка событий ОДНОГО дня на доли. События одного mergeKey сливаются в
 * одну долю (например, отметка «срок готовности» и конец полосы плана).
 * Доли — равные отрезки; при якорях дня смены половины закреплены.
 */
export const layoutDaySlots = (day: number, events: DayCellEvent[]): DaySlot[] => {
  if (!events.length) return [];

  // Слияние событий одной записи/этапа.
  const byMerge = new Map<string, DayCellEvent[]>();
  events.forEach((e) => {
    const arr = byMerge.get(e.mergeKey);
    if (arr) arr.push(e);
    else byMerge.set(e.mergeKey, [e]);
  });
  const groups = Array.from(byMerge.entries()).map(([mergeKey, evs]) => ({
    mergeKey,
    evs,
    cat: evs.reduce((m, e) => (catIndex(e.cat) < catIndex(m) ? e.cat : m), evs[0].cat),
    time: evs.find((e) => e.time)?.time ?? null,
    side: evs.find((e) => e.side)?.side ?? null,
  }));

  const cmp = (a: (typeof groups)[number], b: (typeof groups)[number]): number => {
    // правило 2: если у обоих событий есть время — по времени
    if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
    // правило 1: по жизненному циклу (константа приоритета)
    const d = catIndex(a.cat) - catIndex(b.cat);
    if (d !== 0) return d;
    const t = a.time && b.time && a.time !== b.time ? (a.time < b.time ? -1 : 1) : 0;
    if (t !== 0) return t;
    return a.mergeKey.localeCompare(b.mergeKey);
  };

  const lefts = groups.filter((g) => g.side === 'left').sort(cmp);
  const rights = groups.filter((g) => g.side === 'right').sort(cmp);
  const frees = groups.filter((g) => !g.side).sort(cmp);

  type Placed = { group: (typeof groups)[number]; left: number; right: number };
  const placed: Placed[] = [];
  const fill = (pool: typeof groups, from: number, to: number) => {
    pool.forEach((g, i) => {
      const l = from + ((to - from) * i) / pool.length;
      const r = from + ((to - from) * (i + 1)) / pool.length;
      placed.push({ group: g, left: l, right: r });
    });
  };

  if (!lefts.length && !rights.length) {
    // Полосами день не рассечён — все события делят день равными долями.
    fill(frees, 0, 1);
  } else if (lefts.length && rights.length) {
    // День смены: левая половина — завершающемуся, правая — начинающемуся;
    // свободные события дня добавляются к правой половине.
    fill(lefts, 0, 0.5);
    fill([...rights, ...frees], 0.5, 1);
  } else if (lefts.length) {
    // Полоса кончается на середине дня: свои события — слева, свободные — справа.
    fill(lefts, 0, 0.5);
    fill(frees, 0.5, 1);
  } else {
    // Полоса начинается с середины дня: свои события — справа, свободные — слева.
    fill(rights, 0.5, 1);
    fill(frees, 0, 0.5);
  }

  placed.sort((a, b) => a.left - b.left || a.group.mergeKey.localeCompare(b.group.mergeKey));
  return placed.map((p, i) => ({
    day,
    section: i,
    sections: placed.length,
    left: p.left,
    right: p.right,
    mergeKeys: [p.group.mergeKey],
    refs: p.group.evs.map((e) => e.ref),
    labels: p.group.evs.map((e) => e.label),
    cats: [p.group.cat],
  }));
};

// ---------------------------------------------------------------------------
// Сборка событий строки (план/факт отдельно) + поиск долей для отрисовки
// ---------------------------------------------------------------------------

export interface RowStripeInput {
  kind: 'base-plan' | 'base-fact' | 'repair' | 'base-gap';
  /** Видимые границы полосы (с учётом укорочения/срезов из lib/overlap). */
  a: number;
  b: number;
  fracA: number;
  fracB: number;
  periodKey: string | null;
  label: string;
}

export interface TripSide {
  /** День, в котором полоса рейса начинается (fracA = 0.5), если есть. */
  startDay: number | null;
  /** День, в котором полоса рейса заканчивается (fracB = 0.5), если есть. */
  endDay: number | null;
}

export interface RowDaySectionsInput {
  kind: 'plan' | 'fact';
  vs: number;
  ve: number;
  stages: StageFillInput[];
  stageLabelOf: (s: StageFillInput) => string;
  stripes: RowStripeInput[];
  marks: BzMark[];
  /** Якоря рейсов (из разрешения наложений): где полоса начинается/кончается срезом. */
  tripSides: Map<string, TripSide>;
}

export interface RowDaySections {
  byDay: Map<number, DaySlot[]>;
  slotForStage: (day: number, tripKey: string, stageId: string) => DaySlot | null;
  slotForPeriod: (day: number, mergeKey: string) => DaySlot | null;
  /** Строка «в этот день также: …» — соседние события дня (без своих долей). */
  neighborsOf: (day: number, ownMergeKeys: string[]) => string;
}

const stripeCat = (kind: RowStripeInput['kind'], day: number, a: number, b: number): DayEventCat => {
  if (day === a) return 'period-start';
  if (day === b) {
    if (kind === 'base-plan') return 'ready';
    if (kind === 'repair') return 'repair-end';
    return 'departure'; // base-fact (выезд), base-gap (окончание простоя)
  }
  return 'period-start'; // полоса идёт сквозь день — состояние «простой/ремонт продолжается»
};

/** Видимые границы полос с учётом правок наложений (та же логика, что в отрисовке). */
export const visibleStripeBounds = (
  s: Pick<BzStripe, 'kind' | 'a' | 'b' | 'periodKey'>,
  ov: RowOverlapResolution | null,
): { a: number; b: number; fracA: number; fracB: number } => {
  const adj =
    (s.kind === 'base-plan' || s.kind === 'base-fact') && s.periodKey
      ? ov?.baseAdjust.get(s.periodKey)
      : undefined;
  return { a: adj ? adj.a : s.a, b: adj ? adj.b : s.b, fracA: adj ? adj.fracA : 0, fracB: adj ? adj.fracB : 1 };
};

/** Якоря рейсов строки: дни среза полосы рейса (frac 0.5) по ключу рейса. */
export const tripSidesOf = (
  intervals: Array<{ tripKey: string; a: number; b: number }>,
  ov: RowOverlapResolution | null,
): Map<string, TripSide> => {
  const map = new Map<string, TripSide>();
  intervals.forEach((it) => {
    const adj = ov?.tripAdjust.get(it.tripKey);
    if (!adj) return;
    const prev = map.get(it.tripKey) || { startDay: null, endDay: null };
    map.set(it.tripKey, {
      startDay: adj.fracA === 0.5 ? it.a : prev.startDay,
      endDay: adj.fracB === 0.5 ? it.b : prev.endDay,
    });
  });
  return map;
};

/** Сборка долей дня для одной подстроки (план или факт). */
export const buildRowDaySections = (input: RowDaySectionsInput): RowDaySections => {
  const eventsByDay = new Map<number, DayCellEvent[]>();
  const push = (day: number, ev: DayCellEvent) => {
    const arr = eventsByDay.get(day);
    if (arr) arr.push(ev);
    else eventsByDay.set(day, [ev]);
  };

  // Этапы: плановые даты — в «План», фактические — в «Факт» (не смешиваются).
  input.stages.forEach((it) => {
    const r = input.kind === 'plan' ? stagePlanRange(it.stage) : stageFactRange(it.stage);
    if (!r) return;
    const side = input.tripSides.get(it.tripKey) || null;
    const label = (input.stageLabelOf(it) || '').trim() || 'этап';
    for (let d = Math.max(r.a, input.vs); d <= Math.min(r.b, input.ve); d += 1) {
      push(d, {
        mergeKey: stageMergeKeyOf(it.tripKey, it.stage.id),
        cat: stageCatOf(it.stage.type),
        ref: { type: 'stage', tripKey: it.tripKey, stageId: it.stage.id },
        label,
        side: side ? (side.startDay === d ? 'right' : side.endDay === d ? 'left' : null) : null,
      });
    }
  });
  // Полосы базы/ремонта/промежутков: каждый день периода — событие дня
  // (крайние дни — начало/окончание, середина — «продолжается»).
  input.stripes.forEach((s) => {
    const key = periodMergeKey(s.periodKey, s.a, s.b);
    for (let d = Math.max(s.a, input.vs); d <= Math.min(s.b, input.ve); d += 1) {
      push(d, {
        mergeKey: key,
        cat: stripeCat(s.kind, d, s.a, s.b),
        ref: { type: 'period', periodKey: s.periodKey || key },
        label: s.label,
        side: s.fracA === 0.5 && d === s.a ? 'right' : s.fracB === 0.5 && d === s.b ? 'left' : null,
      });
    }
  });
  // Однодневные отметки записи (готовность / окончание ремонта) — та же доля,
  // что и полоса своей записи (слияние по ключу записи).
  input.marks.forEach((m) => {
    push(m.day, {
      mergeKey: periodMergeKey(m.periodKey),
      cat: m.kind === 'ready' ? 'ready' : 'repair-end',
      ref: { type: 'period', periodKey: m.periodKey },
      label: m.kind === 'ready' ? 'срок готовности' : 'окончание ремонта',
      side: null,
    });
  });

  const byDay = new Map<number, DaySlot[]>();
  eventsByDay.forEach((evs, day) => {
    byDay.set(day, layoutDaySlots(day, evs));
  });

  const slotForStage = (day: number, tripKey: string, stageId: string): DaySlot | null => {
    const slots = byDay.get(day);
    if (!slots) return null;
    return slots.find((s) => s.refs.some((r) => r.type === 'stage' && r.tripKey === tripKey && r.stageId === stageId)) || null;
  };
  const slotForPeriod = (day: number, mergeKey: string): DaySlot | null => {
    const slots = byDay.get(day);
    if (!slots) return null;
    return slots.find((s) => s.mergeKeys.includes(mergeKey)) || null;
  };
  const neighborsOf = (day: number, ownMergeKeys: string[]): string => {
    const slots = byDay.get(day);
    if (!slots || slots.length < 2) return '';
    const others: string[] = [];
    slots.forEach((s) => {
      if (s.mergeKeys.some((k) => ownMergeKeys.includes(k))) return;
      s.labels.forEach((l) => {
        if (l && !others.includes(l)) others.push(l);
      });
    });
    return others.length ? `В этот день также: ${others.join(', ')}.` : '';
  };
  return { byDay, slotForStage, slotForPeriod, neighborsOf };
};
