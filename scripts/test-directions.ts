/**
 * Тесты УПРОЩЁННОГО направления рейса (lib/directionCatalog) — переключатель
 * «Турция / Китай», одно значение-код «TR»/«CN», маппинг старых записей:
 *
 *  1. справочник Настроек `directories/directions` → варианты переключателя
 *     (id/code/name/order/active; coeff/id/dbKey/label существующих записей);
 *  2. НИКАКИХ ставок/средних дней/пересчётов — в модуле их просто нет
 *     (проверяем, что список вариантов несёт только минимальные поля);
 *  3. маппинг «Китай/Турция → CN/TR» И обратно для отображения (фолбэк);
 *  4. выбор варианта по сохранённому значению (код или старое название);
 *  5. эффективный список: справочник, при пустом — встроенная пара TR/CN.
 *
 * Запуск: npx tsx scripts/test-directions.ts  (или npm run test:directions)
 */
import {
  BUILTIN_DIRECTIONS,
  activeDirectionOptions,
  directionLabelOf,
  directionOptionOf,
  directionOptionsFromDb,
  directionStoreValue,
  directionWriteValue,
  effectiveDirectionOptions,
  normalizeDirectionCode,
  normalizeTripDirection,
  sameTripDirection,
} from '../src/components/modules/tripTimeline/lib/directionCatalog';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra: unknown = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra !== '' ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
};

// Реальные записи directories/directions (после упрощения: короткий код TR/CN,
// coeff/id/dbKey/label не тронуты; ставок/дней в задаче больше нет).
const DB_ROWS: Array<Record<string, unknown>> = [
  {
    coeff: 0.67,
    dbKey: 'dir_1785086661221',
    id: '_1785086661221',
    label: 'Турция',
    code: 'TR',
    name: 'Турция',
    active: true,
  },
  {
    coeff: 0.55,
    dbKey: 'dir_1785086675491',
    id: 'dir_1785086675491',
    label: 'Китай',
    code: 'CN',
    name: 'Китай',
    active: true,
  },
];

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Справочник → варианты переключателя (минимальный набор полей)');
{
  const opts = directionOptionsFromDb(DB_ROWS);
  check('обе записи на месте', opts.length === 2);
  const tur = opts.find((d) => d.code === 'TR');
  const chn = opts.find((d) => d.code === 'CN');
  check('Турция: id/dbKey сохранены', tur?.id === '_1785086661221');
  check('Китай: id сохранён', chn?.id === 'dir_1785086675491');
  check('сортировка: Турция (TR) первая, Китай (CN) — второй', opts[0].name === 'Турция' && opts[1].name === 'Китай');
  check(
    'в варианте ТОЛЬКО минимальные поля (никаких ставок/дней)',
    !!tur && !('plannedRate' in tur) && !('plannedDays' in tur) && !('plannedCosts' in tur) && !('bufferDays' in tur),
  );
  check('active по умолчанию true при отсутствии поля', directionOptionsFromDb([{ id: 'x', name: 'X', code: 'XX' }])[0].active === true);
  check('active: false читается', directionOptionsFromDb([{ id: 'x', name: 'X', code: 'XX', active: false }])[0].active === false);
  check('код нормализуется (нижний регистр → верхний)', directionOptionsFromDb([{ id: 'x', name: 'X', code: ' lt ' }])[0].code === 'LT');
  check('без code — первые две буквы названия', directionOptionsFromDb([{ id: 'x', name: 'Литва' }])[0].code === 'ЛИ');
  check('битый ввод не падает', directionOptionsFromDb(null).length === 0 && directionOptionsFromDb([null as never]).length === 0);
  check('неактивные отсеиваются списком', activeDirectionOptions(directionOptionsFromDb([...DB_ROWS, { id: 'off', name: 'Грузия', code: 'GE', active: false }])).length === 2);
  check('пустой справочник → встроенная пара Турция/Китай', effectiveDirectionOptions([]).map((d) => d.code).join(',') === 'TR,CN');
  check('непустой справочник → как есть', effectiveDirectionOptions(directionOptionsFromDb(DB_ROWS)).length === 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Значение рейса: «Китай/Турция → CN/TR» (старые записи) и коды');
{
  check('«Китай» → CN (старая запись)', normalizeTripDirection('Китай') === 'CN');
  check('«Турция» → TR (старая запись)', normalizeTripDirection('Турция') === 'TR');
  check('регистр не важен: «китай»', normalizeTripDirection('китай') === 'CN');
  check('пробелы убираются: « Турция »', normalizeTripDirection(' Турция ') === 'TR');
  check('код «CN» остаётся CN', normalizeTripDirection('CN') === 'CN');
  check('строчный код «tr» → TR', normalizeTripDirection('tr') === 'TR');
  check('пустое значение → пусто (не выдумываем)', normalizeTripDirection('') === '' && normalizeTripDirection(null) === '');
  check('незнакомое название → пусто (не выдумываем)', normalizeTripDirection('Монголия') === '');
  check('короткий латинский код без записи в справочнике сохраняется', normalizeTripDirection('LT') === 'LT');
  const opts = directionOptionsFromDb(DB_ROWS);
  check('название из справочника → его код («Литва» с вариантом)', normalizeTripDirection('Литва', [...opts, { id: 'lt', code: 'LT', name: 'Литва', order: 9, active: true }]) === 'LT');
  check('старый текст с уточнением («Китай (раунд 2)») → CN', normalizeTripDirection('Китай (раунд 2)') === 'CN');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Обратный маппинг для отображения (подпись значения)');
{
  const opts = directionOptionsFromDb(DB_ROWS);
  check('«CN» → Китай', directionLabelOf(opts, 'CN') === 'Китай');
  check('«Китай» (старое) → Китай', directionLabelOf(opts, 'Китай') === 'Китай');
  check('«TR» → Турция', directionLabelOf(opts, 'TR') === 'Турция');
  check('«Турция» (старое) → Турция', directionLabelOf(opts, 'Турция') === 'Турция');
  check('код без справочника → фолбэк-название', directionLabelOf([], 'CN') === 'Китай' && directionLabelOf(null, 'TR') === 'Турция');
  check('неизвестный текст остаётся собой', directionLabelOf(opts, 'Монголия') === 'Монголия');
  check('пусто → пусто', directionLabelOf(opts, '') === '');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Вариант по сохранённому значению (код или старое название)');
{
  const opts = directionOptionsFromDb(DB_ROWS);
  check('по коду CN', directionOptionOf(opts, 'CN')?.name === 'Китай');
  check('по старому тексту «Турция»', directionOptionOf(opts, 'Турция')?.code === 'TR');
  check('по нормализованному коду «cn»', directionOptionOf(opts, 'cn')?.id === 'dir_1785086675491');
  check('нет варианта — null', directionOptionOf(opts, 'Монголия') === null);
  check('пусто — null', directionOptionOf(opts, '') === null);
  check('встроенный фолбэк работает без справочника', directionOptionOf([], 'TR')?.name === 'Турция');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. Нормализация кода и встроенная пара');
{
  check('normalizeDirectionCode: регистр/пробелы/тире', normalizeDirectionCode(' by–lt ') === 'BY-LT');
  check('встроенная пара — Турция TR, Китай CN', BUILTIN_DIRECTIONS.map((d) => `${d.name}:${d.code}`).join(',') === 'Турция:TR,Китай:CN');
  check('встроенная пара активна', BUILTIN_DIRECTIONS.every((d) => d.active));
}

// ────────────────────────────────────────────────────────────────────────────
// Каноническое значение поля direction записи — НАЗВАНИЕ из справочника. Оба
// модуля («План дохода» и «Таймлайн рейсов») пишут и читают его; коды «TR»/«CN»
// остаются совместимым форматом. Здесь — защита от лишних записей (нет циклов).
console.log('6. Каноническое значение записи и защита от повторных записей');
{
  const opts = directionOptionsFromDb(DB_ROWS);
  check('код → название: «TR» → «Турция»', directionStoreValue(opts, 'TR') === 'Турция');
  check('код → название: «CN» → «Китай»', directionStoreValue(opts, 'CN') === 'Китай');
  check('название остаётся названием', directionStoreValue(opts, 'Китай') === 'Китай');
  check('пусто → пусто (значение не выдумываем)', directionStoreValue(opts, '') === '' && directionStoreValue(opts, null) === '');
  check('неизвестный текст сохраняется как есть', directionStoreValue(opts, 'Монголия') === 'Монголия');
  check('без справочника код всё равно приводится (встроенный фолбэк)', directionStoreValue([], 'CN') === 'Китай');
  check('«TR» и «Турция» — ОДНО направление', sameTripDirection('TR', 'Турция', opts));
  check('«CN» и «Турция» — разные направления', !sameTripDirection('CN', 'Турция', opts));
  check('регистр и пробелы не значимы: « Турция » == «tr»', sameTripDirection(' Турция ', 'tr', opts));
  check('пусто и пусто — совпадают', sameTripDirection('', null, opts));
  check('пусто и «Монголия» — расходятся', !sameTripDirection('', 'Монголия', opts));
  const equal = directionWriteValue('TR', 'Турция', opts);
  check('было «TR», выбрали «Турция» — записи НЕТ (цикл не запускается)', equal.write === false && equal.value === null);
  const legacySame = directionWriteValue('CN', 'cn', opts);
  check('регистр не создаёт ложного изменения — записи НЕТ', legacySame.write === false);
  const changed = directionWriteValue('Турция', 'Китай', opts);
  check('смена направления → точечное значение-название', changed.write === true && changed.value === 'Китай');
  const cleared = directionWriteValue('Турция', '', opts);
  check('очистка направления → null (поле записи очищается)', cleared.write === true && cleared.value === null);
  const fromCode = directionWriteValue('türkiye-ish', 'TR', opts);
  check('постороннее значение заменяется выбранным названием', fromCode.write === true && fromCode.value === 'Турция');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
