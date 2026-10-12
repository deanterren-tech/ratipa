/**
 * Тесты шаблонов этапов (lib/stageTemplates) — ветка `stageTemplates`:
 *
 *  1. чтение ветки базы (stages[] — упорядоченный список НАЗВАНИЙ, без мест/дат);
 *  2. эффективный список: база, при пустой ветке — стартовые «Турция»/«Китай»
 *     (по факту реальных рейсов: Китай — Загрузка → Граница → Растаможка (импорт)
 *     → Выгрузка; Турция — + Затаможка (экспорт) перед Границей);
 *  3. шаблон по направлению (Турция/Китай);
 *  4. применение: пустой рейс — seq 1..N, место/даты ПУСТЫЕ;
 *     «Добавить в конец» — seq от max+1, существующие не меняются;
 *     «Заменить пустые» — внесённые даты/места НЕ затираются, перенумерация 1..N;
 *  5. несопоставленное название сохраняется в «Место» (тип «Другое»);
 *  6. правки шаблона: порядок/добавить/удалить/переименовать.
 *
 * Запуск: npx tsx scripts/test-stage-templates.ts (или npm run test:stage-templates)
 */
import type { TimelineStage, TimelineStageType } from '../src/types';
import {
  DEFAULT_STAGE_TEMPLATES,
  addTemplateStage,
  applyStageTemplate,
  effectiveStageTemplates,
  moveTemplateStage,
  newTemplateId,
  removeTemplateStage,
  renameTemplateStage,
  resolveStageTypeByName,
  stageHasContent,
  stageTemplatesFromDb,
  templateForDirection,
} from '../src/components/modules/tripTimeline/lib/stageTemplates';

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

const stageTypes: TimelineStageType[] = [
  { key: 'load', name: 'Загрузка', order: 1 },
  { key: 'cust_out', name: 'Затаможка (экспорт)', order: 2 },
  { key: 'border', name: 'Граница', order: 3, bufferDays: 2 },
  { key: 'cust_in', name: 'Растаможка (импорт)', order: 4 },
  { key: 'unl', name: 'Выгрузка', order: 6 },
  { key: 'other', name: 'Другое', order: 7 },
];

let seq = 0;
const makeId = (): string => `s_test_${++seq}`;

const stage = (over: Partial<TimelineStage>): TimelineStage => ({
  id: over.id || `s_${Math.random().toString(36).slice(2, 8)}`,
  type: 'other',
  label: '',
  plannedDate: '',
  actualDate: '',
  isCritical: false,
  order: 1,
  seq: 1,
  bufferDays: 0,
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Ветка базы → шаблоны (названия читаются как есть)');
{
  const db = {
    tpl_turkey: { id: 'tpl_turkey', name: 'Турция', stages: ['Загрузка', 'Граница', 'Выгрузка'], updatedAt: '2026-10-12T00:00:00Z', updatedBy: 'Тест' },
    tpl_custom: { name: 'Мой шаблон', stages: { 0: 'A', 1: 'B' } },
    broken: { name: 'Пустой' },
  };
  const list = stageTemplatesFromDb(db);
  check('обе записи прочитаны (+ пустая без stages)', list.length === 3);
  check('сортировка по названию', list[0].name === 'Мой шаблон' && list[1].name === 'Пустой' && list[2].name === 'Турция');
  const tur = list.find((t) => t.name === 'Турция');
  check('stages — упорядоченный массив названий', tur?.stages.join('|') === 'Загрузка|Граница|Выгрузка');
  check('updatedAt/updatedBy не теряются', tur?.updatedAt === '2026-10-12T00:00:00Z' && tur?.updatedBy === 'Тест');
  const custom = list.find((t) => t.name === 'Мой шаблон');
  check('объект stages (ключи 0..N) читается по порядку', custom?.stages.join('|') === 'A|B');
  check('id из ключа ветки при отсутствии id', custom?.id === 'tpl_custom');
  check('пустая/битая ветка — пустой список', stageTemplatesFromDb(null).length === 0 && stageTemplatesFromDb({ x: 5 } as never).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Эффективный список: стартовые шаблоны по факту рейсов');
{
  check('пустая база → стартовые шаблоны', effectiveStageTemplates([]).length === 2);
  check('стартовые: Турция и Китай', DEFAULT_STAGE_TEMPLATES.map((t) => t.name).join(',') === 'Турция,Китай');
  const chn = DEFAULT_STAGE_TEMPLATES.find((t) => t.name === 'Китай');
  const tur = DEFAULT_STAGE_TEMPLATES.find((t) => t.name === 'Турция');
  check(
    'Китай по факту: Загрузка → Граница → Растаможка (импорт) → Выгрузка',
    chn?.stages.join('|') === 'Загрузка|Граница|Растаможка (импорт)|Выгрузка',
  );
  check(
    'Турция по факту: + Затаможка (экспорт) перед Границей',
    tur?.stages.join('|') === 'Загрузка|Затаможка (экспорт)|Граница|Растаможка (импорт)|Выгрузка',
  );
  check('непустая база → как есть', effectiveStageTemplates([{ id: 'x', name: 'X', stages: ['A'] }])[0].name === 'X');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Шаблон по направлению');
{
  const tpls = DEFAULT_STAGE_TEMPLATES;
  check('по названию «Турция»', templateForDirection(tpls, 'Турция', 'TR')?.id === 'tpl_turkey');
  check('по названию «китай» (регистр не важен)', templateForDirection(tpls, 'китай', 'CN')?.id === 'tpl_china');
  check('по коду, когда назван так шаблон', templateForDirection([{ id: 'cn', name: 'CN', stages: ['A'] }], undefined, 'CN')?.id === 'cn');
  check('нет шаблона — null (не выдумываем)', templateForDirection(tpls, 'Литва', 'LT') === null);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Применение: пустой рейс (seq 1..N, пустые место и даты)');
{
  seq = 0;
  const tpl = DEFAULT_STAGE_TEMPLATES[1]; // Китай
  const res = applyStageTemplate([], tpl, 'append', { stageTypes, makeId });
  check('создано 4 этапа', res.added === 4 && res.stages.length === 4);
  check('seq/order = 1..N в порядке шаблона', res.stages.map((s) => s.seq).join(',') === '1,2,3,4' && res.stages.map((s) => s.order).join(',') === '1,2,3,4');
  check('типы сопоставлены по названиям', res.stages.map((s) => s.type).join(',') === 'load,border,cust_in,unl');
  check('место ПУСТОЕ и даты ПУСТЫЕ', res.stages.every((s) => s.label === '' && s.plannedDate === '' && s.actualDate === ''));
  check('запас — шаблон типа (Граница: 2)', res.stages.find((s) => s.type === 'border')?.bufferDays === 2);
  check('запас без шаблона — 0', res.stages.find((s) => s.type === 'load')?.bufferDays === 0);
  check('id уникальны', new Set(res.stages.map((s) => s.id)).size === 4);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. «Добавить в конец»: seq от max+1, существующие не меняются');
{
  seq = 0;
  const existing = [
    stage({ id: 'a', type: 'load', label: 'Минск', plannedDate: '2026-10-01', order: 1, seq: 1 }),
    stage({ id: 'b', type: 'border', order: 3, seq: 3 }), // «дырка» в seq — берём максимум
  ];
  const res = applyStageTemplate(existing, { id: 't', name: 'Китай', stages: ['Граница', 'Выгрузка'] }, 'append', { stageTypes, makeId });
  check('добавлено 2, всего 4', res.added === 2 && res.stages.length === 4 && res.removed === 0);
  check('новые — после существующих', res.stages[0].id === 'a' && res.stages[1].id === 'b');
  check('seq от max+1 (4, 5)', res.stages.map((s) => s.seq).join(',') === '1,3,4,5');
  check('существующие не тронуты', res.stages[0].label === 'Минск' && res.stages[1].seq === 3);
  check('легаси без seq не даёт коллизий', applyStageTemplate([stage({ id: 'x' }), stage({ id: 'y' })], { id: 't2', name: 'T', stages: ['Загрузка'] }, 'append', { stageTypes, makeId }).stages.slice(-1)[0].seq === 3);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('6. «Заменить пустые»: внесённые данные НЕ затираются');
{
  seq = 0;
  const existing = [
    stage({ id: 'a', type: 'load', label: 'Минск', plannedDate: '2026-10-01', order: 1, seq: 1 }), // внесён
    stage({ id: 'b', type: 'border', order: 2, seq: 2 }), // пустой — будет заменён
    stage({ id: 'c', type: 'unl', actualDate: '2026-10-30', order: 3, seq: 3 }), // внесён (факт)
    stage({ id: 'd', order: 4, seq: 4 }), // пустой — будет заменён
  ];
  const res = applyStageTemplate(existing, { id: 't', name: 'Китай', stages: ['Граница', 'Растаможка (импорт)'] }, 'replaceEmpty', { stageTypes, makeId });
  check('удалено 2 пустых, добавлено 2', res.removed === 2 && res.added === 2);
  check('внесённые сохранены (метка «Минск» и факт-дата)', res.stages.some((s) => s.id === 'a' && s.label === 'Минск') && res.stages.some((s) => s.id === 'c' && s.actualDate === '2026-10-30'));
  check('удалены именно пустые (id b и d исчезли)', !res.stages.some((s) => s.id === 'b' || s.id === 'd'));
  check('перенумерация 1..N', res.stages.map((s) => s.seq).join(',') === '1,2,3,4' && res.stages.map((s) => s.order).join(',') === '1,2,3,4');
  check('внесённые впереди, шаблон после', res.stages.slice(0, 2).map((s) => s.id).join(',') === 'a,c');
  check('новая плановая дата НЕ выдумана', res.stages.slice(2).every((s) => s.plannedDate === '' && s.actualDate === ''));
  const emptyOnly = applyStageTemplate([stage({ id: 'e' }), stage({ id: 'f' })], { id: 't', name: 'X', stages: ['Выгрузка'] }, 'replaceEmpty', { stageTypes, makeId });
  check('все пустые — как чистый шаблон (1 этап, seq 1)', emptyOnly.stages.length === 1 && emptyOnly.stages[0].seq === 1 && emptyOnly.removed === 2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('7. Несопоставленные названия сохраняются в «Место» (тип «Другое»)');
{
  seq = 0;
  const res = applyStageTemplate([], { id: 't', name: 'X', stages: ['Загрузка', 'Стоянка в Стамбуле'] }, 'append', { stageTypes, makeId });
  check('известное название → тип, место пустое', res.stages[0].type === 'load' && res.stages[0].label === '');
  check('неизвестное → тип other, название в «Место»', res.stages[1].type === 'other' && res.stages[1].label === 'Стоянка в Стамбуле');
  check('resolveStageTypeByName: точно и по вхождению', resolveStageTypeByName(stageTypes, 'Граница')?.key === 'border' && resolveStageTypeByName(stageTypes, 'Растаможка')?.key === 'cust_in');
  check('resolveStageTypeByName: пусто — null', resolveStageTypeByName(stageTypes, '') === null);
  check('stageHasContent: метка/даты', !stageHasContent(stage({})) && stageHasContent(stage({ label: 'x' })) && stageHasContent(stage({ plannedDate: '2026-01-01' })) && stageHasContent(stage({ actualDate: '2026-01-01' })));
  check('пустой шаблон → ничего не добавлено', applyStageTemplate([stage({})], { id: 't', name: 'X', stages: [] }, 'append', { stageTypes, makeId }).added === 0);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('8. Правки шаблона: порядок, добавить, удалить, переименовать');
{
  const base = ['Загрузка', 'Граница', 'Выгрузка'];
  check('перестановка вверх', moveTemplateStage(base, 2, -1).join('|') === 'Загрузка|Выгрузка|Граница');
  check('перестановка вниз', moveTemplateStage(base, 0, 1).join('|') === 'Граница|Загрузка|Выгрузка');
  check('перестановка за границей — без изменений', moveTemplateStage(base, 0, -1).join('|') === base.join('|'));
  check('добавление в конец', addTemplateStage(base, 'Растаможка').join('|') === 'Загрузка|Граница|Выгрузка|Растаможка');
  check('пустое имя не добавляется', addTemplateStage(base, '  ').length === 3);
  check('удаление по позиции', removeTemplateStage(base, 1).join('|') === 'Загрузка|Выгрузка');
  check('переименование', renameTemplateStage(base, 0, 'Погрузка').join('|') === 'Погрузка|Граница|Выгрузка');
  check('пустое переименование не принимается', renameTemplateStage(base, 0, ' ').join('|') === base.join('|'));
  const id1 = newTemplateId();
  const id2 = newTemplateId();
  check('id новых шаблонов различаются', id1 !== id2 && id1.startsWith('tpl_'));
  check('исходный список не мутирован', base.join('|') === 'Загрузка|Граница|Выгрузка');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);
