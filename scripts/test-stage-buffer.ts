/**
 * Тесты чистой логики «этапы: seq + запас (bufferDays)» (lib/stageSchedule)
 * и связанных правил: цепочка плановых дат, накопление запаса, порядок
 * «раньше внесён — левее» (seq → order → позиция), «план без запаса / запас /
 * итого», критический срок от даты С ЗАПАСОМ (lib/timeline) и гейт плана
 * (lib/planLock).
 *
 * Запуск: npx tsx scripts/test-stage-buffer.ts  (или npm run test:stage-buffer)
 */
import type { TimelineStage, TimelineTrip } from '../src/types';
import {
  buildStageSchedule,
  stageBufferOf,
  stageBufferStateOf,
  stageBufferStateTone,
  stageRouteCmp,
  stageSeqOf,
} from '../src/components/modules/tripTimeline/lib/stageSchedule';
import { getDeadlineStatus } from '../src/components/modules/tripTimeline/lib/timeline';
import { computePlanStageChanges } from '../src/components/modules/tripTimeline/lib/planLock';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra: unknown = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra !== '' ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
};

const D = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

let sid = 0;
const st = (
  planned: string,
  extra: Partial<TimelineStage> = {},
): TimelineStage => {
  sid += 1;
  return {
    id: extra.id ?? `s${sid}`,
    type: 'load',
    label: '',
    plannedDate: planned,
    actualDate: '',
    isCritical: false,
    order: sid,
    ...extra,
  };
};

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Порядок этапа: seq → order → позиция (миграционный порядок)');
{
  check('seq=3, order=9 → 3 (seq важнее order)', stageSeqOf({ ...st('2026-10-01'), seq: 3, order: 9 }, 0) === 3);
  check('нет seq, order=5 → 5', stageSeqOf({ ...st('2026-10-01'), order: 5 }, 0) === 5);
  check('нет seq и order → позиция+1 (старый рейс)', stageSeqOf({ ...st('2026-10-01'), order: 0 }, 3) === 4);
  check('seq=0 → падение к order', stageSeqOf({ ...st('2026-10-01'), seq: 0, order: 7 }, 0) === 7);
  check('битый seq ("abc") → order', stageSeqOf({ ...st('2026-10-01'), seq: 'abc' as unknown as number, order: 2 }, 0) === 2);
  check('seq=2.7 → floor 2', stageSeqOf({ ...st('2026-10-01'), seq: 2.7 }, 0) === 2);
  check('старый этап БЕЗ полей seq/order вообще → позиция+1', stageSeqOf({ id: 'x', type: 'load', label: '', plannedDate: '2026-10-01', actualDate: '', isCritical: false } as unknown as TimelineStage, 1) === 2);
}

console.log('2. Запас этапа: целое ≥ 0 (stageBufferOf)');
{
  check('без bufferDays → 0 (старый рейс)', stageBufferOf({ ...st('2026-10-01') }) === 0);
  check('отрицательный → 0', stageBufferOf({ ...st('2026-10-01'), bufferDays: -3 }) === 0);
  check('мусор ("abc") → 0', stageBufferOf({ ...st('2026-10-01'), bufferDays: 'abc' as unknown as number }) === 0);
  check('2.9 → 2 (дни целые)', stageBufferOf({ ...st('2026-10-01'), bufferDays: 2.9 }) === 2);
  check('строковое "3" → 3', stageBufferOf({ ...st('2026-10-01'), bufferDays: '3' as unknown as number }) === 3);
  check('явный 0 → 0', stageBufferOf({ ...st('2026-10-01'), bufferDays: 0 }) === 0);
}

console.log('3. Цепочка плановых дат: накопление запаса (buildStageSchedule)');
{
  const s1 = st('2026-10-01', { id: 'a', order: 1, seq: 1 });
  const s2 = st('2026-10-03', { id: 'b', order: 2, seq: 2, bufferDays: 2, isCritical: true });
  const s3 = st('2026-10-05', { id: 'c', order: 3, seq: 3, bufferDays: 1 });
  const sch = buildStageSchedule([s1, s2, s3]);
  check('порядок цепочки — по датам', sch.chain.map((c) => c.stageId).join(',') === 'a,b,c');
  check('накопленный запас: 0,2,3', sch.chain.map((c) => c.cumBufferDays).join(',') === '0,2,3', sch.chain.map((c) => c.cumBufferDays));
  check('эффективные даты: 01/10, 05/10 (03/10+2), 08/10 (05/10+3)', sch.chain.map((c) => c.effectiveIso).join(',') === '2026-10-01,2026-10-05,2026-10-08', sch.chain.map((c) => c.effectiveIso));
  check('план без запаса: 01/10 – 05/10', sch.planStartDay === D('2026-10-01') && sch.planEndDay === D('2026-10-05'));
  check('Σ запасов = 3 дн', sch.totalBufferDays === 3);
  check('итого (последняя дата + Σ) = 08/10', sch.effectiveEndDay === D('2026-10-08') && sch.effectiveEndIso === '2026-10-08');
  check('собственный запас этапа сохранён (b: 2)', sch.byId.get('b')?.bufferDays === 2);
  check('флаг крит. срока доехал (b: critical)', sch.byId.get('b')?.isCritical === true && sch.byId.get('a')?.isCritical === false);
  check('этап вне цепочки не в byId', !sch.byId.has('zzz'));
}

console.log('4. Нулевой запас: поведение прежнее (рейс без bufferDays)');
{
  const legacy = [st('2026-09-10', { id: 'l1', seq: undefined as unknown as number }), st('2026-09-12', { id: 'l2', seq: undefined as unknown as number })];
  delete (legacy[0] as unknown as Record<string, unknown>).seq;
  delete (legacy[1] as unknown as Record<string, unknown>).seq;
  const sch = buildStageSchedule(legacy);
  check('Σ запасов = 0', sch.totalBufferDays === 0);
  check('эффективные даты = введённые', sch.chain.every((c) => c.effectiveIso === c.plannedIso));
  check('итого = последняя введённая дата', sch.effectiveEndIso === sch.planEndIso && sch.effectiveEndIso === '2026-09-12');
  check('накопленный запас у всех 0', sch.chain.every((c) => c.cumBufferDays === 0));
  check('нет датированных этапов → итогов нет (даты не выдумываются)', buildStageSchedule([st('', { plannedDate: '' })]).planStartDay === null && buildStageSchedule([st('', { plannedDate: '' })]).effectiveEndDay === null);
}

console.log('5. Несколько этапов в один день: порядок seq (раньше внесён — левее)');
{
  // В массиве b внесён ПОЗЖЕ a (b2), но seq у b больше — цепочка обязана дать a,b.
  const a = st('2026-10-04', { id: 'a', seq: 1, order: 1, bufferDays: 1 });
  const b = st('2026-10-04', { id: 'b', seq: 2, order: 2, bufferDays: 1 });
  const sch = buildStageSchedule([b, a]); // порядок массива — обратный
  check('один день: цепочка по seq (a,b)', sch.chain.map((c) => c.stageId).join(',') === 'a,b', sch.chain.map((c) => c.stageId));
  check('один день: накопление 1,2', sch.chain.map((c) => c.cumBufferDays).join(',') === '1,2');
  check('один день: эффективные даты 05/10 и 06/10', sch.chain.map((c) => c.effectiveIso).join(',') === '2026-10-05,2026-10-06');
  check('Σ = 2 (оба этапа в цепочке)', sch.totalBufferDays === 2);
  // Легаси-этапы того же дня без seq: порядок решает order, затем позиция.
  const l1 = { id: 'l1', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false, order: 5 } as TimelineStage;
  const l2 = { id: 'l2', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false, order: 2 } as TimelineStage;
  check('легаси: один день, порядок по order (l2,l1)', buildStageSchedule([l1, l2]).chain.map((c) => c.stageId).join(',') === 'l2,l1');
  const n1 = { id: 'n1', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false } as TimelineStage;
  const n2 = { id: 'n2', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false } as TimelineStage;
  const n3 = { id: 'n3', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false } as TimelineStage;
  const nsch = buildStageSchedule([n3, n1, n2]);
  check('совсем без seq/order: по позиции массива (n3,n1,n2)', nsch.chain.map((c) => c.stageId).join(',') === 'n3,n1,n2', nsch.chain.map((c) => c.stageId));
  check('тай-брейкер дат вне дня: stageRouteCmp сортирует по дате', stageRouteCmp(st('2026-10-01'), st('2026-10-05')) < 0 && stageRouteCmp(st('2026-10-05'), st('2026-10-01')) > 0);
  check('этап без даты — в конец сортировки', stageRouteCmp(st('2026-10-01'), { ...st(''), plannedDate: '' }) < 0);
}

console.log('6. Перестановка ▲▼: seq перенумеровывается по порядку массива');
{
  // Слепок логики moveStage (TripCard): массив переставляется, seq/order = i+1.
  const mk = () => [
    st('2026-10-02', { id: 'a', seq: 1, order: 1, bufferDays: 1 }),
    st('2026-10-04', { id: 'b', seq: 2, order: 2, bufferDays: 1 }),
    st('2026-10-06', { id: 'c', seq: 3, order: 3, bufferDays: 0 }),
  ];
  const renumber = (arr: TimelineStage[]): TimelineStage[] => arr.map((s, i) => ({ ...s, seq: i + 1, order: i + 1 }));
  const down = (arr: TimelineStage[], id: string): TimelineStage[] => {
    const idx = arr.findIndex((s) => s.id === id);
    const next = [...arr];
    const [m] = next.splice(idx, 1);
    next.splice(idx + 1, 0, m);
    return renumber(next);
  };
  let arr = mk();
  arr = down(arr, 'a');
  check('▲▼: a стал вторым в массиве', arr.map((s) => s.id).join(',') === 'b,a,c');
  check('▲▼: seq перенумерован 1..3 по новому порядку', arr.map((s) => s.seq).join(',') === '1,2,3');
  check('▲▼: order тоже 1..3 (чтение старыми рейсами)', arr.map((s) => s.order).join(',') === '1,2,3');
  const sch = buildStageSchedule(arr);
  check('▲▼: цепочка по датам не зависит от порядка массива (даты первичны)', sch.chain.map((c) => c.stageId).join(',') === 'a,b,c', sch.chain.map((c) => c.stageId));
  // Тот же день: перестановка меняет порядок И эффективные даты (запас едет с этапом).
  const sameDay = renumber([
    st('2026-10-04', { id: 'x', bufferDays: 1 }),
    st('2026-10-04', { id: 'y', bufferDays: 1 }),
  ]);
  check('▲▼ один день: x,y → накопление 1,2', buildStageSchedule(sameDay).chain.map((c) => c.effectiveIso).join(',') === '2026-10-05,2026-10-06');
  const swapped = renumber([sameDay[1], sameDay[0]]);
  check('▲▼ один день после перестановки: y,x → накопление 1,2', buildStageSchedule(swapped).chain.map((c) => c.stageId).join(',') === 'y,x');
  check('▲▼ один день: лидерство в дне перевернулось', buildStageSchedule(swapped).chain[0].stageId === 'y' && buildStageSchedule(sameDay).chain[0].stageId === 'x');
}

console.log('7. Запас и порядок — ЧАСТЬ ПЛАНА (гейт planLock)');
{
  const stored = [
    st('2026-10-02', { id: 'a', seq: 1, order: 1 }),
    st('2026-10-04', { id: 'b', seq: 2, order: 2 }),
  ];
  const draftBuffer = [
    { ...stored[0], bufferDays: 2 },
    { ...stored[1] },
  ];
  const cBuf = computePlanStageChanges(stored, draftBuffer);
  check('правка запаса → изменение плана', cBuf.plannedUpdates.length === 1 && cBuf.plannedUpdates[0].bufferDays === 2 && cBuf.plannedUpdates[0].bufferBefore === 0, cBuf.plannedUpdates);
  const draftOrder = renumberLocal(stored, 'b', 'a');
  const cOrder = computePlanStageChanges(stored, draftOrder);
  check('перестановка (seq) → изменение плана', cOrder.plannedUpdates.some((u) => u.id === 'b' && u.orderBefore === 2 && u.order === 1), cOrder.plannedUpdates);
  check('перестановка: затронуты обе сдвинутые позиции', cOrder.plannedUpdates.some((u) => u.id === 'a' && u.orderBefore === 1 && u.order === 2), cOrder.plannedUpdates);
  const noChange = computePlanStageChanges(stored, stored.map((s) => ({ ...s })));
  check('без правок → изменений нет', noChange.count === 0, noChange);
  check('запас без изменений не считается правкой', computePlanStageChanges(draftBuffer, draftBuffer.map((s) => ({ ...s }))).plannedUpdates.length === 0);

  // ── Ленивая миграция seq: старым этапам номер дописывается первым же
  //    сохранением (значение — показываемый порядок seq→order→позиция), в счёт
  //    изменений плана такие записи НЕ входят (разовое разрешение не горит).
  //    Черновик окна строит toDraft: seq = stageSeqOf(s, i) — повторяем это.
  const withDraftSeq = (arr: TimelineStage[]): TimelineStage[] => arr.map((s, i) => ({ ...s, seq: stageSeqOf(s, i) }));
  const legacy = [
    { id: 'l1', type: 'load', label: '', plannedDate: '2026-10-02', actualDate: '', isCritical: false },
    { id: 'l2', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false },
  ] as TimelineStage[];
  const cBack = computePlanStageChanges(legacy, withDraftSeq(legacy));
  check('старые этапы без seq → кандидаты на дозапись (по позиции 1,2)', cBack.seqBackfill.map((b) => `${b.id}:${b.seq}`).join(',') === 'l1:1,l2:2', cBack.seqBackfill);
  check('дозапись seq НЕ считается изменением плана (count 0)', cBack.count === 0, cBack.count);
  const cBackNone = computePlanStageChanges(stored, stored.map((s) => ({ ...s })));
  check('у этапов с seq кандидатов нет', cBackNone.seqBackfill.length === 0, cBackNone.seqBackfill);
  const legacyOrdered = [
    { id: 'o2', type: 'load', label: '', plannedDate: '2026-10-02', actualDate: '', isCritical: false, order: 5 },
    { id: 'o1', type: 'load', label: '', plannedDate: '2026-10-04', actualDate: '', isCritical: false, order: 2 },
  ] as TimelineStage[];
  const cBackOrder = computePlanStageChanges(legacyOrdered, withDraftSeq(legacyOrdered));
  check('легаси с order: seq дозаписывается из order (5 и 2)', cBackOrder.seqBackfill.map((b) => `${b.id}:${b.seq}`).join(',') === 'o2:5,o1:2', cBackOrder.seqBackfill);
  const draftSwapped = renumberLocal(legacy, 'l2', 'l1');
  const cSwap = computePlanStageChanges(legacy, draftSwapped);
  check('перестановка легаси: seq идёт путём изменения плана, backfill не дублирует', cSwap.plannedUpdates.every((u) => u.seq != null) && cSwap.seqBackfill.length === 0, { plan: cSwap.plannedUpdates.map((u) => `${u.id}:${u.seq}`), back: cSwap.seqBackfill });
}

// Локальная перестановка пары (для теста гейта выше).
function renumberLocal(arr: TimelineStage[], first: string, second: string): TimelineStage[] {
  const pick = (id: string) => arr.find((s) => s.id === id) as TimelineStage;
  return [pick(first), pick(second)].map((s, i) => ({ ...s, seq: i + 1, order: i + 1 }));
}

console.log('8. Критический срок считается от даты С ЗАПАСОМ (lib/timeline)');
{
  const mkTrip = (stages: TimelineStage[]): TimelineTrip => ({
    id: 't1', carNumber: 'АА 0001-7', route: 'probe', bufferDays: 0, stages,
  });
  const crit = (plannedDate: string, bufferDays: number): TimelineStage =>
    st(plannedDate, { id: 'k', isCritical: true, bufferDays, seq: 1, order: 1 });
  const t0202 = D('2026-10-02');
  const noBuf = getDeadlineStatus(mkTrip([crit('2026-10-01', 0)]), t0202);
  check('без запаса: план 01/10 прошёл → срок нарушен (missed)', noBuf.kind === 'missed' && noBuf.level === 3, noBuf);
  const withBuf = getDeadlineStatus(mkTrip([crit('2026-10-01', 3)]), t0202);
  check('запас 3: срок с запасом 04/10 → ещё в норме', withBuf.kind === 'ok' && withBuf.level === 1, withBuf);
  const withBuf07 = getDeadlineStatus(mkTrip([crit('2026-10-01', 3)]), D('2026-10-07'));
  check('запас 3: 07/10 > 04/10 → срок нарушен', withBuf07.kind === 'missed', withBuf07);

  // Накопление: критический этап стоит ПОСЛЕ этапа с запасом — запас предыдущих едет в него.
  const s1 = st('2026-09-28', { id: 'a', seq: 1, order: 1, bufferDays: 2 });
  const s2 = st('2026-10-01', { id: 'b', seq: 2, order: 2, bufferDays: 3, isCritical: true });
  const t5 = getDeadlineStatus(mkTrip([s1, s2]), D('2026-10-05'));
  check('цепочка: крит. срок b = 01/10 + (2+3) = 06/10, 05/10 → под угрозой', t5.kind === 'risk' && t5.level === 2, t5);
  const t7 = getDeadlineStatus(mkTrip([s1, s2]), D('2026-10-07'));
  check('цепочка: 07/10 > 06/10 → срок нарушен', t7.kind === 'missed', t7);
  const done = getDeadlineStatus(mkTrip([s1, { ...s2, actualDate: '2026-10-06' }]), D('2026-10-07'));
  check('цепочка: факт ровно в дату с запасом → не нарушен', done.kind === 'ok', done);
  const doneLate = getDeadlineStatus(mkTrip([s1, { ...s2, actualDate: '2026-10-07' }]), D('2026-10-07'));
  check('цепочка: факт позже даты с запасом → нарушен (violated)', doneLate.kind === 'violated', doneLate);
}

console.log('9. Состояния факта относительно плана С ЗАПАСОМ (stageBufferStateOf)');
{
  const mkSched = (stages: TimelineStage[]) => buildStageSchedule(stages);
  const today = D('2026-10-20');
  const base = st('2026-10-10', { id: 'b1' });

  const ontime = stageBufferStateOf({ ...base, actualDate: '2026-10-10' }, mkSched([base]), today);
  check('факт = план → «в срок» (ontime)', ontime.code === 'ontime' && ontime.label.includes('по плану'), ontime);
  const early = stageBufferStateOf({ ...base, actualDate: '2026-10-08' }, mkSched([base]), today);
  check('факт раньше плана → «в срок» (ontime)', early.code === 'ontime' && early.devDays === -2, early);

  const s2 = { ...base, bufferDays: 2 };
  const within = stageBufferStateOf({ ...s2, actualDate: '2026-10-11' }, mkSched([s2]), today);
  check('факт +1 при запасе 2 → «в пределах запаса»', within.code === 'within' && within.label.includes('в пределах запаса'), within);
  check('within: отклонение от плана и от даты с запасом', within.devDays === 1 && within.bufferDevDays === -1);
  const edge = stageBufferStateOf({ ...s2, actualDate: '2026-10-12' }, mkSched([s2]), today);
  check('факт ровно на границе плана с запасом → ещё within', edge.code === 'within', edge);
  const beyond = stageBufferStateOf({ ...s2, actualDate: '2026-10-13' }, mkSched([s2]), today);
  check('факт за границей запаса → «за пределами запаса»', beyond.code === 'beyond' && beyond.label.includes('за пределами запаса'), beyond);
  check('beyond: bufferDevDays > 0', beyond.bufferDevDays === 1, beyond.bufferDevDays);

  const overdue = stageBufferStateOf(s2, mkSched([s2]), D('2026-10-13'));
  check('факта нет, срок с запасом прошёл → planned-overdue', overdue.code === 'planned-overdue', overdue);
  const planned = stageBufferStateOf(s2, mkSched([s2]), D('2026-10-11'));
  check('факта нет, срок с запасом не прошёл → planned', planned.code === 'planned', planned);
  const noPlan = stageBufferStateOf(st('', { plannedDate: '' }), mkSched([]), today);
  check('нет плановой даты и факта → no-plan', noPlan.code === 'no-plan', noPlan);
  const factNoPlan = stageBufferStateOf(st('', { plannedDate: '', actualDate: '2026-10-09' }), mkSched([]), today);
  check('факт без плановой даты → nodata', factNoPlan.code === 'nodata', factNoPlan);

  // Старый рейс (запас 0): позже плана = запас исчерпан, в срок = зелёный.
  const legacyLate = stageBufferStateOf({ ...base, actualDate: '2026-10-11' }, mkSched([base]), today);
  check('старый рейс (0 запас): +1 день → «за пределами запаса»', legacyLate.code === 'beyond', legacyLate);
  check('старый рейс: 0 запас всё ещё даёт ontime в срок', stageBufferStateOf({ ...base, actualDate: '2026-10-09' }, mkSched([base]), today).code === 'ontime');

  check('тон: ontime → emerald', stageBufferStateTone('ontime') === 'emerald');
  check('тон: within → amber', stageBufferStateTone('within') === 'amber');
  check('тон: beyond → rose', stageBufferStateTone('beyond') === 'rose');
  check('тон: planned-overdue → rose', stageBufferStateTone('planned-overdue') === 'rose');
  check('тон: остальные → grey', stageBufferStateTone('planned') === 'grey' && stageBufferStateTone('no-plan') === 'grey' && stageBufferStateTone('nodata') === 'grey');
}

console.log('');
if (failed) {
  console.error(`ПРОВАЛЕНО: ${failed} из ${passed + failed}`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
