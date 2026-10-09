/**
 * Тесты чистой функции сегментов факта (lib/factSegments) и контраста WCAG AA.
 * Запуск: npx tsx scripts/test-fact-segments.ts  (или npm run test:segments)
 */
import type { TimelineStage } from '../src/types';
import {
  FACT_SEGMENT_COLORS,
  contrastRatio,
  factSegmentsOf,
  type FactSegmentsInput,
  type FactSegColor,
} from '../src/components/modules/tripTimeline/lib/factSegments';

let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const D = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

const stage = (order: number, planned: string, actual: string, isCritical = false, label = `этап-${order}`): TimelineStage => ({
  id: `s${order}`,
  type: 'stage',
  label,
  plannedDate: planned,
  actualDate: actual,
  isCritical,
  order,
});

const colorsOf = (segs: Array<{ color: FactSegColor }>): string => segs.map((s) => s.color).join(',');

console.log('factSegmentsOf: 7 обязательных случаев');

// 1. В срок
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-08', '2026-03-08')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-08'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-08'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('1) в срок → только зелёный', colorsOf(r.segments) === 'green,green', colorsOf(r.segments));
}

// 2. Опоздание 1 день
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-05', '2026-03-06')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-06'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('2) опоздание 1 день → зелёный, жёлтый', colorsOf(r.segments) === 'green,yellow', colorsOf(r.segments));
}

// 3. Опоздание 2 дня
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-05', '2026-03-07')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-07'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('3) опоздание 2 дня → зелёный, жёлтый', colorsOf(r.segments) === 'green,yellow', colorsOf(r.segments));
}

// 4. Опоздание 3+ дня
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-05', '2026-03-08')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-08'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('4) опоздание 3 дня → зелёный, оранжевый', colorsOf(r.segments) === 'green,orange', colorsOf(r.segments));
}

// 5. Критический дедлайн нарушен
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-06', '2026-03-12', true, 'таможня')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-06'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-12'),
    ongoing: false,
    today: D('2026-03-15'),
  });
  check('5) критический срок нарушен → красный', colorsOf(r.segments) === 'green,red', colorsOf(r.segments));
  check('5b) причина называет критический срок', /[Кк]ритическ/.test(r.segments[1].reason), r.segments[1].reason);
}

// 6. Идущий рейс с просрочкой (хвост растёт: 2 дня → жёлтый; 5 дней → оранжевый; критический → красный)
{
  const base = {
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-05', '')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    ongoing: true,
  };
  const r2 = factSegmentsOf({ ...base, factTo: D('2026-03-07'), today: D('2026-03-07') });
  check('6a) идущий, просрочка 2 дня → хвост жёлтый', colorsOf(r2.segments) === 'green,yellow', colorsOf(r2.segments));
  const r5 = factSegmentsOf({ ...base, factTo: D('2026-03-10'), today: D('2026-03-10') });
  check('6b) идущий, просрочка 5 дней → хвост оранжевый', colorsOf(r5.segments) === 'green,orange', colorsOf(r5.segments));
  const crit = {
    ...base,
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-05', '', true, 'граница')],
  };
  const rc = factSegmentsOf({ ...crit, factTo: D('2026-03-08'), today: D('2026-03-08') });
  check('6c) идущий с критическим дедлайном → хвост красный', colorsOf(rc.segments) === 'green,red', colorsOf(rc.segments));
}

// 7. Нет плана
{
  const r = factSegmentsOf({
    stages: [stage(1, '', '2026-03-05')],
    planFrom: null,
    planTo: null,
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-05'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('7) нет плана → нейтральный, без зелёного', colorsOf(r.segments) === 'neutral' && r.noPlan === true, colorsOf(r.segments));
}

console.log('Дополнительно: случаи без этапов и пропуск');

// 8. Этапов нет — деление по плановой дате окончания
{
  const r = factSegmentsOf({
    stages: [],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-09'),
    ongoing: false,
    today: D('2026-03-12'),
  });
  check('8) без этапов → зелёный до плана, оранжевый после (4 дн)', colorsOf(r.segments) === 'green,orange', colorsOf(r.segments));
}

// 9. Пропущенный этап позади фронта → красный
{
  const r = factSegmentsOf({
    stages: [stage(1, '2026-03-01', '2026-03-01'), stage(2, '2026-03-04', '', false, 'незавершённый'), stage(3, '2026-03-06', '2026-03-07')],
    planFrom: D('2026-03-01'),
    planTo: D('2026-03-07'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-07'),
    ongoing: false,
    today: D('2026-03-12'),
  });
  check('9) пропущенный этап → красный сегмент', colorsOf(r.segments) === 'green,red', colorsOf(r.segments));
  check('9b) пропущенный попал в missed', r.missed.length === 1 && r.missed[0].label === 'незавершённый', JSON.stringify(r.missed));
}

console.log('Контраст текста на фоне (WCAG AA ≥ 4.5:1)');
for (const [kind, style] of Object.entries(FACT_SEGMENT_COLORS)) {
  const ratio = contrastRatio(style.text, style.bg);
  check(`AA ${kind}: ${ratio.toFixed(2)}:1`, ratio >= 4.5);
}

console.log('');
if (failed) {
  console.error(`ПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log('Все проверки пройдены.');
