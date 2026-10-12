/**
 * Тесты прав на этапы рейса (lib/stageRights + блокируемые изменения плана
 * lib/planLock.computeBlockedPlanChanges) — жалоба владельца: кнопка
 * «Добавить этап» должна быть видна и работать ВСЕГДА (в том числе после
 * сохранения записи и для завершённых рейсов), при этом ограничение на
 * изменение УЖЕ ВНЕСЁННЫХ дат не ослабляется.
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
  resolveStageRights,
  type StageRights,
} from '../src/components/modules/tripTimeline/lib/stageRights';
import { computeBlockedPlanChanges } from '../src/components/modules/tripTimeline/lib/planLock';

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

const rightsOf = (role: string, trip: { kind?: 'manual' | 'plan'; archived?: boolean; planState?: 'draft' | 'saved' | 'permitted' }): StageRights =>
  resolveStageRights({ role }, trip, { canWrite: canWriteOf(role) });

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
        r.canEditExistingDates === (w && a) &&
        r.isAdmin === a;
      if (!ok) {
        matrixOk = false;
        console.error(`    роль ${role}, статус ${JSON.stringify(trip)} → ${JSON.stringify(r)}`);
      }
    }
  }
  check('canAddStage = право записи при ЛЮБОМ статусе (включая архив/сохранён)', matrixOk);
  check('canAddStage у исполнителя (dispatcher, plan+saved) — true', rightsOf('dispatcher', statuses[2]).canAddStage === true);
  check('canAddStage у архивированного рейса — true (завершённые тоже)', rightsOf('dispatcher', statuses[4]).canAddStage === true);
  check('canAddStage в режиме чтения (accountant) — false', rightsOf('accountant', statuses[0]).canAddStage === false);
  check('isAdmin: root_admin/admin — да; dispatcher/manager — нет', isAdminRole('root_admin') && isAdminRole('admin') && !isAdminRole('dispatcher') && !isAdminRole('manager'));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Поле плановой даты: пустое — заполняемо, внесённое — только admin+замок');
{
  const disp = rightsOf('dispatcher', { kind: 'plan', planState: 'saved' });
  const root = rightsOf('root_admin', { kind: 'plan', planState: 'saved' });
  const adm = rightsOf('admin', { kind: 'plan', planState: 'saved' });
  check('исполнитель: пустое поле после сохранения — РЕДАКТИРУЕМО', canEditPlannedDateField(disp, '', false) === true);
  check('исполнитель: внесённое поле — НЕТ', canEditPlannedDateField(disp, '2026-10-01', true) === false);
  check('root-админ: внесённое — да', canEditPlannedDateField(root, '2026-10-01', true) === true);
  check('admin без разового разрешения (замок сохранён): внесённое — нет', canEditPlannedDateField(adm, '2026-10-01', false) === false);
  check('admin с разовым разрешением: внесённое — да', canEditPlannedDateField(adm, '2026-10-01', true) === true);
  check('admin: пустое — да при любом замке', canEditPlannedDateField(adm, '', false) === true);
  check('пустое значение null/undefined тоже «пустое»', canEditPlannedDateField(disp, null, false) === true);
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
  check('добавлен этап в конец — НЕ блокируется', computeBlockedPlanChanges(stored, [...stored, st('c')]).count === 0);
  check('заполнена ПУСТАЯ дата этапа b — НЕ блокируется', computeBlockedPlanChanges(stored, [A, withDate(B, '2026-10-05')]).count === 0);
  check('изменена ВНЕСЁННАЯ дата этапа a — блокируется', computeBlockedPlanChanges(stored, [withDate(A, '2026-10-02'), B]).count === 1);
  check('добавлен этап и заполнена дата нового — НЕ блокируется', computeBlockedPlanChanges(stored, [...stored, withDate(st('c'), '2026-10-09')]).count === 0);
  check('удаление этапа — блокируется', computeBlockedPlanChanges(stored, [A]).count === 1);
  check('смена количества кругов — блокируется', computeBlockedPlanChanges(stored, stored, { stored: 1, draft: 2 }).count === 1);
  check('запас существующего этапа — блокируется', computeBlockedPlanChanges(stored, [{ ...A, bufferDays: 3 }, B]).count === 1);
  check('без изменений — 0', computeBlockedPlanChanges(stored, stored).count === 0);
  check('пустые входы не падают', computeBlockedPlanChanges(undefined, undefined).count === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
