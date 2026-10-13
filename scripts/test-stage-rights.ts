/**
 * Тесты прав на этапы рейса (lib/stageRights + блокируемые изменения плана
 * lib/planLock.computeBlockedPlanChanges).
 *
 * Жалоба владельца №1: кнопка «Добавить этап» должна быть видна и работать
 * ВСЕГДА (в том числе после сохранения записи и для завершённых рейсов).
 * Решение владельца №2: «открой доступ для дат планирования всем» — плановые
 * даты (правка уже внесённых значений, запас/порядок, количество кругов)
 * открыты всем исполнителям с правом записи; флаг PLAN_DATES_OPEN_TO_ALL.
 * Прежний контроль («план сохранён → плановые даты правит только администратор
 * или по разовому разрешению») сохранён под флагом и тоже проверяется — через
 * переопределение (planDatesOpen / opts.open).
 *
 * Матрица: роли × статусы рейса (черновик плана/сохранён/разовое разрешение,
 * архив) × пустое/внесённое значение даты.
 *
 * Запуск: npx tsx scripts/test-stage-rights.ts  (или npm run test:stage-rights)
 */
import type { TimelineStage, UserProfile } from '../src/types';
import { resolvePermission } from '../src/utils/permissions';
import {
  canEditPlannedDateField,
  isAdminRole,
  resolveStageMove,
  resolveStageRights,
  type StageRights,
} from '../src/components/modules/tripTimeline/lib/stageRights';
import { computeBlockedPlanChanges, PLAN_DATES_OPEN_TO_ALL, planDatesEditable } from '../src/components/modules/tripTimeline/lib/planLock';

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

/** Права роли в модуле по умолчанию (как в приложении: resolvePermission). */
const canWriteOf = (role: string): boolean =>
  resolvePermission({ role } as UserProfile, 'tripTimeline') === 'write';

const rightsOf = (
  role: string,
  trip: { kind?: 'manual' | 'plan'; archived?: boolean; planState?: 'draft' | 'saved' | 'permitted' },
  /** Переопределение режима плановых дат (для проверки обоих режимов). */
  opts: { planDatesOpen?: boolean } = {},
): StageRights => resolveStageRights({ role }, trip, { canWrite: canWriteOf(role), ...opts });

let orderNo = 0;
const st = (id: string, planned = '', extra: Partial<TimelineStage> = {}): TimelineStage => {
  orderNo += 1;
  return {
    id,
    type: 'load',
    label: '',
    plannedDate: planned,
    actualDate: '',
    isCritical: false,
    order: orderNo,
    seq: orderNo,
    ...extra,
  };
};

console.log(`Режим продукта: плановые даты ${PLAN_DATES_OPEN_TO_ALL ? 'ОТКРЫТЫ всем исполнителям' : 'под контролем администратора'}`);

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Матрица прав: роли × статусы рейса');
{
  const roles = ['root_admin', 'admin', 'manager', 'dispatcher', 'accountant', 'viewer'];
  const statuses: Array<{ kind?: 'manual' | 'plan'; archived?: boolean; planState?: 'draft' | 'saved' | 'permitted' }> = [
    { kind: 'manual', planState: 'draft' },
    { kind: 'plan', planState: 'draft' },
    { kind: 'plan', planState: 'saved' },
    { kind: 'plan', planState: 'permitted' },
    { kind: 'plan', planState: 'saved', archived: true },
    { kind: 'manual', archived: true },
  ];
  const expectWrite: Record<string, boolean> = {
    root_admin: true, admin: true, manager: true, dispatcher: true, accountant: false, viewer: false,
  };
  const expectAdmin: Record<string, boolean> = {
    root_admin: true, admin: true, manager: false, dispatcher: false, accountant: false, viewer: false,
  };
  let matrixOk = true;
  for (const role of roles) {
    for (const trip of statuses) {
      const r = rightsOf(role, trip);
      const w = expectWrite[role];
      const a = expectAdmin[role];
      const ok =
        r.canAddStage === w &&
        r.canFillEmptyDates === w &&
        r.canEditExistingDates === w &&
        r.isAdmin === a;
      if (!ok) {
        matrixOk = false;
        console.error(`    роль ${role}, статус ${JSON.stringify(trip)} → ${JSON.stringify(r)}`);
      }
    }
  }
  check('canAddStage/canFillEmptyDates/canEditExistingDates = право записи при ЛЮБОМ статусе (включая архив/сохранён)', matrixOk);
  check('canAddStage у исполнителя (dispatcher, plan+saved) — true', rightsOf('dispatcher', statuses[2]).canAddStage === true);
  check('canAddStage у архивированного рейса — true (завершённые тоже)', rightsOf('dispatcher', statuses[4]).canAddStage === true);
  check('canAddStage в режиме чтения (accountant) — false', rightsOf('accountant', statuses[0]).canAddStage === false);
  check('isAdmin: root_admin/admin — да; dispatcher/manager — нет', isAdminRole('root_admin') && isAdminRole('admin') && !isAdminRole('dispatcher') && !isAdminRole('manager'));

  // Прежний режим контроля (если флаг продукта выключат): внесённые даты — только admin.
  let controlledOk = true;
  for (const role of roles) {
    for (const trip of statuses) {
      const r = rightsOf(role, trip, { planDatesOpen: false });
      const ok = r.canEditExistingDates === (expectWrite[role] && expectAdmin[role]) && r.planDatesOpen === false;
      if (!ok) {
        controlledOk = false;
        console.error(`    [контроль] роль ${role}, статус ${JSON.stringify(trip)} → canEditExistingDates=${r.canEditExistingDates}`);
      }
    }
  }
  check('прежний режим (planDatesOpen=false): правка внесённых дат — только admin + запись', controlledOk);
  check('режим продукта: у исполнителя planDatesOpen=true', rightsOf('dispatcher', {}).planDatesOpen === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Поле плановой даты: плановые даты открыты всем исполнителям');
{
  const disp = rightsOf('dispatcher', { kind: 'plan', planState: 'saved' });
  const root = rightsOf('root_admin', { kind: 'plan', planState: 'saved' });
  const adm = rightsOf('admin', { kind: 'plan', planState: 'saved' });
  const viewer = rightsOf('viewer', { kind: 'plan', planState: 'saved' });
  const admControlled = rightsOf('admin', { kind: 'plan', planState: 'saved' }, { planDatesOpen: false });
  const dispControlled = rightsOf('dispatcher', { kind: 'plan', planState: 'saved' }, { planDatesOpen: false });

  // Связка как в приложении: нижний замок = planDatesEditable (карточка рейса).
  const savedLock = { state: 'saved' as const };
  const openNow = planDatesEditable(savedLock, { readOnly: false, isRootAdmin: false });
  check('карточка: при открытых плановых датах замок снят (planDatesEditable = true)', openNow === true);

  check('исполнитель: пустое поле после сохранения — РЕДАКТИРУЕМО', canEditPlannedDateField(disp, '', false) === true);
  check('исполнитель: ВНЕСЁННОЕ поле после сохранения — РЕДАКТИРУЕМО (решение владельца)', canEditPlannedDateField(disp, '2026-10-01', openNow) === true);
  check('исполнитель: то же и без разового разрешения (замок открыт всем)', canEditPlannedDateField(disp, '2026-10-01', true) === true);
  check('root-админ: внесённое — да', canEditPlannedDateField(root, '2026-10-01', true) === true);
  check('admin: внесённое — да', canEditPlannedDateField(adm, '2026-10-01', openNow) === true);
  check('admin: пустое — да при любом замке', canEditPlannedDateField(adm, '', false) === true);
  check('пустое значение null/undefined тоже «пустое»', canEditPlannedDateField(disp, null, false) === true);
  check('без права записи (viewer) — нельзя', canEditPlannedDateField(viewer, '2026-10-01', openNow) === false);
  check('нижний замок при прежнем режиме всё ещё запирает внесённое у исполнителя', canEditPlannedDateField(disp, '2026-10-01', false) === false);

  check('[прежний режим] исполнитель: внесённое — нет', canEditPlannedDateField(dispControlled, '2026-10-01', true) === false);
  check('[прежний режим] admin без разового разрешения (замок): внесённое — нет', canEditPlannedDateField(admControlled, '2026-10-01', false) === false);
  check('[прежний режим] admin с разовым разрешением: внесённое — да', canEditPlannedDateField(admControlled, '2026-10-01', true) === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Блокируемые изменения плана (гейт сохранения)');
{
  // Фиксированные этапы: A — с внесённой датой, B — с пустой; правки — клонами
  // (order/seq сохраняются, чтобы «изменение» считалось только по существу).
  const A = st('a', '2026-10-01');
  const B = st('b', '');
  const stored = [A, B];
  const withDate = (base: TimelineStage, date: string): TimelineStage => ({ ...base, plannedDate: date });
  const closed = { open: false };

  // Режим продукта: блокируемых изменений нет — сохранение без разового разрешения.
  check('открытый режим: изменена ВНЕСЁННАЯ дата — НЕ блокируется', computeBlockedPlanChanges(stored, [withDate(A, '2026-10-02'), B]).count === 0);
  check('открытый режим: удаление этапа — НЕ блокируется', computeBlockedPlanChanges(stored, [A]).count === 0);
  check('открытый режим: смена количества кругов — НЕ блокируется', computeBlockedPlanChanges(stored, stored, { stored: 1, draft: 2 }).count === 0);
  check('открытый режим: запас существующего этапа — НЕ блокируется', computeBlockedPlanChanges(stored, [{ ...A, bufferDays: 3 }, B]).count === 0);
  check('открытый режим: добавлен этап — 0', computeBlockedPlanChanges(stored, [...stored, st('c')]).count === 0);
  check('открытый режим: без изменений — 0', computeBlockedPlanChanges(stored, stored).count === 0);
  check('пустые входы не падают', computeBlockedPlanChanges(undefined, undefined).count === 0);

  // Прежний режим контроля (флаг выключен): блокирует правку внесённого.
  check('[прежний режим] добавлен этап в конец — НЕ блокируется', computeBlockedPlanChanges(stored, [...stored, st('c')], undefined, closed).count === 0);
  check('[прежний режим] заполнена ПУСТАЯ дата этапа b — НЕ блокируется', computeBlockedPlanChanges(stored, [A, withDate(B, '2026-10-05')], undefined, closed).count === 0);
  check('[прежний режим] изменена ВНЕСЁННАЯ дата этапа a — блокируется', computeBlockedPlanChanges(stored, [withDate(A, '2026-10-02'), B], undefined, closed).count === 1);
  check('[прежний режим] добавлен этап и заполнена дата нового — НЕ блокируется', computeBlockedPlanChanges(stored, [...stored, withDate(st('c'), '2026-10-09')], undefined, closed).count === 0);
  check('[прежний режим] удаление этапа — блокируется', computeBlockedPlanChanges(stored, [A], undefined, closed).count === 1);
  check('[прежний режим] смена количества кругов — блокируется', computeBlockedPlanChanges(stored, stored, { stored: 1, draft: 2 }, closed).count === 1);
  check('[прежний режим] запас существующего этапа — блокируется', computeBlockedPlanChanges(stored, [{ ...A, bufferDays: 3 }, B], undefined, closed).count === 1);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Перестановка строк этапов (resolveStageMove): права пары «этап ↔ сосед»');
{
  const day = (id: string, d: string, seq: number): TimelineStage => ({ ...st(id, d), id, seq, order: seq });
  const blank = (id: string, seq: number): TimelineStage => ({ ...st(id, ''), id, seq, order: seq });
  const disp = rightsOf('dispatcher', { kind: 'plan', planState: 'draft' });
  const adm = rightsOf('admin', { kind: 'plan', planState: 'draft' });
  const viewer = rightsOf('viewer', {});

  const same1 = resolveStageMove(disp, day('a', '2026-10-26', 1), day('b', '2026-10-26', 2));
  check('исполнитель: один день — разрешено (только seq, даты не меняются)', same1.allowed === true && same1.kind === 'same-day', same1);
  const same2 = resolveStageMove(disp, blank('a', 1), blank('b', 2));
  check('исполнитель: строки с ПУСТЫМИ датами — разрешено', same2.allowed === true && same2.kind === 'empty-tail', same2);
  const cross1 = resolveStageMove(disp, day('a', '2026-10-26', 2), day('b', '2026-10-25', 1));
  check('исполнитель: разные дни — РАЗРЕШЕНО (плановые даты открыты всем)', cross1.allowed === true && cross1.kind === 'cross-day' && cross1.adminOnly === false, cross1);
  const crossControlled = resolveStageMove(
    rightsOf('dispatcher', { kind: 'plan', planState: 'draft' }, { planDatesOpen: false }),
    day('a', '2026-10-26', 2),
    day('b', '2026-10-25', 1),
  );
  check('[прежний режим] исполнитель: разные дни — ЗАПРЕЩЕНО', crossControlled.allowed === false && crossControlled.adminOnly === true, crossControlled);
  check('[прежний режим] подсказка блокировки называет администратора', crossControlled.reason.includes('администратор'), crossControlled.reason);

  const cross2 = resolveStageMove(adm, day('a', '2026-10-26', 2), day('b', '2026-10-25', 1));
  check('администратор: разные дни — разрешено (этапы меняются датами)', cross2.allowed === true && cross2.kind === 'cross-day', cross2);
  const mixed = resolveStageMove(adm, day('a', '2026-10-26', 1), blank('b', 2));
  check('пара «с датой ↔ без даты» — запрещена и администратору', mixed.allowed === false && mixed.kind === null, mixed);
  check('подсказка объясняет: сначала внесите дату', mixed.reason.includes('внесите дату'), mixed.reason);

  const ro = resolveStageMove(viewer, blank('a', 1), blank('b', 2));
  check('без права записи — запрещено даже внутри пустых', ro.allowed === false && ro.reason.includes('права записи'), ro);
  check('нет соседа — запрещено', resolveStageMove(adm, day('a', '2026-10-26', 1), undefined).allowed === false);

  // Матрица ролей: право перестановки = право записи (и внутри дня, и между днями —
  // плановые даты открыты всем); в прежнем режиме между днями — только admin.
  const roles: Array<[string, boolean, boolean, boolean]> = [
    ['root_admin', true, true, true],
    ['admin', true, true, true],
    ['manager', true, true, false],
    ['dispatcher', true, true, false],
    ['accountant', false, false, false],
    ['viewer', false, false, false],
  ];
  let matrixOk = true;
  for (const [role, within, across, acrossControlled] of roles) {
    const r = rightsOf(role, {});
    const rc = rightsOf(role, {}, { planDatesOpen: false });
    if (r.canReorderStages !== within || r.canReorderAcrossDays !== across || rc.canReorderAcrossDays !== acrossControlled) {
      matrixOk = false;
      console.error(`    роль ${role} → canReorderStages=${r.canReorderStages}, canReorderAcrossDays=${r.canReorderAcrossDays} (контроль: ${rc.canReorderAcrossDays})`);
    }
  }
  check('матрица ролей: canReorderStages = запись; canReorderAcrossDays = запись (в прежнем режиме — admin + запись)', matrixOk);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
