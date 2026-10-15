/**
 * Тесты чистой логики ЕДИНОЙ истории изменений рейса (lib/tripHistory):
 * расчёт строк «было → стало» (план и факт), ключ операции (защита от дублей
 * при синхронизации), сортировка (свежие сверху), показ старой истории плана
 * без потери, порционность «Показать ещё».
 *
 * Запуск: npx tsx scripts/test-trip-history.ts  (или npm run test:trip-history)
 */
import type { TimelinePlanHistoryEntry, TimelineStage } from '../src/types';
import {
  LEGACY_PLAN_HISTORY_LABELS,
  TRIP_HISTORY_DEDUPE_WINDOW_MS,
  buildTripHistoryDraft,
  buildTripHistoryLines,
  factBoundsOf,
  fmtHistoryDateTime,
  fmtHistoryDay,
  historyPageSlice,
  legacyPlanHistoryViews,
  mergeTripHistoryViews,
  planRecordHistoryLines,
  tripHistoryContentKey,
  tripHistoryEntryViews,
  tripHistoryLiveFromStore,
  tripHistoryOpKey,
  tripHistoryPath,
  type TripHistoryEntry,
  type TripHistorySnapshot,
} from '../src/components/modules/tripTimeline/lib/tripHistory';

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

/** Этап с детерминированным seq (номер из id) — снимки сравнимы между вызовами. */
const stage = (id: string, planned = '', extra: Partial<TimelineStage> = {}): TimelineStage => {
  const n = Number(String(id).replace(/\D/g, '')) || 1;
  return {
    id,
    type: 'load',
    label: '',
    plannedDate: planned,
    actualDate: '',
    isCritical: false,
    order: n,
    seq: n,
    ...extra,
  };
};

const snap = (extra: Partial<TripHistorySnapshot> = {}): TripHistorySnapshot => ({
  planStart: '2026-11-20',
  planEnd: '2026-11-26',
  circles: 1,
  direction: 'Турция',
  stages: [stage('s1', '2026-11-20'), stage('s2', '2026-11-26')],
  ...extra,
});

const nameOf = (s: TimelineStage): string => s.label || s.type || s.id;

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Строки изменений: план, факт, состав этапов');
{
  const before = snap();
  const after = snap({ planEnd: '2026-11-28' });
  const lines = buildTripHistoryLines(before, after);
  check('изменение планового возвращения — одна строка «План»', lines.length === 1 && lines[0].field === 'Возвращение' && lines[0].scope === 'plan', lines);
  check('«было → стало» в формате дд.мм.гггг', lines[0].from === '26.11.2026' && lines[0].to === '28.11.2026', lines[0]);

  const lines2 = buildTripHistoryLines(snap(), snap({ planStart: '2026-11-22', circles: 2, direction: 'Китай' }));
  check('старт + круги + направление — три строки', lines2.length === 3, lines2);
  check('направление размечено планом', lines2.some((l) => l.field === 'Направление' && l.scope === 'plan' && l.from === 'Турция' && l.to === 'Китай'), lines2);
  check('круги печатаются числами', lines2.some((l) => l.field === 'Количество кругов' && l.from === '1' && l.to === '2'), lines2);

  const beforeFact = snap({ stages: [stage('s1', '2026-11-20', { actualDate: '2026-11-21' }), stage('s2', '2026-11-26', { actualDate: '2026-11-27' })] });
  const afterFact = snap({ stages: [stage('s1', '2026-11-20', { actualDate: '2026-11-22' }), stage('s2', '2026-11-26', { actualDate: '2026-11-27' })] });
  const factLines = buildTripHistoryLines(beforeFact, afterFact, { nameOf });
  check('фактическая дата этапа — строка «Факт»', factLines.some((l) => l.scope === 'fact' && l.from === '21.11.2026' && l.to === '22.11.2026'), factLines);
  check('границы факта пересчитаны (старт факт)', factLines.some((l) => l.scope === 'fact' && l.field === 'Старт'), factLines);
  check('factBoundsOf берёт крайние фактические даты', factBoundsOf(beforeFact.stages).start === '2026-11-21' && factBoundsOf(beforeFact.stages).end === '2026-11-27');

  const added = buildTripHistoryLines(snap(), snap({ stages: [stage('s1', '2026-11-20'), stage('s2', '2026-11-26'), stage('s3', '2026-11-27', { label: 'Граница' })] }), { nameOf });
  check('добавление этапа — отдельная строка «Добавлен этап «Граница»»', added.some((l) => l.field === 'Добавлен этап «Граница»'), added);
  const removed = buildTripHistoryLines(snap(), snap({ stages: [stage('s1', '2026-11-20')] }), { nameOf });
  check('удаление этапа — строка «Удалён этап …»', removed.some((l) => l.field.startsWith('Удалён этап')), removed);

  const retyped = buildTripHistoryLines(
    snap(),
    snap({ stages: [stage('s1', '2026-11-20', { type: 'border', label: 'Брест', isCritical: true }), stage('s2', '2026-11-26')] }),
    { nameOf },
  );
  check('тип этапа, место и критический срок попадают в строки', retyped.some((l) => l.field.includes('тип этапа')) && retyped.some((l) => l.field.includes('место')) && retyped.some((l) => l.field.includes('критический срок')), retyped);
  check('тип/место/крит. срок помечены «План и факт»', retyped.filter((l) => l.field.includes('тип этапа') || l.field.includes('место') || l.field.includes('критический срок')).every((l) => l.scope === 'both'), retyped);

  const buf = buildTripHistoryLines(snap(), snap({ stages: [stage('s1', '2026-11-20', { bufferDays: 3 }), stage('s2', '2026-11-26')] }), { nameOf });
  check('запас этапа — строка «запас дней» (план)', buf.some((l) => l.field.includes('запас дней') && l.scope === 'plan' && l.from === '0' && l.to === '3'), buf);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Сохранение без изменений и неизменные черновики');
{
  check('без изменений — строк нет', buildTripHistoryLines(snap(), snap()).length === 0);
  check('клоны этапов без изменений — строк нет', buildTripHistoryLines(snap(), snap({ stages: snap().stages.map((s) => ({ ...s })) })).length === 0);
  check('пустые снимки не падают', buildTripHistoryLines(
    { planStart: '', planEnd: '', circles: 1, direction: '', stages: [] },
    { planStart: '', planEnd: '', circles: 1, direction: '', stages: [] },
  ).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Черновик записи истории: автор, источник, ключ операции');
{
  const atMs = 1_800_000_000_000;
  const draft = buildTripHistoryDraft({
    tripKey: 'pd:abc',
    before: snap(),
    after: snap({ planEnd: '2026-11-28' }),
    by: 'Сергей Терез',
    byUid: 'probe-user',
    source: 'timeline',
    atMs,
    summary: 'Рейс сохранён',
  });
  check('черновик создаётся при изменениях', !!draft);
  check('автор и uid записаны', draft!.entry.by === 'Сергей Терез' && draft!.entry.byUid === 'probe-user');
  check('источник = timeline', draft!.entry.source === 'timeline');
  check('opKey лежит и в записи, и в ключе пути', draft!.entry.opKey === draft!.opKey && draft!.path.endsWith(`/${draft!.opKey}`), draft!.path);
  check('путь — ветка tripHistory указанного рейса', draft!.path === `tripTimeline/tripHistory/pd:abc/${draft!.opKey}`, draft!.path);
  check('в записи нет времени (его ставит база — serverTimestamp)', !('at' in draft!.entry));

  check('без изменений черновика нет', buildTripHistoryDraft({
    tripKey: 'pd:abc', before: snap(), after: snap(), by: 'X', source: 'timeline', atMs,
  }) === null);
  check('правка человека без автора не записывается', buildTripHistoryDraft({
    tripKey: 'pd:abc', before: snap(), after: snap({ planEnd: '2026-11-28' }), by: '', source: 'timeline', atMs,
  }) === null);
  const sys = buildTripHistoryDraft({
    tripKey: 'pd:abc', before: snap(), after: snap({ planEnd: '2026-11-28' }), source: 'system', atMs,
  });
  check('системное изменение записывается без подстановки случайного пользователя', !!sys && sys.entry.by === 'Система' && sys.entry.source === 'system');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Ключ операции: та же правка из другой вкладки — одна запись');
{
  const atMs = 1_800_000_000_000;
  const lines = buildTripHistoryLines(snap(), snap({ planEnd: '2026-11-28' }));
  const k1 = tripHistoryOpKey('pd:abc', lines, atMs);
  const k2 = tripHistoryOpKey('pd:abc', lines, atMs + 5_000); // другая вкладка, через 5 секунд
  const k3 = tripHistoryOpKey('pd:abc', lines, atMs + TRIP_HISTORY_DEDUPE_WINDOW_MS * 3); // позже — отдельная операция
  const kOther = tripHistoryOpKey('pd:xyz', lines, atMs);
  const kAnother = tripHistoryOpKey('pd:abc', buildTripHistoryLines(snap(), snap({ planEnd: '2026-11-29' })), atMs);
  check('одинаковые изменения в окне склейки — ОДИН ключ (дубля не будет)', k1 === k2, [k1, k2]);
  check('то же изменение намного позже — новый ключ (правка не теряется)', k1 !== k3);
  check('разные рейсы — разные ключи', k1 !== kOther);
  check('разные изменения — разные ключи', k1 !== kAnother);
  check('ключ не зависит от автора', tripHistoryContentKey('pd:abc', lines) === tripHistoryContentKey('pd:abc', lines));
  check('путь строится из ключа', tripHistoryPath('pd:abc', k1).endsWith(`/${k1}`));
  check('опасные символы ключа рейса санированы', tripHistoryPath('tl:a.b#c', 'k').includes('tl:a_b_c'), tripHistoryPath('tl:a.b#c', 'k'));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. Показ: свежие сверху, старая история плана — без потери');
{
  const entry = (opKey: string, at: number, by: string, lines: TripHistoryEntry['lines']): TripHistoryEntry => ({
    at,
    by,
    source: 'timeline',
    opKey,
    lines,
  });
  const e1 = entry('k1', 1_800_000_000_000, 'Сергей Терез', [{ scope: 'plan', field: 'Возвращение', from: '26.11.2026', to: '28.11.2026' }]);
  const e2 = entry('k2', 1_800_000_100_000, 'Пётр', [{ scope: 'fact', field: 'Загрузка: факт', from: '21.11.2026', to: '22.11.2026' }]);
  const legacy: TimelinePlanHistoryEntry[] = [
    { at: '2026-10-01T09:00:00.000Z', by: 'Старый админ', action: 'initial', note: 'Первичное сохранение плана этапов' },
    { at: '', by: '', action: 'grant', note: '' },
  ];
  const views = mergeTripHistoryViews([{ key: 'k1', entry: e1 }, { key: 'k2', entry: e2 }], legacy);
  check('живые строки + старая история в одном списке', views.length === 4, views.length);
  check('порядок: свежие сверху (журнал в конце)', views[0].byLabel === 'Пётр' && views[1].byLabel === 'Сергей Терез', views.map((v) => v.byLabel));
  check('метка источника: живая запись «Таймлайн»', views[0].sourceLabel === 'Таймлайн');
  check('старая запись: время «Не зафиксировано» и автор «Неизвестно» — ничего не выдумано', views[views.length - 1].atLabel === 'Не зафиксировано' && views[views.length - 1].byLabel === 'Неизвестно', views[views.length - 1]);
  check('старые метки читаются словарём PLAN_HISTORY_LABELS', legacyPlanHistoryViews(legacy)[0].field === LEGACY_PLAN_HISTORY_LABELS.initial);
  check('старые записи помечены legacy (правка недоступна)', legacyPlanHistoryViews(legacy).every((v) => v.legacy === true));
  check('одна запись с несколькими изменениями — несколько строк', views.filter((v) => v.byLabel === 'Сергей Терез').length === 1);
  const twoLine = tripHistoryEntryViews({
    at: 1, by: 'X', source: 'plan', opKey: 'k',
    lines: [
      { scope: 'plan', field: 'Возвращение', from: 'a', to: 'b' },
      { scope: 'fact', field: 'Загрузка: факт', from: 'c', to: 'd' },
    ],
  });
  check('несколько изменений одной записи — отдельные строки с метками', twoLine.length === 2 && twoLine[0].scopeLabel === 'План' && twoLine[1].scopeLabel === 'Факт', twoLine);

  const store = tripHistoryLiveFromStore({
    k1: { at: 1_800_000_000_000, by: 'A', source: 'plan', opKey: 'k1', lines: [{ scope: 'plan', field: 'Старт', from: '01.01.2027', to: '02.01.2027' }] },
    k2: { at: '2026-12-01T10:00:00.000Z', by: 'B', source: 'system', opKey: 'k2', lines: [] },
    bad: null,
  });
  check('разбор ветки базы: пустые узлы пропускаются', store.length === 2, store.length);
  check('ISO-время из базы читается', tripHistoryEntryViews(store.find((s) => s.key === 'k2')!.entry)[0].atLabel.startsWith('01.12.2026'));

  check('сортировка при равном времени стабильна по ключу', (() => {
    const a = mergeTripHistoryViews([{ key: 'b', entry: entry('b', 1_000, 'B', [{ scope: 'plan', field: 'f', from: '', to: '' }]) }, { key: 'a', entry: entry('a', 1_000, 'A', [{ scope: 'plan', field: 'f', from: '', to: '' }]) }], []);
    return a[0].key < a[1].key || a[0].key === a[1].key;
  })());
  check('легаси-запись при равном времени уходит вниз', (() => {
    const live = [{ key: 'k', entry: entry('k', 1_000, 'A', [{ scope: 'plan', field: 'f', from: '', to: '' }]) }];
    const leg: TimelinePlanHistoryEntry[] = [{ at: new Date(1_000).toISOString(), by: 'L', action: 'update' }];
    const merged = mergeTripHistoryViews(live, leg);
    return merged[0].legacy === false && merged[1].legacy === true;
  })());
}

// ────────────────────────────────────────────────────────────────────────────
console.log('6. Форматирование и порционный показ');
{
  check('дата ISO → дд.мм.гггг', fmtHistoryDay('2026-11-28') === '28.11.2026');
  check('пустая дата → «не указана»', fmtHistoryDay('') === 'не указана');
  check('незнакомый текст не переписывается', fmtHistoryDay('без даты') === 'без даты');
  check('время записи → «дд.мм.гггг, чч:мм»', /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/.test(fmtHistoryDateTime(1_800_000_000_000)), fmtHistoryDateTime(1_800_000_000_000));
  check('нет времени → «Не зафиксировано»', fmtHistoryDateTime(null) === 'Не зафиксировано');
  const items = Array.from({ length: 10 }, (_, i) => i);
  check('порция 6 из 10: видно 6, скрыто 4', historyPageSlice(items, 6, 6).visible.length === 6 && historyPageSlice(items, 6, 6).hidden === 4);
  check('после «Показать ещё» видно 10, скрыто 0', historyPageSlice(items, 12, 6).visible.length === 10 && historyPageSlice(items, 12, 6).hidden === 0);
  check('порядок не меняется при показе', historyPageSlice(items, 6, 6).visible.join(',') === '0,1,2,3,4,5');
  check('пустой список не падает', historyPageSlice([], 6, 6).visible.length === 0 && historyPageSlice([], 6, 6).hidden === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('7. Путь «Плана дохода»: те же поля плана, одна запись на изменение');
{
  const before = { dateStart: '2026-11-20', dateEnd: '2026-11-26', circles: 1, direction: 'Турция', totalKm: 3000 };
  const after = { ...before, dateEnd: '2026-11-28' };
  const lines = planRecordHistoryLines(before, after);
  check('изменение даты возвращения — одна строка плана', lines.length === 1 && lines[0].field === 'Возвращение' && lines[0].from === '26.11.2026' && lines[0].to === '28.11.2026', lines);
  check('финансовые поля историю не пишут', planRecordHistoryLines({ totalKm: 1 }, { totalKm: 2 }).length === 0);
  check('без изменений — пусто', planRecordHistoryLines(before, { ...before }).length === 0);
  check('круги и направление ловятся', planRecordHistoryLines(before, { ...before, circles: 2, direction: 'Китай' }).length === 2);

  const tlLines = buildTripHistoryLines(snap(), snap({ planEnd: '2026-11-28' }));
  const planLines = planRecordHistoryLines(before, after);
  const sameKey = tripHistoryOpKey('pd:abc', tlLines, 1_800_000_000_000) === tripHistoryOpKey('pd:abc', planLines, 1_800_000_000_000 + 3_000);
  check('одно изменение из двух путей даёт ОДИН ключ (дубля не будет)', sameKey, [tlLines, planLines]);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
