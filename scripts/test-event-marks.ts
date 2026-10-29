/**
 * Тесты маркеров событий (lib/eventMarks): в маркере остаётся ПОЛНЫЙ текст
 * заметки для карточки события, а подсказка по-прежнему короткая; группы
 * близких событий сохраняют все записи.
 * Запуск: npx tsx scripts/test-event-marks.ts  (или npm run test:event-marks)
 */
import type { TimelineVehicleEvent } from '../src/types';
import { eventMarkOf, groupEventMarks, type EventMark } from '../src/components/modules/tripTimeline/lib/eventMarks';

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

const ev = (id: string, dateFrom: string, note: string, extra: Partial<TimelineVehicleEvent> = {}): TimelineVehicleEvent => ({
  id,
  carNumber: 'AO 3921-7',
  kind: 'other',
  dateFrom,
  note,
  ...extra,
});

console.log('eventMarkOf: полный текст для карточки');

{
  const long = 'не мог зарегистрироваться на выгрузке, '.repeat(8).trim();
  const m = eventMarkOf(ev('e1', '2026-10-14', long, { tripKey: 'pd:1' }), 'Другое', '#7C3AED');
  check('маркер создан', !!m);
  check('note — полный текст без обрезки', m?.note === long, String(m?.note.length));
  check('title — короткий (обрезан до ~140 символов)', (m?.title.length ?? 0) < long.length, String(m?.title.length));
  check('typeName сохранён', m?.typeName === 'Другое');
  check('связь с рейсом сохранена', m?.tripKey === 'pd:1');
}

{
  const m = eventMarkOf(ev('e2', '2026-10-14', 'Ремонт оси', { dateTo: '2026-10-17' }), 'Ремонт', '#D97706');
  check('событие на несколько дней — dayTo больше day', !!m && m.dayTo != null && m.dayTo > m.day);
}

{
  const m = eventMarkOf(ev('e3', '2026-10-14', 'один день', { dateTo: '2026-10-14' }), 'Другое', '#7C3AED');
  check('dateTo в тот же день — dayTo не задаётся', m?.dayTo === undefined);
}

{
  const m = eventMarkOf(ev('e4', '2026-10-14', ''), 'Другое', '#7C3AED');
  check('пустая заметка — note пустой, маркер есть', !!m && m.note === '');
}

{
  const m = eventMarkOf(ev('e5', 'не дата', 'текст'), 'Другое', '#7C3AED');
  check('без даты маркера нет', m === null);
}

console.log('groupEventMarks: записи группы остаются доступными');

{
  const marks = [
    eventMarkOf(ev('a', '2026-10-14', 'первая'), 'Другое', '#7C3AED'),
    eventMarkOf(ev('b', '2026-10-15', 'вторая', { tripKey: 'pd:2' }), 'Другое', '#7C3AED'),
    eventMarkOf(ev('c', '2026-10-25', 'далеко'), 'Другое', '#7C3AED'),
  ].filter((x): x is EventMark => !!x);
  const groups = groupEventMarks(marks);
  check('близкие события — одна группа, далёкое — отдельно', groups.length === 2 && groups[0].count === 2 && groups[1].count === 1);
  check('в группе сохранён полный текст каждой записи', groups[0].items.map((i) => i.note).join('|') === 'первая|вторая');
  check('цель перехода — запись, связанная с рейсом', groups[0].tripKey === 'pd:2' && groups[0].eventId === 'b');
}

if (failed) {
  console.error(`\nПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`\nВсе проверки пройдены: ${passed}.`);
