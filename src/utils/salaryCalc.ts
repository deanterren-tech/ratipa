/**
 * Единый (без копий) расчёт показателей выплаты водителю.
 *
 * Формулы перенесены БЕЗ изменений из основной формы SalaryModule:
 *   kmMoney      = (Number(km) || 0) * rate
 *   idleMoney    = idleDays * idleRate
 *   daysMoney    = totalDays * perDiem
 *   totalSalary  = kmMoney + idleMoney + daysMoney + bonus
 *   salaryPerDay = totalSalary / Math.max(totalDays, 1)
 *
 * Функцию использует И основная форма, И окно «Редактирование выплаты», И сохранение —
 * в компонентах не должно оставаться ни одной копии этих формул.
 * Идентичность прежнему (инлайн) расчёту проверяется скриптом
 * scripts/test-salary-calc.ts на реальном снимке записей salaryHistory (N ≥ 30).
 *
 * Отличие от инлайна только в устойчивости к мусорным входам: undefined/''/NaN
 * приводятся к 0 (а не дают NaN на экране) — конечные числа считаются ровно так же.
 */

/** Входные данные расчёта: любое поле может прийти сырым из записи/инпута. */
export interface SalaryTotalsInput {
  km?: unknown;
  rate?: unknown;
  idleDays?: unknown;
  idleRate?: unknown;
  totalDays?: unknown;
  perDiem?: unknown;
  bonus?: unknown;
}

/** Показатели выплаты, как их показывают форма и список. */
export interface SalaryTotals {
  kmMoney: number;
  idleMoney: number;
  daysMoney: number;
  totalSalary: number;
  salaryPerDay: number;
  /** Все входы неотрицательные и totalDays > 0 — можно подсказывать «проверьте значения». */
  inputsValid: boolean;
}

/** Число или 0: undefined/''/NaN не должны давать NaN в показателях. */
export function salaryNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Тот же расчёт, что и в основной форме (см. шапку модуля). */
export function computeSalaryTotals(input: SalaryTotalsInput): SalaryTotals {
  const km = salaryNumber(input.km);
  const rate = salaryNumber(input.rate);
  const idleDays = salaryNumber(input.idleDays);
  const idleRate = salaryNumber(input.idleRate);
  const totalDays = salaryNumber(input.totalDays);
  const perDiem = salaryNumber(input.perDiem);
  const bonus = salaryNumber(input.bonus);

  const kmMoney = km * rate;
  const idleMoney = idleDays * idleRate;
  const daysMoney = totalDays * perDiem;
  const totalSalary = kmMoney + idleMoney + daysMoney + bonus;
  const salaryPerDay = totalSalary / Math.max(totalDays, 1);

  return {
    kmMoney,
    idleMoney,
    daysMoney,
    totalSalary,
    salaryPerDay,
    inputsValid: km >= 0 && rate >= 0 && idleDays >= 0 && totalDays > 0 && perDiem >= 0 && bonus >= 0,
  };
}

/** Источник ставки: запись автопарка/сцепки, водитель или легаси-группа. */
export interface RateSource {
  rateGroupId?: unknown;
  rate?: unknown;
  perDiemRate?: unknown;
}

/** Резолвнутая ставка за км и (опционально) суточная ставка группы. */
export interface ResolvedCarRate {
  rate: number;
  perDiemRate?: number;
}

/** Элемент справочника «Группы ставок» (directories/rateGroups). */
export interface RateGroupLike {
  id?: string;
  key?: string;
  rate?: unknown;
  perDiemRate?: unknown;
}

/**
 * Ставка за км: сначала группа ставок (directories/rateGroups) по rateGroupId,
 * затем прямое числовое значение rate у самой записи. Логика перенесена из
 * SalaryModule без изменений — используется и основной формой, и окном
 * «Редактирование выплаты» (никаких отдельных поисков через carsPool).
 */
export function resolveCarRateFrom(
  source: RateSource | null | undefined,
  rateGroups: RateGroupLike[],
): ResolvedCarRate | null {
  if (!source) return null;
  const groupId = String(source.rateGroupId || '').trim();
  if (groupId) {
    const group = rateGroups.find((x) => (x.id || x.key || '') === groupId);
    const groupRate = Number(group?.rate);
    if (Number.isFinite(groupRate) && groupRate > 0) {
      const groupPerDiem = Number(group?.perDiemRate);
      return { rate: groupRate, perDiemRate: Number.isFinite(groupPerDiem) && groupPerDiem > 0 ? groupPerDiem : undefined };
    }
  }
  const directRate = Number(source.rate);
  if (Number.isFinite(directRate) && directRate > 0) {
    const directPerDiem = Number(source.perDiemRate);
    return { rate: directRate, perDiemRate: Number.isFinite(directPerDiem) && directPerDiem > 0 ? directPerDiem : undefined };
  }
  return null;
}

/** Деньги/дни → ставка, если восстановима (деньги > 0 и дни > 0), иначе fallback. */
function rateFromMoneyAndDays(money: unknown, days: unknown, fallback: number): number {
  const m = Number(money);
  const d = Number(days);
  if (Number.isFinite(m) && m > 0 && Number.isFinite(d) && d > 0) {
    const r = m / d;
    if (Number.isFinite(r) && r > 0) return r;
  }
  return fallback;
}

/**
 * Ставки, с которыми запись была сохранена: суточные из daysMoney/totalDays,
 * простой из idleMoney/idleDays. Записи не хранят сами ставки, поэтому окно
 * редактирования восстанавливает их из сохранённых начислений — так открытие
 * окна не меняет итог, а правка дней продолжается той же ставкой.
 * Если данных нет (легаси-запись) — текущие настройки портала.
 */
export function deriveStoredRates(
  record: { daysMoney?: unknown; totalDays?: unknown; idleMoney?: unknown; idleDays?: unknown },
  defaults: { perDiemRate: number; idleRate: number },
): { perDiemRate: number; idleRate: number } {
  return {
    perDiemRate: rateFromMoneyAndDays(record.daysMoney, record.totalDays, defaults.perDiemRate),
    idleRate: rateFromMoneyAndDays(record.idleMoney, record.idleDays, defaults.idleRate),
  };
}
