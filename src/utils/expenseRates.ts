/**
 * Дополнительные расходы «Плана дохода»: статьи с суммами в разных валютах и
 * расчётом эквивалента в евро.
 *
 * Курсы портала (`useConverter`) означают «сколько BYN стоит 1 единица валюты»
 * (курс BYN = 1). Отсюда направление конвертации:
 *
 *     сумма → BYN:  byn = amount × rates[валюта]
 *     BYN → EUR:    eur = byn ÷ rates.EUR
 *
 * то есть `eur = amount × rates[валюта] / rates.EUR`. Перепутать умножение и
 * деление здесь нельзя — формулы собраны в ОДНОЙ функции `convertToEur`, а тесты
 * (`npm run test:expenses`) проверяют направление на известных числах.
 *
 * Сохранённый `eur` строки НЕ пересчитывается при открытии старого плана: сумма
 * меняется только явным действием «Обновить курс» (показывает разницу) или
 * правкой суммы/валюты. Иначе обновление курсов НБРБ задним числом меняло бы
 * расходы и прибыль уже сохранённых рейсов.
 *
 * Старые записи («Доп расходы €» + «Коммент расходов») переносятся в одну статью
 * со стабильным идентификатором `legacy-<план>` — перенос идемпотентен, повторный
 * запуск не создаёт дублей; если у записи уже есть `expenses[]`, старые поля не
 * учитываются вовсе (двойного вычитания не бывает).
 */
import type { ExpenseRow } from '../types';

/** Валюты статей: тот же список, что в конвертере портала (currencyMeta). */
export const EXPENSE_CURRENCY_FALLBACK = [
  'EUR', 'USD', 'BYN', 'RUB', 'TRY', 'KZT', 'CNY', 'UZS', 'AMD', 'GEL', 'AZN', 'PLN', 'UAH', 'GBP',
];

/** Нейтральное пояснение для старой суммы без комментария (дословно по заданию). */
export const LEGACY_EXPENSE_NOTE = 'Дополнительный расход из прежней записи';

/**
 * Число или null. Внимание: `Number(null)` и `Number('')` дают 0, поэтому
 * обычная проверка `Number.isFinite(Number(v))` НЕ отличает отсутствие курса
 * (null) от нулевого значения — такие проверки здесь запрещены.
 */
export const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const newExpenseId = (): string =>
  `exp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Сумма статьи: число (0 — допустимое значение) или null, если пусто. */
export const expenseAmountOf = (row: ExpenseRow | null | undefined): number | null => {
  const raw = row?.amount;
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Пустая строка (ни суммы, ни пояснения) — в расчёт не входит и в базу не идёт. */
export const expenseIsEmpty = (row: ExpenseRow | null | undefined): boolean =>
  expenseAmountOf(row) === null && !String(row?.note || '').trim();

/** Статья влияет на итог: сумма указана (в том числе явный ноль). */
export const expenseCounts = (row: ExpenseRow | null | undefined): boolean => expenseAmountOf(row) !== null;

export interface ExpenseRates {
  [code: string]: number;
}

export interface ExpenseConversion {
  ok: boolean;
  /** Эквивалент в евро (округлён до копеек) или null, если курс недоступен. */
  eur: number | null;
  /** Курс, которым считали (BYN за единицу валюты; EUR — 1). */
  rate: number | null;
  /** Понятная причина, если посчитать нельзя. */
  error?: string;
}

/**
 * ЕДИНСТВЕННАЯ точка конвертации статьи в евро.
 * `manualRate` — явный ручной курс (BYN за 1 единицу валюты), если он задан
 * осознанно; в интерфейсе такая строка помечается.
 */
export const convertToEur = (
  amount: number | null,
  currency: string,
  rates: ExpenseRates | null | undefined,
  manualRate?: number | null,
): ExpenseConversion => {
  if (amount === null || !Number.isFinite(amount)) {
    return { ok: false, eur: null, rate: null, error: 'Укажите сумму расхода' };
  }
  const code = String(currency || '').toUpperCase();
  if (!code) return { ok: false, eur: null, rate: null, error: 'Выберите валюту' };
  // EUR — 1:1, курс не нужен.
  if (code === 'EUR') return { ok: true, eur: round2(amount), rate: 1 };

  // Курс валюты: ручной (осознанно заданный) важнее справочного.
  const manual = Number.isFinite(Number(manualRate)) && Number(manualRate) > 0 ? Number(manualRate) : null;
  const fromRates = Number.isFinite(Number(rates?.[code])) && Number(rates?.[code]) > 0 ? Number(rates?.[code]) : null;
  const rate = manual ?? fromRates;
  if (rate === null) {
    return { ok: false, eur: null, rate: null, error: `Нет курса ${code} — обновите курсы` };
  }
  const eurRate = Number(rates?.['EUR']);
  if (!Number.isFinite(eurRate) || eurRate <= 0) {
    return { ok: false, eur: null, rate: null, error: 'Нет курса EUR — обновите курсы' };
  }
  // BYN-стоимость = сумма × курс валюты; затем делим на курс EUR (BYN за 1 €).
  return { ok: true, eur: round2((amount * rate) / eurRate), rate };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Итог по статьям — по СОХРАНЁННЫМ значениям `eur` (без пересчёта по текущему
 * курсу). Статьи без курса в сумму не попадают: итог помечается неполным
 * (см. `expensesMissingRate`), нулём такой расход не подменяется.
 */
export const expensesTotalEur = (rows: ExpenseRow[] | null | undefined): number =>
  (rows || []).reduce((sum, row) => {
    if (!expenseCounts(row)) return sum;
    return sum + (numOrNull(row?.eur) ?? 0);
  }, 0);

/** Статьи с суммой, но без рассчитанного эквивалента — итог неполный. */
export const expensesMissingRate = (rows: ExpenseRow[] | null | undefined): ExpenseRow[] =>
  (rows || []).filter((row) => expenseCounts(row) && numOrNull(row?.eur) === null);

/**
 * Перенос старых полей в одну статью. Идемпотентно: идентификатор стабилен
 * (`legacy-<план>`), сумма конвертируется 1:1 в EUR (курс 1), комментарий
 * сохраняется как пояснение; сумма без комментария получает нейтральное
 * пояснение, комментарий без суммы — статью-примечание без влияния на итог.
 */
export const legacyExpenseRows = (
  legacyAmount: unknown,
  legacyNote: unknown,
  planId: string,
): ExpenseRow[] => {
  const note = String(legacyNote ?? '').trim();
  const amountRaw = numOrNull(legacyAmount);
  // Ноль в старых полях означал «расхода нет»: такая запись даёт только примечание.
  const amount = amountRaw !== null && amountRaw !== 0 ? amountRaw : null;
  const id = `legacy-${String(planId || 'plan')}`;

  if (amount !== null) {
    return [{
      id,
      amount,
      currency: 'EUR',
      note: note || LEGACY_EXPENSE_NOTE,
      eur: round2(amount),
      rate: 1,
      rateSource: 'прежняя запись (EUR)',
      legacy: true,
    }];
  }
  if (note) {
    return [{ id, amount: '', currency: 'EUR', note, eur: null, rate: null, rateSource: 'прежняя запись', legacy: true }];
  }
  return [];
};

/** Запись плана в форме, достаточная для восстановления статей. */
export interface ExpenseRecordLike {
  id?: string;
  expenses?: ExpenseRow[] | null;
  extraExpense?: unknown;
  extraExpenseNote?: unknown;
}

/**
 * Статьи записи: если новые строки есть — берём только их (старые поля
 * игнорируются, двойного учёта нет), иначе переносим старые поля одной статьёй.
 */
export const normalizeExpenseRows = (record: ExpenseRecordLike | null | undefined): ExpenseRow[] => {
  const rows = record?.expenses;
  if (Array.isArray(rows)) {
    return rows.filter(Boolean).map((row) => ({
      ...row,
      id: String(row.id || newExpenseId()),
      amount: row.amount === undefined ? '' : row.amount,
      currency: String(row.currency || 'EUR').toUpperCase(),
      note: String(row.note || ''),
      eur: numOrNull(row.eur),
      rate: numOrNull(row.rate),
    }));
  }
  return legacyExpenseRows(record?.extraExpense, record?.extraExpenseNote, String(record?.id || 'plan'));
};

/** Пересчёт одной статьи по ТЕКУЩИМ курсам (только явное действие обновления). */
export const recalcExpenseRow = (row: ExpenseRow, rates: ExpenseRates, source: string): ExpenseRow => {
  const amount = expenseAmountOf(row);
  if (amount === null) return row;
  const manual = numOrNull(row.manualRate);
  const res = convertToEur(amount, row.currency, rates, manual);
  return {
    ...row,
    eur: res.ok ? res.eur : null,
    rate: res.ok ? res.rate : null,
    rateAt: new Date().toISOString(),
    rateSource: manual !== null ? 'ручной курс' : source,
    // Ручной курс сохраняем: он задан осознанно и не должен «слетать» при обновлении.
    manualRate: manual,
  };
};

export const recalcExpenseRows = (
  rows: ExpenseRow[],
  rates: ExpenseRates,
  source: string,
): { rows: ExpenseRow[]; changed: Array<{ id: string; before: number; after: number }> } => {
  const changed: Array<{ id: string; before: number; after: number }> = [];
  const next = (rows || []).map((row) => {
    if (!expenseCounts(row)) return row;
    const after = recalcExpenseRow(row, rates, source);
    const beforeEur = numOrNull(row.eur) ?? 0;
    const afterEur = numOrNull(after.eur) ?? 0;
    if (Math.abs(beforeEur - afterEur) > 0.004) changed.push({ id: row.id, before: beforeEur, after: afterEur });
    return after;
  });
  return { rows: next, changed };
};

export interface ExpenseValidationIssue {
  id: string;
  message: string;
}

/**
 * Проверки статей перед сохранением: сумма, валюта, пояснение, наличие курса.
 * Пустые строки замечаний не дают — они просто не попадают в запись.
 */
export const validateExpenseRows = (rows: ExpenseRow[] | null | undefined): ExpenseValidationIssue[] => {
  const issues: ExpenseValidationIssue[] = [];
  (rows || []).forEach((row) => {
    if (expenseIsEmpty(row)) return;
    const amount = expenseAmountOf(row);
    if (amount === null && String(row.note || '').trim()) return; // примечание без суммы — допустимо
    if (amount === null) return;
    if (amount < 0) issues.push({ id: row.id, message: 'Сумма расхода не может быть отрицательной' });
    if (!String(row.currency || '').trim()) issues.push({ id: row.id, message: 'Выберите валюту расхода' });
    if (!String(row.note || '').trim()) issues.push({ id: row.id, message: 'Добавьте пояснение: что это за расход' });
    if (numOrNull(row.eur) === null) {
      issues.push({ id: row.id, message: 'Нет курса для этой валюты — обновите курсы или укажите ручной курс' });
    }
  });
  return issues;
};

/** Строки, которые действительно пишутся в базу: пустые отбрасываются, частичные — остаются. */
export const serializeExpenseRows = (rows: ExpenseRow[] | null | undefined): ExpenseRow[] =>
  (rows || []).filter((row) => !expenseIsEmpty(row)).map((row) => ({ ...row }));
