/**
 * Тесты СОГЛАСОВАННОСТИ направления между «Таймлайном рейсов» и «Планом
 * дохода» (единый справочник, каноническое значение, связь по стабильному id):
 *
 *  1. «Таймлайн рейсов» и переключатель используют ОДИН справочник
 *     `directories/directions`: идентификаторы/названия/коды/порядок записей
 *     совпадают (встроенная пара — фолбэк пустого справочника);
 *  2. список меток/фильтра таймлайна строится из того же справочника
 *     (ветка tripDirections — только исторический цвет по названию);
 *  3. определение направления рейса понимает и каноническое название, и старый
 *     код («TR»/«CN»), и не выдумывает направление при пустом значении;
 *  4. чтение «Плана дохода»: сохранённое значение приводится к названию
 *     справочника (старые коды видны как «Турция»/«Китай», запись не меняется);
 *  5. правило записи пары «рейс таймлайна (`pd:<id>`) ↔ запись
 *     `trips_dashboard/<id>`»: пишется ровно поле direction и только при
 *     реальном расхождении (циклов и лишних записей нет).
 *
 * Запуск: npx tsx scripts/test-direction-sync.ts  (npm run test:direction-sync)
 */
import {
  BUILTIN_DIRECTIONS,
  directionLabelOf,
  directionOptionsFromDb,
  directionStoreValue,
  directionWriteValue,
  type DirectionOption,
} from '../src/components/modules/tripTimeline/lib/directionCatalog';
import {
  DEFAULT_DIRECTIONS,
  directionOfTrip,
  mergeDirections,
} from '../src/components/modules/tripTimeline/lib/directions';
import type { WholeTrip } from '../src/components/modules/tripTimeline/lib/sources';

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

/** Живые записи справочника «Плана дохода» `directories/directions`. */
const DB_ROWS: Array<Record<string, unknown>> = [
  { active: true, code: 'TR', coeff: 0.67, dbKey: 'dir_1785086661221', id: '_1785086661221', label: 'Турция', name: 'Турция' },
  { active: true, code: 'CN', coeff: 0.55, dbKey: 'dir_1785086675491', id: 'dir_1785086675491', label: 'Китай', name: 'Китай' },
];

/** Мини-рейс таймлайна: directionOfTrip использует только эти поля. */
const tripStub = (f: { direction?: string; planDirection?: string; route?: string }): WholeTrip =>
  ({
    direction: f.direction,
    plan: f.planDirection ? { direction: f.planDirection } : undefined,
    route: f.route || '',
  }) as unknown as WholeTrip;

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Единый справочник: встроенная пара и записи directories/directions');
{
  check(
    'встроенная пара списка таймлайна = пара переключателя (названия/коды/ids)',
    DEFAULT_DIRECTIONS.map((d) => `${d.id}:${d.name}:${d.code}`).join(',') ===
      BUILTIN_DIRECTIONS.map((d) => `${d.id}:${d.name}:${d.code}`).join(','),
  );
  check('порядок пары — Турция (1), Китай (2), как у «Плана дохода»', DEFAULT_DIRECTIONS[0].name === 'Турция' && DEFAULT_DIRECTIONS[1].name === 'Китай');
  const merged = mergeDirections(DB_ROWS);
  check('справочник → тот же состав: 2 направления', merged.length === 2);
  check(
    'идентификаторы — из записей справочника (обе стороны видят одни id)',
    merged[0].id === '_1785086661221' && merged[1].id === 'dir_1785086675491',
  );
  check('названия/коды — из справочника', merged[0].name === 'Турция' && merged[0].code === 'TR' && merged[1].name === 'Китай' && merged[1].code === 'CN');
  check('порядок меток = порядок справочника (Турция, Китай)', merged[0].name === 'Турция' && merged[1].name === 'Китай');
  check('цвета исторической палитры сохранены (Турция/Китай)', merged[0].color === '#4FA3A5' && merged[1].color === '#5E7BB6');
  check('встроенная пара помечена builtin (та же пара, что у переключателя)', merged.every((d) => d.builtin === true));
  check('пустой справочник → встроенная пара (фолбэк и у меток)', mergeDirections([]).map((d) => d.code).join(',') === 'TR,CN');
  const withColors = mergeDirections(DB_ROWS, [{ name: 'Турция', color: '#123456' }]);
  check('tripDirections перекрывает ТОЛЬКО цвет (список — из directions)', withColors[0].color === '#123456' && withColors[0].id === '_1785086661221' && withColors.length === 2);
  check(
    'идентификаторы переключателя и меток совпадают',
    directionOptionsFromDb(DB_ROWS).map((d) => d.id).join(',') === merged.map((d) => d.id).join(','),
  );
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Определение направления рейса (метки/фильтр/окно)');
{
  const dirs = mergeDirections(DB_ROWS);
  check('каноническое название: «Турция» → Турция', directionOfTrip(tripStub({ direction: 'Турция' }), dirs)?.name === 'Турция');
  check('старый код: «TR» → Турция', directionOfTrip(tripStub({ direction: 'TR' }), dirs)?.name === 'Турция');
  check('старый код из плана: «CN» → Китай', directionOfTrip(tripStub({ planDirection: 'CN' }), dirs)?.name === 'Китай');
  check('пустое значение → null (направление не выдумываем)', directionOfTrip(tripStub({}), dirs) === null);
  check('посторонний текст (Монголия) → null, а не «угаданное»', directionOfTrip(tripStub({ direction: 'Монголия' }), dirs) === null);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Чтение «Плана дохода»: сохранённое значение → название справочника');
{
  const opts: DirectionOption[] = directionOptionsFromDb(DB_ROWS);
  check('«TR» из записи таймлайна показывается как «Турция»', directionLabelOf(opts, 'TR') === 'Турция');
  check('«CN» из записи таймлайна показывается как «Китай»', directionLabelOf(opts, 'CN') === 'Китай');
  check('название остаётся названием', directionLabelOf(opts, 'Турция') === 'Турция');
  check('пусто → пусто (вкладка/список покажут «—»)', directionLabelOf(opts, '') === '');
  check('неизвестный текст остаётся собой', directionLabelOf(opts, 'Монголия') === 'Монголия');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Пара «рейс таймлайна (`pd:<id>`) ↔ запись trips_dashboard/<id>`»: правило записи');
{
  const opts = directionOptionsFromDb(DB_ROWS);
  const rows: Array<{ stored: string; desired: string; write: boolean; value: string | null; note: string }> = [
    { stored: 'Турция', desired: 'TR', write: false, value: null, note: 'то же направление (название ↔ код) — записи нет' },
    { stored: 'TR', desired: 'Турция', write: false, value: null, note: 'то же направление в обратную сторону — записи нет' },
    { stored: 'CN', desired: 'CN', write: false, value: null, note: 'повторный выбор того же кода — записи нет' },
    { stored: 'TR', desired: 'CN', write: true, value: 'Китай', note: 'смена: уходит НАЗВАНИЕ, а не код' },
    { stored: 'Китай', desired: 'TR', write: true, value: 'Турция', note: 'смена из названия в название' },
    { stored: '', desired: 'TR', write: true, value: 'Турция', note: 'пусто → выбираем направление' },
    { stored: 'Турция', desired: '', write: true, value: null, note: 'снятие выбора → поле очищается' },
    { stored: 'Монголия', desired: 'CN', write: true, value: 'Китай', note: 'постороннее значение заменяется выбранным' },
  ];
  rows.forEach((r) => {
    const d = directionWriteValue(r.stored, r.desired, opts);
    check(`${r.note}`, d.write === r.write && d.value === r.value, { got: d });
  });
  check('значение записи всегда каноническое (название), коды не пишутся', directionWriteValue('', 'TR', opts).value === 'Турция' && directionStoreValue(opts, 'CN') === 'Китай');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
