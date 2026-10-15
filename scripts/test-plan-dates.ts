/**
 * test-plan-dates — юнит-проверки синхронизации ПЛАНОВЫХ дат «Таймлайна рейсов»
 * с записью «Плана дохода» (часть 3 задания владельца).
 *
 *  1. ЕДИНЫЙ источник плановых границ (tripPlanBounds): приоритет
 *     оверрайд tripMeta → плановые границы записи (spanOverride) → плановые даты
 *     этапов; фактические даты в плановые границы НЕ подставляются.
 *  2. Слой слияния withPlanMetaOverride: пока ветка оверрайда грузится — нет
 *     ложного предупреждения; границы и предупреждения пересобираются из
 *     эффективных значений.
 *  3. Модель записи дат (lib/planBoundsWrite): у связанного рейса даты — в
 *     trips_dashboard/<planId>/dateStart|dateEnd, у ручного — в его запись
 *     (startDate|endDate); ОДНА база, оба поля одной операцией; даты НЕ
 *     записываются в tripMeta (легаси-оверрайд очищается); история/журнал этой
 *     операцией не создаются; факт не затрагивается.
 *  4. Проверка периодов не обходится: кандидат проверки — рейс с НОВЫМИ датами
 *     (findTripPeriodConflict): конфликтующее перетаскивание блокируется,
 *     допустимое — проходит; свой ключ исключается.
 *  5. Пересчёт «Плана дохода» тем же расчётом (calculateTripFinances): дни
 *     считаются при обеих датах, финансы — только у заполненной записи.
 *
 * Запуск: npm run test:plan-dates   (или npx tsx scripts/test-plan-dates.ts)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import type { TimelineStage } from '../src/types';
import { dayNum, dayStr, tripPlanBounds, tripSpan } from '../src/components/modules/tripTimeline/lib/timeline';
import {
  buildCarIndex,
  planMetaOverrideOf,
  planTripsToWholeTrips,
  withPlanMetaOverride,
  type WholeTrip,
} from '../src/components/modules/tripTimeline/lib/sources';
import { planBoundsTargetOf, planBoundsWritePlan } from '../src/components/modules/tripTimeline/lib/planBoundsWrite';
import { findTripPeriodConflict } from '../src/components/modules/tripTimeline/lib/tripGuard';
import { planDaysForRange } from '../src/components/modules/tripTimeline/lib/planFromDraft';
import { buildDispatcherDirectory } from '../src/utils/dispatcher';

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

// ── Фикстуры ───────────────────────────────────────────────────────────────
const carIndex = buildCarIndex([{ couplingId: 'car1', carNumber: 'AP 8340-7', dispatcherId: 'd1', dispatcherName: 'Тест' }]);
const dir = buildDispatcherDirectory([{ id: 'd1', name: 'Тест' }]);

const st = (over: Partial<TimelineStage> & { id: string }): TimelineStage => ({
  type: 'load',
  label: '',
  plannedDate: '',
  actualDate: '',
  isCritical: false,
  order: 0,
  ...over,
});

/** Связанный рейс из плана дохода (как строит planTripsToWholeTrips). */
const planTripOf = (id: string, fields: Record<string, unknown>, stages: TimelineStage[] = []): WholeTrip => {
  const trips = planTripsToWholeTrips(
    [{ id, carNumber: 'AP 8340-7', tripNote: 'Москва / Стамбул', ...fields }],
    carIndex,
    dir,
    stages.length ? { [id]: Object.fromEntries(stages.map((s) => [s.id, s])) } : {},
  );
  return trips[0];
};

console.log('\n1. ЕДИНЫЙ источник плановых границ (приоритет источников)');
{
  const recField = planTripOf('p1', { dateStart: '2026-10-01', dateEnd: '2026-10-20' }, [
    st({ id: 's1', plannedDate: '2026-10-05' }),
    st({ id: 's2', plannedDate: '2026-10-25' }),
  ]);
  const b1 = tripPlanBounds(recField);
  check('границы записи (dateStart/dateEnd) важнее плановых дат этапов', b1.pMin === dayNum('2026-10-01') && b1.pMax === dayNum('2026-10-20'), b1);

  const noField = planTripOf('p2', {}, [
    st({ id: 's1', plannedDate: '2026-10-05' }),
    st({ id: 's2', plannedDate: '2026-10-25' }),
  ]);
  const b2 = tripPlanBounds(noField);
  check('без полей записи границы берутся из плановых дат этапов', b2.pMin === dayNum('2026-10-05') && b2.pMax === dayNum('2026-10-25'), b2);

  const override = { pMin: dayNum('2026-10-03'), pMax: dayNum('2026-10-18') };
  const b3 = tripPlanBounds(recField, override);
  check('оверрайд tripMeta (правка из таймлайна) важнее записи и этапов', b3.pMin === dayNum('2026-10-03') && b3.pMax === dayNum('2026-10-18'), b3);

  const openPlan = planTripOf('p3', { dateStart: '2026-10-01' });
  const b4 = tripPlanBounds(openPlan);
  check('неполный план: старт есть, возвращения нет — null, дата не выдумывается', b4.pMin != null && b4.pMax === null, b4);

  const factOnly = planTripOf('p4', {}, [st({ id: 's1', actualDate: '2026-10-11' })]);
  const b5 = tripPlanBounds(factOnly);
  check('факт в плановые границы НЕ подставляется (этап с одним фактом)', b5.pMin === null && b5.pMax === null, b5);
  const span5 = tripSpan(factOnly);
  check('факт-границы живут отдельно (fMin/fMax), план — null', span5.fMin === dayNum('2026-10-11') && span5.pMin === null, span5);
}

console.log('\n2. Слой слияния withPlanMetaOverride (оверрайд tripMeta)');
{
  const trip = planTripOf('p5', { dateStart: '2026-10-01', dateEnd: '2026-10-10' });
  const loadedNoOverride = withPlanMetaOverride(trip, null, { metaLoaded: true });
  check('без оверрайда границы — из записи', tripPlanBounds(loadedNoOverride).pMax === dayNum('2026-10-10'), tripPlanBounds(loadedNoOverride));

  const withOverride = withPlanMetaOverride(trip, { planStart: '2026-10-02', planEnd: '2026-10-12' }, { metaLoaded: true });
  check('оверрайд перекрывает запись в слое отображения', tripPlanBounds(withOverride).pMin === dayNum('2026-10-02') && tripPlanBounds(withOverride).pMax === dayNum('2026-10-12'), tripPlanBounds(withOverride));

  const openRec = planTripOf('p6', { dateStart: '2026-10-01' });
  const loading = withPlanMetaOverride(openRec, null, { metaLoaded: false });
  check('пока ветка оверрайда грузится — предупреждения о возвращении нет', !loading.warnings.some((w) => w.includes('не указана дата возвращения')), loading.warnings);
  const afterLoad = withPlanMetaOverride(openRec, null, { metaLoaded: true });
  check('после загрузки честное предупреждение об открытом плане', afterLoad.warnings.some((w) => w.includes('не указана дата возвращения')), afterLoad.warnings);

  const filled = withPlanMetaOverride(openRec, { planEnd: '2026-10-15' }, { metaLoaded: true });
  check('оверрайд возвращения снимает предупреждение о неполном плане', !filled.warnings.some((w) => w.includes('не указана дата возвращения')) && !filled.openPlan, filled.warnings);

  check('planMetaOverrideOf: пустые/битые значения не выдумываются', planMetaOverrideOf({ planStart: '', planEnd: 'мусор' }) === null);
  check('planMetaOverrideOf: корректные даты читаются', planMetaOverrideOf({ planStart: '2026-10-02' })?.pMin === dayNum('2026-10-02'));
}

console.log('\n3. Модель записи дат: одна сторона, оба поля вместе');
{
  const linkedRaw = { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-10', tripsNote: 'как есть' };
  const plan = planBoundsWritePlan({ tripKey: 'pd:abc', raw: linkedRaw, startIso: '2026-10-02', endIso: '2026-10-12', by: 'Тест' });
  check('связанный рейс: запись идёт в trips_dashboard/<planId>', plan.ok && plan.base === 'trips_dashboard/abc', plan.base);
  check('связанный рейс: поля записи плана — dateStart/dateEnd', plan.dateFields.start === 'dateStart' && plan.dateFields.end === 'dateEnd', plan.dateFields);
  const datePaths = plan.datePaths;
  check('ровно ДВЕ даты — одной операцией, оба поля вместе', datePaths.length === 2 && plan.updates['trips_dashboard/abc/dateStart'] === '2026-10-02' && plan.updates['trips_dashboard/abc/dateEnd'] === '2026-10-12', datePaths);
  const bases = new Set(datePaths.map((p) => p.split('/').slice(0, 2).join('/')));
  check('одна база записи (нет второй стороны)', bases.size === 1 && bases.has('trips_dashboard/abc'), Array.from(bases));
  check('даты НЕ пишутся в tripMeta (в tripMeta только очистка null)', !Object.entries(plan.updates).some(([p, v]) => p.includes('/tripMeta/') && v !== null), plan.updates);
  check('ни одного пути в tripTimeline/trips (нет копии «второй записи»)', !Object.keys(plan.updates).some((p) => p.startsWith('tripTimeline/trips/')), Object.keys(plan.updates));
  check('история/журнал этой операцией не создаются', !Object.keys(plan.updates).some((p) => p.includes('tripHistory') || p.includes('global_history') || p.includes('history/')), Object.keys(plan.updates));
  check('факт не затрагивается (ни этапов, ни baza)', !Object.keys(plan.updates).some((p) => p.includes('/stages/') || p.startsWith('baza/')), Object.keys(plan.updates));
  check('проверка периодов — по НОВЫМ датам и той же машине', plan.guard.dateStart === '2026-10-02' && plan.guard.dateEnd === '2026-10-12' && plan.guard.carNumber === 'AP 8340-7' && plan.guard.id === 'abc', plan.guard);

  const manual = planBoundsWritePlan({ tripKey: 'tl:m1', raw: { carNumber: 'AP 8340-7', startDate: '2026-11-01', endDate: '2026-11-05' }, startIso: '2026-11-02', endIso: '2026-11-07' });
  check('ручной рейс: запись — его собственная запись (startDate/endDate)', manual.base === 'tripTimeline/trips/m1' && manual.updates['tripTimeline/trips/m1/startDate'] === '2026-11-02' && manual.updates['tripTimeline/trips/m1/endDate'] === '2026-11-07', manual.updates);
  check('ручной рейс: даты не уходят в tripMeta', !Object.entries(manual.updates).some(([p, v]) => p.includes('/tripMeta/') && v !== null));

  const legacy = planBoundsWritePlan({
    tripKey: 'pd:abc',
    raw: linkedRaw,
    metaRaw: { planStart: '2026-09-01', planEnd: '2026-09-02', comment: 'текст' },
    startIso: '2026-10-02',
    endIso: '2026-10-12',
  });
  check('легаси-оверрайд очищается той же операцией (второе значение исчезает)', legacy.updates['tripTimeline/tripMeta/pd:abc/planStart'] === null && legacy.updates['tripTimeline/tripMeta/pd:abc/planEnd'] === null, legacy.updates);
  check('тексты tripMeta (comment и пр.) операция дат не трогает', !('tripTimeline/tripMeta/pd:abc/comment' in legacy.updates));

  const months = planBoundsWritePlan({ tripKey: 'pd:abc', raw: linkedRaw, startIso: '02.10.2026', endIso: '12/10/2026' });
  check('даты принимаются и в дд/мм/гггг, хранятся в YYYY-MM-DD', months.ok && months.updates['trips_dashboard/abc/dateStart'] === '2026-10-02' && months.updates['trips_dashboard/abc/dateEnd'] === '2026-10-12');

  const badOrder = planBoundsWritePlan({ tripKey: 'pd:abc', raw: linkedRaw, startIso: '2026-10-12', endIso: '2026-10-02' });
  check('возвращение раньше старта — отказ ДО записи, путей нет', !badOrder.ok && Object.keys(badOrder.updates).length === 0, badOrder.error);

  const noDates = planBoundsWritePlan({ tripKey: 'pd:empty', raw: { carNumber: 'X' }, startIso: '', endIso: '' });
  check('нет дат нигде — сохранять нечего (отказ, без записи)', !noDates.ok && Object.keys(noDates.updates).length === 0);

  const idem1 = planBoundsWritePlan({ tripKey: 'pd:abc', raw: linkedRaw, startIso: '2026-10-02', endIso: '2026-10-12', nowIso: '2026-10-15T10:00:00Z' });
  const idem2 = planBoundsWritePlan({ tripKey: 'pd:abc', raw: { ...linkedRaw, dateStart: '2026-10-02', dateEnd: '2026-10-12' }, startIso: '2026-10-02', endIso: '2026-10-12', nowIso: '2026-10-15T10:00:00Z' });
  check('повторная синхронизация идемпотентна (абсолютные значения, дублей нет)', JSON.stringify(idem1.updates) === JSON.stringify(idem2.updates));

  check('planBoundsTargetOf: pd → план, tl → ручной, id без префикса', planBoundsTargetOf('pd:x').kind === 'plan' && planBoundsTargetOf('tl:y').kind === 'manual' && planBoundsTargetOf('tl:y').bareId === 'y');
}

console.log('\n4. Проверка периодов не обходится перетаскиванием');
{
  const existing = [
    { id: 'other', carNumber: 'AP 8340-7', dateStart: '2026-10-15', dateEnd: '2026-10-25' },
    { id: 'self', carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' },
  ];
  const drag = (key: string, raw: Record<string, unknown>, startIso: string, endIso: string) => {
    const plan = planBoundsWritePlan({ tripKey: key, raw, startIso, endIso });
    return findTripPeriodConflict(plan.guard, existing, { selfKey: plan.bareId });
  };
  const conflict = drag('pd:self', { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' }, '2026-10-14', '2026-10-20');
  check('конфликтующее перетаскивание (нахлёст на чужой рейс) — конфликт найден', !!conflict, conflict?.message);
  check('сообщение называет машину и период', /8340-7/.test(conflict?.message || ''), conflict?.message);
  const allowed = drag('pd:self', { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' }, '2026-10-06', '2026-10-14');
  check('допустимое перетаскивание (последовательные рейсы, день возвращения свободен) — конфликта нет', allowed === null, allowed?.message);
  const touch = drag('pd:self', { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' }, '2026-10-06', '2026-10-15');
  check('выезд в ДЕНЬ возвращения предыдущего рейса — разрешён (правило границ)', touch === null, touch?.message);
  const overRun = drag('pd:self', { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' }, '2026-10-14', '2026-10-16');
  check('заход внутрь чужого периода (14 < 15 уже наложение) — конфликт', !!overRun, overRun?.message);
  const selfMove = drag('pd:self', { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-05' }, '2026-10-01', '2026-10-12');
  check('правка собственного периода не конфликтует с самим собой', selfMove === null, selfMove?.message);
}

console.log('\n5. Пересчёт «Плана дохода» при правке дат (без выдуманных чисел)');
{
  const planned = planBoundsWritePlan({ tripKey: 'pd:abc', raw: { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-10' }, startIso: '2026-10-02', endIso: '2026-10-12' });
  check('дни пересчитываются тем же расчётом (обе даты включительно: 02→12 = 11)', planned.updates['trips_dashboard/abc/days'] === 11, planned.updates['trips_dashboard/abc/days']);
  check('у незаполненной записи финансы НЕ выдумываются (нет totalKm/profit)', !('trips_dashboard/abc/totalKm' in planned.updates) && !('trips_dashboard/abc/profit' in planned.updates), Object.keys(planned.updates));

  const withFin = planBoundsWritePlan({
    tripKey: 'pd:fin',
    raw: {
      carNumber: 'AP 8340-7',
      dateStart: '2026-10-01',
      dateEnd: '2026-10-10',
      legs: [{ from: 'Москва', to: 'Стамбул', km: 2000, rate: 5000 }],
      totalKm: 2000,
    },
    startIso: '2026-10-02',
    endIso: '2026-10-12',
  });
  check('у заполненной записи финансы пересчитываются (totalKm/profit на месте)', typeof withFin.updates['trips_dashboard/fin/totalKm'] === 'number' && typeof withFin.updates['trips_dashboard/fin/profit'] === 'number', Object.keys(withFin.updates));

  const noEnd = planBoundsWritePlan({ tripKey: 'pd:open', raw: { carNumber: 'AP 8340-7', dateStart: '2026-10-01' }, startIso: '2026-10-02' });
  check('одна сторона (нет возвращения) — дни не выдумываются, путь дней не пишется', noEnd.ok && !('trips_dashboard/open/days' in noEnd.updates), noEnd.updates);

  check('плановая продолжительность для подписи полосы — тот же расчёт, что в «Плане дохода»', planDaysForRange('2026-10-02', '2026-10-12') === 11 && planDaysForRange('2026-10-02', '') === undefined);
  check('dayStr/dayNum — календарные дни через Date.UTC (без сдвигов часовых поясов)', dayStr(dayNum('2026-10-25') as number) === '2026-10-25');
}

console.log('\n6. Повторная синхронизация и параллельные запросы (ограничение честно)');
{
  const mk = (startIso: string, endIso: string) =>
    planBoundsWritePlan({ tripKey: 'pd:abc', raw: { carNumber: 'AP 8340-7', dateStart: '2026-10-01', dateEnd: '2026-10-10' }, startIso, endIso });
  const first = mk('2026-10-02', '2026-10-12');
  const again = mk('2026-10-02', '2026-10-12');
  check('повторный вызов (ретрай/две вкладки) — та же запись и те же пути', JSON.stringify(first.updates) === JSON.stringify(again.updates));
  const other = mk('2026-10-05', '2026-10-15');
  check(
    'параллельные правки пишут ОДИН и тот же набор путей (одна запись: последняя побеждает, второго рейса/сторона не создаётся)',
    JSON.stringify(Object.keys(first.updates).sort()) === JSON.stringify(Object.keys(other.updates).sort()),
  );
  check('повтор не добавляет записей (duplicateOf/новых id в путях нет)', !Object.keys(first.updates).some((p) => p.includes('duplicate') || p.split('/').length > 3));
  // Проверка периодов выполняется ДО записи (порядок вызовов в dbService:
  // guardTimelinePeriod → update одним multi-path). Атомарной транзакции на
  // пару «два рейса» в RTDB нет: окно TOCTOU между проверкой и записью честно
  // остаётся; здесь проверяется, что кандидат — НОВЫЕ даты, а не старые.
  check('проверка периодов — по НОВЫМ датам (иначе конфликт не был бы найден)', first.guard.dateStart === '2026-10-02' && first.guard.dateEnd === '2026-10-12');
  check('сам по себе сборщик записи не содержит побочных эффектов (чистая функция)', JSON.stringify(mk('2026-10-02', '2026-10-12').updates) === JSON.stringify(first.updates));
}

console.log(`\nИТОГО: ${passed}/${passed + failed}`);
if (failed > 0) process.exit(1);
