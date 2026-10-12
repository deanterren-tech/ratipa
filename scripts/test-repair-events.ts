/**
 * Тесты чистой логики событий на базе окна «Учёт выезда / период на базе»
 * (lib/repairEvents): разбор вложенной ветки, десять типов (со старыми
 * ключами), порядок внесения seq (max+1, фолбэк старых, сортировка «дата, seq»),
 * проверка дат по границам периода, предложение сдвига срока и раскладка точек
 * над полосой. Формулы дней/сроков НЕ проверяются здесь — они живут в
 * существующих lib/sources и не менялись.
 */
import {
  canonicalEventType,
  EVENT_DATE_OUT_OF_RANGE,
  eventDateLimits,
  eventSeqRanks,
  eventsOutOfRange,
  isEventDateAllowed,
  isValidEventSeq,
  layoutEventDots,
  LEGACY_EVENT_TYPE_KEYS,
  MAX_DOTS_PER_DAY,
  nextEventSeq,
  orderEvents,
  parseRepairEvents,
  pendingWaitEvent,
  proposedReadyShift,
  repairEventDotColor,
  repairEventLabel,
  REPAIR_EVENT_TYPES,
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
const ev = (id: string, date: string, extra: Partial<RepairEvent> = {}): RepairEvent => ({
  id,
  dateIso: date,
  day: D(date),
  type: 'diag',
  text: '',
  amount: null,
  seq: null,
  author: '',
  createdAt: `${date}T09:00:00Z`,
  ...extra,
});

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
  // события одного дня сортируются по порядку внесения (createdAt) — старые записи без seq
  const sameDay = parseRepairEvents({
    c2: { id: 'c2', date: '2026-10-11', type: 'work', createdAt: '2026-10-11T10:00:00Z' },
    c1: { id: 'c1', date: '2026-10-11', type: 'diag', createdAt: '2026-10-11T09:00:00Z' },
  });
  ok('один день: по порядку внесения', sameDay.map((e) => e.id).join(',') === 'c1,c2');
  // seq: читается целым; мусор/ноль/отрицательные → null (фолбэк по createdAt)
  const withSeq = parseRepairEvents({
    s2: { id: 's2', date: '2026-10-11', type: 'work', seq: 2, createdAt: '2026-10-11T10:00:00Z' },
    s1: { id: 's1', date: '2026-10-11', type: 'diag', seq: 1, createdAt: '2026-10-11T11:00:00Z' },
    bad: { id: 'bad', date: '2026-10-11', type: 'docs', seq: 'не число', createdAt: '2026-10-11T09:00:00Z' },
    zero: { id: 'zero', date: '2026-10-11', type: 'wash', seq: 0, createdAt: '2026-10-11T08:00:00Z' },
  });
  ok('seq читается целым (2 → 2)', withSeq.find((e) => e.id === 's2')?.seq === 2);
  ok('битый seq → null', withSeq.find((e) => e.id === 'bad')?.seq === null && withSeq.find((e) => e.id === 'zero')?.seq === null);
  ok(
    'сортировка одного дня: по номеру (seq или фолбэк), ничьи — по createdAt',
    withSeq.map((e) => e.id).join(',') === 'zero,s1,bad,s2',
    withSeq.map((e) => e.id),
  );
  ok('isValidEventSeq: 1/3.9 → да; 0, −2, «», null, мусор → нет', isValidEventSeq(1) && isValidEventSeq(3.9) && ![0, -2, '', null, undefined, 'x'].some((v) => isValidEventSeq(v)));
}

console.log('2. Десять типов и старые ключи (REPAIR_EVENT_TYPES)');
{
  ok('ровно десять типов', REPAIR_EVENT_TYPES.length === 10, REPAIR_EVENT_TYPES.map((t) => t.key));
  ok(
    'ключи: шесть прежних + четыре новых',
    ['diag', 'wait-part', 'part-arrived', 'work', 'done', 'other', 'to', 'wash', 'no-driver', 'docs'].every((k) =>
      REPAIR_EVENT_TYPES.some((t) => t.key === k),
    ),
  );
  ok(
    'подписи ровно из ТЗ',
    REPAIR_EVENT_TYPES.map((t) => t.label).join('|') ===
      'Диагностика|Ждём запчасть|Запчасть приехала|Работы идут|Сдана с ремонта|ТО|Мойка|Простой без водителя|Документы|Другое',
    REPAIR_EVENT_TYPES.map((t) => t.label),
  );
  // уже сохранённые ключи НЕ теряются: подписи прежних шести не изменились
  ok(
    'прежние ключи читаются как раньше',
    repairEventLabel('diag') === 'Диагностика' &&
      repairEventLabel('part-arrived') === 'Запчасть приехала' &&
      repairEventLabel('done') === 'Сдана с ремонта' &&
      repairEventLabel('other') === 'Другое',
  );
  // старые/альтернативные ключи приводятся к каноническим подписям (маппинг при чтении)
  ok('легаси-ключ diagnostics → подпись «Диагностика»', repairEventLabel('diagnostics') === 'Диагностика');
  ok('легаси-ключ waiting → «Ждём запчасть»', repairEventLabel('waiting') === 'Ждём запчасть');
  ok('легаси-ключ maintenance → «ТО»', repairEventLabel('maintenance') === 'ТО');
  ok('канонизация: diagnostics → diag', canonicalEventType('diagnostics') === 'diag' && canonicalEventType('to') === 'to');
  ok('цвет легаси-ключа = цвет канонического', repairEventDotColor('diagnostics') === repairEventDotColor('diag'));
  ok('незнакомый ключ НЕ подменяется', repairEventLabel('свой-тип') === 'свой-тип' && canonicalEventType('свой-тип') === 'свой-тип');
  ok('маппинг легаси — только чтение (ключ в базе не меняется)', LEGACY_EVENT_TYPE_KEYS.diagnostics === 'diag');
  const colors = REPAIR_EVENT_TYPES.map((t) => repairEventDotColor(t.key));
  ok('все десять типов имеют цвет точки (нет серых по умолчанию)', colors.filter((c) => c === '#6B7280').length === 1);
}

console.log('3. Порядок внесения: nextEventSeq, фолбэк старых, сортировка (дата, seq)');
{
  ok('пустая лента → seq 1', nextEventSeq([]) === 1);
  ok('max(seq)+1: [1,2] → 3', nextEventSeq([ev('a', '2026-10-01', { seq: 1 }), ev('b', '2026-10-02', { seq: 2 })]) === 3);
  ok('дыры учитываются: [1,5] → 6', nextEventSeq([ev('a', '2026-10-01', { seq: 1 }), ev('b', '2026-10-02', { seq: 5 })]) === 6);
  // старые записи без seq: номер по фолбэку (createdAt), новые идут после них
  const legacyTwo = [
    ev('l2', '2026-10-01', { createdAt: '2026-10-01T10:00:00Z' }),
    ev('l1', '2026-10-01', { createdAt: '2026-10-01T09:00:00Z' }),
  ];
  ok('две старые записи без seq → следующий 3 (фолбэк 1..2)', nextEventSeq(legacyTwo) === 3, nextEventSeq(legacyTwo));
  ok(
    'смешанный случай: seq 5 + две старые → 6',
    nextEventSeq([ev('n', '2026-10-05', { seq: 5 }), ...legacyTwo]) === 6,
  );
  const ranks = eventSeqRanks(legacyTwo);
  ok('эффективные номера старых: l1=1, l2=2 (по createdAt)', ranks.get('l1') === 1 && ranks.get('l2') === 2, [...ranks]);
  // сортировка (дата, seq): сначала дата, потом номер внесения, старые — по фолбэку
  const mixed = orderEvents([
    ev('c', '2026-10-02', { seq: 9 }),
    ev('a', '2026-10-02', { seq: 2 }),
    ev('l', '2026-10-02', { createdAt: '2026-10-01T00:00:00Z' }),
    ev('d', '2026-10-01', { seq: 7 }),
  ]);
  ok('дата первична, затем seq (старые в начале дня)', mixed.map((e) => e.id).join(',') === 'd,l,a,c', mixed.map((e) => e.id));
  const seqSort = orderEvents([ev('x2', '2026-10-03', { seq: 2 }), ev('x1', '2026-10-03', { seq: 1 })]);
  ok('один день: seq по возрастанию (раньше внесён — выше)', seqSort.map((e) => e.id).join(',') === 'x1,x2');
  const dateSort = orderEvents([ev('y2', '2026-10-05', { seq: 1 }), ev('y1', '2026-10-04', { seq: 99 })]);
  ok('дата важнее seq: 04/10 выше 05/10', dateSort.map((e) => e.id).join(',') === 'y1,y2');
  const noDateEvents = orderEvents([ev('n', '', { day: null }), ev('m', '2026-10-01')]);
  ok('события без даты — в конец', noDateEvents.map((e) => e.id).join(',') === 'm,n');
}

console.log('4. Даты события: границы периода включительно (eventDateLimits/isEventDateAllowed)');
{
  // приезд 02/10, выезд 12/10 — обе границы включительно
  const lim = eventDateLimits('2026-10-02', '2026-10-12', '2026-10-20');
  ok('приезд — включительно', isEventDateAllowed('2026-10-02', lim));
  ok('выезд — включительно', isEventDateAllowed('2026-10-12', lim));
  ok('внутри — можно', isEventDateAllowed('2026-10-07', lim));
  ok('до приезда — нельзя', !isEventDateAllowed('2026-10-01', lim));
  ok('после выезда — нельзя', !isEventDateAllowed('2026-10-13', lim));
  // выезда нет — верхняя граница = сегодня
  const limToday = eventDateLimits('2026-10-02', '', '2026-10-20');
  ok('без выезда: сегодня — включительно', isEventDateAllowed('2026-10-20', limToday));
  ok('без выезда: завтра — нельзя', !isEventDateAllowed('2026-10-21', limToday));
  ok('без выезда: низ не задет', isEventDateAllowed('2026-10-02', limToday) && !isEventDateAllowed('2026-10-01', limToday));
  // дата приезда не указана — нижней границы нет (верхняя действует)
  const limNoArr = eventDateLimits('', '2026-10-12', '2026-10-20');
  ok('без приезда: нижней границы нет', isEventDateAllowed('2000-01-01', limNoArr) && isEventDateAllowed('2026-10-12', limNoArr));
  ok('без приезда: верхняя граница действует', !isEventDateAllowed('2026-10-13', limNoArr));
  // обратные даты (выезд раньше приезда) — допустимых дат нет
  const limBad = eventDateLimits('2026-10-12', '2026-10-02', '2026-10-20');
  ok('выезд раньше приезда — ни одна дата не проходит', !isEventDateAllowed('2026-10-07', limBad));
  ok('пустая/битая дата события — отказ', !isEventDateAllowed('', lim) && !isEventDateAllowed('не дата', lim));
  ok('сообщение валидации — из ТЗ', EVENT_DATE_OUT_OF_RANGE === 'Дата вне периода на базе');
  // предупреждение при смене дат периода: список только «датированных» событий вне диапазона
  const limNew = eventDateLimits('2026-10-02', '2026-10-05', '2026-10-20');
  const outside = eventsOutOfRange(
    [ev('in', '2026-10-04'), ev('out1', '2026-10-07'), ev('out2', '2026-10-11'), ev('nodate', '', { day: null })],
    limNew,
  );
  ok('вне нового диапазона — только датированные (2), без удалений', outside.map((e) => e.id).join(',') === 'out1,out2', outside.map((e) => e.id));
  ok('события вне диапазона НЕ теряются (возвращаются как список)', outside.every((e) => e.id && e.dateIso));
}

console.log('5. Предложение сдвига срока готовности (proposedReadyShift)');
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

console.log('6. Ожидающее событие «Ждём запчасть» (pendingWaitEvent)');
{
  const list = [
    ev('w1', '2026-10-10', { type: 'wait-part' }),
    ev('d1', '2026-10-11', { type: 'diag' }),
    ev('w2', '2026-10-12', { type: 'wait-part' }),
  ];
  ok('берётся самое позднее необработанное', pendingWaitEvent(list)?.id === 'w2');
  ok('после сдвига событие больше не предлагается', pendingWaitEvent([ev('w1', '2026-10-10', { type: 'wait-part', shiftedReadyTo: '2026-10-17' })]) === null);
  ok('без «ждём запчасть» предложений нет', pendingWaitEvent([ev('d1', '2026-10-11', { type: 'diag' })]) === null);
}

console.log('7. Раскладка точек над полосой (layoutEventDots)');
{
  const xOf = (d: number) => (d - D('2026-10-01')) * 30; // 30px/день, полоса от 1 окт
  const dayW = 30;
  const one = layoutEventDots([ev('e1', '2026-10-05')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('одно событие — одна точка в центре дня', one.length === 1 && one[0].x === 4 * 30 + 15, one);
  const multi = layoutEventDots([ev('a', '2026-10-05'), ev('b', '2026-10-05'), ev('c', '2026-10-05')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('события одного дня — рядом (шаг 9px)', multi.length === 3 && multi[1].x - multi[0].x === 9 && multi[2].x - multi[1].x === 9, multi.map((d) => d.x));
  // несколько событий в один день — слева направо по seq (раньше внесено — левее)
  const bySeq = layoutEventDots(
    [ev('b', '2026-10-05', { seq: 2 }), ev('a', '2026-10-05', { seq: 1 }), ev('c', '2026-10-05', { seq: 3 })],
    D('2026-10-01'), D('2026-10-10'), xOf, dayW,
  );
  ok('точки одного дня идут по seq слева направо', bySeq.map((d) => d.items[0].id).join(',') === 'a,b,c' && bySeq[0].x < bySeq[1].x && bySeq[1].x < bySeq[2].x, bySeq.map((d) => `${d.items[0].id}@${d.x}`));
  const legacyDay = layoutEventDots(
    [
      ev('new', '2026-10-05', { seq: 5, createdAt: '2026-10-05T12:00:00Z' }),
      ev('old2', '2026-10-05', { createdAt: '2026-10-01T10:00:00Z' }),
      ev('old1', '2026-10-05', { createdAt: '2026-10-01T09:00:00Z' }),
    ],
    D('2026-10-01'), D('2026-10-10'), xOf, dayW,
  );
  ok('старые записи без seq — слева, по createdAt', legacyDay.map((d) => d.items[0].id).join(',') === 'old1,old2,new', legacyDay.map((d) => d.items[0].id));
  const many = layoutEventDots(
    [ev('a', '2026-10-05', { seq: 1 }), ev('b', '2026-10-05', { seq: 2 }), ev('c', '2026-10-05', { seq: 3 }), ev('d', '2026-10-05', { seq: 4 })],
    D('2026-10-01'), D('2026-10-10'), xOf, dayW,
  );
  ok(`не больше ${MAX_DOTS_PER_DAY} точек в день, лишние в extra`, many.length === MAX_DOTS_PER_DAY && many[MAX_DOTS_PER_DAY - 1].extra === 1, many);
  const clipped = layoutEventDots([ev('x', '2026-09-28'), ev('y', '2026-10-05'), ev('z', '2026-10-12')], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('события вне видимого отрезка полосы пропускаются', clipped.length === 1 && clipped[0].items[0].id === 'y');
  const order = layoutEventDots([ev('l', '2026-10-07', { seq: 1 }), ev('m', '2026-10-03', { seq: 2 })], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('точки в порядке дней', order[0].day === D('2026-10-03') && order[1].day === D('2026-10-07'));
  const empty = layoutEventDots([], D('2026-10-01'), D('2026-10-10'), xOf, dayW);
  ok('нет событий — нет точек', empty.length === 0);
  ok('isoOfDay обратен dayStr', dayStr(D('2026-10-05')) === '2026-10-05');
}

console.log('');
console.log(failed === 0 ? `ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (${passed})` : `ПРОВАЛЕНО ${failed} из ${passed + failed}`);
if (failed > 0) process.exit(1);
