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
  /**
   * Исторические методы (подтверждены ЖИВЫМИ вызовами 11.10.2026, см. отчёт
   * «История CAN-пробега»):
   *  - objectStatData: агрегат за период с одометром и РЕАЛЬНЫМИ временами
   *    измерений на границах (odom_start/s_odo_dt, odom_finish/e_odo_dt;
   *    s_odo_dt/e_odo_dt — epoch-СЕКУНДЫ UTC). Без from/to отдаёт текущее
   *    значение и datetime последнего измерения.
   *  - cityOrTrack (can_needed=true): сегменты город/трасса; у сегментов
   *    движения start_odometer/end_odometer (float, км) и их времена.
   *  - getPlanFact: у нашего аккаунта 403 (нет прав) — НЕ используем.
   */
  objectStatData: '/lumen/integration/object-stat-data',
  cityOrTrack: '/lumen/integration/city-or-track',
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

/**
 * Источники измерений одометра («История CAN-пробега»). Имя источника —
 * подтверждённый живым вызовом метод API, из которого получено измерение:
 *  - stat_window: object-stat-data за окно; значение — целые км (округление
 *    источника), время измерения s_odo_dt/e_odo_dt — РЕАЛЬНОЕ (epoch секунды);
 *  - city_segment: city-or-track, can_needed=true; start_odometer/end_odometer
 *    (float, км) на границах сегментов движения;
 *  - parking_segment: parking-movement-report; s_odo_can/e_odo_can (float, км)
 *    на границах интервалов стоянка/движение;
 *  - snapshot: снимок current-position портала (время измерения одометра в
 *    API отсутствует — честно помечается «время измерения неизвестно»;
 *    хранится как проекция telemetry_history, отдельно не дублируется).
 */
export const NAVBY_CAN_SOURCES = {
  statWindow: 'navby.stat_window',
  citySegment: 'navby.city_segment',
  parkingSegment: 'navby.parking_segment',
  snapshot: 'navby.current_position',
} as const;
export type NavbyCanSource = typeof NAVBY_CAN_SOURCES[keyof typeof NAVBY_CAN_SOURCES];
/** Короткие теги для ключей узлов RTDB. */
export const NAVBY_CAN_SRC_TAG: Record<string, string> = {
  [NAVBY_CAN_SOURCES.statWindow]: 'sw',
  [NAVBY_CAN_SOURCES.citySegment]: 'cs',
  [NAVBY_CAN_SOURCES.parkingSegment]: 'ps',
  [NAVBY_CAN_SOURCES.snapshot]: 'cp',
};
/** Точность значения: int — целые км (object-stat-data), 3 — три знака (float-источники). */
export type NavbyCanPrecision = 'km_int' | 'km_3dec';

/** Дополнения конфигурации модуля для постоянного сбора истории. */
export const CAN_COLLECT_DEFAULTS = {
  /** Включён ли постоянный сбор измерений CAN. */
  canCollectEnabled: true,
  /** Окно запроса object-stat-data при почасовом съёме, мин (2 точки на окно). */
  canWindowMin: 60,
  /** Как часто делать почасовой съём (мин от последнего). */
  canSweepMin: 60,
  /** Максимум окон к догону за один цикл (ограничение темпа запросов). */
  canSweepMaxWindows: 3,
  /** Как часто выполнять суточную догрузку сегментов (часов). */
  canBackfillHours: 24,
  /** Сколько последних полных дней догружать каждый раз (идемпотентно). */
  canBackfillDays: 2,
  /** Максимум дней в запросе city-or-track/parking за один вызов (защита от таймаута). */
  canChunkDays: 31,
  /** Сколько машин обрабатывать за цикл догрузки (курсор продолжит со следующего). */
  canBackfillCarsPerRun: 50,
} as const;

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
