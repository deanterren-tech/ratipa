/**
 * Тесты ЕДИНОГО порядка этапов и контроля хронологии (lib/stageSchedule):
 *  - единый компаратор «дата, затем seq» и сортировка списка (sortStagesRoute):
 *    сырой порядок массива (порядок ключей базы) на отображение не влияет;
 *  - перестановка строк (moveStageInList): один день / оба без даты — свап,
 *    разные дни — обмен датами (администратор, см. test-stage-rights);
 *  - перенумерация seq/order 1..N (renumberStageSeq);
 *  - «Поменять местами» по предупреждению шаблона (swapStageOrderInList);
 *  - ЖЁСТКИЙ контроль хронологии (stageOrderConflicts): дата этапа с большим
 *    seq не может быть раньше даты этапа с меньшим seq — сохранение блокируется.
 *
 * Запуск: npx tsx scripts/test-stage-order.ts  (или npm run test:stage-order)
 */
import type { TimelineStage } from '../src/types';
import {
  buildStageSchedule,
  moveStageInList,
  renumberStageSeq,
  sortStagesRoute,
  stageMoveKindOf,
  stageOrderConflicts,
  stageRouteCmp,
  swapStageOrderInList,
} from '../src/components/modules/tripTimeline/lib/stageSchedule';

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

let sid = 0;
const st = (planned: string, extra: Partial<TimelineStage> = {}): TimelineStage => {
  sid += 1;
  return {
    id: extra.id ?? `s${sid}`,
    type: extra.type ?? 'load',
    label: '',
    plannedDate: planned,
    actualDate: '',
    isCritical: false,
    order: extra.order ?? sid,
    ...extra,
  };
};

const ids = (list: TimelineStage[]): string => list.map((s) => String(s.id)).join(',');
const seqs = (list: TimelineStage[]): string => list.map((s) => `${s.id}:${s.seq}`).join(',');

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Единый компаратор «дата, затем seq»: низкий seq при равной дате — левее');
{
  const a = st('2026-10-26', { id: 'a', seq: 5 });
  const b = st('2026-10-26', { id: 'b', seq: 6 });
  check('равная дата: seq 5 раньше seq 6', stageRouteCmp(a, b) < 0 && stageRouteCmp(b, a) > 0);
  check('разные даты: дата важнее seq (26/10 seq 6 после 25/10 seq 1)', stageRouteCmp(st('2026-10-25', { id: 'x', seq: 1 }), b) < 0);
  check('без даты — в конец (даже при seq=1 против датированного seq=9)', stageRouteCmp(st('', { id: 'n', seq: 1 }), st('2026-10-26', { id: 'd', seq: 9 })) > 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. sortStagesRoute: сырой порядок массива (порядок ключей базы) не влияет');
{
  // Массив приходит «в порядке создания ключей»: выгрузка раньше границы
  // (эталон 9271: было «Выгрузка Ереван» перед «Граница Бавра»).
  const raw = [
    st('2026-10-26', { id: 'erevan', seq: 6, type: 'unl' }),
    st('2026-10-25', { id: 'guguti', seq: 4, type: 'load' }),
    st('2026-10-26', { id: 'bavra', seq: 5, type: 'border' }),
  ];
  const sorted = sortStagesRoute(raw);
  check('порядок как в окне и на полосе: Гугути → Бавра → Ереван', ids(sorted) === 'guguti,bavra,erevan', ids(sorted));
  check('исходный массив не мутирован', ids(raw) === 'erevan,guguti,bavra');
  check('повторная сортировка идемпотентна (один источник порядка)', ids(sortStagesRoute(sorted)) === 'guguti,bavra,erevan');

  // Старые записи без seq: миграционный порядок seq → order → позиция.
  const legacy = [
    st('2026-10-26', { id: 'l2', order: 2 }),
    st('2026-10-26', { id: 'l1', order: 1 }),
  ];
  check('без seq: порядок читается из order (не из позиции массива)', ids(sortStagesRoute(legacy)) === 'l1,l2', ids(sortStagesRoute(legacy)));

  const noMeta = [
    st('2026-10-26', { id: 'n2', order: 0 }),
    st('2026-10-26', { id: 'n1', order: 0 }),
  ];
  check('ни seq, ни order: сохраняется порядок массива (позиция как last-resort)', ids(sortStagesRoute(noMeta)) === 'n2,n1', ids(sortStagesRoute(noMeta)));
  check('пустые входы безопасны', sortStagesRoute(undefined).length === 0 && sortStagesRoute(null).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Цепочка плана с запасом следует единому порядку (дата, seq), не массиву');
{
  const raw = [
    st('2026-10-26', { id: 's3', seq: 3 }),
    st('2026-10-24', { id: 's1', seq: 1 }),
    st('2026-10-25', { id: 's2', seq: 2 }),
  ];
  const chain = buildStageSchedule(raw);
  check('цепочка: s1 → s2 → s3 независимо от порядка массива', chain.chain.map((c) => c.stageId).join(',') === 's1,s2,s3', chain.chain.map((c) => c.stageId).join(','));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Вид пары при перестановке (stageMoveKindOf)');
{
  check('оба без даты → empty-tail', stageMoveKindOf(st('', { id: 'a' }), st('', { id: 'b' })) === 'empty-tail');
  check('один день → same-day', stageMoveKindOf(st('2026-10-26', { id: 'a' }), st('2026-10-26', { id: 'b' })) === 'same-day');
  check('разные дни → cross-day', stageMoveKindOf(st('2026-10-26', { id: 'a' }), st('2026-10-25', { id: 'b' })) === 'cross-day');
  check('с датой ↔ без даты → null (не переставляются)', stageMoveKindOf(st('2026-10-26', { id: 'a' }), st('', { id: 'b' })) === null);
  check('null-сосед безопасен', stageMoveKindOf(st('2026-10-26', { id: 'a' }), undefined) === null);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. Перестановка строк (moveStageInList): свап в одном дне, пересчёт seq 1..N');
{
  // Один день: перестановка Выгрузки и Границы (эталон 9271 в обратную сторону).
  const list = [
    st('2026-10-25', { id: 'g', seq: 4 }),
    st('2026-10-26', { id: 'v', seq: 5, type: 'unl' }),
    st('2026-10-26', { id: 'b', seq: 6, type: 'border' }),
  ];
  const next = moveStageInList(list, 'b', -1);
  check('один день: Бавра поднята выше Выгрузки', !!next && ids(next!) === 'g,b,v', next && ids(next!));
  check('seq перенумерованы 1..N по новому порядку', !!next && seqs(next!) === 'g:1,b:2,v:3', next && seqs(next!));
  check('даты не изменились (порядок внутри дня — только seq)', !!next && next!.find((s) => s.id === 'b')!.plannedDate === '2026-10-26');
  check('исходный список не мутирован', ids(list) === 'g,v,b');
  check('за краем списка — null', moveStageInList(list, 'g', -1) === null && moveStageInList(list, 'b', 1) === null);
  check('неизвестный id — null', moveStageInList(list, 'nope', 1) === null);
  check('пара «с датой ↔ без даты» — null (порядок задают даты)', moveStageInList([st('2026-10-26', { id: 'd' }), st('', { id: 'e' })], 'e', -1) === null);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('6. Перестановка хвоста без дат: только среди этапов без даты');
{
  const list = [st('2026-10-24', { id: 'd', seq: 1 }), st('', { id: 'x', seq: 2 }), st('', { id: 'y', seq: 3 })];
  const next = moveStageInList(list, 'y', -1);
  check('оба без даты: свап x,y', !!next && ids(next!) === 'd,y,x', next && ids(next!));
  check('seq после свапа 1..N', !!next && seqs(next!) === 'd:1,y:2,x:3', next && seqs(next!));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('7. Разные дни: этапы обмениваются ДАТАМИ (строка встаёт на день соседа)');
{
  const list = [
    st('2026-10-25', { id: 'g', seq: 1 }),
    st('2026-10-26', { id: 'b', seq: 2 }),
  ];
  // Бавра вверх: этапы меняются днями — Бавра встаёт на 25/10 (как поставил
  // пользователь), Гугути — на 26/10; порядок остаётся согласованным.
  const next = moveStageInList(list, 'b', -1);
  check('порядок списка: Бавра → Гугути', !!next && ids(next!) === 'b,g', next && ids(next!));
  check('даты обменялись: Бавра 25/10, Гугути 26/10', !!next && next!.find((s) => s.id === 'b')!.plannedDate === '2026-10-25' && next!.find((s) => s.id === 'g')!.plannedDate === '2026-10-26');
  check('seq после перестановки 1..N', !!next && seqs(next!) === 'b:1,g:2', next && seqs(next!));
  check('хронология чистая (этапы одной даты согласованы с seq)', stageOrderConflicts(next!).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('8. renumberStageSeq: перенумерация 1..N по порядку списка');
{
  const list = [st('2026-10-01', { id: 'a', seq: 7, order: 7 }), st('2026-10-02', { id: 'b', seq: 3, order: 3 })];
  const next = renumberStageSeq(list);
  check('seq = 1,2 по порядку списка', next[0].seq === 1 && next[1].seq === 2, next.map((s) => s.seq));
  check('order синхронизирован с seq (совместимость старых чтений)', next[0].order === 1 && next[1].order === 2);
  check('исходный список не мутирован', list[0].seq === 7 && list[1].seq === 3);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('9. «Поменять местами» (swapStageOrderInList): обмен номеров, даты не трогаются');
{
  const list = [
    st('2026-10-25', { id: 'g', seq: 1 }),
    st('2026-10-26', { id: 'v', seq: 2, type: 'unl' }),
    st('2026-10-26', { id: 'b', seq: 3, type: 'border' }),
  ];
  const next = swapStageOrderInList(list, 'v', 'b');
  check('Выгрузка и Граница поменялись местами', ids(next) === 'g,b,v', ids(next));
  check('seq после обмена перенумерованы 1..N', seqs(next) === 'g:1,b:2,v:3', seqs(next));
  check('даты обеих не изменились', next.find((s) => s.id === 'b')!.plannedDate === '2026-10-26' && next.find((s) => s.id === 'v')!.plannedDate === '2026-10-26');
  check('несуществующий id — список без изменений', ids(swapStageOrderInList(list, 'v', 'nope')) === 'g,v,b');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('10. ЖЁСТКИЙ контроль хронологии (stageOrderConflicts)');
{
  const clean = [
    st('2026-10-25', { id: 'g', seq: 1 }),
    st('2026-10-26', { id: 'b', seq: 2 }),
    st('2026-10-26', { id: 'e', seq: 3 }),
  ];
  check('согласованный маршрут — нарушений нет', stageOrderConflicts(clean).length === 0);

  // Дата этапа с БОЛЬШИМ seq раньше даты этапа с меньшим seq — нарушение.
  const broken = [
    st('2026-10-27', { id: 'late', seq: 1 }),
    st('2026-10-26', { id: 'early', seq: 2 }),
  ];
  const conf = stageOrderConflicts(broken);
  check('нарушение найдено (одна пара)', conf.length === 1, conf.length);
  check('пара называет ОБА этапа: a=late (seq1), b=early (seq2)', conf[0]?.a.id === 'late' && conf[0]?.b.id === 'early', conf[0] && `${conf[0].a.id}/${conf[0].b.id}`);
  check('дни пары: dayA > dayB', conf[0] && conf[0].dayA > conf[0].dayB);

  // Пробелы: этапы без даты и служебная строка плана в сравнение не входят.
  const withGaps = [
    st('', { id: 'blank', seq: 1 }),
    st('2026-10-27', { id: 'x', seq: 2 }),
    st('', { id: 'tail', seq: 3 }),
    st('2026-10-26', { id: 'y', seq: 4 }),
    st('2026-10-22', { id: 'pd-1-fallback-load', seq: 5 }),
  ];
  check('без дат/служебные строки не создают нарушений', stageOrderConflicts(withGaps).length === 1, stageOrderConflicts(withGaps));

  // Один и тот же день — норм (порядок в дне задаёт seq).
  const sameDay = [
    st('2026-10-26', { id: 'v', seq: 5 }),
    st('2026-10-26', { id: 'b', seq: 6 }),
  ];
  check('этапы одного дня нарушением НЕ считаются', stageOrderConflicts(sameDay).length === 0);
  check('пустые входы безопасны', stageOrderConflicts(undefined).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('11. Сортировка не скрывает нарушение: оно остаётся видимым и адресным');
{
  const broken = [
    st('2026-10-26', { id: 'a', seq: 1 }),
    st('2026-10-25', { id: 'b', seq: 2 }),
  ];
  const view = sortStagesRoute(broken);
  check('показ идёт по датам (25/10 раньше 26/10)', ids(view) === 'b,a', ids(view));
  const conflicts = stageOrderConflicts(broken);
  check('нарушение видно (a seq1 26/10 против b seq2 25/10)', conflicts.length === 1, conflicts.length);
  check('пара адресна: a — меньший seq (26/10), b — больший seq (25/10)', conflicts[0]?.a.id === 'a' && conflicts[0]?.b.id === 'b', conflicts[0] && `${conflicts[0].a.id}/${conflicts[0].b.id}`);
}

console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
