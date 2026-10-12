/**
 * Тесты чистой логики событий ремонта окна «Учёт выезда / период на базе»
 * (lib/repairEvents): разбор вложенной ветки, типы, предложение сдвига срока
 * и раскладка точек над полосой. Формулы дней/сроков НЕ проверяются здесь —
 * они живут в существующих lib/sources и не менялись.
 */
import {
  layoutEventDots,
  MAX_DOTS_PER_DAY,
  parseRepairEvents,
  pendingWaitEvent,
  proposedReadyShift,
  repairEventDotColor,
  repairEventLabel,
  SHIFT_DAYS_FOR_WAIT,
  type RepairEvent,
} from '../src/components/modules/tripTimeline/lib/repairEvents';
import { dayNum, dayStr } from '../src/components/modules/tripTimeline/lib/timeline';

let passed = 0;
let failed = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  }
};

const D = (iso: string) => dayNum(iso) as number;

console.log('1. Разбор ветки событий (parseRepairEvents)');
{
  const parsed = parseRepairEvents({
    b: { id: 'b', date: '2026-10-12', type: 'wait-part', text: 'Поставка', amount: 1200, author: 'Пётр', createdAt: '2026-10-12T08:00:00Z' },
    a: { id: 'a', date: '2026-10-10', type: 'diag', text: '', author: 'Пётр', createdAt: '2026-10-10T08:00:00Z' },
  });
  ok('сортировка по дате (a раньше b)', parsed.map((e) => e.id).join(',') === 'a,b', parsed.map((e) => e.id));
  ok('день посчитан', parsed[1]?.day === D('2026-10-12'), parsed[1]?.day);
  ok('amount числом', parsed[1]?.amount === 1200);
  ok('пустой amount → null', parsed[0]?.amount === null);
  ok('отсутствие ветки → []', parseRepairEvents(undefined).length === 0);
  ok('мусор отбрасывается', parseRepairEvents({ x: null, y: { text: 'без id' } }).length === 0);
  const noDate = parseRepairEvents({ z: { id: 'z', type: 'other', text: 'без даты' } });
  ok('событие без даты сохраняется (day null)', noDate.length === 1 && noDate[0].day === null);
  ok('незнакомый тип не теряется', repairEventLabel('custom-x') === 'custom-x');
  ok('подпись типа известного', repairEventLabel('wait-part') === 'Ждём запчасть');
  ok('цвет точки у незнакомого типа — серый', repairEventDotColor('custom-x') === '#6B7280');
  // события одного дня сортируются по createdAt (порядок внесения)
  const sameDay = parseRepairEvents({
    c2: { id: 'c2', date: '2026-10-11', type: 'work', createdAt: '2026-10-11T10:00:00Z' },
    c1: { id: 'c1', date: '2026-10-11', type: 'diag', createdAt: '2026-10-11T09:00:00Z' },
  });
  ok('один день: по порядку внесения', sameDay.map((e) => e.id).join(',') === 'c1,c2');
}

console.log('2. Предложение сдвига срока готовности (proposedReadyShift)');
{
  const today = '2026-10-12';
  const p1 = proposedReadyShift('2026-10-16', '2026-10-12', today);
  ok('срок позже события → база = срок + 7 дн', p1?.toIso === '2026-10-23' && p1?.fromIso === '2026-10-16', p1);
  const p2 = proposedReadyShift('2026-10-01', '2026-10-12', today);
  ok('срок раньше события → база = дата события + 7 дн', p2?.toIso === '2026-10-19', p2);
  const p3 = proposedReadyShift('', '2026-10-05', today);
  ok('срока нет → база = сегодня/событие, назначается + 7 дн', p3?.toIso === '2026-10-19' && p3?.fromIso === '', p3);
  const p4 = proposedReadyShift('', '', today);
  ok('ни срока, ни даты события → от сегодня + 7 дн', p4?.toIso === '2026-10-19', p4);
  ok('шаг сдвига — константа 7 дн', p1?.days === SHIFT_DAYS_FOR_WAIT && SHIFT_DAYS_FOR_WAIT === 7);
  ok('сдвиг НИКОГДА не в прошлое', ['2026-01-01', '2026-10-12', ''].every((r) => (proposedReadyShift(r, '2026-10-12', today)?.toIso || '') > today));
}

console.log('3. Ожидающее событие «Ждём запчасть» (pendingWaitEvent)');
{
  const ev = (id: string, date: string, type: string, extra: Partial<RepairEvent> = {}): RepairEvent => ({
    id, dateIso: date, day: D(date), type, text: '', amount: null, author: '', createdAt: `${date}T09:00:00Z`, ...extra,
  });
  const list = [
    ev('w1', '2026-10-10', 'wait-part'),
    ev('d1', '2026-10-11', 'diag'),
    ev('w2', '2026-10-12', 'wait-part'),
  ];
  ok('берётся самое позднее необработанное', pendingWaitEvent(list)?.id === 'w2');
  ok('после сдвига событие больше не предлагается', pendingWaitEvent([ev('w1', '2026-10-10', 'wait-part', { shiftedReadyTo: '2026-10-17' })]) === null);
  ok('без «ждём запчасть» предложений нет', pendingWaitEvent([ev('d1', '2026-10-11', 'diag')]) === null);
}

console.log('4. Раскладка точек над полосой (layoutEventDots)');
{
  const ev = (id: string, date: string, type = 'diag', text = ''): RepairEvent => ({
    id, dateIso: date, day: D(date), type, text, amount: null, author: '', createdAt: `${date}T09:00:00Z`,
  });
  const xOf = (d: number) => (d - D('2026-10-01')) * 30; // 30px/день, полоса от 1 окт
  const dayW = 30;
  const one = layoutEventDots([ev('e1', '2026-10-05')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('одно событие — одна точка в центре дня', one.length === 1 && one[0].x === 4 * 30 + 15, one);
  const multi = layoutEventDots([ev('a', '2026-10-05'), ev('b', '2026-10-05'), ev('c', '2026-10-05')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('события одного дня — рядом (шаг 9px)', multi.length === 3 && multi[1].x - multi[0].x === 9 && multi[2].x - multi[1].x === 9, multi.map((d) => d.x));
  const many = layoutEventDots(
    [ev('a', '2026-10-05'), ev('b', '2026-10-05'), ev('c', '2026-10-05'), ev('d', '2026-10-05')],
    D('2026-10-01'), D('2026-10-10'), xOf, dayW,
  );
  ok(`не больше ${MAX_DOTS_PER_DAY} точек в день, лишние в extra`, many.length === MAX_DOTS_PER_DAY && many[MAX_DOTS_PER_DAY - 1].extra === 1, many);
  const clipped = layoutEventDots([ev('x', '2026-09-28'), ev('y', '2026-10-05'), ev('z', '2026-10-12')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('события вне видимого отрезка полосы пропускаются', clipped.length === 1 && clipped[0].items[0].id === 'y');
  const order = layoutEventDots([ev('l', '2026-10-07'), ev('m', '2026-10-03')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('точки в порядке дней', order[0].day === D('2026-10-03') && order[1].day === D('2026-10-07'));
  const empty = layoutEventDots([], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('нет событий — нет точек', empty.length === 0);
  ok('isoOfDay обратен dayStr', dayStr(D('2026-10-05')) === '2026-10-05');
}

console.log('');
console.log(failed === 0 ? `ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (${passed})` : `ПРОВАЛЕНО ${failed} из ${passed + failed}`);
if (failed > 0) process.exit(1);
