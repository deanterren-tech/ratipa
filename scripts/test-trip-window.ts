/**
 * test-trip-window — юнит-проверки доработок окна рейса «Таймлайна рейсов»:
 *
 *  1. Сокращённые названия этапов («Затаможка» / «Растаможка» / «Бронь») —
 *     встроенный справочник, шаблоны направлений, отображение у НОВЫХ и
 *     СТАРЫХ записей (записи хранят КЛЮЧИ типов, имя берётся из справочника);
 *     сопоставление шаблона направления и подсказки порядка не сломаны.
 *  2. Ложное предупреждение «В плане не указана дата возвращения»: полнота
 *     плана считается по ЕДИНОМУ источнику границ (tripPlanBounds: план записи
 *     + правки дат из таймлайна (tripMeta) + плановые даты этапов), а не по
 *     одному полю dateEnd; пока ветка оверрайда грузится — предупреждения нет.
 *  3. Счётчики длительности (tripDurationsOf): календарные дни ВКЛЮЧИТЕЛЬНО
 *     (15.10→17.10 = 3 дня), выполняемый — факт-старт → сегодня, завершённый —
 *     до факт-возвращения; фактические даты плановыми НЕ подменяются.
 *  4. Интервалы между соседними этапами (stageIntervalsOf): БЕЗ включительного
 *     подсчёта (15.10→17.10 = 2; один день = 0), «—» при отсутствии даты,
 *     явная ошибка при обратном порядке (не ноль), пересчёт при перестановке.
 *
 * Запуск: npx tsx scripts/test-trip-window.ts   (npm run test:trip-window)
 * Код выхода: 0 — все проверки прошли; 1 — есть провалы.
 */
import type { TimelineStage, TimelineStageType, TimelineTrip } from '../src/types';
import { DEFAULT_STAGE_TYPES, effectiveStageTypes, stageTypeName } from '../src/components/modules/tripTimeline/lib/catalog';
import {
  DEFAULT_STAGE_TEMPLATES,
  applyStageTemplate,
  resolveStageTypeByName,
  templateForDirection,
  templateOrderWarnings,
  templateStagesFromTrip,
} from '../src/components/modules/tripTimeline/lib/stageTemplates';
import {
  dayNum,
  dayStr,
  stageIntervalText,
  stageIntervalsOf,
  tripPlanBounds,
  tripSpan,
} from '../src/components/modules/tripTimeline/lib/timeline';
import { buildCarIndex, planTripsToWholeTrips, planMetaOverrideOf, withPlanMetaOverride } from '../src/components/modules/tripTimeline/lib/sources';
import { buildTimelinePlanPayload, planDaysForRange, tripDurationsOf } from '../src/components/modules/tripTimeline/lib/planFromDraft';
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

// ── Общие фикстуры ─────────────────────────────────────────────────────────
const carIndex = buildCarIndex([{ couplingId: 'car1', carNumber: 'AP 8340-7', dispatcherId: 'd1', dispatcherName: 'Тест' }]);
const dir = buildDispatcherDirectory([{ id: 'd1', name: 'Тест' }]);

const st = (over: Partial<TimelineStage> & { id: string }): TimelineStage => ({
  type: 'other',
  label: '',
  plannedDate: '',
  actualDate: '',
  isCritical: false,
  reason: '',
  action: '',
  order: 1,
  seq: 1,
  bufferDays: 0,
  ...over,
});

const stagesStoreOf = (stages: TimelineStage[]): Record<string, Record<string, unknown>> =>
  Object.fromEntries(stages.map((s) => [s.id, s as unknown as Record<string, unknown>]));

/** Рейс «Плана дохода» через ТОТ ЖЕ путь чтения, что у модуля. */
const planTripOf = (record: Record<string, unknown>, stages: TimelineStage[] = []) => {
  const rec = { id: 't1', carNumber: 'AP 8340-7', ...record };
  return planTripsToWholeTrips([rec], carIndex, dir, { t1: stagesStoreOf(stages) })[0];
};

/** Минимальный ручной рейс (для счётов дат без внешних источников). */
const manualTripOf = (stages: TimelineStage[], over: Partial<TimelineTrip> = {}): TimelineTrip => ({
  id: 'tl:test',
  carNumber: 'AP 8340-7',
  route: '',
  dispatcherId: '',
  dispatcherName: '',
  bufferDays: 0,
  archived: false,
  createdAt: '',
  updatedAt: '',
  stages,
  ...over,
});

const RETURN_WARN = 'не указана дата возвращения';
const hasReturnWarn = (warnings: string[]): boolean => warnings.some((w) => w.includes(RETURN_WARN));

const today = dayNum('2026-10-15') as number;

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Сокращённые названия этапов — справочник, шаблоны, старые записи');
{
  const byKey = new Map(DEFAULT_STAGE_TYPES.map((t) => [t.key, t.name]));
  check('встроенный справочник: «Затаможка»', byKey.get('cust_out') === 'Затаможка');
  check('встроенный справочник: «Растаможка»', byKey.get('cust_in') === 'Растаможка');
  check('встроенный справочник: «Бронь»', byKey.get('reserve') === 'Бронь');
  const allNames = DEFAULT_STAGE_TYPES.map((t) => t.name).join(' | ');
  check(
    'ни в одном имени нет «(экспорт)»/«(импорт)»/«согласование перехода»',
    !allNames.includes('(экспорт)') && !allNames.includes('(импорт)') && !allNames.includes('согласование перехода'),
    allNames,
  );
  // Внутренние ключи НЕ изменились (записи этапов хранят ключ, не имя).
  check(
    'ключи типов не менялись',
    DEFAULT_STAGE_TYPES.map((t) => t.key).join(',') === 'load,cust_out,border,cust_in,reserve,unl,other',
  );
  // Старые записи: этап хранит type='cust_out' — имя берётся из справочника.
  const oldStage = st({ id: 'old1', type: 'cust_out' });
  check('старая запись с ключом cust_out показывает «Затаможка»', stageTypeName(DEFAULT_STAGE_TYPES, oldStage) === 'Затаможка');
  check('старая запись с ключом cust_in показывает «Растаможка»', stageTypeName(DEFAULT_STAGE_TYPES, st({ id: 'old2', type: 'cust_in' })) === 'Растаможка');
  check('старая запись с ключом reserve показывает «Бронь»', stageTypeName(DEFAULT_STAGE_TYPES, st({ id: 'old3', type: 'reserve' })) === 'Бронь');
  // Эффективный справочник: пустая база → встроенные (короткие) имена.
  const eff = effectiveStageTypes([]);
  check('эффективный справочник из пустой базы — короткие имена', stageTypeName(eff, oldStage) === 'Затаможка');

  // Шаблоны направлений.
  const tur = DEFAULT_STAGE_TEMPLATES.find((t) => t.name === 'Турция');
  const chn = DEFAULT_STAGE_TEMPLATES.find((t) => t.name === 'Китай');
  check('шаблон «Турция»: короткие названия', tur?.stages.join('|') === 'Загрузка|Затаможка|Граница|Растаможка|Выгрузка', tur?.stages);
  check('шаблон «Китай»: короткие названия', chn?.stages.join('|') === 'Загрузка|Граница|Растаможка|Выгрузка', chn?.stages);
  check('сопоставление шаблона «Турция 1» с направлением «Турция» работает', templateForDirection([{ id: 't1', name: 'Турция 1', stages: ['A'] }], 'Турция', 'TR')?.id === 't1');
  check('сопоставление точного «Турция» — по имени', templateForDirection(DEFAULT_STAGE_TEMPLATES, 'Турция', 'TR')?.id === 'tpl_turkey');

  // Канонический справочник типов (как в базе после переименования).
  const dbTypes: TimelineStageType[] = DEFAULT_STAGE_TYPES;
  check('«Затаможка» сопоставляется типу cust_out', resolveStageTypeByName(dbTypes, 'Затаможка')?.key === 'cust_out');
  check('«Растаможка» сопоставляется типу cust_in', resolveStageTypeByName(dbTypes, 'Растаможка')?.key === 'cust_in');
  check('«Бронь» сопоставляется типу reserve', resolveStageTypeByName(dbTypes, 'Бронь')?.key === 'reserve');

  // Подсказки порядка по шаблону не сломаны новыми именами.
  const warnPairs = templateOrderWarnings(
    [st({ id: 'g1', type: 'border', plannedDate: '2026-10-25', seq: 1 }), st({ id: 'g2', type: 'cust_out', plannedDate: '2026-10-25', seq: 2 })],
    tur!,
    dbTypes,
  );
  check('подсказка порядка по «Турции»: Затаможка раньше Границы — пара найдена', warnPairs.length === 1, warnPairs);
  check('в паре названия короткие', warnPairs[0]?.nameA === 'Граница' && warnPairs[0]?.nameB === 'Затаможка', warnPairs[0] && `${warnPairs[0].nameA}/${warnPairs[0].nameB}`);
  const applied = applyStageTemplate([], chn!, 'append', { stageTypes: dbTypes, makeId: (() => { let i = 0; return () => `s_${++i}`; })() });
  check('«Из шаблона» создаёт этапы по коротким именам', applied.stages.map((s) => s.type).join(',') === 'load,border,cust_in,unl', applied.stages.map((s) => s.type));
  const backNames = templateStagesFromTrip(applied.stages, dbTypes);
  check('«Сохранить как шаблон» из этих этапов — короткие имена', backNames.join('|') === 'Загрузка|Граница|Растаможка|Выгрузка', backNames);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Полнота плана: заполненная дата возвращения предупреждения НЕ даёт');
{
  // (а) Даты в записи плана — предупреждения нет.
  const full = planTripOf({ dateStart: '2026-10-14', dateEnd: '2026-10-21' });
  check('запись с dateEnd — без предупреждения о возвращении', !hasReturnWarn(full.warnings), full.warnings);
  check('запись с dateEnd — план полный (openPlan=false)', full.openPlan === false);
  check('границы = даты записи', JSON.stringify(tripPlanBounds(full)) === JSON.stringify({ pMin: dayNum('2026-10-14'), pMax: dayNum('2026-10-21') }));

  // (б) Дата возвращения — только в ЭТАПАХ (реальная «Требует заполнения» запись).
  const stageOnly = planTripOf(
    { dateStart: '2026-10-14', needsFill: true, createdFrom: 'timeline' },
    [
      st({ id: 's1', type: 'load', plannedDate: '2026-10-14' }),
      st({ id: 's2', type: 'unl', plannedDate: '2026-11-12', seq: 2, order: 2 }),
    ],
  );
  check(
    'дата возвращения заполнена ЭТАПАМИ — предупреждения НЕТ (раньше было ложным)',
    !hasReturnWarn(stageOnly.warnings),
    stageOnly.warnings,
  );
  check('openPlan=false: полоса показывает полный план', stageOnly.openPlan === false);
  check('эффективный pMax — плановая дата последнего этапа', tripPlanBounds(stageOnly).pMax === dayNum('2026-11-12'));

  // (в) Даты возвращения нет нигде — предупреждение ОСТАЁТСЯ.
  const missing = planTripOf({ dateStart: '2026-10-14' });
  check('нет dateEnd и нет этапов — предупреждение есть', hasReturnWarn(missing.warnings), missing.warnings);
  check('openPlan=true', missing.openPlan === true);
  const mergedMissing = withPlanMetaOverride(missing, {}, { metaLoaded: true });
  check('после слоя оверрайда (meta загружена, пусто) предупреждение есть', hasReturnWarn(mergedMissing.warnings), mergedMissing.warnings);

  // (г) Пока ветка tripMeta грузится — ложной ошибки нет.
  const loading = withPlanMetaOverride(missing, undefined, { metaLoaded: false });
  check('metaLoaded=false — предупреждения о возвращении нет (ложная ошибка исключена)', !hasReturnWarn(loading.warnings), loading.warnings);

  // (д) Правка даты из таймлайна (оверрайд tripMeta: planStart/planEnd) — рейс полный.
  const override = planMetaOverrideOf({ planStart: '2026-10-14', planEnd: '2026-11-20' });
  check('planMetaOverrideOf читает planStart/planEnd', override?.pMin === dayNum('2026-10-14') && override?.pMax === dayNum('2026-11-20'), override);
  const merged = withPlanMetaOverride(missing, { planStart: '2026-10-14', planEnd: '2026-11-20' }, { metaLoaded: true });
  check('оверрайд закрывает полноту — предупреждения нет', !hasReturnWarn(merged.warnings), merged.warnings);
  check('оверрайд становится spanOverride рейса (дата видна окну и полосе)', merged.spanOverride?.pMax === dayNum('2026-11-20'), merged.spanOverride);
  check('границы рейса с оверрайдом совпадают у всех читателей', tripPlanBounds(merged).pMax === dayNum('2026-11-20'));
  const loadedEmpty = withPlanMetaOverride(missing, {}, { metaLoaded: true });
  check('пустой оверрайд не затирает границы записи', loadedEmpty.spanOverride?.pMin === dayNum('2026-10-14') && loadedEmpty.spanOverride?.pMax === null);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Счётчики длительности: дни включительно, факт без подмены планом');
{
  // Старт и возвращение в один день = 1 день.
  check('план 15.10→15.10 = 1 день', planDaysForRange('2026-10-15', '2026-10-15') === 1);
  check('план 15.10→17.10 = 3 дня (обе даты включительно)', planDaysForRange('2026-10-15', '2026-10-17') === 3);
  check('план 15.10→17.10 = 3 дня и в счётчике окна', tripDurationsOf(manualTripOf([st({ id: 'a', plannedDate: '2026-10-15' }), st({ id: 'b', plannedDate: '2026-10-17', seq: 2 })]), today).planDays === 3);

  // Выполняемый: от факт-старта до сегодня.
  const ongoingTrip = manualTripOf([
    st({ id: 'a', type: 'load', plannedDate: '2026-10-01', actualDate: '2026-10-01' }),
    st({ id: 'b', type: 'unl', plannedDate: '2026-10-20', seq: 2 }),
  ]);
  const ongoingDur = tripDurationsOf(ongoingTrip, today);
  check('выполняемый: 01.10 → сегодня (15.10) = 15 дней', ongoingDur.ongoingDays === 15, ongoingDur);
  check('завершённого счёта у выполняемого нет', ongoingDur.doneDays === undefined);
  check('плановая длительность всё равно считается', ongoingDur.planDays === 20, ongoingDur);

  // Завершённый: от факт-старта до факт-возвращения.
  const doneTrip = manualTripOf([
    st({ id: 'a', type: 'load', actualDate: '2026-10-01' }),
    st({ id: 'b', type: 'unl', actualDate: '2026-10-10', seq: 2 }),
  ]);
  const doneDur = tripDurationsOf(doneTrip, today);
  check('завершённый: 01.10 → 10.10 = 10 дней', doneDur.doneDays === 10, doneDur);
  check('счёта «в рейсе» у завершённого нет', doneDur.ongoingDays === undefined);

  // Факт в один день = 1 день (включительно).
  const oneDayFact = tripDurationsOf(manualTripOf([st({ id: 'a', actualDate: '2026-10-14' })]), today);
  check('факт-старт в один день = 1 день', oneDayFact.doneDays === 1, oneDayFact);

  // Нет факта — подстановки плана НЕТ.
  const noFact = tripDurationsOf(manualTripOf([st({ id: 'a', plannedDate: '2026-10-01' })]), today);
  check('нет факта: hasFact=false, счётов факта нет', noFact.hasFact === false && noFact.ongoingDays === undefined && noFact.doneDays === undefined, noFact);
  check('нет факта: плановая длительность не подменяет факт (planDays отдельно)', noFact.planDays === 1 && noFact.doneDays === undefined);

  // Нет ни плана, ни факта — счёта нет (—).
  const empty = tripDurationsOf(manualTripOf([st({ id: 'a' })]), today);
  check('без дат: план и факт — без чисел', empty.planDays === undefined && empty.ongoingDays === undefined && empty.doneDays === undefined, empty);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Интервалы между соседними этапами: без включительного подсчёта');
{
  const s = (id: string, over: Partial<TimelineStage>): TimelineStage => st({ id, ...over });
  const two = [s('a', { plannedDate: '2026-10-15' }), s('b', { plannedDate: '2026-10-17', seq: 2 })];
  const iv = stageIntervalsOf(two);
  check('два этапа — один интервал', iv.length === 1);
  check('план 15.10→17.10 = 2 дня (без включительного)', iv[0].planDays === 2, iv[0]);
  check('факт без дат = — (null)', iv[0].factDays === null && !iv[0].factReversed);

  const sameDay = stageIntervalsOf([s('a', { plannedDate: '2026-10-15', actualDate: '2026-10-15' }), s('b', { plannedDate: '2026-10-15', actualDate: '2026-10-15', seq: 2 })]);
  check('соседние этапы в один день = 0', sameDay[0].planDays === 0 && sameDay[0].factDays === 0, sameDay[0]);

  const factIv = stageIntervalsOf([s('a', { actualDate: '2026-10-15' }), s('b', { actualDate: '2026-10-19', seq: 2 })]);
  check('факт 15.10→19.10 = 4 дня', factIv[0].factDays === 4, factIv[0]);
  check('нет плана — «План: —» в тексте', stageIntervalText(factIv[0]).startsWith('План: —'), stageIntervalText(factIv[0]));
  check('полный текст «План: 2 дн. · Факт: 4 дн.» (пример)', stageIntervalText({ planDays: 2, factDays: 4, planReversed: false, factReversed: false }) === 'План: 2 дн. · Факт: 4 дн.');

  // Через этап без даты НЕ перескакиваем: интервал считается только между СОСЕДЯМИ,
  // отсутствие одной даты даёт «—», а не «дотягивание» до следующего этапа с датой.
  const gap = stageIntervalsOf([
    s('a', { plannedDate: '2026-10-15' }),
    s('b', { plannedDate: '' , seq: 2 }),
    s('c', { plannedDate: '2026-10-19', seq: 3 }),
  ]);
  check('этап без даты: оба интервала без чисел (нет перескока)', gap.length === 2 && gap[0].planDays === null && gap[1].planDays === null, gap);

  // Обратный порядок — явная ошибка, НЕ ноль.
  const reversed = stageIntervalsOf([s('a', { plannedDate: '2026-10-17' }), s('b', { plannedDate: '2026-10-15', seq: 2 })]);
  check('обратный порядок: planReversed=true, число не выдумано', reversed[0].planReversed === true && reversed[0].planDays === null, reversed[0]);
  check('обратный порядок виден в тексте («ошибка порядка дат»), не нулём', stageIntervalText(reversed[0]).includes('ошибка порядка дат'), stageIntervalText(reversed[0]));
  const reversedFact = stageIntervalsOf([s('a', { actualDate: '2026-10-17' }), s('b', { actualDate: '2026-10-15', seq: 2 })]);
  check('обратный порядок по факту — тоже ошибка', reversedFact[0].factReversed === true && reversedFact[0].factDays === null);

  // Перестановка этапов пересчитывает интервалы (по ТЕКУЩЕМУ порядку списка).
  const three = [s('a', { plannedDate: '2026-10-01' }), s('b', { plannedDate: '2026-10-03', seq: 2 }), s('c', { plannedDate: '2026-10-06', seq: 3 })];
  const before = stageIntervalsOf(three).map((x) => x.planDays).join(',');
  const swapped = [three[0], three[2], three[1]];
  const after = stageIntervalsOf(swapped);
  check('исходные интервалы 2,3', before === '2,3', before);
  check('после перестановки интервалы пересчитаны (5 и ошибка)', after[0].planDays === 5 && after[1].planReversed === true, after);
  check('перестановка не мутирует исходный список', stageIntervalsOf(three).map((x) => x.planDays).join(',') === '2,3');

  // Старт и возвращение — границы цепочки (поля рейса), этапами НЕ дублируются:
  // интервалов ровно на один меньше числа строк.
  check('интервалов ровно n−1 (старт/возвращение не дублируются этапами)', stageIntervalsOf(three).length === 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. После сохранения и повторного открытия данные согласованы');
{
  // Черновик формы → запись плана дохода (тот же путь, что у «Сохранить»).
  const draftStages = [
    st({ id: 's1', type: 'load', plannedDate: '2026-10-14' }),
    st({ id: 's2', type: 'border', plannedDate: '2026-10-16', seq: 2 }),
    st({ id: 's3', type: 'unl', plannedDate: '2026-10-21', seq: 3 }),
  ];
  const payload = buildTimelinePlanPayload(
    { carNumber: 'AP 8340-7', route: 'Минск — Алматы', startDate: '2026-10-14', endDate: '2026-10-21', circles: 1 },
    { createdBy: 'Тест', dispatcher: { id: 'd1', name: 'Тест' } },
  );
  check('сохранение пишет даты и дни записи плана', payload.dateStart === '2026-10-14' && payload.dateEnd === '2026-10-21' && payload.days === 8, payload.days);

  // «Повторное открытие»: та же запись + те же этапы → согласовано.
  const reopened = planTripOf(
    { dateStart: String(payload.dateStart), dateEnd: String(payload.dateEnd), needsFill: true },
    draftStages,
  );
  const bounds = tripPlanBounds(reopened);
  check('после переоткрытия границы = сохранённые даты', bounds.pMin === dayNum('2026-10-14') && bounds.pMax === dayNum('2026-10-21'), bounds);
  check('после переоткрытия предупреждения о возвращении нет', !hasReturnWarn(reopened.warnings), reopened.warnings);
  const dur = tripDurationsOf(reopened, today);
  check('после переоткрытия длительность = сохранённым дням (8)', dur.planDays === 8, dur);
  check('после переоткрытия интервалы согласованы с этапами', stageIntervalsOf(reopened.stages).map((x) => x.planDays).join(',') === '2,5');
  check(
    'границы окна и полосы совпадают с записью (ov.pMax ?? span.pMax)',
    (reopened.spanOverride?.pMax ?? tripSpan(reopened).pMax) === dayNum('2026-10-21'),
  );

  // Правка даты возвращения (тем же сохранением) обновляет и границы, и счёты.
  const edited = planTripOf({ dateStart: '2026-10-14', dateEnd: '2026-10-18' }, draftStages);
  check('правка даты меняет границы без перезагрузки (чтение = источник)', tripPlanBounds(edited).pMax === dayNum('2026-10-18'));
  check('правка даты меняет счёт длительности', tripDurationsOf(edited, today).planDays === 5);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
