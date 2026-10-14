/**
 * Тесты единой чистой функции расчёта зарплаты (src/utils/salaryCalc) и
 * доказательство идентичности прежнему инлайн-расчёту из SalaryModule.
 *
 * Запуск: npx tsx scripts/test-salary-calc.ts   (или npm run test:salary-calc)
 *
 * Данные: scripts/fixtures/salary-real-sample.json — снимок реальных записей
 * salaryHistory (выгрузка из базы без изменений; ФИО/госномера удалены).
 * Старая формула (legacyInlineTotals) — дословная копия инлайна из SalaryModule
 * до выноса в utils. Идентичность проверяется на каждой реальной записи:
 * все поля сравниваются через Object.is (бит-в-бит, без допусков).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeSalaryTotals,
  resolveCarRateFrom,
  deriveStoredRates,
  salaryNumber,
  pushKeyTime,
  salaryDateOnly,
  salaryEntryTime,
  compareByEntryTimeDesc,
} from '../src/utils/salaryCalc';

let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

interface FixtureRecord {
  key_index: number;
  datetime?: string;
  km?: number;
  rate?: number;
  idleDays?: number;
  totalDays?: number;
  bonus?: number;
  kmMoney?: number;
  idleMoney?: number;
  daysMoney?: number;
  totalSalary?: number;
  salaryPerDay?: number;
}

/** Показатели старого (инлайн) расчёта — дословно из SalaryModule до выноса. */
function legacyInlineTotals(i: {
  km: number | '';
  rate: number;
  idleDays: number;
  idleRate: number;
  totalDays: number;
  perDiem: number;
  bonus: number;
}): { kmMoney: number; idleMoney: number; daysMoney: number; totalSalary: number; salaryPerDay: number } {
  const totalKm = i.km;
  const ratePerKm = i.rate;
  const idleDays = i.idleDays;
  const currentIdleRate = i.idleRate;
  const totalDays = i.totalDays;
  const currentPerDiem = i.perDiem;
  const bonus = i.bonus;
  const kmMoney = (Number(totalKm) || 0) * ratePerKm;
  const idleMoney = idleDays * currentIdleRate;
  const daysMoney = totalDays * currentPerDiem;
  const totalSalary = kmMoney + idleMoney + daysMoney + bonus;
  const salaryPerDay = totalSalary / Math.max(totalDays, 1);
  return { kmMoney, idleMoney, daysMoney, totalSalary, salaryPerDay };
}

const fixturePath = fileURLToPath(new URL('./fixtures/salary-real-sample.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { count: number; records: FixtureRecord[] };
const records = fixture.records;
// Ставки портала на момент снятия: appSettings.idleRate=30, appSettings.perDiemRate=7.
const IDLE_RATE = 30;
const PER_DIEM = 7;

console.log(`Идентичность расчёта на реальных записях (${records.length} шт., снимок ${fixturePath.split('/').pop()})`);

const FIELDS = ['kmMoney', 'idleMoney', 'daysMoney', 'totalSalary', 'salaryPerDay'] as const;
let comparedFields = 0;
let mismatches = 0;
const mismatchExamples: string[] = [];
for (const r of records) {
  const input = {
    km: r.km ?? 0,
    rate: r.rate ?? 0,
    idleDays: r.idleDays ?? 0,
    idleRate: IDLE_RATE,
    totalDays: r.totalDays ?? 0,
    perDiem: PER_DIEM,
    bonus: r.bonus ?? 0,
  };
  const oldT = legacyInlineTotals(input);
  const newT = computeSalaryTotals(input);
  for (const f of FIELDS) {
    comparedFields += 1;
    if (!Object.is(oldT[f], newT[f])) {
      mismatches += 1;
      if (mismatchExamples.length < 5) {
        mismatchExamples.push(`rec#${r.key_index}.${f}: old=${oldT[f]} new=${newT[f]}`);
      }
    }
  }
}
check(
  `старая и новая реализация совпали бит-в-бит на ${records.length} записях × ${FIELDS.length} полей`,
  mismatches === 0 && records.length >= 30,
  `сравнений: ${comparedFields}, расхождений: ${mismatches}${mismatchExamples.length ? ' | ' + mismatchExamples.join('; ') : ''}`,
);

// Контрольная сверка с сохранёнными в записях начислениями: км × ставка и простой
// (суточные зависят от исторических ставок и менялись, поэтому у части записей не сходятся).
let kmOk = 0; let kmTotal = 0; let idleOk = 0; let idleTotal = 0; let sumOk = 0; let sumTotal = 0;
const sumExamples: string[] = [];
for (const r of records) {
  const t = computeSalaryTotals({
    km: r.km, rate: r.rate, idleDays: r.idleDays, idleRate: IDLE_RATE,
    totalDays: r.totalDays, perDiem: PER_DIEM, bonus: r.bonus,
  });
  if (typeof r.kmMoney === 'number') {
    kmTotal += 1;
    if (Object.is(t.kmMoney, r.kmMoney)) kmOk += 1;
  }
  if (typeof r.idleMoney === 'number') {
    idleTotal += 1;
    if (Object.is(t.idleMoney, r.idleMoney)) idleOk += 1;
  }
  // Сумма из СОХРАНЁННЫХ слагаемых — независимая проверка формулы totalSalary.
  if (typeof r.kmMoney === 'number' && typeof r.idleMoney === 'number' && typeof r.daysMoney === 'number' && typeof r.totalSalary === 'number') {
    sumTotal += 1;
    const storedSum = r.kmMoney + r.idleMoney + r.daysMoney + (r.bonus ?? 0);
    if (Object.is(storedSum, r.totalSalary)) sumOk += 1;
    else if (sumExamples.length < 3) {
      sumExamples.push(`rec#${r.key_index}: сохранённые слагаемые ${storedSum} ≠ сохранённый итог ${r.totalSalary}`);
    }
  }
}
console.log('  · контрольная сверка с сохранёнными начислениями (не влияет на идентичность):');
console.log(`    км×ставка: ${kmOk}/${kmTotal} записей совпало; простой: ${idleOk}/${idleTotal};`);
console.log(`    сохранённый итог = сумме сохранённых слагаемых: ${sumOk}/${sumTotal}${sumExamples.length ? ' | примеры расхождений (следы старого бага — итог не пересчитывался при правках): ' + sumExamples.join('; ') : ''}`);

console.log('\nГраничные значения (нет NaN, понятное состояние):');
{
  const t = computeSalaryTotals({ km: '', rate: 0.125, idleDays: '', idleRate: IDLE_RATE, totalDays: 10, perDiem: PER_DIEM, bonus: '' });
  check('пустые поля → нулевые слагаемые, без NaN', !Number.isNaN(t.totalSalary) && t.kmMoney === 0 && t.idleMoney === 0 && t.totalSalary === 70 && t.inputsValid, JSON.stringify(t));
}
{
  const t = computeSalaryTotals({});
  check('все входы undefined → нули, salaryPerDay=0 (делитель max(totalDays,1))', t.totalSalary === 0 && t.salaryPerDay === 0 && t.inputsValid === false, JSON.stringify(t));
}
{
  const t = computeSalaryTotals({ km: 'abc', rate: NaN, idleDays: undefined, totalDays: null, perDiem: 'x', bonus: {} });
  check('мусорные значения (NaN/строки/объект) → 0, без NaN', [t.kmMoney, t.idleMoney, t.daysMoney, t.totalSalary, t.salaryPerDay].every((v) => Number.isFinite(v)), JSON.stringify(t));
}
{
  const t = computeSalaryTotals({ km: 100, rate: 0.125, idleDays: 0, idleRate: 30, totalDays: 0, perDiem: 7, bonus: 0 });
  check('дни в рейсе = 0 → salaryPerDay делится на 1, inputsValid=false', t.totalSalary === 12.5 && t.salaryPerDay === 12.5 && !t.inputsValid, JSON.stringify(t));
}
{
  const t = computeSalaryTotals({ km: -500, rate: 0.125, idleDays: -1, idleRate: 30, totalDays: -2, perDiem: 7, bonus: -10 });
  check('отрицательные значения считаются, inputsValid=false (подсказка «проверьте значения»)', t.kmMoney === -62.5 && t.idleMoney === -30 && t.daysMoney === -14 && t.totalSalary === -116.5 && !t.inputsValid, JSON.stringify(t));
}
{
  const t = computeSalaryTotals({ km: 5500, rate: 0.125, idleDays: 0, idleRate: 30, totalDays: 30, perDiem: 7, bonus: 200 });
  check('дробная ставка точна копейка-в-копейку (5500×0.125=687.5)', t.kmMoney === 687.5 && t.totalSalary === 1097.5, JSON.stringify(t));
}

console.log('\nГраничные значения: старая vs новая на числовых входах (включая 0 и отрицательные):');
{
  const values = [0, -3, 0.5, 12.5, 1];
  let cmp = 0; let bad = 0;
  for (const km of values) for (const rate of [0, 0.125]) for (const days of values) for (const bonus of values) {
    const input = { km, rate, idleDays: days, idleRate: IDLE_RATE, totalDays: days, perDiem: PER_DIEM, bonus };
    const o = legacyInlineTotals(input);
    const n = computeSalaryTotals(input);
    cmp += 1;
    if (!(Object.is(o.kmMoney, n.kmMoney) && Object.is(o.idleMoney, n.idleMoney) && Object.is(o.daysMoney, n.daysMoney) && Object.is(o.totalSalary, n.totalSalary) && Object.is(o.salaryPerDay, n.salaryPerDay))) bad += 1;
  }
  check(`набор ${cmp} числовых комбинаций совпал полностью`, bad === 0, bad ? `расхождений: ${bad}` : '');
}

console.log('\nВосстановление ставок записи (deriveStoredRates):');
{
  const r = deriveStoredRates({ daysMoney: 210.6, totalDays: 27, idleMoney: 150, idleDays: 5 }, { perDiemRate: 7, idleRate: 30 });
  check('суточные из daysMoney/totalDays = 7.8 (историческая ставка записи)', r.perDiemRate === 7.8, String(r.perDiemRate));
  check('простой из idleMoney/idleDays = 30', r.idleRate === 30, String(r.idleRate));
}
{
  const r = deriveStoredRates({}, { perDiemRate: 7, idleRate: 30 });
  check('нет данных записи → ставки из настроек (7/30)', r.perDiemRate === 7 && r.idleRate === 30, JSON.stringify(r));
}
{
  const r = deriveStoredRates({ daysMoney: 0, totalDays: 30, idleMoney: -5, idleDays: 0 }, { perDiemRate: 7, idleRate: 30 });
  check('нулевые/отрицательные начисления → фолбэк на настройки, без NaN', r.perDiemRate === 7 && r.idleRate === 30, JSON.stringify(r));
}

console.log('\nСтавка за км (resolveCarRateFrom) — группы ставок, затем прямое значение:');
{
  const groups = [
    { id: 'c2', key: 'c2', name: 'Группа 0.125', rate: 0.125 },
    { id: 'dir_9', key: 'dir_9', rate: '0.145', perDiemRate: 8 },
  ];
  const g = resolveCarRateFrom({ rateGroupId: 'c2' }, groups);
  check('rateGroupId → ставка группы (0.125), без carsPool', !!g && g.rate === 0.125 && g.perDiemRate === undefined, JSON.stringify(g));
  const g2 = resolveCarRateFrom({ rateGroupId: 'dir_9' }, groups);
  check('группа со суточными → perDiemRate=8', !!g2 && g2.rate === 0.145 && g2.perDiemRate === 8, JSON.stringify(g2));
  const g3 = resolveCarRateFrom({ rateGroupId: 'missing', rate: 0.15 }, groups);
  check('группы нет → фолбэк на прямое значение записи (0.15)', !!g3 && g3.rate === 0.15, JSON.stringify(g3));
  const g4 = resolveCarRateFrom({ rate: 0.14 }, groups);
  check('без rateGroupId → прямое значение (0.14)', !!g4 && g4.rate === 0.14, JSON.stringify(g4));
  const g5 = resolveCarRateFrom({ rateGroupId: 'zero_group', rate: 0.13 }, [{ id: 'zero_group', rate: 0 }]);
  check('нулевая ставка группы → фолбэк на прямое значение (0.13)', !!g5 && g5.rate === 0.13, JSON.stringify(g5));
  const g6 = resolveCarRateFrom({}, groups);
  check('нет ни группы, ни ставки → null (поле не трогаем)', g6 === null, JSON.stringify(g6));
  const g7 = resolveCarRateFrom(null, groups);
  check('пустой источник → null', g7 === null, String(g7));
}

console.log('\nsalaryNumber:');
{
  check('пусто/undefined/NaN → 0', salaryNumber('') === 0 && salaryNumber(undefined) === 0 && salaryNumber(NaN) === 0 && salaryNumber('12.5') === 12.5, '');
}

// ── Порядок журнала/статистики: «по времени внесения записи, последние сверху» ──
// Ключи взяты из реальной базы: push-ключ несёт время создания записи в мс.
console.log('\nВремя внесения записи (порядок журнала выплат)');
{
  const oct = '-P3uLjnwiaTCNblprfye'; // внесена 14.10.2026
  const jul = '-OwRy6MIGXHuHJFGxTQ1'; // внесена 01.07.2026
  check('push-ключ декодируется в правдоподобное время', pushKeyTime(oct) > 1_700_000_000_000, String(pushKeyTime(oct)));
  check('ключ новой записи позже ключа старой', pushKeyTime(oct) > pushKeyTime(jul), `${pushKeyTime(oct)} > ${pushKeyTime(jul)}`);
  check('не-push ключи времени не дают', pushKeyTime('manual_1') === 0 && pushKeyTime('') === 0 && pushKeyTime('-Ot') === 0);
  check('дата разбирается в обоих форматах (ДД.ММ.ГГГГ и ДД/ММ/ГГГГ)', salaryDateOnly('14/10/2026') === salaryDateOnly('14.10.2026') && salaryDateOnly('14/10/2026') > 0);
  check('мусор и пусто → 0, без NaN', salaryDateOnly('не дата') === 0 && salaryEntryTime({ datetime: '' }) === 0 && Number.isFinite(salaryEntryTime({ datetime: 'abc' })));
  check('запись без ключа: время берётся из createdAt/savedAt', salaryEntryTime({ createdAt: '2026-10-14T05:00:00.000Z' }) > 0 && salaryEntryTime({ savedAt: '2026-10-14T05:00:00.000Z' }) > 0);
  check('запись без ключа и без createdAt: берётся дата выплаты', salaryEntryTime({ datetime: '14/10/2026' }) === salaryDateOnly('14/10/2026'));
  check('сортировка: внесённая позже — выше', compareByEntryTimeDesc({ storageKey: jul }, { storageKey: oct }) > 0 && compareByEntryTimeDesc({ storageKey: oct }, { storageKey: jul }) < 0);
  check(
    'свежая запись со «старой» датой выплаты стоит ВЫШЕ старой записи (корень жалобы)',
    compareByEntryTimeDesc({ storageKey: oct, datetime: '01/05/2026' }, { storageKey: jul, datetime: '14/10/2026' }) < 0,
  );
  check('порядок не зависит от даты выплаты: только от времени внесения', (() => {
    const list = [
      { storageKey: jul, datetime: '14/10/2026' },
      { storageKey: oct, datetime: '01/05/2026' },
    ].sort(compareByEntryTimeDesc);
    return list[0].storageKey === oct && list[1].storageKey === jul;
  })());
  check('обе записи без времени — порядок детерминирован (по ключу)', compareByEntryTimeDesc({ id: 'aaaa' }, { id: 'bbbb' }) > 0);
}

if (failed > 0) {
  console.error(`\nПровалено проверок: ${failed}`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
