/**
 * Квартальные квоты дозволов — единая система расчёта.
 *
 * Используется и вкладкой «Квоты и лимиты», и панелью «Лимит выдачи»,
 * чтобы цифры в обоих местах не расходились.
 *
 * Ключевые правила:
 *  - Учёт идёт по ДАТЕ ФАКТИЧЕСКОГО ПОЛУЧЕНИЯ бланка. В текущей модели дозвола
 *    это поле `issueDate` («Дата выдачи» в форме бланка) — момент регистрации
 *    поступившего бланка. Дата выдачи в рейс — отдельное событие (смена статуса
 *    на `hand`), она здесь НЕ используется, как и дата создания/изменения записи.
 *  - Бланк без даты получения не относится к текущему кварталу автоматически:
 *    он попадает в «требует проверки» и вне квартального подсчёта.
 *  - Копии (`isCopy`) квоту не расходуют.
 *  - Аннулированные (`expired`) полученными не считаются.
 *  - Эффективная квота = max(0, квота − сокращение).
 *  - Остаток = max(0, эффективная квота − получено в квартале).
 */

export type Quarter = 1 | 2 | 3 | 4;

export const QUARTERS: Quarter[] = [1, 2, 3, 4];

export const QUARTER_LABELS: Record<Quarter, string> = {
  1: 'Q1',
  2: 'Q2',
  3: 'Q3',
  4: 'Q4',
};

export const QUARTER_MONTHS: Record<Quarter, string> = {
  1: 'янв — мар',
  2: 'апр — июн',
  3: 'июл — сен',
  4: 'окт — дек',
};

/** Границы квартала, включительно по первому и последнему дню. */
export function getQuarterRange(year: number, quarter: Quarter): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
}

export function quarterLabel(year: number, quarter: Quarter): string {
  return `${QUARTER_LABELS[quarter]} ${year}`;
}

export function currentQuarter(date: Date = new Date()): Quarter {
  return (Math.floor(date.getMonth() / 3) + 1) as Quarter;
}

/** Приводит значение из input/БД к неотрицательному целому. */
export function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Дата фактического получения бланка, либо null если её нет.
 * Никогда не подставляет текущую дату — такие записи уходят в «требует проверки».
 */
export function getReceiptDate(item: any): Date | null {
  if (!item) return null;
  const raw = item.issueDate || item.receiptDate || item.receivedAt || null;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Попадает ли дата в квартал (границы включительно). */
export function isDateInQuarter(date: Date | null, year: number, quarter: Quarter): boolean {
  if (!date) return false;
  const { start, end } = getQuarterRange(year, quarter);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

/** Учитывается ли запись в квартальной квоте вообще (без привязки к периоду). */
export function countsTowardsQuota(item: any): boolean {
  if (!item) return false;
  if (item.isCopy) return false; // копии квоту не расходуют
  if (item.status === 'expired') return false; // аннулированные полученными не считаются
  return true;
}

/** Проверяет, учтён ли бланк как полученный в указанном квартале. */
export function isReceivedIn(item: any, year: number, quarter: Quarter): boolean {
  if (!countsTowardsQuota(item)) return false;
  return isDateInQuarter(getReceiptDate(item), year, quarter);
}

export interface QuarterTypeStats {
  /** Установленная квартальная квота (после fallback на прежнюю настройку). */
  quota: number;
  /** Сокращение квоты в штуках (0, если не задано). */
  reduction: number;
  /** Эффективная квота = max(0, квота − сокращение). */
  effective: number;
  /** Получено бланков в этом квартале. */
  received: number;
  /** Остаток к получению = max(0, эффективная − получено), либо null когда квота не задана. */
  remaining: number | null;
  /** Бланки вида без даты получения — требуют проверки. */
  needsVerification: number;
  /** Квота не задана вовсе. */
  notConfigured: boolean;
  /** Процент заполнения эффективной квоты (0..100), либо null когда квота не задана. */
  fillPct: number | null;
  /** Сокращение больше исходной квоты — эффективная упирается в ноль. */
  reductionClamped: boolean;
}

/**
 * Полный расчёт по одному виду дозвола и кварталу.
 * Всё считается из переданных записей — без обращения к внешнему состоянию.
 */
export function computeQuarterStats(
  permits: any[],
  year: number,
  quarter: Quarter,
  quotaRaw: unknown,
  reductionRaw: unknown,
): QuarterTypeStats {
  const quota = toNonNegativeInt(quotaRaw);
  const reduction = toNonNegativeInt(reductionRaw);

  const effective = Math.max(0, quota - reduction);
  const reductionClamped = reduction > quota;

  let received = 0;
  let needsVerification = 0;

  for (const item of permits || []) {
    if (!countsTowardsQuota(item)) continue;
    const date = getReceiptDate(item);
    if (!date) {
      needsVerification++;
      continue;
    }
    if (isDateInQuarter(date, year, quarter)) received++;
  }

  const notConfigured = quota <= 0;
  const remaining = notConfigured ? null : Math.max(0, effective - received);
  const fillPct = notConfigured
    ? null
    : Math.min(100, Math.round((received / Math.max(1, effective)) * 100));

  return {
    quota,
    reduction,
    effective,
    received,
    remaining,
    needsVerification,
    notConfigured,
    fillPct,
    reductionClamped,
  };
}

/**
 * Бланки вида, у которых нет даты получения (требуют проверки) —
 * вне зависимости от квартала.
 */
export function countMissingReceiptDate(permits: any[]): number {
  let n = 0;
  for (const item of permits || []) {
    if (!countsTowardsQuota(item)) continue;
    if (!getReceiptDate(item)) n++;
  }
  return n;
}

/** Пути Firebase: настройки по годам и кварталам. */
export const quotaPaths = {
  /** Основная таблица квот: quotaQuarterLimitsV2/{year}/{quarter}/{type} */
  limits: (year: number, quarter: Quarter) => `quotaQuarterLimitsV2/${year}/${quarter}`,
  limitForType: (year: number, quarter: Quarter, type: string) =>
    `quotaQuarterLimitsV2/${year}/${quarter}/${type}`,
  /** Сокращения: quotaQuarterReductionsV2/{year}/{quarter}/{type} */
  reductions: (year: number, quarter: Quarter) => `quotaQuarterReductionsV2/${year}/${quarter}`,
  reductionForType: (year: number, quarter: Quarter, type: string) =>
    `quotaQuarterReductionsV2/${year}/${quarter}/${type}`,
  /** Прежняя плоская настройка (без года/квартала) — fallback, чтобы не терять уже заданные квоты. */
  legacyQuarterLimit: (type: string) => `quotaTypesQuarterLimits/${type}`,
  /** Режим квотирования вида: quotaModeV1/{type} = 'annual' | 'quarterly' */
  modeForType: (type: string) => `quotaModeV1/${type}`,
  modeAll: () => 'quotaModeV1',
  /** Годовое сокращение: quotaAnnualReductionsV1/{year}/{type} */
  annualReductionForType: (year: number, type: string) => `quotaAnnualReductionsV1/${year}/${type}`,
  annualReductions: (year: number) => `quotaAnnualReductionsV1/${year}`,
  /** Годовой процент: quotaAnnualPercentsV1/{year}/{type} */
  annualPercentForType: (year: number, type: string) => `quotaAnnualPercentsV1/${year}/${type}`,
  annualPercents: (year: number) => `quotaAnnualPercentsV1/${year}`,
  /** Прежний общий процент (fallback) */
  legacyPercent: (type: string) => `quotaTypesPercents/${type}`,
};
// ─────────────────────────────────────────────────────────────────────────────
// Режимы квотирования: у вида дозвола он один, единицы не смешиваются.
//   'annual'    — годовая квота в процентах от штата (одно значение на год);
//   'quarterly' — квартальные квоты в штуках (Q1..Q4 на год).
// ─────────────────────────────────────────────────────────────────────────────

export type QuotaMode = 'annual' | 'quarterly';

export const DEFAULT_QUOTA_MODE: QuotaMode = 'annual';

export function normalizeQuotaMode(raw: unknown): QuotaMode {
  return raw === 'quarterly' ? 'quarterly' : 'annual';
}

/** Границы года, включительно. */
export function getYearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(year, 0, 1, 0, 0, 0, 0),
    end: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

export interface YearTypeStats {
  /** Процент от штата (годовая квота). */
  percent: number;
  /** Исходная годовая квота в штуках = round(штат × процент / 100). */
  quota: number;
  /** Сокращение квоты в штуках (не в процентах). */
  reduction: number;
  /** Эффективная квота = max(0, квота − сокращение). */
  effective: number;
  /** Сокращение упирается в ноль: эффективная квота не может быть отрицательной. */
  reductionClamped: boolean;
  /** Получено бланков за год. */
  received: number;
  /** Остаток к получению за год (null, если квота не задана). */
  remaining: number | null;
  notConfigured: boolean;
  fillPct: number | null;
  needsVerification: number;
}

/**
 * Расчёт годовой (процентной) квоты. Учитывает только бланки, полученные
 * в границах года, по дате фактического получения.
 */
export function computeYearStats(
  permits: any[],
  year: number,
  percentRaw: unknown,
  driversCount: number,
  reductionRaw?: unknown,
): YearTypeStats {
  const percent = Number(percentRaw) || 0;
  // Сначала процент переводим в штуки, и только потом вычитаем сокращение
  const quota = percent > 0 ? Math.round((driversCount * percent) / 100) : 0;
  const reduction = toNonNegativeInt(reductionRaw);
  const effective = Math.max(0, quota - reduction);
  const reductionClamped = reduction > quota;
  const { start, end } = getYearRange(year);

  let received = 0;
  let needsVerification = 0;
  for (const item of permits || []) {
    if (!countsTowardsQuota(item)) continue;
    const date = getReceiptDate(item);
    if (!date) {
      needsVerification++;
      continue;
    }
    if (date.getTime() >= start.getTime() && date.getTime() <= end.getTime()) received++;
  }

  const notConfigured = quota <= 0;
  return {
    percent,
    quota,
    reduction,
    effective,
    reductionClamped,
    received,
    remaining: notConfigured ? null : Math.max(0, effective - received),
    notConfigured,
    fillPct: notConfigured ? null : Math.min(100, Math.round((received / Math.max(1, effective)) * 100)),
    needsVerification,
  };
}

/** Кварталы, у которых для вида задано ненулевое количество. */
export function countConfiguredQuarters(limits: Record<string, any> | null | undefined): number {
  if (!limits) return 0;
  return QUARTERS.filter((q) => toNonNegativeInt(limits[String(q)]) > 0).length;
}

