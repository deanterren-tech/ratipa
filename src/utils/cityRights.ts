/**
 * Права на справочник городов — чистые функции (без Firebase и React):
 *
 *  · добавление города (в т.ч. через CityAutocomplete) — ИСПОЛНИТЕЛЮ:
 *    любой авторизованной роли, кроме «только просмотр» (viewer);
 *  · удаление и объединение дублей — ТОЛЬКО администратору
 *    (root_admin / admin).
 *
 * Используется и сервисом (citiesService — проверка при вызове), и UI
 * (кнопки/разделы скрыты или отклонены). Чистота функций позволяет
 * тестировать матрицу ролей без сети.
 */

export const CITY_ADMIN_ROLES = ['root_admin', 'admin'] as const;

/** Администратор (root_admin/admin). */
export const isCityAdmin = (role?: string | null): boolean =>
  CITY_ADMIN_ROLES.includes(String(role || '') as (typeof CITY_ADMIN_ROLES)[number]);

/** Роль «только просмотр» — единственная, кому добавление запрещено. */
export const READONLY_ROLES = ['viewer'] as const;

/** Может ли роль добавлять города (исполнитель да, viewer нет). */
export const canAddCity = (role?: string | null): boolean => {
  const r = String(role || '').trim();
  if (!r) return false;
  return !READONLY_ROLES.includes(r as (typeof READONLY_ROLES)[number]);
};

/** Текст отказа для удаления/объединения. */
export const DENY_ADMIN_ONLY = 'Недостаточно прав: удаление и объединение дублей — только администратор';

/** Текст отказа для добавления. */
export const DENY_ADD = 'Недостаточно прав: добавление города недоступно этой роли';
