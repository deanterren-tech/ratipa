import type { ExpenseRow } from '../src/types';
import {
  convertToEur,
  expensesMissingRate,
  expensesTotalEur,
  expenseAmountOf,
  expenseIsEmpty,
  legacyExpenseRows,
  normalizeExpenseRows,
  recalcExpenseRows,
  serializeExpenseRows,
  validateExpenseRows,
  LEGACY_EXPENSE_NOTE,
} from '../src/utils/expenseRates';

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, info = '') => {
  if (cond) { passed++; console.log(`PASS :: ${name}${info ? ' :: ' + info : ''}`); }
  else { failed++; console.log(`FAIL :: ${name}${info ? ' :: ' + info : ''}`); }
};

// Курсы портала: сколько BYN за 1 единицу валюты.
const R = { EUR: 3.55, USD: 3.25, RUB: 0.0413, TRY: 0.0925, BYN: 1 };

console.log('\nНаправление конвертации');
check('EUR — 1:1, курс 1', (() => { const r = convertToEur(100, 'EUR', R); return r.ok && r.eur === 100 && r.rate === 1; })(), JSON.stringify(convertToEur(100, 'EUR', R)));
check('USD → EUR: 100 USD = 100×3.25÷3.55 = 91.55 €', (() => { const r = convertToEur(100, 'USD', R); return r.ok && r.eur === 91.55 && r.rate === 3.25; })(), JSON.stringify(convertToEur(100, 'USD', R)));
check('ошибка «умножение вместо деления» отловлена (иначе было бы 109.23)', convertToEur(100, 'USD', R).eur !== 109.23);
check('BYN → EUR: 355 BYN = 100 €', convertToEur(355, 'BYN', R).eur === 100, String(convertToEur(355, 'BYN', R).eur));
check('RUB → EUR: 10 000 RUB = 116.34 €', convertToEur(10000, 'RUB', R).eur === 116.34, String(convertToEur(10000, 'RUB', R).eur));
check('явный ноль — корректная сумма (0 €)', convertToEur(0, 'EUR', R).eur === 0);
check('нет курса валюты — результат не выдумывается', (() => { const r = convertToEur(50, 'GEL', R); return !r.ok && r.eur === null && String(r.error).includes('GEL'); })(), JSON.stringify(convertToEur(50, 'GEL', R)));
check('нет курса EUR — расчёт не выдаётся за корректный', !convertToEur(50, 'USD', { USD: 3.25 }).ok);
check('ручной курс важнее справочного и тоже делится на курс EUR', (() => { const r = convertToEur(100, 'TRY', R, 0.3); return r.ok && r.eur === 8.45 && r.rate === 0.3; })(), JSON.stringify(convertToEur(100, 'TRY', R, 0.3)));

console.log('\nИтог по статьям');
const mk = (over: Partial<ExpenseRow>): ExpenseRow => ({ id: 'x' + Math.random().toString(36).slice(2, 5), amount: 0, currency: 'EUR', note: 'n', eur: 0, rate: 1, ...over });
const rows: ExpenseRow[] = [mk({ id: 'a', amount: 100, currency: 'USD', note: 'мойка', eur: 91.55, rate: 3.25 }), mk({ id: 'b', amount: 50, currency: 'EUR', note: 'стоянка', eur: 50, rate: 1 })];
check('итог — сумма сохранённых значений в €', expensesTotalEur(rows) === 141.55, String(expensesTotalEur(rows)));
check('пустая строка в расчёт не входит', expensesTotalEur([...rows, mk({ id: 'c', amount: '', note: '', eur: null, rate: null })]) === 141.55);
check('статья без курса не превращается в ноль и помечается', (() => { const list = [...rows, mk({ id: 'd', amount: 500, currency: 'GEL', eur: null, rate: null })]; return expensesTotalEur(list) === 141.55 && expensesMissingRate(list).length === 1 && expensesMissingRate(list)[0].id === 'd'; })());
check('сохранённый итог не пересчитывается по новым курсам при открытии', expensesTotalEur([mk({ amount: 100, currency: 'USD', eur: 91.55, rate: 3.25 })]) === 91.55);

console.log('\nПеренос старых записей');
const legacy = legacyExpenseRows(120, 'Мойки и прочее', 'p1');
check('старая сумма+комментарий → одна статья EUR, курс 1:1', legacy.length === 1 && legacy[0].amount === 120 && legacy[0].currency === 'EUR' && legacy[0].eur === 120 && legacy[0].rate === 1 && legacy[0].note === 'Мойки и прочее' && legacy[0].id === 'legacy-p1', JSON.stringify(legacy[0]));
check('сумма без комментария → нейтральное пояснение', legacyExpenseRows(80, '', 'p2')[0].note === LEGACY_EXPENSE_NOTE, legacyExpenseRows(80, '', 'p2')[0].note);
check('только комментарий → примечание без влияния на итог', (() => { const r = legacyExpenseRows(0, 'Замена масла позже', 'p3'); return r.length === 1 && r[0].amount === '' && r[0].eur === null && expensesTotalEur(r) === 0; })(), JSON.stringify(legacyExpenseRows(0, 'Замена масла позже', 'p3')));
check('пустые старые поля → статей нет', legacyExpenseRows(0, '', 'p4').length === 0);
check('перенос идемпотентен: повторный запуск даёт тот же идентификатор', legacyExpenseRows(120, 'x', 'p1')[0].id === legacyExpenseRows(120, 'x', 'p1')[0].id);
const rec = { id: 'p5', extraExpense: 999, extraExpenseNote: 'старое', expenses: [mk({ id: 'n1', amount: 50, currency: 'EUR', eur: 50 })] };
check('новые строки есть → старые поля не учитываются (нет двойного вычитания)', expensesTotalEur(normalizeExpenseRows(rec)) === 50 && normalizeExpenseRows(rec).length === 1);
check('новая запись без expenses[] переносится одной статьёй', (() => { const r = normalizeExpenseRows({ id: 'p6', extraExpense: 30, extraExpenseNote: '' }); return r.length === 1 && r[0].amount === 30 && r[0].legacy === true; })());
check('повторное открытие (двойной normalize) дублей не даёт', (() => { const once = normalizeExpenseRows({ id: 'p7', extraExpense: 30, extraExpenseNote: '' }); const twice = normalizeExpenseRows({ id: 'p7', expenses: once }); return twice.length === 1 && twice[0].amount === 30; })());

console.log('\nОбновление курса и проверки');
const upd = recalcExpenseRows([mk({ id: 'u1', amount: 100, currency: 'USD', eur: 91.55, rate: 3.25 })], { EUR: 3.6, USD: 3.3 }, 'НБРБ');
check('явное обновление курса пересчитывает сумму и сообщает разницу', upd.rows[0].eur === 91.67 && upd.changed.length === 1 && upd.changed[0].before === 91.55, JSON.stringify(upd.changed));
const manual = recalcExpenseRows([mk({ id: 'u2', amount: 100, currency: 'TRY', eur: 8.45, rate: 0.3, manualRate: 0.3 })], { EUR: 3.6, TRY: 0.1 }, 'НБРБ');
check('ручной курс помечен и не слетает при обновлении', manual.rows[0].rate === 0.3 && manual.rows[0].rateSource === 'ручной курс' && manual.rows[0].eur === 8.33, JSON.stringify(manual.rows[0]));
check('проверки: сумма без пояснения — замечание', validateExpenseRows([mk({ amount: 50, note: '', eur: 50, rate: 1 })]).some((i) => /пояснение/.test(i.message)));
check('проверки: корректная статья замечаний не даёт', validateExpenseRows([mk({ amount: 50, note: 'мойка', eur: 50, rate: 1 })]).length === 0);
check('проверки: отрицательная сумма — замечание', validateExpenseRows([mk({ amount: -5, note: 'x', eur: -5, rate: 1 })]).some((i) => /отрицательной/.test(i.message)));
check('проверки: статья без курса — замечание про курсы', validateExpenseRows([mk({ amount: 500, currency: 'GEL', note: 'x', eur: null, rate: null })]).some((i) => /курс/.test(i.message)));
check('проверки: пустая добавленная строка молча пропускается', validateExpenseRows([mk({ amount: '', note: '', eur: null, rate: null })]).length === 0);
check('сериализация: пустые строки не пишутся, частичные с суммой сохраняются', (() => { const out = serializeExpenseRows([mk({ id: 'e1', amount: '', note: '', eur: null, rate: null }), mk({ id: 'e2', amount: 500, currency: 'GEL', note: '', eur: null, rate: null })]); return out.length === 1 && out[0].id === 'e2'; })());
check('различение отсутствия и нуля', expenseAmountOf(mk({ amount: 0 })) === 0 && expenseAmountOf(mk({ amount: '' })) === null && expenseIsEmpty(mk({ amount: 0, note: '' })) === false);

console.log(`\nИТОГО: ${passed}/${passed + failed}`);
if (failed > 0) process.exit(1);
