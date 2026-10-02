/**
 * Отображение имени пользователя — единые правила для всего портала.
 *
 * Данные: у профиля есть отдельные `firstName` и `lastName`, а `name` остаётся
 * полным отображаемым именем и логином входа («Имя Фамилия»). Старые записи
 * содержат только `name` — для них имя и фамилия разбираются из строки.
 *
 * Правила:
 *  - на главной в приветствии — только ИМЯ (`getUserFirstName`);
 *  - во всех остальных местах (top bar, онлайн, списки, комментарии) — ПОЛНОЕ имя
 *    «Имя Фамилия» (`getUserFullName`);
 *  - если заполнено только одно из полей, показывается оно, без лишних пробелов.
 */

type NameLike = { name?: string; firstName?: string; lastName?: string } | null | undefined;

const clean = (value?: string) => String(value ?? '').trim();

/** Разбор строки полного имени на имя и фамилию (для записей без отдельных полей). */
export function splitFullName(full?: string): { firstName: string; lastName: string } {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Имя и фамилия профиля: отдельные поля, либо разбор строки `name`. */
export function getUserNameParts(user: NameLike): { firstName: string; lastName: string } {
  const firstName = clean(user?.firstName);
  const lastName = clean(user?.lastName);
  if (firstName || lastName) return { firstName, lastName };
  return splitFullName(user?.name);
}

/** Только имя — для приветствия на главной. */
export function getUserFirstName(user: NameLike): string {
  const { firstName } = getUserNameParts(user);
  return firstName || clean(user?.name) || 'Пользователь';
}

/** Полное имя «Имя Фамилия» — для top bar, блока онлайна и остальных мест. */
export function getUserFullName(user: NameLike): string {
  const { firstName, lastName } = getUserNameParts(user);
  const full = [firstName, lastName].filter(Boolean).join(' ').trim();
  return full || clean(user?.name) || 'Пользователь';
}

/**
 * Первая буква значения: пропускает пробелы, дефисы, кавычки и точки.
 * Кириллица, латиница и цифры поддерживаются; «анна-мария» → «А».
 */
export function firstLetter(value?: string): string {
  const match = String(value ?? '').trim().match(/[0-9A-Za-zА-Яа-яЁё]/);
  return match ? match[0].toUpperCase() : '';
}

/**
 * Инициалы аватара: первая буква ИМЕНИ + первая буква ФАМИЛИИ («Сергей Терез» → «СТ»).
 * Вторая буква имени вместо фамилии не используется. Если фамилия не задана —
 * остаётся только первая буква имени.
 */
export function getInitials(firstName?: string, lastName?: string): string {
  return `${firstLetter(firstName)}${firstLetter(lastName)}`;
}

/** Инициалы по полному имени — когда отдельные поля «Имя» и «Фамилия» недоступны. */
export function getInitialsFromFullName(fullName?: string): string {
  const parts = splitFullName(fullName);
  return getInitials(parts.firstName, parts.lastName) || firstLetter(fullName);
}

/** Инициалы профиля: берутся из полей профиля, иначе разбирается строка `name`. */
export function getUserInitials(user: NameLike): string {
  const { firstName, lastName } = getUserNameParts(user);
  return getInitials(firstName, lastName);
}

export default getUserFullName;
