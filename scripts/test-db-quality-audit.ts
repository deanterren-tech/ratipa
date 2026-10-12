/**
 * test-db-quality-audit — юнит-проверки детекторов scripts/db-quality-core.ts.
 *
 * Запуск:
 *   npx tsx scripts/test-db-quality-audit.ts                 # текст + JSON-сводка
 *   npx tsx scripts/test-db-quality-audit.ts --out=DIR       # свой каталог сводки
 *
 * Сводка (число проверок и провалов) пишется в <out>/unit-tests.latest.json —
 * её читает scripts/audit-db-quality.ts и включает в отчёт.
 * Код выхода: 0 — все проверки прошли, 1 — есть провалы.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ageDays,
  classifyPlatePair,
  dateIssues,
  dupGroups,
  endBeforeStart,
  foldPlate,
  hasSpaceNoise,
  isTestPlate,
  letterMix,
  looksJunk,
  normText,
  numIssues,
  numericString,
  parseLooseDate,
  personKeyRu,
  plateInfo,
  twinGroups,
} from './db-quality-core.ts';

const ARGS = process.argv.slice(2);
const argOf = (n: string): string | null => { const h = ARGS.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : null; };
const OUT_DIR = argOf('out') || '/Users/sergei/.hermes/cache/scratch/dbclean';

let checks = 0;
let failed = 0;
const failures: string[] = [];
const ok = (cond: boolean, name: string): void => {
  checks += 1;
  if (!cond) { failed += 1; failures.push(name); }
};
const eq = <T>(actual: T, expected: T, name: string): void => {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${name} (получено ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)})`);
};

// ── 1. Буквы: кир/лат/смешение ──────────────────────────────────────────────
// Явные esc: кириллические А О В Х Е С — чтобы тест не зависел от раскладки ввода.
const A = '\u0410'; const O = '\u041E'; const V = '\u0412'; const X = '\u0425'; const E = '\u0415';
const AO = A + O; // «АО» кириллицей
eq(letterMix(`${AO} 3921-7`).kind, 'cyr', 'letterMix: кириллица');
eq(letterMix('AO 3921-7').kind, 'lat', 'letterMix: латиница');
eq(letterMix(`${A}O 3921-7`).kind, 'mixed', 'letterMix: А(кир)+O(лат) = mixed');
eq(letterMix('1234-56').kind, 'none', 'letterMix: только цифры');
eq(letterMix(`${AO}39217 / A3981B7`).kind, 'mixed', 'letterMix: полный номер со слэшем');

// ── 2. Разбор номера ────────────────────────────────────────────────────────
const p1 = plateInfo('AO 2029-7');
ok(!p1.issues.includes('mixed-script'), 'plateInfo: чистый латинский номер без mixed');
ok(p1.issues.includes('latin-only-suspect'), 'plateInfo: латинский номер помечен suspect');
eq(p1.tractorKey, 'AO20297', 'plateInfo: tractorKey скелет');

const p2 = plateInfo(`${AO} 3921-7 / ${A} 3981 ${V}-7`);
eq(p2.tractorKey, 'AO39217', 'plateInfo: tractorKey первой части');
ok(!p2.issues.includes('mixed-script'), 'plateInfo: полностью кириллический номер не mixed');

const p3 = plateInfo('  AP 8340-7 ');
ok(p3.issues.includes('edge-space'), 'plateInfo: краевые пробелы');
eq(p3.skeleton, 'AP83407', 'plateInfo: скелет с фолдингом');

const p4 = plateInfo('671');
ok(p4.issues.includes('digits-only'), 'plateInfo: только цифры 671');
ok(p4.issues.includes('too-short'), 'plateInfo: 671 короткий');

const p5 = plateInfo(`1) ${AO}0246-7/${A}1635${E}-7`);
ok(p5.issues.includes('numbered-prefix'), 'plateInfo: ведущий «1) »');
eq(p5.tractorKey, 'AO02467', 'plateInfo: tractorKey после «1) » (склейка не мешает скелету)');

const p6 = plateInfo(`${A}${X} 4065 31`);
ok(!p6.issues.includes('mixed-script'), 'plateInfo: пробел вместо дефиса — не mixed');
eq(p6.skeleton, 'AX406531', 'plateInfo: скелет без разделителей');

const p7 = plateInfo(`${X}671${O}${V}31 / ${V}${A}832931`);
ok(!p7.issues.includes('mixed-script') && p7.letters.cyr === 5 && p7.letters.lat === 0, 'plateInfo: 5 кириллических букв в паре номеров');
eq(p7.skeleton, 'X671OB31BA832931', 'plateInfo: скелет пары');

// ── 3. Пары-«близнецы» ──────────────────────────────────────────────────────
eq(classifyPlatePair(`${AO} 3921-7`, 'AO 3921-7'), 'script', 'pair: АО кир vs AO лат = script');
eq(classifyPlatePair(`${AO} 3921-7`, `${AO}39217`), 'spacing', 'pair: с пробелами vs без = spacing');
eq(classifyPlatePair('\u0430\u043E 3921-7', `${AO} 3921-7`), 'case', 'pair: регистр = case');
eq(classifyPlatePair(`${AO}  3921-7`, `${AO} 3921-7`), 'spacing', 'pair: двойной пробел = spacing');
eq(classifyPlatePair(`${A}${V} 9271-7`, `${AO} 9271-7`), null, 'pair: разные номера = null');
eq(classifyPlatePair(`${AO} 3921-7`, `${AO} 3921-7`), null, 'pair: идентичные = null');
eq(classifyPlatePair(`${A}${X} 4065 31`, 'AX406531'), 'script', 'pair: кир + пробелы vs лат слитно = script');

const tg = twinGroups([
  { key: 'a', value: `${AO} 3921-7` },
  { key: 'b', value: 'AO39217' },
  { key: 'c', value: `${V}${V} 0000-1` },
]);
eq(tg.length, 1, 'twinGroups: одна группа из трёх значений');
eq(tg[0].kind, 'script', 'twinGroups: вид группы script');
eq(tg[0].variants, ['AO39217', `${AO} 3921-7`].sort(), 'twinGroups: варианты');
eq(twinGroups([{ key: 'x', value: `${A}Б 1111-1` }, { key: 'y', value: `${V}Г 2222-2` }]).length, 0, 'twinGroups: разные номера — пусто');

// ── 4. Мусор прошлых прогонов ───────────────────────────────────────────────
ok(looksJunk(['probe-123']).length > 0, 'junk: probe-123');
ok(looksJunk(['qa_run7']).length > 0, 'junk: qa_run7');
ok(looksJunk(['тест записи']).length > 0, 'junk: «тест»');
ok(looksJunk(['test-data']).length > 0, 'junk: test-data');
ok(looksJunk(['tmp_x']).length > 0, 'junk: tmp_x');
ok(looksJunk(['latest-recalc']).length === 0, 'junk: «latest» не мусор');
ok(looksJunk(['kosteль']).length === 0, 'junk: обычное слово не мусор');
ok(isTestPlate('AA1234BB'), 'junk: AA1234BB — тестовый номер');
ok(isTestPlate('hh4567kk'.toUpperCase()), 'junk: HH4567KK — тестовый номер');
ok(!isTestPlate('АО 3921-7'), 'junk: реальный номер не тестовый');

// ── 5. Числа ────────────────────────────────────────────────────────────────
eq(numIssues('km', -5).length, 1, 'num: отрицательное');
eq(numIssues('km', -5)[0].kind, 'negative', 'num: вид negative');
eq(numIssues('km', 70000, { max: 60000 }).length, 1, 'num: выше max');
eq(numIssues('km', 70000, { max: 60000 })[0].kind, 'absurd', 'num: вид absurd');
eq(numIssues('days', '14').length, 1, 'num: число строкой');
eq(numIssues('days', '14')[0].kind, 'numeric-string', 'num: вид numeric-string');
eq(numIssues('days', 'четырнадцать').length, 1, 'num: не число');
eq(numIssues('profit', -124, { allowNegative: true }).length, 0, 'num: отрицательный profit разрешён');
eq(numIssues('x', '').length, 0, 'num: пусто — не шумим');
eq(numIssues('x', '', { required: true }).length, 1, 'num: пусто обязательное — сигнал');
eq(numIssues('x', 0).length, 0, 'num: ноль корректен');
ok(numericString('1 250,50'), 'num: «1 250,50» — число строкой');
ok(!numericString('12abc'), 'num: «12abc» — не число');
ok(numericString('-3.5'), 'num: «-3.5» — число строкой');

// ── 6. Даты ─────────────────────────────────────────────────────────────────
eq(parseLooseDate('2026-10-13')!.iso, '2026-10-13', 'date: ISO');
eq(parseLooseDate('13.10.2026')!.iso, '2026-10-13', 'date: DD.MM.YYYY');
eq(parseLooseDate('31.02.2026'), null, 'date: несуществующая дата');
eq(parseLooseDate(''), null, 'date: пусто');
eq(dateIssues('d', '', { todayDay: 20000 }).length, 0, 'date: пусто необязательное — тихо');
eq(dateIssues('d', '', { todayDay: 20000, required: true })[0].kind, 'missing', 'date: пусто обязательное — missing');
eq(dateIssues('d', '2026-13-01', { todayDay: 20000 })[0].kind, 'bad-format', 'date: битый месяц');
eq(dateIssues('d', '01/01/2500', { todayDay: 20000 })[0].kind, 'far-future', 'date: далёкое будущее');
eq(dateIssues('d', '01.01.1990', { todayDay: 20000 })[0].kind, 'far-past', 'date: далёкое прошлое');
ok(endBeforeStart('2026-08-10', '2026-07-01'), 'date: конец раньше начала');
ok(!endBeforeStart('2026-07-01', '2026-08-10'), 'date: нормальный интервал');
ok(!endBeforeStart('2026-07-01', ''), 'date: пустой конец — не ошибка');
const age = ageDays('2026-07-01', parseLooseDate('2026-10-13')!.day);
eq(age, 104, 'date: возраст в днях');

// ── 7. Дубли ────────────────────────────────────────────────────────────────
const dg = dupGroups(
  [{ id: 'a', k: 'x' }, { id: 'b', k: 'x' }, { id: 'c', k: 'y' }],
  (t) => t.k,
);
eq(dg.length, 1, 'dupGroups: одна группа');
eq(dg[0].items.map((i) => i.id).sort(), ['a', 'b'], 'dupGroups: состав');
eq(dupGroups([{ k: '' }, { k: '' }], (t) => t.k).length, 0, 'dupGroups: пустые ключи игнорируются');

// ── 8. Тексты ───────────────────────────────────────────────────────────────
ok(hasSpaceNoise('АО  3921'), 'text: двойной пробел');
ok(hasSpaceNoise(' АО 3921'), 'text: краевой пробел');
ok(!hasSpaceNoise('АО 3921-7'), 'text: норма');
ok(normText('АО  3921-7') === 'ао 3921-7', 'text: normText схлопывает пробелы');
ok(personKeyRu('Тычко  В.В.') === personKeyRu('тычко в в') || personKeyRu('Тычко В.В.') === 'тычко в в', 'text: personKeyRu');
eq(personKeyRu('Тычко В.В.'), 'тычко в в', 'text: personKeyRu скобки/точки');

// ── 9. Скелеты машин ────────────────────────────────────────────────────────
eq(foldPlate('АВ 9271-7 / A 2416 E-7'), 'AB92717A2416E7', 'fold: склейка пары');
eq(foldPlate(String('АО 3921-7 / А 3981 В-7').split('/')[0]), 'AO39217', 'fold: так же собирает ключ машины, как vehicleKey');
eq(foldPlate('АО 3921-7'), foldPlate('AO 3921-7'), 'fold: кир и лат дают один скелет');

// ── Сводка ──────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const summary = {
  script: 'scripts/test-db-quality-audit.ts',
  takenAt: new Date().toISOString(),
  checks,
  failed,
  failures,
};
writeFileSync(join(OUT_DIR, 'unit-tests.latest.json'), JSON.stringify(summary, null, 1) + '\n');

if (failed === 0) {
  console.log(`[test-db-quality-audit] OK: все ${checks} проверок прошли. Сводка: ${join(OUT_DIR, 'unit-tests.latest.json')}`);
} else {
  console.log(`[test-db-quality-audit] ПРОВАЛЫ: ${failed} из ${checks}.`);
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}
console.log(`CHECKS=${checks} FAILED=${failed}`);
process.exit(failed === 0 ? 0 : 1);
