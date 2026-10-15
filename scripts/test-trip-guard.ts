import { findTripPeriodConflict, collectCarConflicts, sameCar, tripRangeOf } from '../src/components/modules/tripTimeline/lib/tripGuard';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, info = '') => {
  if (c) { pass++; console.log('PASS :: ' + n + (info ? ' :: ' + info : '')); }
  else { fail++; console.log('FAIL :: ' + n + (info ? ' :: ' + info : '')); }
};
const t = (id: string, carNumber: string, dateStart: string, dateEnd: string, over: Record<string, unknown> = {}) =>
  ({ id, carNumber, dateStart, dateEnd, ...over });

console.log('\nПересечения периодов одной машины');
const base = [t('tl:1', 'AO 8806-7', '2026-10-01', '2026-10-20')];
ok('полностью внутри периода — конфликт', !!findTripPeriodConflict(t('', 'АО 8806-7', '2026-10-05', '2026-10-10'), base));
ok('перекрытие в конце — конфликт', !!findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-15', '2026-10-25'), base));
ok('перекрытие в начале — конфликт', !!findTripPeriodConflict(t('', 'AO 8806-7', '2026-09-25', '2026-10-05'), base));
ok('полное накрытие — конфликт', !!findTripPeriodConflict(t('', 'AO 8806-7', '2026-09-01', '2026-11-01'), base));
ok('последовательный рейс после возвращения — разрешён', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-21', '2026-11-01'), base));
ok('выезд в ДЕНЬ возвращения предыдущего — разрешён (день возвращения занят предыдущим)', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-20', '2026-10-30'), base), 'правило границ: startA < endB && startB < endA');
ok('рейс, заканчивающийся в день старта — разрешён', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-09-20', '2026-10-01'), base));
ok('другая машина не блокируется', !findTripPeriodConflict(t('', 'AO 9999-9', '2026-10-05', '2026-10-10'), base));

console.log('\nРаскладка номера и самоисключение');
ok('«АО» и «AO» — одна машина', sameCar(t('', 'АО 8806-7', '', ''), t('', 'AO8806-7', '', '')));
ok('разные номера — разные машины', !sameCar(t('', 'AO 8806-7', '', ''), t('', 'AO 8807-7', '', '')));
ok('редактирование без смены периода не конфликтует с самим собой', !findTripPeriodConflict(t('tl:1', 'AO 8806-7', '2026-10-01', '2026-10-20', { dateStart: '2026-10-01', dateEnd: '2026-10-20' }), base, { selfKey: 'tl:1' }));
ok('смена периода на пересекающийся с чужим — конфликт', !!findTripPeriodConflict(t('tl:1', 'AO 8806-7', '2026-10-15', '2026-10-30'), [...base, t('tl:2', 'AO 8806-7', '2026-10-25', '2026-11-05')], { selfKey: 'tl:1' }));

console.log('\nВыполняемый рейс без даты возвращения');
const open = [t('tl:open', 'AO 8806-7', '2026-10-10', '')];
ok('второй рейс той же машины блокируется, пока открытый не закрыт', !!findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-25', '2026-11-01'), open));
ok('сообщение называет машину и период', /8806-7/.test(findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-25', '2026-11-01'), open)?.message || ''));
ok('полностью прошедший рейс открытым не блокируется', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-09-01', '2026-09-20'), open));
ok('новый рейс без даты возвращения при открытом — тоже блокируется', !!findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-25', ''), open));
ok('другая машина при открытом рейсе не блокируется', !findTripPeriodConflict(t('', 'AO 1111-1', '2026-10-25', '2026-11-01'), open));

console.log('\nОтменённые и архивные записи машину не блокируют');
ok('архивная запись не мешает', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-05', '2026-10-10'), [t('tl:a', 'AO 8806-7', '2026-10-01', '2026-10-20', { archived: true })]));
ok('отменённая запись не мешает', !findTripPeriodConflict(t('', 'AO 8806-7', '2026-10-05', '2026-10-10'), [t('tl:c', 'AO 8806-7', '2026-10-01', '2026-10-20', { status: 'cancelled' })]));

console.log('\nАудит существующих конфликтов');
const messy = [t('a', 'AO 8806-7', '2026-10-01', '2026-10-20'), t('b', 'AO 8806-7', '2026-10-15', '2026-10-25'), t('c', 'AO 7777-7', '2026-10-01', '2026-10-10')];
const found = collectCarConflicts(messy);
ok('конфликтующие записи находятся списком (не молча)', found.length === 1 && ['a', 'b'].includes(found[0].tripId), JSON.stringify(found.map((c) => c.tripId)));
ok('пары не дублируются', collectCarConflicts([...messy, t('d', 'AO 8806-7', '2026-10-16', '2026-10-18')]).length >= 1);
ok('чистый набор конфликтов не даёт', collectCarConflicts([t('x', 'AO 1111-1', '2026-10-01', '2026-10-05'), t('y', 'AO 1111-1', '2026-10-06', '2026-10-10')]).length === 0);
ok('нет дат у обеих записей — предупреждаем, а не молчим', !!findTripPeriodConflict(t('', 'AO 8806-7', '', ''), [t('z', 'AO 8806-7', '', '')]));

console.log('\nРазбор дат');
ok('ISO и ДД.ММ.ГГГГ понимаются одинаково', tripRangeOf(t('', 'x', '2026-10-01', '2026-10-20')).start === tripRangeOf(t('', 'x', '01.10.2026', '20.10.2026')).start);
ok('пустая дата — null, а не ноль', tripRangeOf(t('', 'x', '', '')).end === null);

console.log(`\nИТОГО: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
