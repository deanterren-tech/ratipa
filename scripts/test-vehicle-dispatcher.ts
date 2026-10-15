/**
 * Тесты единого разрешения диспетчера (lib/vehicleDispatcher).
 * Запуск: npx tsx scripts/test-vehicle-dispatcher.ts
 */
import { buildDispatcherDirectory } from '../src/utils/dispatcher';
import {
  buildDispatcherFacts,
  carPartOf,
  fillRecordDispatchers,
  pickDispatcher,
  resolveDispatcherFor,
  vehicleKeyVariants,
  type DispatcherFact,
} from '../src/components/modules/tripTimeline/lib/vehicleDispatcher';
import { dayNum } from '../src/components/modules/tripTimeline/lib/timeline';

let pass = 0;
let fail = 0;
const ok = (title: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass += 1;
    console.log('  ✓', title);
  } else {
    fail += 1;
    console.log('  ✗', title, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

const dir = buildDispatcherDirectory([
  { id: 'user_max', name: 'Максим Половиков' },
  { id: 'user_yura', name: 'Юрий Токарев' },
  { id: 'user_matvey', name: 'Матвей Солодкий' },
]);

console.log('— разбор номера машины —');
ok('«машина / прицеп» режется по слэшу', carPartOf('AO 8806-7 / A3928B7') === 'AO 8806-7', carPartOf('AO 8806-7 / A3928B7'));
ok('номер со слэшем и пробелами', carPartOf('АО 3921-7 / А 3981 В-7') === 'АО 3921-7');
ok('запятая тоже разделитель', carPartOf('AB 9271-7, A 2416 E-7') === 'AB 9271-7');
ok('обычный номер не портится', carPartOf('AO 8806-7') === 'AO 8806-7');
ok('пустое значение', carPartOf(null) === '');
const keys = vehicleKeyVariants('AO 8806-7 / A3928B7');
ok('ключи сцепки совпадают с ключом машины', keys.includes('AO88067'), keys);
ok('кириллическая раскладка ведёт к тому же ключу', vehicleKeyVariants('АО8806-7').includes('AO88067'));

console.log('— идентификатор выводится из имени (первопричина) —');
const facts = buildDispatcherFacts({
  cars: [{ carNumber: 'AO 8806-7', dispatcher: 'Максим Половиков' }],
  dir,
});
const lookup = { facts, dir };
const person = resolveDispatcherFor(lookup, { keys: vehicleKeyVariants('AO 8806-7 / A3928B7'), day: null });
ok('карточка только с именем даёт и имя, и идентификатор', person.id === 'user_max' && person.name === 'Максим Половиков', person);
ok('источник — карточка парка', person.source === 'coupling', person.source);
const viaLatin = resolveDispatcherFor(lookup, { keys: vehicleKeyVariants('АО 8806-7'), day: null });
ok('кириллический номер находит ту же машину', viaLatin.id === 'user_max', viaLatin);

console.log('— плановый откат учитывает дату —');
const planFacts = buildDispatcherFacts({
  plans: [
    { carNumber: 'AO 8806-7', dispatcher: 'Юрий Токарев', dispatcherId: 'user_yura', dateStart: '2026-05-12', dateEnd: '2026-06-15' },
    { carNumber: 'AO 8806-7', dispatcher: 'Юрий Токарев', dispatcherId: 'user_yura', dateStart: '2026-06-25', dateEnd: '2026-07-31' },
    { carNumber: 'AO 8806-7', dispatcher: 'Максим Половиков', dispatcherId: 'user_max', dateStart: '2026-08-24', dateEnd: '2026-10-01' },
    { carNumber: 'AO 8806-7', dispatcher: 'Максим Половиков', dispatcherId: 'user_max', dateStart: '2026-10-19', dateEnd: '2026-11-18' },
  ],
  dir,
});
const pick = (iso: string | null) =>
  resolveDispatcherFor({ facts: planFacts, dir }, { keys: vehicleKeyVariants('AO 8806-7'), day: iso ? dayNum(iso) : null });
ok('дата внутри плана — его диспетчер (май)', pick('2026-05-20').name === 'Юрий Токарев');
ok('дата внутри плана — его диспетчер (сентябрь)', pick('2026-09-10').name === 'Максим Половиков');
ok('дата между планами — ближайший по времени (12.10 → Максим, 7 дней)', pick('2026-10-12').name === 'Максим Половиков', pick('2026-10-12'));
ok('дата до первого плана — первый по времени', pick('2026-01-05').name === 'Юрий Токарев', pick('2026-01-05'));
ok('без даты — самый свежий план', pick(null).name === 'Максим Половиков');
ok('машина с историей диспетчеров больше не остаётся без назначения', Boolean(pick(null).id), pick(null));

console.log('— приоритеты и защита от затирания —');
const mixed = buildDispatcherFacts({
  cars: [{ carNumber: 'AO 8806-7', dispatcher: 'Максим Половиков' }],
  plans: [{ carNumber: 'AO 8806-7', dispatcher: 'Юрий Токарев', dispatcherId: 'user_yura', dateStart: '2026-05-12', dateEnd: '2026-06-15' }],
  dir,
});
ok('карточка парка важнее старого плана', resolveDispatcherFor({ facts: mixed, dir }, { keys: vehicleKeyVariants('AO 8806-7'), day: null }).name === 'Максим Половиков');
const records = [
  { dispatcherId: 'user_matvey', dispatcherName: 'Матвей Солодкий', carNumber: 'AO 8806-7' },
  { dispatcherId: '', dispatcherName: '', carNumber: 'AO 8806-7 / A3928B7' },
  { dispatcherId: '', dispatcherName: 'Максим Половиков', carNumber: 'AO 8806-7' },
];
const stats = fillRecordDispatchers(records, { facts: mixed, dir }, {
  keysOf: (r) => vehicleKeyVariants(r.carNumber),
  dayOf: () => null,
});
ok('непустое назначение не переписывается', records[0].dispatcherId === 'user_matvey' && records[0].dispatcherName === 'Матвей Солодкий');
ok('пустая запись получает назначение', records[1].dispatcherId === 'user_max' && records[1].dispatcherName === 'Максим Половиков');
ok('имя без идентификатора дополняется идентификатором', records[2].dispatcherId === 'user_max');
ok('счётчики заполнения верны', stats.filled === 2 && stats.unresolved === 0, stats);

console.log('— честное «без диспетчера» —');
const empty = buildDispatcherFacts({ dir });
const none = resolveDispatcherFor({ facts: empty, dir }, { keys: vehicleKeyVariants('XX 0000-0'), day: dayNum('2026-10-12') });
ok('нет данных — пусто, без выдумывания', none.id === '' && none.name === '' && none.source === 'none', none);
const noMatch = fillRecordDispatchers([{ dispatcherId: '', dispatcherName: '', carNumber: 'XX 0000-0' }], { facts: empty, dir }, { keysOf: (r) => vehicleKeyVariants(r.carNumber) });
ok('нераспознанная машина считается unresolved', noMatch.unresolved === 1 && noMatch.filled === 0, noMatch);
const stranger = buildDispatcherFacts({ cars: [{ carNumber: 'AO 8806-7', dispatcher: 'Незнакомый Человек' }], dir });
const strangerPick = resolveDispatcherFor({ facts: stranger, dir }, { keys: vehicleKeyVariants('AO 8806-7'), day: null });
ok('имя вне справочника сохраняется, идентификатор не выдумывается', strangerPick.name === 'Незнакомый Человек' && strangerPick.id === '', strangerPick);

console.log('— устойчивость выбора —');
const twoPlans: DispatcherFact[] = [
  { key: 'k', id: 'user_yura', name: 'Юрий Токарев', from: dayNum('2026-05-12'), to: dayNum('2026-06-15'), priority: 1, source: 'plan' },
  { key: 'k', id: 'user_max', name: 'Максим Половиков', from: dayNum('2026-08-24'), to: dayNum('2026-10-01'), priority: 1, source: 'plan' },
];
ok('накрывающий период важнее близости', pickDispatcher(twoPlans, dayNum('2026-05-20'))?.name === 'Юрий Токарев');
const tiePlans: DispatcherFact[] = [
  { key: 'k', id: 'user_yura', name: 'Юрий Токарев', from: dayNum('2026-06-01'), to: dayNum('2026-06-10'), priority: 1, source: 'plan' },
  { key: 'k', id: 'user_max', name: 'Максим Половиков', from: dayNum('2026-06-20'), to: dayNum('2026-06-30'), priority: 1, source: 'plan' },
];
ok('равная близость двух планов (15.06: 5 и 5 дней) — берётся более поздний', pickDispatcher(tiePlans, dayNum('2026-06-15'))?.name === 'Максим Половиков', pickDispatcher(tiePlans, dayNum('2026-06-15')));
ok('дата ближе к раннему плану — он и выбран', pickDispatcher(tiePlans, dayNum('2026-06-11'))?.name === 'Юрий Токарев');
ok('пустой список — null', pickDispatcher([], dayNum('2026-07-01')) === null);
ok('факт без имени не выбирается', pickDispatcher([{ key: 'k', id: 'x', name: '', from: 1, to: 2, priority: 0, source: 'coupling' }], null) === null);

console.log(`\nИТОГО: ${pass}/${pass + fail}${fail ? ' — ЕСТЬ ПРОВАЛЫ' : ' — всё зелёное'}`);
process.exit(fail ? 1 : 0);
