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


// ---------------------------------------------------------------------------
// «Время внесения записи» — порядок журнала/статистики выплат
// ---------------------------------------------------------------------------

/** Символы push-ключа Firebase (порядок фиксирован форматом ключа). */
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/**
 * Время создания записи по ключу базы: первые 8 символов push-ключа кодируют
 * метку времени в миллисекундах. Не-push ключи (ручные, перенесённые) → 0 —
 * времени создания в них нет, вызывающий берёт следующий источник.
 */
export function pushKeyTime(key: unknown): number {
  const s = String(key ?? '');
  if (s.length < 8) return 0;
  let t = 0;
  for (let i = 0; i < 8; i += 1) {
    const idx = PUSH_CHARS.indexOf(s[i]);
    if (idx < 0) return 0;
    t = t * 64 + idx;
  }
  // Правдоподобные границы (2015 г. … ~2100 г.): мусор не считаем временем.
  return t > 1_420_000_000_000 && t < 4_100_000_000_000 ? t : 0;
}

/** «ДД.ММ.ГГГГ» или «ДД/ММ/ГГГГ» → начало дня в мс (0 — даты нет). */
export function salaryDateOnly(value: unknown): number {
  const parts = String(value ?? '').trim().split(/[./]/);
  if (parts.length !== 3) return 0;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (!d || !m || String(y).length !== 4) return 0;
  return new Date(y, m - 1, d).getTime();
}

/** Минимум полей записи, нужный для порядка: ключ базы и дата выплаты. */
export interface SalaryEntryOrderLike {
  storageKey?: unknown;
  id?: unknown;
  createdAt?: unknown;
  savedAt?: unknown;
  datetime?: unknown;
}

/**
 * Время ВНЕСЕНИЯ записи выплаты: ключ базы → createdAt/savedAt → дата выплаты.
 * Именно по нему сортируются журнал и статистика выплат («последние сверху»):
 * свежая запись со «старой» датой выплаты должна быть сверху, а не внизу.
 */
export function salaryEntryTime(rec: SalaryEntryOrderLike | null | undefined): number {
  if (!rec) return 0;
  const byKey = pushKeyTime(rec.storageKey) || pushKeyTime(rec.id);
  if (byKey) return byKey;
  const stamp = rec.createdAt || rec.savedAt;
  const parsed = stamp ? Date.parse(String(stamp)) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return salaryDateOnly(rec.datetime);
}

/** Компаратор «сначала внесённые позже» (журнал и статистика выплат). */
export function compareByEntryTimeDesc(a: SalaryEntryOrderLike | null | undefined, b: SalaryEntryOrderLike | null | undefined): number {
  const ta = salaryEntryTime(a);
  const tb = salaryEntryTime(b);
  if (ta !== tb) return tb - ta;
  // Одно мгновение (или обе записи без времени) — по ключу базы, детерминированно.
  return String(b?.storageKey || b?.id || '').localeCompare(String(a?.storageKey || a?.id || ''));
}
