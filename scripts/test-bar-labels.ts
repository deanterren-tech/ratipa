/**
 * Тест ЕДИНОГО правила раскладки подписей полос (lib/barLabels):
 * свободные сегменты, отступ, правило «вся ячейка дня», выбор видимого
 * сегмента и ступени сокращения полный → короткий → иконка/многоточие → нет.
 * Запуск: npm run test:labels
 */
import {
  LABEL_GAP,
  barLabelSegments,
  estimateLabelWidth,
  labelTextFor,
  labelVariantFor,
  obstaclesFromFills,
  parseLabelSegsAttr,
  pickActiveSegment,
} from '../src/components/modules/tripTimeline/lib/barLabels';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` ${extra}` : ''}`);
  }
};
const eq = (name: string, a: unknown, b: unknown): void => check(name, JSON.stringify(a) === JSON.stringify(b), `(${JSON.stringify(a)} == ${JSON.stringify(b)})`);

console.log('== 1. Свободные сегменты полосы ==');
{
  const segs = barLabelSegments(300, []);
  eq('без занятых зон — один сегмент на всю полосу', segs.length, 1);
  eq('сегмент покрывает полосу целиком', [segs[0].left, segs[0].right], [0, 300]);
}
{
  const segs = barLabelSegments(300, [{ left: 140, right: 160 }]);
  eq('зона в середине режет полосу на два сегмента', segs.length, 2);
  eq('левый сегмент с отступом LABEL_GAP', [segs[0].left, segs[0].right], [0, 140 - LABEL_GAP]);
  eq('правый сегмент с отступом LABEL_GAP', [segs[1].left, segs[1].right], [160 + LABEL_GAP, 300]);
}
{
  const segs = barLabelSegments(300, [
    { left: 100, right: 150 },
    { left: 140, right: 180 },
  ]);
  eq('пересекающиеся зоны сливаются', segs.length, 2);
  eq('слитая зона учитывает обе границы', [segs[0].right, segs[1].left], [100 - LABEL_GAP, 180 + LABEL_GAP]);
}
{
  const segs = barLabelSegments(300, [{ left: -10, right: 310 }]);
  eq('зона за пределами полосы — свободного места нет', segs.length, 0);
}
{
  const segs = barLabelSegments(120, [
    { left: 0, right: 50 },
    { left: 55, right: 120 },
  ]);
  eq('узкие остатки (< минимального сегмента) отбрасываются', segs.length, 0);
}

console.log('== 2. Правило «вся ячейка дня» (половины/доли) ==');
{
  const dayToX = (d: number) => (d - 100) * 30;
  const colW = 30;
  // две заливки одного дня (доли) — день поделён: занятой считается вся ячейка
  const fills = [
    { day: 101, section: 0, sections: 2 },
    { day: 101, section: 1, sections: 2 },
  ];
  const obs = obstaclesFromFills(fills, (day) => (day === 101 ? 2 : 1), dayToX, colW);
  eq('день с половинами — одна занятая зона на всю ячейку', [obs[0].left, obs[0].right], [30, 60]);
  const single = obstaclesFromFills([{ day: 102, section: 0, sections: 1 }], () => 1, dayToX, colW);
  eq('обычный день — заливка на всю ячейку дня', [single[0].left, single[0].right], [60, 90]);
}
console.log('== 3. Выбор активного сегмента (видимый приоритет) ==');
{
  const segs = parseLabelSegsAttr('0:0:100;1:120:420');
  eq('оба сегмента видны — выбирается самый широкий', pickActiveSegment(segs, 0, 500), 1);
  eq('уход второго сегмента влево — выбирается левый', pickActiveSegment(segs, -40, 80), 0);
  eq('видимый кусок меньше порога — берётся самый широкий сегмент', pickActiveSegment(segs, 395, 500), 1);
  eq('пустой список — -1', pickActiveSegment([], 0, 500), -1);
  const segs2 = parseLabelSegsAttr('0:0:100;1:120:420');
  eq('разбор атрибута «индекс:лево:право»', segs2.map((x) => [x.index, x.left, x.right]), [[0, 0, 100], [1, 120, 420]]);
}
console.log('== 4. Ступени сокращения подписи ==');
{
  const full = 'Плановый простой на базе';
  const short = 'Простой на базе';
  eq('широкий сегмент — полный текст', labelVariantFor(300, full, short, false), 'full');
  const needFull = estimateLabelWidth(full, false);
  eq('ровно по ширине полного текста — полный', labelVariantFor(needFull, full, short, false), 'full');
  eq('чуть меньше полного — короткий вариант', labelVariantFor(needFull - 1, full, short, false), 'short');
  const needShort = estimateLabelWidth(short, false);
  eq('ровно по короткому — короткий', labelVariantFor(needShort, full, short, false), 'short');
  eq('меньше короткого — первое слово с многоточием', labelVariantFor(needShort - 1, full, short, false), 'icon');
  eq('текст ступени «icon» — первое слово + …', labelTextFor('icon', full, short), 'Простой…');
  eq('текст ступени «short» — короткий вариант', labelTextFor('short', full, short), 'Простой на базе');
  eq('меньше минимального — подписи нет', labelVariantFor(5, full, short, false), 'none');
  eq('пустой текст — подписи нет', labelVariantFor(500, '', '', false), 'none');
  // рейс: маршрут + хвост «/ План · N дней» → короткий = маршрут
  const rfull = 'Минск → Стамбул / План · 8 дней';
  const rshort = 'Минск → Стамбул';
  eq('рейс: маршрут с днями помещается — полный', labelVariantFor(400, rfull, rshort, false), 'full');
  eq('рейс: тесно — маршрут', labelVariantFor(estimateLabelWidth(rshort, false) + 2, rfull, rshort, false), 'short');
  eq('ремонт: короткая ступень не дублирует полную', labelVariantFor(80, 'Ремонт', 'Ремонт', false), 'full');
}
console.log(`\nИтог: ${passed} проверок пройдено, ${failed} провалено.`);
if (failed > 0) process.exit(1);
