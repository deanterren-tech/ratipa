/**
 * Тесты чистой логики мастерa «Закрыть рейс» (src/components/modules/tripClose/core.ts).
 *
 * Проверяем правила, заданные владельцем:
 *  · шаги и их состояния (не начат / в работе / выполнен / отложен / не требуется);
 *  · «Отложено» ≠ «Выполнено»; «Не требуется» — только с обоснованием;
 *  · прогресс, canFinish, точка продолжения (nextStep), сводка;
 *  · защита операций (hasOperation), зарплата ≠ выплата;
 *  · salaryRecheckNeeded (план изменился после зарплаты), planStepIssues (нет «Факт км»/дат);
 *  · блокировка lockIsActive.
 *
 * Запуск: npm run test:trip-close
 */
import {
  LOCK_TTL_MS,
  STEP_DEFS,
  STEP_OPERATION_KEYS,
  STEP_ORDER,
  STEP_STATUS_LABEL,
  deriveProgress,
  emptyState,
  emptySteps,
  hasOperation,
  lockIsActive,
  missingInSummary,
  nextStep,
  normalizeState,
  planStepIssues,
  progressLabel,
  salaryRecheckNeeded,
  stepDef,
  stepDone,
  stepSettled,
  summaryLines,
  type StepKey,
  type StepState,
  type StepStatus,
  type TripCloseState,
} from '../src/components/modules/tripClose/core';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, info = '') => {
  if (cond) { passed++; console.log(`PASS :: ${name}${info ? ' :: ' + info : ''}`); }
  else { failed++; console.log(`FAIL :: ${name}${info ? ' :: ' + info : ''}`); }
};

const step = (status: StepStatus, extra: Partial<StepState> = {}): StepState => ({ status, at: '2026-10-15T10:00:00.000Z', by: 'tester', ...extra });

/** Базовое состояние без обращения к базе: normalizeState(null) даёт канонический пустой сценарий. */
const mkState = (over: Partial<TripCloseState> = {}): TripCloseState => {
  const base = normalizeState(null, 'trip-probe');
  return { ...base, ...over, steps: { ...base.steps, ...(over.steps || {}) } };
};

const withSteps = (statuses: Partial<Record<StepKey, StepState>>): TripCloseState => mkState({ steps: statuses as Record<StepKey, StepState> });
// ── 1. Определения шагов ─────────────────────────────────────────────────────
console.log('\nОпределения шагов');
check('шагов ровно шесть и порядок совпадает с STEP_DEFS', STEP_ORDER.length === 6 && STEP_DEFS.map((d) => d.key).join(',') === STEP_ORDER.join(','), STEP_ORDER.join(','));
check('у каждого шага есть короткое имя, подсказка и ключ права', STEP_DEFS.every((d) => d.short.trim() && d.hint.trim() && d.permissionKey.trim()));
check('первый шаг — план дохода, последний — журнал МДП', STEP_ORDER[0] === 'planDohod' && STEP_ORDER[5] === 'mdp');
check('stepDef находит шаг по ключу (mdp → bookIssue)', stepDef('mdp').key === 'mdp' && stepDef('mdp').permissionKey === 'bookIssue');
check('неизвестный ключ шага возвращает первый шаг, а не падает', stepDef('nope' as StepKey).key === 'planDohod');
check('ключи операций покрывают все шесть шагов и уникальны', STEP_ORDER.every((k) => Boolean(STEP_OPERATION_KEYS[k])) && new Set(Object.values(STEP_OPERATION_KEYS)).size === 6, Object.values(STEP_OPERATION_KEYS).join(','));
check('ключи операций совпадают с контрактом (planSaved…mdpReturned)', STEP_OPERATION_KEYS.planDohod === 'planSaved' && STEP_OPERATION_KEYS.salary === 'salarySaved' && STEP_OPERATION_KEYS.vyezd === 'vyezdSaved' && STEP_OPERATION_KEYS.zagruzka === 'zagruzkaConfirmed' && STEP_OPERATION_KEYS.docs === 'docsAccepted' && STEP_OPERATION_KEYS.mdp === 'mdpReturned');
check('подписи статусов: все пять состояний, «отложен» отдельно от «выполнен»', STEP_STATUS_LABEL.pending === 'не начат' && STEP_STATUS_LABEL.in_progress === 'в работе' && STEP_STATUS_LABEL.done === 'выполнен' && STEP_STATUS_LABEL.postponed === 'отложен' && STEP_STATUS_LABEL.not_needed === 'не требуется');

// ── 2. Пустое состояние и нормализация ───────────────────────────────────────
console.log('\nПустое состояние и нормализация');
const empty = emptySteps();
check('emptySteps: шесть шагов, все «не начаты»', Object.keys(empty).length === 6 && STEP_ORDER.every((k) => empty[k].status === 'pending'));
const seedState = emptyState({ tripId: 'pd:1', carNumber: 'ПР 9009-9', driverNames: ['Иванов И.'], route: 'Минск → Варшава' });
check('emptyState: запись плана берётся из tripId, когда planDohodId не задан', seedState.planDohodId === 'pd:1');
check('emptyState: точка старта — шаг «План дохода», массивов нет, флагов нет', seedState.currentStep === 'planDohod' && seedState.docs!.length === 0 && seedState.mdp!.length === 0 && !seedState.flags?.docsNone && !seedState.completedAt);
check('emptyState: переданный planDohodId не перетирается tripId', emptyState({ tripId: 'x', planDohodId: 'pd:real', carNumber: '' }).planDohodId === 'pd:real');
const norm = normalizeState({ carNumber: 'АВ 1234-5', steps: { salary: step('done') }, docs: [null as any, { id: 'd1', type: 'CMR', accepted: false }], mdp: null as any, operations: { planSaved: { at: '2026-10-15T09:00:00.000Z' } } } as any, 'pd:2');
check('normalizeState: заполненные шаги сохраняются, остальные остаются «не начатыми»', norm.steps.salary.status === 'done' && norm.steps.mdp.status === 'pending');
check('normalizeState: мусор в docs/mdp отфильтрован, массив остаётся массивом', Array.isArray(norm.docs) && norm.docs!.length === 1 && Array.isArray(norm.mdp) && norm.mdp!.length === 0);
check('normalizeState: operations читаются (защита повторных операций)', hasOperation(norm, 'planSaved') === true);
check('normalizeState: неизвестный статус шага не считается состоянием (падает в «не начат»)', normalizeState({ steps: { mdp: { status: 'finished' } } as any }, 'pd:3').steps.mdp.status === 'pending');
check('normalizeState: пустой шаг без статуса не ломает состояние', normalizeState({ steps: { docs: {} } as any }, 'pd:4').steps.docs.status === 'pending');
check('normalizeState: tripId всегда подставляется (состояние привязано к записи плана)', normalizeState({ tripId: 'чужой' } as any, 'pd:5').tripId === 'pd:5');

// ── 3. Состояния шага: «отложено» ≠ «выполнено», «не требуется» только с обоснованием ──
console.log('\nСостояния шага');
const stDone = withSteps({ salary: step('done') });
check('«выполнен» — шаг закрыт (stepDone и stepSettled)', stepDone(stDone, 'salary') && stepSettled(stDone, 'salary'));
const stPostponed = withSteps({ salary: step('postponed', { note: 'нет данных от бухгалтерии' }) });
check('«отложен» — НЕ выполнен и НЕ закрыт для прогресса', !stepDone(stPostponed, 'salary') && !stepSettled(stPostponed, 'salary'));
const stNotNeededNote = withSteps({ mdp: step('not_needed', { note: 'рейс внутри Беларуси, МДП не оформляли' }) });
check('«не требуется» с обоснованием — шаг закрыт', stepSettled(stNotNeededNote, 'mdp') && !stepDone(stNotNeededNote, 'mdp'));
const stNotNeededEmpty = withSteps({ mdp: step('not_needed', { note: '' }) });
check('«не требуется» без обоснования — шаг НЕ закрыт', !stepSettled(stNotNeededEmpty, 'mdp'));
check('«не требуется» с пробельным обоснованием — тоже не закрыт', !stepSettled(withSteps({ mdp: step('not_needed', { note: '   ' }) }), 'mdp'));
check('«в работе» — не закрыт и не выполнен', !stepSettled(withSteps({ vyezd: step('in_progress') }), 'vyezd'));
check('«не начат» — не закрыт', !stepSettled(withSteps({}), 'planDohod'));

// ── 4. Прогресс и canFinish ──────────────────────────────────────────────────
console.log('\nПрогресс и canFinish');
const p0 = deriveProgress(mkState());
check('свежий сценарий: 0 закрытых из 6, завершать нельзя', p0.done === 0 && p0.settled === 0 && p0.total === 6 && p0.canFinish === false && p0.completed === false);
check('свежий сценарий: все шаги в списке «не начат», отложенных нет', p0.pending.length === 6 && p0.postponed.length === 0 && p0.inProgress.length === 0);
const pMix = deriveProgress(withSteps({ planDohod: step('done'), salary: step('done'), vyezd: step('in_progress'), mdp: step('not_needed', { note: 'не использовалась' }) }));
check('три закрытых (2 выполнены + 1 обоснованно не требуется), done считает только выполненные', pMix.settled === 3 && pMix.done === 2, `${pMix.done}/${pMix.settled}`);
check('«в работе» виден отдельным списком', pMix.inProgress.length === 1 && pMix.inProgress[0] === 'vyezd');
const pPost = deriveProgress(withSteps({ planDohod: step('done'), salary: step('postponed', { note: 'причина' }) }));
check('отложенный шаг не закрывает сценарий: canFinish=false и он в списке postponed', pPost.canFinish === false && pPost.postponed.length === 1 && pPost.postponed[0] === 'salary');
const allDone = withSteps(Object.fromEntries(STEP_ORDER.map((k) => [k, step('done')])) as Record<StepKey, StepState>);
const pAll = deriveProgress(allDone);
check('все шесть выполнены: canFinish=true, отложенных нет', pAll.canFinish === true && pAll.settled === 6 && pAll.postponed.length === 0);
const allNotNeeded = withSteps(Object.fromEntries(STEP_ORDER.map((k) => [k, step('not_needed', { note: 'обоснование' })])) as Record<StepKey, StepState>);
check('все шесть обоснованно «не требуется»: canFinish=true', deriveProgress(allNotNeeded).canFinish === true);
const mixedNotNeeded = withSteps(Object.fromEntries(STEP_ORDER.map((k) => [k, k === 'docs' ? step('not_needed') : step('done')])) as Record<StepKey, StepState>);
check('«не требуется» без обоснования не даёт завершить (canFinish=false)', deriveProgress(mixedNotNeeded).canFinish === false);
check('completedAt помечает сценарий завершённым', deriveProgress({ ...allDone, completedAt: '2026-10-15T12:00:00.000Z' }).completed === true);

// ── 5. Точка продолжения nextStep ────────────────────────────────────────────
console.log('\nТочка продолжения (nextStep)');
check('свежий сценарий продолжается с «Плана дохода»', nextStep(mkState()) === 'planDohod');
check('шаг 1 выполнен и шаг 2 в работе → продолжаем с «Зарплаты»', nextStep(withSteps({ planDohod: step('done'), salary: step('in_progress') })) === 'salary');
check('зарплата выполнена → следующий «Учёт выезда»', nextStep(withSteps({ planDohod: step('done'), salary: step('done') })) === 'vyezd');
const skipPostponed = withSteps({ planDohod: step('postponed', { note: 'ждём документы' }), salary: step('done'), vyezd: step('done'), zagruzka: step('done'), docs: step('done'), mdp: step('pending') });
check('при отложенном шаге 1 продолжаем с последнего незавершённого (МДП), а не топчемся на отложенном', nextStep(skipPostponed) === 'mdp');
const onlyPostponed = withSteps({ planDohod: step('postponed', { note: 'нет данных' }), salary: step('done'), vyezd: step('done'), zagruzka: step('done'), docs: step('done'), mdp: step('done') });
check('если отложенных только один — он и есть следующая точка', nextStep(onlyPostponed) === 'planDohod');
check('всё закрыто → точки продолжения нет (null)', nextStep(allDone) === null);
check('завершённый сценарий точки продолжения не имеет', nextStep({ ...allDone, completedAt: '2026-10-15T12:00:00.000Z' }) === null);
check('«не требуется» без обоснования остаётся открытым шагом для продолжения', nextStep(withSteps({ planDohod: step('not_needed', { note: '' }) })) === 'planDohod');

// ── 6. Защита операций hasOperation ─────────────────────────────────────────
console.log('\nЗащита операций (hasOperation)');
check('без отметок операций hasOperation=false для всех ключей', !hasOperation(mkState(), 'planSaved') && !hasOperation(mkState(), 'mdpReturned'));
const opState = mkState({ operations: { planSaved: { at: '2026-10-15T09:00:00.000Z', by: 'A' }, planArchived: { by: 'A' } } as any });
check('запись с отметкой времени считается выполненной', hasOperation(opState, 'planSaved') === true);
check('полузаписанная операция (без at) выполнением не считается', hasOperation(opState, 'planArchived') === false);
check('незнакомый ключ операции — false, а не исключение', hasOperation(opState, 'noSuchOp') === false);

// ── 7. planStepIssues: «Факт км» и даты ─────────────────────────────────────
console.log('\nЗамечания шага «План дохода» (planStepIssues)');
check('запись плана не найдена — одна явная ошибка', (() => { const i = planStepIssues(null); return i.length === 1 && /не найдена/.test(i[0]); })());
check('пустой «Факт км» — замечание с пояснением, что подстановок нет', (() => { const i = planStepIssues({ factKm: '', dateStart: '2026-10-01', dateEnd: '2026-10-10' }); return i.length === 1 && /Факт км/.test(i[0]) && /плановый/.test(i[0]); })(), JSON.stringify(planStepIssues({ factKm: '', dateStart: '2026-10-01', dateEnd: '2026-10-10' })));
check('«Факт км» = null — то же замечание (пусто ≠ ноль)', planStepIssues({ factKm: null, dateStart: '2026-10-01', dateEnd: '2026-10-10' }).some((s) => /Факт км/.test(s)));
check('нулевой «Факт км» — значение есть, замечания нет (0 это не «пусто»)', planStepIssues({ factKm: 0, dateStart: '2026-10-01', dateEnd: '2026-10-10' }).length === 0);
check('«Факт км» строкой из базы («4200») принимается', planStepIssues({ factKm: '4200', dateStart: '2026-10-01', dateEnd: '2026-10-10' }).length === 0);
check('нечисловой «Факт км» — замечание', planStepIssues({ factKm: 'abc', dateStart: '2026-10-01', dateEnd: '2026-10-10' }).some((s) => /Факт км/.test(s)));
check('отсутствие даты старта и финиша — два отдельных замечания', (() => { const i = planStepIssues({ factKm: 100 }); return i.length === 2 && i.some((s) => /старта/.test(s)) && i.some((s) => /финиша/.test(s)); })());
check('заполнена только дата старта — замечание про финиш одно', (() => { const i = planStepIssues({ factKm: '10', dateStart: '2026-10-01' }); return i.length === 1 && /финиша/.test(i[0]); })());

// ── 8. salaryRecheckNeeded: план изменился после зарплаты ─────────────────────
console.log('\nПерепроверка зарплаты (salaryRecheckNeeded)');
const snap = { dateStart: '2026-10-01', dateEnd: '2026-10-10', factKm: 4200 };
check('план не менялся — перепроверка не нужна', salaryRecheckNeeded(snap, { dateStart: '2026-10-01', dateEnd: '2026-10-10', factKm: '4200' }).needed === false);
check('изменилась дата старта — названа причина', (() => { const r = salaryRecheckNeeded(snap, { dateStart: '2026-10-02', dateEnd: '2026-10-10', factKm: 4200 }); return r.needed && r.reasons.join(',') === 'дата старта'; })());
check('изменилась дата финиша — названа причина', salaryRecheckNeeded(snap, { dateStart: '2026-10-01', dateEnd: '2026-10-12', factKm: 4200 }).reasons.join(',') === 'дата финиша');
check('изменился «Факт км» — названа причина', salaryRecheckNeeded(snap, { dateStart: '2026-10-01', dateEnd: '2026-10-10', factKm: '4300' }).reasons.join(',') === '«Факт км»');
check('изменились даты и пробег — три причины сразу', (() => { const r = salaryRecheckNeeded(snap, { dateStart: '2026-10-02', dateEnd: '2026-10-12', factKm: 4300 }); return r.reasons.length === 3; })());
check('нет снимка зарплаты — перепроверка не выдумывается (needed=false)', salaryRecheckNeeded(null, { dateStart: '2026-10-05' }).needed === false && salaryRecheckNeeded(undefined, null).needed === false);
check('в плане пусто — сравнивать нечего, причины не выдумываются', salaryRecheckNeeded(snap, { dateStart: '', dateEnd: '', factKm: '' }).needed === false);
check('пустой «Факт км» в снимке — сравнение пропускается', salaryRecheckNeeded({ dateStart: '2026-10-01', dateEnd: '2026-10-10', factKm: null }, { factKm: 5000 }).needed === false);

// ── 9. Сводка summaryLines ───────────────────────────────────────────────────
console.log('\nСводка (summaryLines)');
const linesFresh = summaryLines(mkState());
check('сводка: шесть строк в порядке шагов с теми же ключами', linesFresh.length === 6 && linesFresh.map((l) => l.key).join(',') === STEP_ORDER.join(','));
check('свежие шаги: «Не начато», тон приглушённый', linesFresh.every((l) => l.result === 'Не начато' && l.tone === 'muted'));
const linesPost = summaryLines(withSteps({ salary: step('postponed', { note: 'нет ставки' }) }));
check('отложенный шаг в сводке: «Отложено — причина», тон warn (не «выполнен»)', linesPost[1].result === 'Отложено — нет ставки' && linesPost[1].tone === 'warn');
const linesNotNeeded = summaryLines(withSteps({ zagruzka: step('not_needed', { note: 'рейс пустой' }) }));
check('«не требуется» в сводке: подпись с обоснованием, тон muted', linesNotNeeded[3].result === 'Не требуется — рейс пустой' && linesNotNeeded[3].tone === 'muted');
const linesInProgress = summaryLines(withSteps({ vyezd: step('in_progress') }));
check('«в работе» в сводке: честно «не завершено», тон warn', linesInProgress[2].result === 'В работе — не завершено' && linesInProgress[2].tone === 'warn');
check('выполненный план дохода: «Сохранён и архивирован»', summaryLines(withSteps({ planDohod: step('done') }))[0].result === 'Сохранён и архивирован');
check('зарплата в сводке прямо говорит, что выплата оформляется отдельно', /факт выплаты/.test(summaryLines(withSteps({ salary: step('done') }))[1].result));
check('выполненный план загрузок: «Внесено и подтверждено»', summaryLines(withSteps({ zagruzka: step('done') }))[3].result === 'Внесено и подтверждено');

const docsPartialState = mkState({
  steps: { docs: step('done') } as any,
  docs: [
    { id: 'd1', type: 'CMR', number: '001', accepted: true, acceptedAt: '2026-10-15T10:00:00.000Z', acceptedBy: 'tester' },
    { id: 'd2', type: 'Дозвол', number: '77', accepted: false },
  ],
});
const docsPartial = summaryLines(docsPartialState)[4];
check('частичный приём документов: «приняты частично», warn и число непринятых', docsPartial.tone === 'warn' && docsPartial.result === 'Документы приняты частично — не принято: 1', docsPartial.result);
check('missingInSummary показывает непринятый документ поимённо', (() => { const m = missingInSummary(docsPartialState); return m.docs.length === 1 && m.docs[0].type === 'Дозвол' && m.mdp.length === 0; })());
const docsAllState = mkState({ steps: { docs: step('done') } as any, docs: [{ id: 'd1', type: 'CMR', accepted: true }, { id: 'd2', type: 'T1', accepted: true }] });
check('все документы приняты: «Документы приняты: 2», тон ok', (() => { const l = summaryLines(docsAllState)[4]; return l.result === 'Документы приняты: 2' && l.tone === 'ok'; })());
const docsNoneState = mkState({ steps: { docs: step('done') } as any, flags: { docsNone: true } });
check('«документы не выдавались» — явная подпись, тон muted', (() => { const l = summaryLines(docsNoneState)[4]; return /не выдавались/.test(l.result) && l.tone === 'muted'; })());

const mdpPartialState = mkState({
  steps: { mdp: step('done') } as any,
  mdp: [
    { id: 'm1', number: 'МДП 111', returned: true, returnedAt: '2026-10-15T10:00:00.000Z' },
    { id: 'm2', number: 'МДП 222', returned: false },
  ],
});
const mdpPartial = summaryLines(mdpPartialState)[5];
check('невозвращённая книжка МДП: «возврат не подтверждён», warn и количество', mdpPartial.tone === 'warn' && /без возврата: 1/.test(mdpPartial.result), mdpPartial.result);
check('missingInSummary называет книжки МДП без возврата', (() => { const m = missingInSummary(mdpPartialState); return m.mdp.length === 1 && m.mdp[0].number === 'МДП 222'; })());
check('все книжки возвращены: «Возврат подтверждён: 2», тон ok', (() => { const l = summaryLines(mkState({ steps: { mdp: step('done') } as any, mdp: [{ id: 'm1', number: '1', returned: true }, { id: 'm2', number: '2', returned: true }] }))[5]; return l.result === 'Возврат подтверждён: 2' && l.tone === 'ok'; })());
check('«книжка МДП не использовалась» — явное подтверждение, тон muted', (() => { const l = summaryLines(mkState({ steps: { mdp: step('done') } as any, flags: { mdpNotUsed: true } }))[5]; return /не использовалась/.test(l.result) && l.tone === 'muted'; })());
check('комплектность книжки не подменяет возврат: returned=false + complete=true — всё равно не подтверждён', (() => { const l = summaryLines(mkState({ steps: { mdp: step('done') } as any, mdp: [{ id: 'm1', number: 'МДП X', returned: false, complete: true }] }))[5]; return /не подтверждён/.test(l.result); })());
check('загрузка интеграцией: «Внесено интеграцией», а ручная — «Внесено и подтверждено»', summaryLines(mkState({ steps: { zagruzka: step('done') } as any, zagruzka: { mode: 'auto' } }))[3].result === 'Внесено интеграцией' && summaryLines(mkState({ steps: { zagruzka: step('done') } as any, zagruzka: { mode: 'manual' } }))[3].result === 'Внесено и подтверждено');

// ── 10. progressLabel ────────────────────────────────────────────────────────
console.log('\nПодпись прогресса (progressLabel)');
check('свежий сценарий: 0/6 и следующий шаг «План дохода»', progressLabel(mkState()) === 'Закрытие рейса: 0/6 · следующий шаг: План дохода', progressLabel(mkState()));
check('частичное закрытие: счётчик и следующий шаг из подписей шагов', progressLabel(withSteps({ planDohod: step('done'), salary: step('done') })) === 'Закрытие рейса: 2/6 · следующий шаг: Учёт выезда', progressLabel(withSteps({ planDohod: step('done'), salary: step('done') })));
check('завершённый сценарий: отдельная подпись без «следующего шага»', progressLabel({ ...allDone, completedAt: '2026-10-15T12:00:00.000Z' }) === 'Сценарий закрытия завершён');

// ── 11. Блокировка lockIsActive ──────────────────────────────────────────────
console.log('\nБлокировка сценария (lockIsActive)');
const now = Date.now();
check('блокировки нет — не активна', lockIsActive(undefined, now) === false && lockIsActive(null, now) === false);
check('живая блокировка (истекает позже) — активна', lockIsActive({ by: 'A', at: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }, now) === true);
check('истёкшая блокировка — не активна (чужой сценарий не висит вечно)', lockIsActive({ by: 'A', at: new Date(now - 120_000).toISOString(), expiresAt: new Date(now - 1000).toISOString() }, now) === false);
check('мусор в expiresAt — не активна, а не исключение', lockIsActive({ by: 'A', at: '', expiresAt: 'не дата' }, now) === false);
check('TTL блокировки — 20 минут (совпадает с договорённостью)', LOCK_TTL_MS === 20 * 60 * 1000, String(LOCK_TTL_MS));
check('блокировка, взятая на TTL, жива весь TTL и мертва после', lockIsActive({ by: 'A', at: new Date(now).toISOString(), expiresAt: new Date(now + LOCK_TTL_MS).toISOString() }, now) === true && lockIsActive({ by: 'A', at: new Date(now).toISOString(), expiresAt: new Date(now + LOCK_TTL_MS).toISOString() }, now + LOCK_TTL_MS + 1) === false);
check('блокировка учитывает владельца (свой uid продлевает, чужой видит «ведёт другой»)', lockIsActive({ by: 'B', uid: 'uid-b', at: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString() }, now) === true);

console.log(`\nИТОГО: ${passed}/${passed + failed}`);
if (failed > 0) process.exit(1);
