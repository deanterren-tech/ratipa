/**
 * Права справочника городов (чистая матрица ролей, без базы):
 *  · добавлять (CityInput) — исполнителю: любая роль кроме viewer;
 *  · удалять и объединять дубли — только root_admin/admin;
 *  · тексты отказов совпадают с проверками в сервисе (citiesService).
 * Запуск: npm run test:cities-rights
 */
import {
  isCityAdmin,
  canAddCity,
  DENY_ADMIN_ONLY,
  DENY_ADD,
  CITY_ADMIN_ROLES,
  READONLY_ROLES,
} from '../src/utils/cityRights.ts';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` ${extra}` : ''}`);
  }
};

// --- администраторы ---
check('root_admin — администратор', isCityAdmin('root_admin'));
check('admin — администратор', isCityAdmin('admin'));
check('dispatcher — НЕ администратор', !isCityAdmin('dispatcher'));
check('manager — НЕ администратор', !isCityAdmin('manager'));
check('accountant — НЕ администратор', !isCityAdmin('accountant'));
check('mechanic — НЕ администратор', !isCityAdmin('mechanic'));
check('viewer — НЕ администратор', !isCityAdmin('viewer'));
check('пустая/undefined роль — НЕ администратор', !isCityAdmin('') && !isCityAdmin(undefined) && !isCityAdmin(null));

// --- добавление ---
check('dispatcher может добавлять', canAddCity('dispatcher'));
check('manager может добавлять', canAddCity('manager'));
check('logist может добавлять', canAddCity('logist'));
check('accountant может добавлять (исполнитель данных)', canAddCity('accountant'));
check('admin может добавлять', canAddCity('admin'));
check('root_admin может добавлять', canAddCity('root_admin'));
check('viewer НЕ может добавлять', !canAddCity('viewer'));
check('пустая роль НЕ может добавлять', !canAddCity('') && !canAddCity(undefined));

// --- константы и тексты ---
check('CITY_ADMIN_ROLES = [root_admin, admin]', JSON.stringify(CITY_ADMIN_ROLES) === JSON.stringify(['root_admin', 'admin']));
check('READONLY_ROLES = [viewer]', JSON.stringify(READONLY_ROLES) === JSON.stringify(['viewer']));
check('текст отказа admin-only стабилен', DENY_ADMIN_ONLY.includes('только администратор'));
check('текст отказа добавления стабилен', DENY_ADD.includes('добавление'));

// --- заявление задачи: «исполнитель может добавить, удалить/объединить не может — админ может» ---
{
  const executor = 'dispatcher';
  const admin = 'admin';
  check('исполнитель: add=да, админ-операции=нет', canAddCity(executor) && !isCityAdmin(executor));
  check('админ: add=да, админ-операции=да', canAddCity(admin) && isCityAdmin(admin));
}

console.log(`\ntest-cities-rights: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
