/**
 * Тесты прав на этапы рейса (lib/stageRights) и расчёта изменений плана
 * (lib/planChanges.computePlanStageChanges).
 *
 * Жалоба владельца №1: кнопка «Добавить этап» должна быть видна и работать
 * ВСЕГДА (в том числе после сохранения записи и для завершённых рейсов).
 * Решение владельца №2: «открой доступ для дат планирования всем» — плановые
 * даты (правка уже внесённых значений, запас/порядок, количество кругов)
 * открыты всем исполнителям с правом записи. Механизм разовых разрешений
 * администратора (planGuard/planPerms/planRequests) УДАЛЁН: контроля плана в
 * правах больше нет, а изменения фиксирует единая история изменений рейса
 * (lib/tripHistory, тесты — test:trip-history).
 *
 * Матрица: роли × статусы рейса (черновик/сохранён/архив) × пустое/внесённое
 * значение даты.
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
import { computePlanStageChanges, describePlanChanges } from '../src/components/modules/tripTimeline/lib/planChanges';

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
  trip: { kind?: 'manual' | 'plan'; archived?: boolean },
): StageRights => resolveStageRights({ role }, trip, { canWrite: canWriteOf(role) });

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

console.log('Режим продукта: механизм разовых разрешений на изменение плана УДАЛЁН — плановые даты открыты всем исполнителям с правом записи');

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Матрица прав: роли × статусы рейса');
{
  const roles = ['root_admin', 'admin', 'manager', 'dispatcher', 'accountant', 'viewer'];
  const statuses: Array<{ kind?: 'manual' | 'plan'; archived?: boolean }> = [
    { kind: 'manual' },
    { kind: 'plan' },
    { kind: 'plan', archived: true },
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
        r.canReorderStages === w &&
        r.canReorderAcrossDays === w &&
        r.isAdmin === a;
      if (!ok) {
        matrixOk = false;
        console.error(`    роль ${role}, статус ${JSON.stringify(trip)} → ${JSON.stringify(r)}`);
      }
    }
  }
  check('canAddStage/canFillEmptyDates/canEditExistingDates/canReorder* = право записи при ЛЮБОМ статусе (включая архив)', matrixOk);
  check('canAddStage у исполнителя (dispatcher, план) — true', rightsOf('dispatcher', statuses[1]).canAddStage === true);
  check('canAddStage у архивированного рейса — true (завершённые тоже)', rightsOf('dispatcher', statuses[2]).canAddStage === true);
  check('canAddStage в режиме чтения (accountant) — false', rightsOf('accountant', statuses[0]).canAddStage === false);
  check('isAdmin: root_admin/admin — да; dispatcher/manager — нет', isAdminRole('root_admin') && isAdminRole('admin') && !isAdminRole('dispatcher') && !isAdminRole('manager'));
  check('в правах НЕТ остатков контроля плана (planDatesOpen/planState удалены)', !('planDatesOpen' in rightsOf('dispatcher', statuses[1])));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Поле плановой даты: без контроля плана');
{
  const disp = rightsOf('dispatcher', { kind: 'plan' });
  const root = rightsOf('root_admin', { kind: 'plan' });
  const adm = rightsOf('admin', { kind: 'plan' });
  const viewer = rightsOf('viewer', { kind: 'plan' });

  check('исполнитель: пустое поле — РЕДАКТИРУЕМО', canEditPlannedDateField(disp, '') === true);
  check('исполнитель: ВНЕСЁННОЕ поле — РЕДАКТИРУЕМО (решение владельца)', canEditPlannedDateField(disp, '2026-10-01') === true);
  check('root-админ: внесённое — да', canEditPlannedDateField(root, '2026-10-01') === true);
  check('admin: внесённое — да', canEditPlannedDateField(adm, '2026-10-01') === true);
  check('admin: пустое — да', canEditPlannedDateField(adm, '') === true);
  check('пустое значение null/undefined тоже «пустое»', canEditPlannedDateField(disp, null) === true);
  check('без права записи (viewer) — нельзя (внесённое)', canEditPlannedDateField(viewer, '2026-10-01') === false);
  check('без права записи (viewer) — нельзя (пустое)', canEditPlannedDateField(viewer, '') === false);
  check('пробелы считаются пустым полем', canEditPlannedDateField(disp, '   ') === true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Расчёт изменений плана (сравнение сохранённого и черновика)');
{
  const A = st('a', '2026-10-01');
  const B = st('b', '');
  const stored = [A, B];
  const withDate = (base: TimelineStage, date: string): TimelineStage => ({ ...base, plannedDate: date });

  check('изменена ВНЕСЁННАЯ дата — изменение есть', computePlanStageChanges(stored, [withDate(A, '2026-10-02'), B]).plannedUpdates.length === 1);
  check('заполнена пустая дата — изменение плана есть (в истории — строкой)', computePlanStageChanges(stored, [A, withDate(B, '2026-10-05')]).plannedUpdates.length === 1);
  check('удаление этапа — изменение есть', computePlanStageChanges(stored, [A]).removes.length === 1);
  check('добавление этапа — изменение есть', computePlanStageChanges(stored, [...stored, st('c')]).adds.length === 1);
  check('смена количества кругов — изменение есть', computePlanStageChanges(stored, stored, { stored: 1, draft: 2 }).circlesChanged === true);
  check('запас существующего этапа — изменение есть', computePlanStageChanges(stored, [{ ...A, bufferDays: 3 }, B]).plannedUpdates[0]?.bufferDays === 3);
  check('без изменений — пусто', computePlanStageChanges(stored, stored.map((s) => ({ ...s }))).count === 0);
  check('служебная строка-заглушка не считается этапом', computePlanStageChanges(stored, [...stored, { ...st('x-fallback-load'), id: 'x-fallback-load' }]).adds.length === 0);
  check('пустые входы не падают', computePlanStageChanges(undefined, undefined).count === 0);
  check('счётчик складывает все виды изменений', computePlanStageChanges(stored, [withDate(A, '2026-10-02'), { ...B, bufferDays: 1 }, st('c')], { stored: 1, draft: 2 }).count === 4);
  {
    const desc = describePlanChanges(computePlanStageChanges(stored, [withDate(A, '2026-10-02'), B]), {
      nameOf: (s) => s.id,
      dayLabel: (v) => v,
      circlesBefore: 1,
      circlesAfter: 1,
    });
    check('describePlanChanges печатает «было → стало» по плановой дате', desc.includes('a: план 2026-10-01 → 2026-10-02'), desc);
  }
  {
    const desc = describePlanChanges(computePlanStageChanges(stored, stored, { stored: 1, draft: 2 }), {
      nameOf: (s) => s.id,
      dayLabel: (v) => v,
      circlesBefore: 1,
      circlesAfter: 2,
    });
    check('describePlanChanges печатает изменение кругов', desc.includes('количество кругов рейса: 1 → 2'), desc);
  }
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Перестановка строк этапов (resolveStageMove): права пары «этап ↔ сосед»');
{
  const day = (id: string, d: string, seq: number): TimelineStage => ({ ...st(id, d), id, seq, order: seq });
  const blank = (id: string, seq: number): TimelineStage => ({ ...st(id, ''), id, seq, order: seq });
  const disp = rightsOf('dispatcher', { kind: 'plan' });
  const adm = rightsOf('admin', { kind: 'plan' });
  const viewer = rightsOf('viewer', {});

  const same1 = resolveStageMove(disp, day('a', '2026-10-26', 1), day('b', '2026-10-26', 2));
  check('исполнитель: один день — разрешено (только seq, даты не меняются)', same1.allowed === true && same1.kind === 'same-day', same1);
  const same2 = resolveStageMove(disp, blank('a', 1), blank('b', 2));
  check('исполнитель: строки с ПУСТЫМИ датами — разрешено', same2.allowed === true && same2.kind === 'empty-tail', same2);
  const cross1 = resolveStageMove(disp, day('a', '2026-10-26', 2), day('b', '2026-10-25', 1));
  check('исполнитель: разные дни — РАЗРЕШЕНО (плановые даты открыты всем)', cross1.allowed === true && cross1.kind === 'cross-day' && cross1.adminOnly === false, cross1);
  const cross2 = resolveStageMove(adm, day('a', '2026-10-26', 2), day('b', '2026-10-25', 1));
  check('администратор: разные дни — разрешено (этапы меняются датами)', cross2.allowed === true && cross2.kind === 'cross-day', cross2);
  const mixed = resolveStageMove(adm, day('a', '2026-10-26', 1), blank('b', 2));
  check('пара «с датой ↔ без даты» — запрещена и администратору', mixed.allowed === false && mixed.kind === null, mixed);
  check('подсказка объясняет: сначала внесите дату', mixed.reason.includes('внесите дату'), mixed.reason);

  const ro = resolveStageMove(viewer, blank('a', 1), blank('b', 2));
  check('без права записи — запрещено даже внутри пустых', ro.allowed === false && ro.reason.includes('права записи'), ro);
  const roCross = resolveStageMove(viewer, day('a', '2026-10-26', 2), day('b', '2026-10-25', 1));
  check('без права записи — разные дни запрещены', roCross.allowed === false && roCross.adminOnly === false, roCross);
  check('нет соседа — запрещено', resolveStageMove(adm, day('a', '2026-10-26', 1), undefined).allowed === false);

  // Матрица ролей: право перестановки = право записи (и внутри дня, и между днями).
  const roles: Array<[string, boolean, boolean]> = [
    ['root_admin', true, true],
    ['admin', true, true],
    ['manager', true, true],
    ['dispatcher', true, true],
    ['accountant', false, false],
    ['viewer', false, false],
  ];
  let matrixOk = true;
  for (const [role, within, across] of roles) {
    const r = rightsOf(role, {});
    if (r.canReorderStages !== within || r.canReorderAcrossDays !== across) {
      matrixOk = false;
      console.error(`    роль ${role} → canReorderStages=${r.canReorderStages}, canReorderAcrossDays=${r.canReorderAcrossDays}`);
    }
  }
  check('матрица ролей: canReorderStages = canReorderAcrossDays = право записи', matrixOk);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
