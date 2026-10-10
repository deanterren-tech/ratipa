/**
 * Константы интеграции Nav.by для модуля «Пробег и связь» (этап 1).
 *
 * Все имена полей и параметров ниже ПОДТВЕРЖДЕНЫ живым чтением API
 * 10.10.2026 (vehicle-list: 78 объектов; current-position: 65 объектов одним
 * запросом). Не добавляйте сюда поля «по документации», без живого ответа.
 */

/** Базовый хост API. Меняется только через env (NAVBY_BASE). */
export const NAVBY_DEFAULT_BASE = 'https://nav.by';

/** Пути методов (подтверждены). parkingReport подтверждён живым вызовом 10.10.2026. */
export const NAVBY_PATHS = {
  token: '/lumen/integration/get-token',
  vehicleList: '/lumen/integration/vehicle-list',
  currentPosition: '/lumen/integration/current-position',
  parkingReport: '/lumen/integration/parking-movement-report',
} as const;

/**
 * Лимит аккаунта: 100 запросов/мин (документация nav.by; при превышении 429).
 * Мы сознательно используем не больше NAVBY_SELF_RATE_PER_MIN — запас для
 * других интеграций аккаунта и ручных действий операторов.
 */
export const NAVBY_ACCOUNT_RATE_PER_MIN = 100;
export const NAVBY_SELF_RATE_PER_MIN = 40;

/** Таймаут одного HTTP-запроса, мс. */
export const NAVBY_HTTP_TIMEOUT_MS = 20_000;

/** Политика ретраев: 3 попытки, пауза с ростом; 429 — уважаем Retry-After. */
export const NAVBY_RETRY = {
  attempts: 3,
  baseDelayMs: 1_500,
  maxDelayMs: 20_000,
} as const;

/**
 * Часовой пояс строковых дат API. Проверено сравнением `datetime` и
 * `datetime_unix` (разница ровно +3 часа; Минск, UTC+3 круглый год).
 */
export const NAVBY_TZ_OFFSET_MINUTES = 180;

/**
 * Имени источника одометра. Поле `odom_can` в ответе API; имя намекает на
 * CAN-шину, но физический источник нами НЕ подтверждён — в интерфейсе
 * показываем нейтрально «одометр (odom_can)».
 * Вторая величина `prob` дублирует odom_can (округление до целого):
 * расхождение > 1.5 км среди 65 объектов — 0. Хранить оба не нужно.
 */
export const NAVBY_ODO_SOURCE = 'navby.odom_can';
export const NAVBY_ODO_VIRT_SOURCE = 'navby.odom_virt';
/** Реальная шкала одометра в км. */
export const NAVBY_ODO_UNIT = 'km';

/** Поля позиции, которые модуль забирает с current-position (подтверждены). */
export const NAVBY_CP_FLAGS: Record<string, string> = {
  get_odometer: 'true',
  get_address: 'true',
};

/** Дефолты конфигурации модуля (можно менять из UI, без перезапуска). */
export const TELEMETRY_DEFAULTS = {
  enabled: true,
  /** Интервал опроса, сек. Настраивается в UI. */
  intervalSec: 300,
  /** Через сколько часов без координаты считать «нет обновлений». */
  staleHours: 24,
  /** Окно ожидания после подтверждённого въезда в РФ. */
  rfWindowHours: 48,
  /** Срок хранения истории измерений, дней. */
  retentionDays: 120,
  /** Рассылка уведомлений (по умолчанию выключена — включает админ). */
  alertsEnabled: true,
  /** Роли-получатели уведомлений модуля. */
  alertRoles: ['root_admin', 'admin', 'manager'],
  /** Напоминание «нет ответа по обращению», часов. */
  replyRemindHours: 72,
  /** Не чаще одного уведомления на (авто, тип), часов. */
  alertCooldownHours: 12,
  /** Максимум уведомлений за цикл опроса. */
  maxAlertsPerRun: 30,
};

export const TELEMETRY_ROOT = 'telemetry';

/** Разбор строки "YYYY-MM-DD HH:MM:SS" в мс epoch (UTC), с учётом NAVBY_TZ_OFFSET_MINUTES. */
export function parseNavbyDateTimeToMs(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - NAVBY_TZ_OFFSET_MINUTES * 60_000;
  return Number.isFinite(utc) ? utc : null;
}

/** Ключ дня YYYYMMDD в часовом поясе API (по UTC+3), а не в поясе сервера. */
export function navbyDayKey(ms: number): string {
  const shifted = new Date(ms + NAVBY_TZ_OFFSET_MINUTES * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${p(shifted.getUTCMonth() + 1)}${p(shifted.getUTCDate())}`;
}

/** Ключ записи истории HHMMSSmmm в поясе API. */
export function navbyTimeKey(ms: number): string {
  const shifted = new Date(ms + NAVBY_TZ_OFFSET_MINUTES * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(shifted.getUTCHours())}${p(shifted.getUTCMinutes())}${p(shifted.getUTCSeconds())}${String(shifted.getUTCMilliseconds()).padStart(3, '0')}`;
}

/** Строка даты-времени в формате API «YYYY-MM-DD HH:MM:SS» (пояс +03) из epoch мс. */
export function navbyDateTimeString(ms: number): string {
  const shifted = new Date(ms + NAVBY_TZ_OFFSET_MINUTES * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`;
}
