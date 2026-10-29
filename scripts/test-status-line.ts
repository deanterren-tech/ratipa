/**
 * Тесты статус-линии рейса (lib/statusLine): зелёный — по плану, оранжевый —
 * срок подходит за 1–2 дня, красный — ровно на период просрочки.
 * Запуск: npx tsx scripts/test-status-line.ts  (или npm run test:status-line)
 */
import type { TimelineStage } from '../src/types';
import { statusLineOf, type StatusLineSegment } from '../src/components/modules/tripTimeline/lib/statusLine';

let failed = 0;
let passed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
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

const stage = (order: number, planned: string, actual = ''): TimelineStage => ({
  id: `s${order}`,
  type: 'stage',
  label: `этап-${order}`,
  plannedDate: planned,
  actualDate: actual,
  isCritical: false,
  order,
});

/** «ok:01-05,late:06-07» — состояния с днями месяца, для читаемых проверок. */
const shape = (segs: StatusLineSegment[]): string =>
  segs
    .map((s) => {
      const day = (n: number) => String(new Date(n * 86400000).getUTCDate()).padStart(2, '0');
      return `${s.state}:${day(s.a)}-${day(s.b)}`;
    })
    .join(',');

console.log('statusLineOf: зелёный / оранжевый / красный');

// 1. Всё в срок — вся линия зелёная.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-02', '2026-03-02'), stage(2, '2026-03-05', '2026-03-05')],
    planTo: D('2026-03-05'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-05'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('в срок — одна зелёная линия', shape(r) === 'ok:01-05', shape(r));
}

// 2. Этап выполнен с опозданием — красный ровно на период просрочки, дальше снова зелёный.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-03', '2026-03-05'), stage(2, '2026-03-08', '2026-03-08')],
    planTo: D('2026-03-08'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-08'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('опоздание на 2 дня — красный 04–05, потом зелёный', shape(r) === 'ok:01-03,late:04-05,ok:06-08', shape(r));
}

// 3. Срок подходит (сегодня за 1 день до срока, этап не выполнен) — оранжевый хвост.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-06')],
    planTo: D('2026-03-08'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-05'),
    ongoing: true,
    today: D('2026-03-05'),
  });
  check('срок через 1 день — оранжевый с 04', shape(r) === 'ok:01-03,soon:04-05', shape(r));
}

// 4. Тот же рейс, этап отмечен в срок — оранжевый уходит, линия снова зелёная.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-06', '2026-03-06'), stage(2, '2026-03-12')],
    planTo: D('2026-03-12'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-07'),
    ongoing: true,
    today: D('2026-03-07'),
  });
  check('этап выполнен в срок — всё зелёное', shape(r) === 'ok:01-07', shape(r));
}

// 5. Срок прошёл, факта нет — красный продолжается до сегодня.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-04')],
    planTo: D('2026-03-10'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-07'),
    ongoing: true,
    today: D('2026-03-07'),
  });
  check('просрочка идёт — красный 05–07', shape(r) === 'ok:01-04,late:05-07', shape(r));
}

// 6. Пропущенный этап: срок прошёл, факта нет, а следующий выполнен — красный от срока пропущенного.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-03'), stage(2, '2026-03-06', '2026-03-06')],
    planTo: D('2026-03-06'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-06'),
    ongoing: false,
    today: D('2026-03-10'),
  });
  check('пропущенный этап — красный с 04', shape(r) === 'ok:01-03,late:04-06', shape(r));
  check('в причине названа пропущенная точка', /пропущен/.test(r[1]?.reason || ''), r[1]?.reason);
}

// 7. Срок далеко — зелёный, оранжевого нет.
{
  const r = statusLineOf({
    stages: [stage(1, '2026-03-20')],
    planTo: D('2026-03-25'),
    factFrom: D('2026-03-01'),
    factTo: D('2026-03-05'),
    ongoing: true,
    today: D('2026-03-05'),
  });
  check('срок через 15 дней — зелёный', shape(r) === 'ok:01-05', shape(r));
}

// 8. Без этапов — срок по плановому окончанию рейса.
{
  const r = statusLineOf({ stages: [], planTo: D('2026-03-04'), factFrom: D('2026-03-01'), factTo: D('2026-03-06'), ongoing: true, today: D('2026-03-06') });
  check('без этапов: после окончания по плану — красный', shape(r) === 'ok:01-04,late:05-06', shape(r));
}

// 9. Плана нет вовсе — нейтральная линия.
{
  const r = statusLineOf({ stages: [stage(1, '')], planTo: null, factFrom: D('2026-03-01'), factTo: D('2026-03-03'), ongoing: true, today: D('2026-03-03') });
  check('плана нет — нейтральная линия', shape(r) === 'none:01-03', shape(r));
}

// 10. Срок сегодня — оранжевый (ещё не просрочка).
{
  const r = statusLineOf({ stages: [stage(1, '2026-03-05')], planTo: null, factFrom: D('2026-03-01'), factTo: D('2026-03-05'), ongoing: true, today: D('2026-03-05') });
  check('срок сегодня — оранжевый, не красный', shape(r) === 'ok:01-02,soon:03-05', shape(r));
}

if (failed) {
  console.error(`\nПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`\nВсе проверки пройдены: ${passed}.`);
