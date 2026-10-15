/**
 * Качество данных реестра водителей — ЧИСТЫЙ слой АДМИНИСТРАТИВНОЙ проверки
 * неполных записей (окно «Дата рождения водителя» сюда не ходит: персональное
 * окно адресное и показывает записи только ответственному диспетчеру).
 *
 * Что проверяем:
 *  · негодная/пустая дата рождения (`birth-date`) — те же пороги, что у окна
 *    (utils/driverBirthPrompt.checkBirthDate — единые правила);
 *  · ответственный диспетчер не назначен (`dispatcher`) — drivers/{id}.dispatcherId
 *    пуст: запись не принадлежит никому, персональное окно по ней не поднимается
 *    ни у кого, поэтому такие записи должен видеть администратор;
 *  · dispatcherId заполнен, но такой учётки нет в users_list (`dispatcher-unknown`) —
 *    битая связь, её тоже нужно чинить руками.
 *
 * Источник ответственного — СТАБИЛЬНЫЙ ID: имя разрешается по users_list, а не по
 * устаревшему текстовому полю записи (его показываем лишь как подсказку).
 */
import { checkBirthDate } from './driverBirthPrompt';
import {
  driverFullName,
  primaryPhone,
  isServiceDriver,
  isArchivedDriver,
  type DriverRecord,
} from './driverRegistry';

/** Что не заполнено/сломано в записи водителя. */
export type DriverDataIssue = 'birth-date' | 'dispatcher' | 'dispatcher-unknown';

/** Минимум учётки для разрешения имени ответственного по id. */
export interface DriverDataQualityUser {
  uid?: string;
  name?: string;
  role?: string;
}

/** Сцепка в объёме машины для подписи (ровно как в окне). */
export interface DriverDataQualityCoupling {
  driverId?: string;
  carNumber?: string;
  vehicleNumbers?: string;
}

/** Строка административной проверки — одна запись с проблемами. */
export interface DriverDataQualityRow {
  id: string;
  name: string;
  phone: string;
  car: string;
  /** Ответственный по стабильному id ('' — не назначен). */
  dispatcherId: string;
  /** Имя ответственного, разрешённое по users_list ('' — не разрешилось). */
  dispatcherName: string;
  /** Текстовый след ответственного в самой записи (старое поле) — подсказка. */
  dispatcherText: string;
  /** Что не заполнено: дата рождения и/или ответственный. */
  issues: DriverDataIssue[];
  /** Причина по дате рождения (для показа), '' — когда дата в порядке. */
  birthReason: string;
}

/**
 * Строки проверки: только НЕ служебные и НЕ архивные записи, у которых есть
 * хотя бы одна проблема. Порядок — по ФИО (русская локаль).
 */
export function buildDriverDataQualityRows(
  drivers: DriverRecord[] | null | undefined,
  opts: {
    users?: DriverDataQualityUser[] | null;
    couplings?: DriverDataQualityCoupling[] | null;
    now?: Date;
  } = {},
): DriverDataQualityRow[] {
  const users = Array.isArray(opts.users) ? opts.users : null;
  const nameById = new Map<string, string>();
  for (const u of users || []) {
    const uid = String(u?.uid ?? '').trim();
    const name = String(u?.name ?? '').trim();
    if (uid && name) nameById.set(uid, name);
  }

  const carByDriver = new Map<string, string>();
  for (const c of opts.couplings || []) {
    const driverId = String(c?.driverId ?? '').trim();
    if (!driverId) continue;
    const car = String(c?.carNumber ?? '').trim() || String(c?.vehicleNumbers ?? '').trim();
    if (car && !carByDriver.has(driverId)) carByDriver.set(driverId, car);
  }

  const out: DriverDataQualityRow[] = [];
  for (const d of drivers || []) {
    const id = String(d?.id ?? '').trim();
    if (!id) continue;
    if (isServiceDriver(d) || isArchivedDriver(d)) continue;

    const issues: DriverDataIssue[] = [];
    const verdict = checkBirthDate(d?.birthDate, opts.now);
    if (verdict.needsInput) issues.push('birth-date');

    const dispatcherId = String(d?.dispatcherId ?? '').trim();
    if (!dispatcherId) {
      issues.push('dispatcher');
    } else if (users && users.length > 0 && !nameById.has(dispatcherId)) {
      // Проверяем связь только когда список учёток реально загружен.
      issues.push('dispatcher-unknown');
    }
    if (issues.length === 0) continue;

    out.push({
      id,
      name: driverFullName(d),
      phone: primaryPhone(d),
      car: carByDriver.get(id) || '',
      dispatcherId,
      dispatcherName: dispatcherId ? (nameById.get(dispatcherId) || '') : '',
      dispatcherText: String(d?.dispatcherName ?? '').trim() || String(d?.dispatcher ?? '').trim(),
      issues,
      birthReason: verdict.needsInput ? verdict.reason : '',
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  return out;
}

/** Подпись проблемы для интерфейса администратора. */
export function driverDataIssueLabel(issue: DriverDataIssue): string {
  switch (issue) {
    case 'birth-date':
      return 'Дата рождения';
    case 'dispatcher':
      return 'Ответственный не назначен';
    case 'dispatcher-unknown':
      return 'Ответственный — неизвестная учётка';
    default:
      return '';
  }
}
