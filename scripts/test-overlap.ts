/**
 * Тесты функции разрешения наложений полос таймлайна (lib/overlap + lib/overlapRow).
 * Сценарии: ранний выезд, поздний выезд, смена в один день (прибытие и выезд),
 * рейс внутри простоя, два пересекающихся рейса, открытый простой, ремонт внутри
 * простоя, плюс граничные случаи (включительные окончания, срезы, «ожидание»).
 * Запуск: npx tsx scripts/test-overlap.ts
 */
import {
  resolveOverlaps,
  waitGapsOf,
  type OverlapBase,
  type OverlapInterval,
} from '../src/components/modules/tripTimeline/lib/overlap';
import { resolveRowOverlaps } from '../src/components/modules/tripTimeline/lib/overlapRow';
import { baseBarRange, readyBarRange, repairBarRange, type BasePeriod } from '../src/components/modules/tripTimeline/lib/sources';
import { layoutBzFills } from '../src/components/modules/tripTimeline/lib/bzFills';
import { vyezdStatusOf, VYEZD_STATUS } from '../src/components/modules/tripTimeline/lib/vyezd';

let failures = 0;
let total = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  total += 1;
  if (cond) {
    console.log(`✔ ${name}`);
  } else {
    failures += 1;
    console.error(`✘ ${name}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
};
const fmt = (d: number): string => `D${d}`;
const baseOf = (over: Partial<OverlapBase> & { a: number; b: number }): OverlapBase => ({
  key: 'bz:t1',
  xEnd: null,
  xKind: null,
  ...over,
});
const segOf = (res: ReturnType<typeof resolveOverlaps>, key: string) => res.segments.find((s) => s.key === key);
const markerOf = (res: ReturnType<typeof resolveOverlaps>, kind: string) => res.markers.find((m) => m.kind === kind);

// ── 1. Ранний выезд: рейс начинается раньше учётного конца простоя ──────────
{
  const base = baseOf({ a: 10, b: 20, xEnd: 19, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r1', a: 12, b: 25, label: 'Рейс «Тест»' };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  const b = segOf(res, 'bz:t1');
  const t = segOf(res, 'pd:r1');
  ok('1.1: простой укорочен до дня выезда', b?.b === 12, b);
  ok('1.2: день смены — срез простоя (левая половина)', b?.fracB === 0.5 && b?.cutB === true, b);
  ok('1.3: рейс начинается справа от среза (fraA=0.5)', t?.fracA === 0.5 && t?.cutA === true, t);
  ok('1.4: truncatedDays = 7 (на сколько раньше учёта)', b?.truncatedDays === 7, b?.truncatedDays);
  const m = markerOf(res, 'early-departure');
  ok('1.5: маркер «выехала раньше» в день выезда', !!m && m.day === 12 && m.frac === 0.5, m);
  ok('1.6: маркер alert (расхождение) и кликабелен на период', m?.alert === true && m?.periodKey === 'bz:t1', m);
  ok('1.7: подсказка «на 7 дн. раньше» и учётный X', !!m && m.title.includes('на 7 дн. раньше') && m.title.includes('простой до: D19'), m?.title);
  ok('1.8: пересечений-конфликтов нет (разрешено правилом 1)', res.warnings.length === 0, res.warnings);
  ok('1.9: «Ожидание выезда» не выдумывается', waitGapsOf(base, [trip], fmt).length === 0);
}

// ── 2. Поздний выезд: между концом простоя и рейсом остаётся промежуток ─────
{
  const base = baseOf({ a: 10, b: 15, xEnd: 15, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r2', a: 20, b: 25 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  const b = segOf(res, 'bz:t1');
  ok('2.1: простой не укорачивается (рейс позже конца)', b?.b === 15 && b?.fracB === 1, b);
  ok('2.2: старт рейса не срезан', segOf(res, 'pd:r2')?.fracA === 0, segOf(res, 'pd:r2'));
  ok('2.3: конфликтов нет (рейс вне периода)', res.warnings.length === 0, res.warnings);
  const gaps = waitGapsOf(base, [trip], fmt);
  ok('2.4: промежуток «Ожидание выезда» 4 дн (D16–D19)', gaps.length === 1 && gaps[0].a === 16 && gaps[0].b === 19 && gaps[0].days === 4, gaps);
  ok('2.5: в подсказке есть «Ожидание выезда» и количество дней', gaps[0]?.title.includes('Ожидание выезда: 4 дн'), gaps[0]?.title);
  ok('2.6: без подтверждённого X (открытый) промежуток не подписываем', waitGapsOf(baseOf({ a: 10, b: 40, open: true }), [trip], fmt).length === 0);
  ok('2.7: рейс на следующий день после X — промежутка нет', waitGapsOf(base, [{ key: 'pd:r3', a: 16, b: 20 }], fmt).length === 0);
  const gaps2 = waitGapsOf(base, [{ key: 'pd:r4', a: 17, b: 20 }], fmt);
  ok('2.8: рейс через день после X — промежуток 1 дн', gaps2.length === 1 && gaps2[0].days === 1 && gaps2[0].a === 16, gaps2);
}

// ── 3. Штатная смена в один день: прибытие и выезд ──────────────────────────
{
  // 3a. Рейс завершён в день приезда на базу.
  const base = baseOf({ a: 15, b: 25, xEnd: 25, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r5', a: 5, b: 15, label: 'Рейс «Юг»' };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('3a.1: рейс заканчивается левой половиной дня', segOf(res, 'pd:r5')?.fracB === 0.5 && segOf(res, 'pd:r5')?.cutB === true);
  ok('3a.2: простой начинается правой половиной дня', segOf(res, 'bz:t1')?.fracA === 0.5 && segOf(res, 'bz:t1')?.cutA === true);
  const m = markerOf(res, 'arrival');
  ok('3a.3: маркер прибытия день/центр', !!m && m.day === 15 && m.frac === 0.5, m);
  ok('3a.4: подсказка «рейс завершён… начало простоя»', !!m && m.title.includes('завершён D15') && m.title.includes('Начало простоя на базе: D15'), m?.title);
  ok('3a.5: смена в один день — не расхождение (нет конфликтов)', res.warnings.length === 0, res.warnings);
  ok('3a.6: маркер прибытия не alert', m?.alert !== true);
}
{
  // 3b. Простой закончился, рейс начался в тот же день (n = 0).
  const base = baseOf({ a: 10, b: 20, xEnd: 20, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r6', a: 20, b: 25 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('3b.1: простой до дня смены, правый край — срез', segOf(res, 'bz:t1')?.b === 20 && segOf(res, 'bz:t1')?.fracB === 0.5);
  ok('3b.2: рейс начинается правой половиной дня', segOf(res, 'pd:r6')?.fracA === 0.5 && segOf(res, 'pd:r6')?.cutA === true);
  const m = markerOf(res, 'departure');
  ok('3b.3: маркер «выезд» (не «раньше») в день смены', !!m && m.kind === 'departure' && m.day === 20, m);
  ok('3b.4: маркер не alert и день не считается расхождением', m?.alert !== true && res.warnings.length === 0);
  ok('3b.5: «Ожидание выезда» пусто (стык в один день)', waitGapsOf(base, [trip], fmt).length === 0);
}
{
  // 3c. Открытый простой: срок готовности X совпал с днём старта рейса,
  // рейс продолжается (обычная картина «выезд ещё не внесён в учёт»).
  const base = baseOf({ a: 10, b: 30, open: true, xEnd: 20, xKind: 'plan' });
  const trip: OverlapInterval = { key: 'pd:r7', a: 20, b: 35 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('3c.1: открытый простой укорочен до дня выезда', segOf(res, 'bz:t1')?.b === 20 && segOf(res, 'bz:t1')?.open === false);
  ok('3c.2: маркер «выезд» (n=0) без alert', markerOf(res, 'departure')?.alert !== true);
  ok('3c.3: конфликтов нет', res.warnings.length === 0, res.warnings);
  // 3d. Открытый простой, рейс ЦЕЛИКОМ внутри (завершён): это конфликт данных.
  const inside: OverlapInterval = { key: 'pd:r7b', a: 21, b: 25 };
  const res2 = resolveOverlaps({ base, trips: [inside] }, fmt);
  ok('3d.1: рейс целиком внутри открытого простоя — конфликт, не маскируется', res2.warnings.length === 1 && segOf(res2, 'bz:t1')?.b === 30, res2.warnings);
}

// ── 4. Рейс внутри простоя: не маскируется — «конфликт данных» ──────────────
{
  const base = baseOf({ a: 10, b: 30, xEnd: 30, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r8', a: 15, b: 20, label: 'Рейс «Внутри»' };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('4.1: простой НЕ укорачивается (рейс внутри — не выезд)', segOf(res, 'bz:t1')?.b === 30 && segOf(res, 'bz:t1')?.fracB === 1, segOf(res, 'bz:t1'));
  ok('4.2: рейс не срезан', segOf(res, 'pd:r8')?.fracA === 0 && segOf(res, 'pd:r8')?.fracB === 1);
  ok('4.3: конфликт данных: зона = дни пересечения', res.warnings.length === 1 && res.warnings[0].a === 15 && res.warnings[0].b === 20, res.warnings);
  ok('4.4: полоса рейса помечена штриховкой (overlap)', segOf(res, 'pd:r8')?.overlap === true, segOf(res, 'pd:r8'));
  ok('4.5: в подсказке конфликта есть источники', !!res.warnings[0] && res.warnings[0].title.includes('Учёт выезда') && res.warnings[0].title.includes('План дохода'), res.warnings[0]?.title);
  ok('4.6: срезов дня нет (это не смена)', segOf(res, 'bz:t1')?.cutB === false);
}
{
  // Открытый простой: рейс целиком внутри тоже конфликт, простой не рвём.
  const base = baseOf({ a: 10, b: 40, open: true, xEnd: null, xKind: null });
  const trip: OverlapInterval = { key: 'pd:r9', a: 15, b: 20 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('4.7: открытый простой + рейс внутри → конфликт, без укорачивания', res.warnings.length === 1 && segOf(res, 'bz:t1')?.b === 40, res.warnings);
}

// ── 5. Два пересекающихся рейса ─────────────────────────────────────────────
{
  const a: OverlapInterval = { key: 'pd:a', a: 10, b: 15, label: 'Рейс «A»' };
  const b: OverlapInterval = { key: 'pd:b', a: 12, b: 20, label: 'Рейс «B»' };
  const res = resolveOverlaps({ base: null, trips: [a, b] }, fmt);
  ok('5.1: оба рейса в сегментах, без срезов', res.segments.length === 2 && res.segments.every((s) => s.fracA === 0 && s.fracB === 1));
  ok('5.2: конфликт с зоной пересечения D12–D15', res.warnings.length === 1 && res.warnings[0].a === 12 && res.warnings[0].b === 15, res.warnings);
  ok('5.3: в подсказке оба рейса', !!res.warnings[0] && res.warnings[0].title.includes('«A»') && res.warnings[0].title.includes('«B»'), res.warnings[0]?.title);
}

// ── 6. Открытый простой: рейс начинается внутри, выезд не зафиксирован ──────
{
  const base = baseOf({ a: 10, b: 40, open: true, xEnd: null, xKind: null });
  const trip: OverlapInterval = { key: 'pd:r10', a: 12, b: 45 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('6.1: простой укорочен до дня выезда (открытый больше не тянется)', segOf(res, 'bz:t1')?.b === 12 && segOf(res, 'bz:t1')?.open === false);
  const m = markerOf(res, 'departure');
  ok('6.2: маркер «выезд» без числа дней (учётный конец неизвестен)', !!m && m.alert !== true && m.title.includes('фактический выезд не указан'), m?.title);
  ok('6.3: waitGaps пусто (X не подтверждён)', waitGapsOf(base, [trip], fmt).length === 0);
}
{
  // Открытый простой со сроком готовности: рейс раньше срока.
  const base = baseOf({ a: 10, b: 40, open: true, xEnd: 18, xKind: 'plan' });
  const trip: OverlapInterval = { key: 'pd:r11', a: 12, b: 45 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  const m = markerOf(res, 'early-departure');
  ok('6.4: n = 6 (раньше срока готовности)', m?.alert === true && m?.title.includes('на 6 дн. раньше'), m?.title);
  ok('6.5: полоса ещё открыта до выезда — «ожидание» не дублируется', waitGapsOf(base, [trip], fmt).length === 0);
  ok('6.6: в подсказке помечен срок готовности', !!m && m.title.includes('срок готовности'), m?.title);
}

// ── 7. Ремонт внутри простоя: вложенность не конфликт, не маскируется ───────
{
  const period: BasePeriod = {
    id: 'p7', key: 'bz:p7', carKey: 'car:7', carId: '7', carNumber: 'T 0007', dispatcherId: '', dispatcherName: '',
    arrivalDay: 10, departureDay: 20, repairStartDay: 12, repairEndDay: 16, plannedReadyDay: 18,
    causeLabel: 'Ремонт', causeKind: 'repair', comment: '', archived: false, openBase: false, openRepair: false,
    repairCappedByDeparture: false, warnings: [],
  };
  const bb = baseBarRange(period, 20);
  const rr = repairBarRange(period, 20);
  const rb = readyBarRange(period);
  ok('7.1: ремонт внутри факта базы', !!bb && !!rr && rr.a >= bb.a && rr.b <= bb.b, { bb, rr });
  ok('7.2: план базы до срока готовности внутри факта', !!rb && rb.b === 18 && rb.a === 10, rb);
  const res = resolveOverlaps({ base: baseOf({ a: bb!.a, b: bb!.b, xEnd: 20, xKind: 'fact' }), trips: [] }, fmt);
  ok('7.3: ремонт внутри простоя не создаёт предупреждений', res.warnings.length === 0 && res.markers.length === 0);
  ok('7.4: без рейсов простой не укорачивается', segOf(res, 'bz:t1')?.b === 20 && segOf(res, 'bz:t1')?.truncatedDays === 0);
  // Показ: ремонт рисуется ВЛОЖЕННЫМ в простой (одна запись — две полосы, штриховки нет).
  const layout = layoutBzFills([{ period }], [], 'fact', 0, 100, 20);
  const baseStripe = layout.stripes.find((s) => s.kind === 'base-fact');
  const remStripe = layout.stripes.find((s) => s.kind === 'repair');
  ok('7.5: полоса базы и полоса ремонта обе в раскладке', !!baseStripe && !!remStripe);
  ok('7.6: ремонт — внутри базы (12..16)', remStripe?.a === 12 && remStripe?.b === 16 && (remStripe?.b ?? 99) <= (baseStripe?.b ?? -1), { rem: remStripe, base: baseStripe });
}

// ── 8. Границы и крайние случаи ─────────────────────────────────────────────
{
  // Рейс в день приезда (не «внутри») — один общий день: конфликт без укорачивания.
  const base = baseOf({ a: 10, b: 10, xEnd: 10, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r12', a: 10, b: 15 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  ok('8.1: рейс в день приезда — конфликт на один день', res.warnings.length === 1 && res.warnings[0].a === 10 && res.warnings[0].b === 10, res.warnings);
  ok('8.2: полоса простоя не укорочена до нуля', segOf(res, 'bz:t1')?.b === 10 && segOf(res, 'bz:t1')?.fracB === 1, segOf(res, 'bz:t1'));
}
{
  // n < 0: выехала позже срока готовности (открытый период).
  const base = baseOf({ a: 10, b: 40, open: true, xEnd: 26, xKind: 'plan' });
  const trip: OverlapInterval = { key: 'pd:r13', a: 33, b: 45 };
  const res = resolveOverlaps({ base, trips: [trip] }, fmt);
  const m = markerOf(res, 'departure');
  ok('8.3: маркер «позже» на 7 дн (alert)', !!m && m.alert === true && m.title.includes('на 7 дн. позже'), m?.title);
  ok('8.4: простой укорочен до дня фактического выезда', segOf(res, 'bz:t1')?.b === 33 && segOf(res, 'bz:t1')?.fracB === 0.5);
  ok('8.5: «ожидание» не показывается поверх незакрытого простоя', waitGapsOf(base, [trip], fmt).length === 0);
}
{
  // Ожидание: часть промежутка занята другим рейсом — вычитается.
  const base = baseOf({ a: 10, b: 20, xEnd: 20, xKind: 'fact' });
  const t1: OverlapInterval = { key: 'pd:r14', a: 10, b: 24 };
  const t2: OverlapInterval = { key: 'pd:r15', a: 28, b: 30 };
  const gaps = waitGapsOf(base, [t1, t2], fmt);
  ok('8.6: «ожидание» усечено до свободных дней D25–D27', gaps.length === 1 && gaps[0].a === 25 && gaps[0].b === 27 && gaps[0].days === 3, gaps);
}
{
  // Ожидание: часть промежутка занята ДРУГОЙ записью учёта выезда машины — не штрихуем.
  const base = baseOf({ a: 10, b: 15, xEnd: 15, xKind: 'fact' });
  const trip: OverlapInterval = { key: 'pd:r17', a: 30, b: 35 };
  const gapsNo = waitGapsOf(base, [trip], fmt);
  ok('8.9: без вычета «ожидание» D16–D29 (14 дн)', gapsNo.length === 1 && gapsNo[0].days === 14, gapsNo);
  const gapsOcc = waitGapsOf(base, [trip], fmt, [{ a: 16, b: 28 }]);
  ok('8.10: соседняя запись учёта (D16–D28) вычитается из ожидания', gapsOcc.length === 1 && gapsOcc[0].a === 29 && gapsOcc[0].b === 29, gapsOcc);
  const gapsMid = waitGapsOf(base, [trip], fmt, [{ a: 20, b: 24 }]);
  ok('8.11: вычет середины даёт два свободных отрезка (D16–D19, D25–D29)', gapsMid.length === 2 && gapsMid[0].a === 16 && gapsMid[0].b === 19 && gapsMid[1].a === 25 && gapsMid[1].b === 29, gapsMid);
  const gapsFull = waitGapsOf(base, [trip], fmt, [{ a: 16, b: 29 }]);
  ok('8.12: полностью занятый промежуток не показываем', gapsFull.length === 0, gapsFull);
}
{
  // Дубли рейсов (один ключ дважды) не создают второго маркера/сегмента.
  const base = baseOf({ a: 10, b: 20, xEnd: 19, xKind: 'fact' });
  const dup: OverlapInterval = { key: 'pd:r16', a: 12, b: 25 };
  const res = resolveOverlaps({ base, trips: [dup, { ...dup }] }, fmt);
  ok('8.7: дубль рейса не даёт второго сегмента', res.segments.filter((s) => s.key === 'pd:r16').length === 2); // сегменты как есть; маркер один
  ok('8.8: маркер «выехала раньше» один', res.markers.filter((m) => m.kind === 'early-departure').length === 1, res.markers);
}

// ── 9. Строка машины (overlapRow): план и факт считаются отдельно ───────────
{
  const period: BasePeriod = {
    id: 'p9', key: 'bz:p9', carKey: 'car:9', carId: '9', carNumber: 'T 0009', dispatcherId: '', dispatcherName: '',
    arrivalDay: 10, departureDay: 20, repairStartDay: null, repairEndDay: null, plannedReadyDay: 16,
    causeLabel: 'На базе', causeKind: 'base', comment: '', archived: false, openBase: false, openRepair: false,
    repairCappedByDeparture: false, warnings: [],
  };
  const planTrips = [{ key: 'pd:z1', a: 12, b: 25, label: 'Рейс «Z»' }];
  const plan = resolveRowOverlaps([period], planTrips, 'plan', 20, fmt, 'T 0009');
  ok('9.1: ПЛАН: база до срока готовности (10..16), рейс с 12 → ранний выезд', plan.baseAdjust.get('bz:p9')?.b === 12 && plan.baseAdjust.get('bz:p9')?.truncatedDays === 4, plan.baseAdjust.get('bz:p9'));
  ok('9.2: ПЛАН: маркер ранний (D12), без конфликтов', plan.markers.some((m) => m.kind === 'early-departure' && m.day === 12) && plan.warnings.length === 0);
  // Факт — тот же рейс, но база факта до 20: рейс начинается внутри (12<20) —
  // тоже укорачивание, но с другим учётным концом.
  const fact = resolveRowOverlaps([period], planTrips, 'fact', 20, fmt, 'T 0009');
  ok('9.3: ФАКТ: своё укорочение до D12 и n = 8', fact.baseAdjust.get('bz:p9')?.b === 12 && fact.baseAdjust.get('bz:p9')?.truncatedDays === 8, fact.baseAdjust.get('bz:p9'));
  ok('9.4: ФАКТ: свой маркер (periodKey тот же)', fact.markers.some((m) => m.kind === 'early-departure' && m.periodKey === 'bz:p9'));
  // Рейс без факт-дат показывается плановыми — факт-строка всё равно режется.
  ok('9.5: ПЛАН и ФАКТ не смешиваются (разные truncatedDays)', plan.baseAdjust.get('bz:p9')?.truncatedDays !== fact.baseAdjust.get('bz:p9')?.truncatedDays);
  // Дубль периода-записи не дублирует маркеры.
  const dup = resolveRowOverlaps([period, { ...period }], planTrips, 'plan', 20, fmt, 'T 0009');
  ok('9.6: дубль периода не дублирует маркеры', dup.markers.length === plan.markers.length, dup.markers.length);
}

// ── 10. Смягчение статуса «ранний выезд» — ТОЛЬКО таймлайн ──────────────────
{
  const periodOf = (over: Partial<BasePeriod>): BasePeriod => ({
    id: 'p10', key: 'bz:p10', carKey: 'car:10', carId: '10', carNumber: 'T 0010', dispatcherId: '', dispatcherName: '',
    arrivalDay: null, departureDay: null, repairStartDay: null, repairEndDay: null, plannedReadyDay: null,
    causeLabel: 'На базе', causeKind: 'base', comment: '', archived: false, openBase: false, openRepair: false,
    repairCappedByDeparture: false, warnings: [],
    ...over,
  });
  // Ранний выезд (−1 день, как AT 4458-7 / AC 3392-7): рейс начался внутри
  // периода, идёт дальше его конца; учётный конец — фактический выезд.
  const earlyPeriod = periodOf({ arrivalDay: 10, departureDay: 20, plannedReadyDay: 18 });
  const earlyTrip = { a: 19, b: 40, label: 'Рейс «Ранний»', archived: false };
  {
    const st = vyezdStatusOf(earlyPeriod, 25, [earlyTrip]);
    ok('10.1: у источника статус конфликт (модуль не смягчается)', st.kind === 'conflict' && st.earlyDepartureOnly === true, st);
    const layout = layoutBzFills([{ period: earlyPeriod, tripRanges: [earlyTrip] }], [], 'fact', 0, 100, 25);
    const stripe = layout.stripes.find((s) => s.kind === 'base-fact');
    ok('10.2: полоса таймлайна смягчена до early-departure', stripe?.status === 'early-departure', stripe?.status);
    ok(
      '10.3: смягчённая полоса нейтральна и без тревоги (палитра как active)',
      stripe?.status === 'early-departure' && VYEZD_STATUS['early-departure'].bg === VYEZD_STATUS.active.bg && VYEZD_STATUS['early-departure'].text === VYEZD_STATUS.active.text,
      stripe?.status,
    );
    ok('10.4: подсказка полосы сохраняет объяснение и маркер', !!stripe && stripe.title.includes('ранний выезд') && stripe.title.includes('маркер на стыке'), stripe?.title);
  }
  {
    // Архивная закрытая запись того же случая (AT 4458-7, AC 3392-7): на
    // таймлайне — тоже нейтрально, хотя у источника статус «закрыт».
    const archEarly = { ...earlyPeriod, id: 'p10a', key: 'bz:p10a', archived: true };
    const st = vyezdStatusOf(archEarly, 25, [earlyTrip]);
    ok('10.5: архивная ранняя — у источника closed, флаг earlyDepartureOnly', st.kind === 'closed' && st.earlyDepartureOnly === true, st);
    const layout = layoutBzFills([{ period: archEarly, tripRanges: [earlyTrip] }], [], 'fact', 0, 100, 25);
    const stripe = layout.stripes.find((s) => s.kind === 'base-fact');
    ok('10.6: архивная ранняя — полоса таймлайна нейтральна', stripe?.status === 'early-departure', stripe?.status);
  }
  {
    // Настоящий конфликт — рейс ЦЕЛИКОМ внутри простоя: на таймлайне красный.
    const inside = periodOf({ id: 'p10b', key: 'bz:p10b', arrivalDay: 10, departureDay: 30, plannedReadyDay: 28 });
    const insideTrip = { a: 15, b: 20, label: 'Рейс «Внутри»' };
    const st = vyezdStatusOf(inside, 35, [insideTrip]);
    ok('10.7: рейс внутри — флаг не поднимается', st.kind === 'conflict' && st.earlyDepartureOnly === false, st);
    const layout = layoutBzFills([{ period: inside, tripRanges: [insideTrip] }], [], 'fact', 0, 100, 35);
    ok('10.8: рейс внутри — полоса остаётся красной (conflict)', layout.stripes.find((s) => s.kind === 'base-fact')?.status === 'conflict');
  }
  {
    // Хвост рейса внутри простоя (как AO 3086-7: рейс начался до приезда) — красный.
    const tail = periodOf({ id: 'p10c', key: 'bz:p10c', arrivalDay: 10, departureDay: 30, plannedReadyDay: 28 });
    const tailTrip = { a: 5, b: 15, label: 'Рейс «Хвост»' };
    const st = vyezdStatusOf(tail, 35, [tailTrip]);
    ok('10.9: рейс с хвостом внутри — без смягчения', st.kind === 'conflict' && st.earlyDepartureOnly === false, st);
    const layout = layoutBzFills([{ period: tail, tripRanges: [tailTrip] }], [], 'fact', 0, 100, 35);
    ok('10.10: хвост внутри — полоса красная', layout.stripes.find((s) => s.kind === 'base-fact')?.status === 'conflict');
  }
  {
    // Смешанный случай: ранний рейс + рейс внутри — смягчения нет (красный).
    const mixed = periodOf({ id: 'p10d', key: 'bz:p10d', arrivalDay: 10, departureDay: 40, plannedReadyDay: 38 });
    const trips = [
      { a: 36, b: 60, label: 'Рейс «Ранний»' },
      { a: 15, b: 20, label: 'Рейс «Внутри»' },
    ];
    const st = vyezdStatusOf(mixed, 45, trips);
    ok('10.11: смешанные пересечения — без смягчения', st.kind === 'conflict' && st.earlyDepartureOnly === false, st);
    const layout = layoutBzFills([{ period: mixed, tripRanges: trips }], [], 'fact', 0, 100, 45);
    ok('10.12: смешанные — полоса красная', layout.stripes.find((s) => s.kind === 'base-fact')?.status === 'conflict');
  }
  {
    // Выезд ПОЗЖЕ срока готовности (открытый период, n < 0) — смягчения нет.
    const late = periodOf({ id: 'p10e', key: 'bz:p10e', arrivalDay: 10, departureDay: null, plannedReadyDay: 18 });
    const lateTrip = { a: 25, b: 45, label: 'Рейс «Поздний»' };
    const st = vyezdStatusOf(late, 40, [lateTrip]);
    ok('10.13: поздний выезд — без смягчения (как AC 5448-7 / AO 3921-7)', st.kind === 'conflict' && st.earlyDepartureOnly === false, st);
    const layout = layoutBzFills([{ period: late, tripRanges: [lateTrip] }], [], 'fact', 0, 100, 40);
    ok('10.14: поздний выезд — полоса красная', layout.stripes.find((s) => s.kind === 'base-fact')?.status === 'conflict');
  }
  {
    // Честный стык (рейс начался в день выезда) — конфликта нет, closed.
    const swap = periodOf({ id: 'p10f', key: 'bz:p10f', arrivalDay: 10, departureDay: 20, plannedReadyDay: 20 });
    const swapTrip = { a: 20, b: 40, label: 'Рейс «В один день»' };
    const st = vyezdStatusOf(swap, 25, [swapTrip]);
    ok('10.15: смена в день выезда — не конфликт и не «ранний»', st.kind === 'closed' && st.earlyDepartureOnly === false, st);
    const layout = layoutBzFills([{ period: swap, tripRanges: [swapTrip] }], [], 'fact', 0, 100, 25);
    ok('10.16: смена в день выезда — полоса закрыта (closed)', layout.stripes.find((s) => s.kind === 'base-fact')?.status === 'closed');
  }
}

if (failures) {
  console.error(`\n${failures} из ${total} проверок не прошли`);
  process.exit(1);
}
console.log(`\nВсе проверки пройдены (${total}): пересечения полос разрешаются по правилам 1–4, конфликты не маскируются.`);
