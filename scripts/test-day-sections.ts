/**
 * Тесты ЕДИНОГО правила деления ячейки дня (lib/dayCellSections).
 * Запуск: npx tsx scripts/test-day-sections.ts   (или npm run test:day-sections)
 *
 * Покрытие по спецификации владельца:
 *  - выгрузка + начало ремонта (слева выгрузка, справа ремонт);
 *  - выгрузка + начало простоя (день смены: слева выгрузка/рейс, справа простой);
 *  - окончание ремонта + срок готовности;
 *  - три события в одном дне (равные доли слева направо);
 *  - события с временем и без времени;
 *  - ПЛАН и ФАКТ считаются отдельно (плановые даты — в «План», фактические — в «Факт»).
 */
import {
  DAY_EVENT_PRIORITY,
  buildRowDaySections,
  layoutDaySlots,
  layoutDaySlots as _layout,
  periodMergeKey,
  stageCatOf,
  stageMergeKeyOf,
  tripSidesOf,
  visibleStripeBounds,
  type DayCellEvent,
  type RowStripeInput,
  type TripSide,
} from '../src/components/modules/tripTimeline/lib/dayCellSections';
import type { StageFillInput } from '../src/components/modules/tripTimeline/lib/stageFills';
import type { BzMark, BzStripe } from '../src/components/modules/tripTimeline/lib/bzFills';
import type { TimelineStage } from '../src/types';

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass += 1;
    console.log(`✔ ${name}`);
  } else {
    fail += 1;
    console.log(`✘ ${name}\n   получено: ${g}\n   ожидалось: ${w}`);
  }
};
/** Номер дня из ISO-даты — та же математика, что в приложении (день = UTC-дата / 86400000). */
const D = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const stage = (id: string, type: string, planned: string, actual: string, order = 0): TimelineStage => ({
  id,
  type,
  label: '',
  order,
  plannedDate: planned,
  actualDate: actual,
  isCritical: false,
  action: '',
  reason: '',
} as unknown as TimelineStage);

const stripesOf = (list: Array<Partial<RowStripeInput> & { kind: RowStripeInput['kind']; a: number; b: number }>): RowStripeInput[] =>
  list.map((s) => ({ fracA: 0, fracB: 1, periodKey: 'bz:1', label: 'Простой', ...s }));

// ── 1. Приоритет типов — одна константа, порядок жизненного цикла ──────────
eq('приоритет: загрузка раньше границы/таможни', DAY_EVENT_PRIORITY.indexOf('stage-load') < DAY_EVENT_PRIORITY.indexOf('stage-border'), true);
eq('приоритет: выгрузка раньше начала простоя/ремонта', DAY_EVENT_PRIORITY.indexOf('stage-unload') < DAY_EVENT_PRIORITY.indexOf('period-start'), true);
eq('приоритет: окончание ремонта раньше срока готовности', DAY_EVENT_PRIORITY.indexOf('repair-end') < DAY_EVENT_PRIORITY.indexOf('ready'), true);
eq('приоритет: срок готовности раньше выезда', DAY_EVENT_PRIORITY.indexOf('ready') < DAY_EVENT_PRIORITY.indexOf('departure'), true);
eq('приоритет: выезд раньше следующего рейса', DAY_EVENT_PRIORITY.indexOf('departure') < DAY_EVENT_PRIORITY.indexOf('trip-start'), true);
eq('категория типа: cust_in → таможня/граница', stageCatOf('cust_in'), 'stage-border');
eq('категория типа: unl → выгрузка', stageCatOf('unl'), 'stage-unload');

// ── 2. layoutDaySlots: выгрузка + начало ремонта (две половины) ────────────
{
  const evs: DayCellEvent[] = [
    { mergeKey: stageMergeKeyOf('pd:1', 's4'), cat: 'stage-unload', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's4' }, label: 'Выгрузка' },
    { mergeKey: periodMergeKey('bz:1'), cat: 'period-start', ref: { type: 'period', periodKey: 'bz:1' }, label: 'Ремонт' },
  ];
  const slots = layoutDaySlots(100, evs);
  eq('выгрузка+ремонт: две доли', slots.length, 2);
  eq('выгрузка слева (0..0.5)', [slots[0].refs[0].type === 'stage', slots[0].left, slots[0].right], [true, 0, 0.5]);
  eq('ремонт справа (0.5..1)', [slots[1].refs[0].type, slots[1].left, slots[1].right], ['period', 0.5, 1]);
}
// ── 3. layoutDaySlots: окончание ремонта + срок готовности ─────────────────
{
  const evs: DayCellEvent[] = [
    { mergeKey: periodMergeKey('bz:2'), cat: 'ready', ref: { type: 'period', periodKey: 'bz:2' }, label: 'срок готовности' },
    { mergeKey: periodMergeKey('bz:1'), cat: 'repair-end', ref: { type: 'period', periodKey: 'bz:1' }, label: 'окончание ремонта' },
  ];
  const slots = layoutDaySlots(50, evs);
  eq('окончание ремонта слева, готовность справа', slots.map((s) => s.labels[0]), ['окончание ремонта', 'срок готовности']);
  eq('доли: половины', slots.map((s) => [s.left, s.right]), [[0, 0.5], [0.5, 1]]);
}
// ── 4. Три события в дне — равные трети; порядок по времени при наличии ────
{
  const evs: DayCellEvent[] = [
    { mergeKey: 'st:1|s3', cat: 'stage-border', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's3' }, label: 'Граница' },
    { mergeKey: 'st:1|s1', cat: 'stage-load', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's1' }, label: 'Загрузка' },
    { mergeKey: 'st:1|s2', cat: 'stage-border', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's2' }, label: 'Затаможка' },
  ];
  const slots = layoutDaySlots(10, evs);
  eq('три события: трети', slots.map((s) => [s.left, s.right]), [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]);
  eq('порядок: загрузка → таможня → граница (по жизненному циклу)', slots.map((s) => s.labels[0]), ['Загрузка', 'Затаможка', 'Граница']);
}
{
  const evs: DayCellEvent[] = [
    { mergeKey: 'st:1|s2', cat: 'stage-load', time: '15:00', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's2' }, label: 'Поздняя загрузка' },
    { mergeKey: 'st:1|s1', cat: 'stage-load', time: '08:00', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's1' }, label: 'Ранняя загрузка' },
  ];
  const slots = layoutDaySlots(11, evs);
  eq('есть время: раньше по времени — слева', slots.map((s) => s.labels[0]), ['Ранняя загрузка', 'Поздняя загрузка']);
}
{
  const evs: DayCellEvent[] = [
    { mergeKey: 'st:1|s2', cat: 'stage-load', time: '15:00', ref: { type: 'stage', tripKey: 'pd:1', stageId: 's2' }, label: 'Загрузка (15:00)' },
    { mergeKey: 'st:1|s1', cat: 'stage-unload', time: null, ref: { type: 'stage', tripKey: 'pd:1', stageId: 's1' }, label: 'Выгрузка (без времени)' },
  ];
  const slots = layoutDaySlots(12, evs);
  eq('время только у одного: порядок по циклу (загрузка раньше выгрузки)', slots.map((s) => s.labels[0]), ['Загрузка (15:00)', 'Выгрузка (без времени)']);
}

// ── 5. Якоря дня смены: выгрузка/окончание рейса слева, простой справа ─────
{
  const B = D('2026-10-08');
  const stages: StageFillInput[] = [{ tripKey: 'pd:1', stage: stage('s4', 'unl', '2026-10-08', '2026-10-08'), archived: false }];
  const stripes: RowStripeInput[] = stripesOf([
    { kind: 'base-fact', a: B, b: B + 10, fracA: 0.5, fracB: 0.5, label: 'Фактический простой на базе' },
    { kind: 'repair', a: B, b: B + 8, fracA: 0, fracB: 1, label: 'Ремонт' },
  ]);
  const tripSides = new Map<string, TripSide>([['pd:1', { startDay: null, endDay: B }]]);
  const sec = buildRowDaySections({
    kind: 'fact', vs: B - 5, ve: B + 20, stages,
    stageLabelOf: () => 'Выгрузка',
    stripes, marks: [], tripSides,
  });
  const slots = sec.byDay.get(B)!;
  eq('день смены: две доли', slots.length, 2);
  eq('выгрузка слева, простой справа', slots.map((s) => (s.refs[0].type === 'stage' ? 'этап' : 'период')), ['этап', 'период']);
  eq('доли день смены: [0,0.5] и [0.5,1]', slots.map((s) => [s.left, s.right]), [[0, 0.5], [0.5, 1]]);
  const stageSlot = sec.slotForStage(B, 'pd:1', 's4')!;
  eq('этап получил свою долю', [stageSlot.section, stageSlot.sections], [0, 2]);
  const periodSlot = sec.slotForPeriod(B, periodMergeKey('bz:1'))!;
  eq('период получил правую долю', [periodSlot.section, periodSlot.sections], [1, 2]);
  const nr = sec.neighborsOf(B, [periodMergeKey('bz:1')]);
  eq('соседнее событие дня в подсказке (без дублей)', nr, 'В этот день также: Выгрузка.');
}

// ── 6. ПЛАН и ФАКТ — разные строки (плановые даты слева в «Плане») ─────────
{
  const stages: StageFillInput[] = [{ tripKey: 'pd:1', stage: stage('s1', 'load', '2026-10-01', '2026-10-02'), archived: false }];
  const W = [D('2026-09-25'), D('2026-10-10')] as const;
  const planSec = buildRowDaySections({ kind: 'plan', vs: W[0], ve: W[1], stages, stageLabelOf: () => 'Загрузка', stripes: [], marks: [], tripSides: new Map() });
  const factSec = buildRowDaySections({ kind: 'fact', vs: W[0], ve: W[1], stages, stageLabelOf: () => 'Загрузка', stripes: [], marks: [], tripSides: new Map() });
  const planDay = D('2026-10-01');
  const factDay = D('2026-10-02');
  eq('ПЛАН: заливка по плановой дате', !!planSec.slotForStage(planDay, 'pd:1', 's1') && !planSec.slotForStage(factDay, 'pd:1', 's1'), true);
  eq('ФАКТ: заливка по фактической дате', !!factSec.slotForStage(factDay, 'pd:1', 's1') && !factSec.slotForStage(planDay, 'pd:1', 's1'), true);
}

// ── 7. Слияние отметки со своей полосой (готовность + конец плана базы) ────
{
  const R = D('2026-10-18');
  const marks: BzMark[] = [{ kind: 'ready', day: R, periodKey: 'bz:5', archived: false, label: 'плановое окончание базы', title: 'x' }];
  const stripes: RowStripeInput[] = stripesOf([{ kind: 'base-plan', a: R - 5, b: R, periodKey: 'bz:5', label: 'Плановый простой на базе' }]);
  const sec = buildRowDaySections({ kind: 'plan', vs: R - 10, ve: R + 5, stages: [], stageLabelOf: () => '', stripes, marks, tripSides: new Map() });
  const slots = sec.byDay.get(R)!;
  eq('отметка и полоса своей записи — одна доля (не наложение)', slots.length, 1);
  eq('доля на весь день', [slots[0].left, slots[0].right], [0, 1]);
  eq('отметка нашла свою долю', [sec.slotForPeriod(R, periodMergeKey('bz:5'))!.section, sec.slotForPeriod(R, periodMergeKey('bz:5'))!.sections], [0, 1]);
}

// ── 8. visibleStripeBounds / tripSidesOf — общие для отрисовки ─────────────
{
  const stripe = { kind: 'base-fact', a: 100, b: 110, periodKey: 'bz:1' } as Pick<BzStripe, 'kind' | 'a' | 'b' | 'periodKey'>;
  const ov = { tripAdjust: new Map(), baseAdjust: new Map([['bz:1', { a: 100, b: 104, fracA: 0.5, fracB: 0.5, cutA: true, cutB: true, truncatedDays: 0, open: false }]]), markers: [], warnings: [], waitGaps: [] };
  eq('visibleStripeBounds: укорочение из разрешения наложений', visibleStripeBounds(stripe, ov as never), { a: 100, b: 104, fracA: 0.5, fracB: 0.5 });
  const sides = tripSidesOf([{ tripKey: 'pd:9', a: 100, b: 105 }], { tripAdjust: new Map([['pd:9', { fracA: 0.5, fracB: 0.5, cutA: true, cutB: true, overlap: false }]]), baseAdjust: new Map(), markers: [], warnings: [], waitGaps: [] } as never);
  eq('tripSidesOf: дни среза полосы рейса', sides.get('pd:9'), { startDay: 100, endDay: 105 });
}

// ── 9. Более двух событий с якорем: доли половины рейса делятся между этапами ──
{
  const stages: StageFillInput[] = [
    { tripKey: 'pd:2', stage: stage('a', 'unl', '2026-10-20', '2026-10-20'), archived: false },
    { tripKey: 'pd:2', stage: stage('b', 'cust_in', '2026-10-20', '2026-10-20', 1), archived: false },
  ];
  const T = D('2026-10-20');
  const stripes: RowStripeInput[] = stripesOf([{ kind: 'base-fact', a: T - 20, b: T, fracA: 0, fracB: 0.5, periodKey: 'bz:7', label: 'Фактический простой на базе' }]);
  // рейс НАЧИНАЕТСЯ в день выезда (полоса срезана с середины): его события — справа
  const tripSides = new Map<string, TripSide>([['pd:2', { startDay: T, endDay: null }]]);
  const sec = buildRowDaySections({ kind: 'fact', vs: T - 25, ve: T + 5, stages, stageLabelOf: (it) => it.stage.id, stripes, marks: [], tripSides });
  const slots = sec.byDay.get(T)!;
  eq('простой слева, этапы рейса справа (по циклу: таможня раньше выгрузки)', slots.map((s) => (s.refs[0].type === 'period' ? 'период' : 'этап:' + (s.refs[0] as { stageId: string }).stageId)), ['период', 'этап:b', 'этап:a']);
  eq('доли: простой [0,0.5], этапы по четверти', slots.map((s) => [s.left, s.right]), [[0, 0.5], [0.5, 0.75], [0.75, 1]]);
}

console.log(`\nИтог: ${pass} проверок пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
