/**
 * Аудит назначения диспетчеров на таймлайне (только чтение, без правок).
 *
 * Показывает автомобили, у которых хотя бы в одном источнике (карточка парка,
 * справочник «машина → диспетчер», план дохода) диспетчер известен, а у записи
 * «Учёта выезда»/события он пуст — такие записи уходят в блок
 * «Без диспетчера» (жалоба владельца по 8806).
 *
 * Запуск: npx tsx scripts/audit-vehicle-dispatchers.ts
 */
import { bazaToBasePeriods, buildCarIndex } from '../src/components/modules/tripTimeline/lib/sources';
import { buildDispatcherDirectory } from '../src/utils/dispatcher';
import { buildDispatcherFacts, fillRecordDispatchers, vehicleKeyVariants } from '../src/components/modules/tripTimeline/lib/vehicleDispatcher';

const DB = 'https://ratipa-portal-default-rtdb.firebaseio.com';
async function rest<T>(path: string): Promise<T> {
  const r = await fetch(`${DB}/${path}.json`);
  return (await r.json()) as T;
}
async function restList(path: string): Promise<Array<Record<string, unknown>>> {
  const obj = await rest<Record<string, Record<string, unknown>>>(path);
  return Object.entries(obj || {}).map(([k, v]) => ({ ...(v as Record<string, unknown>), id: String((v as Record<string, unknown>)?.id || k) }));
}

(async () => {
  const [baza, couplings, plansObj, users, mapping] = await Promise.all([
    restList('baza'),
    restList('couplings'),
    rest<Record<string, Record<string, unknown>>>('trips_dashboard'),
    rest<Record<string, Record<string, unknown>>>('users_list'),
    rest<Record<string, string>>('dispatchers_car_mapping'),
  ]);
  const plans = Object.entries(plansObj || {}).map(([k, v]) => ({ ...v, id: k }));
  const dir = buildDispatcherDirectory(
    Object.entries(users || {})
      .filter(([, u]) => u && (u.isDispatcher || u.role === 'dispatcher'))
      .map(([id, u]) => ({ id, name: String(u.name || `${u.firstName || ''} ${u.lastName || ''}`).trim() })),
  );
  const carIndex = buildCarIndex(couplings);
  const facts = buildDispatcherFacts({ plans, cars: couplings, mapping, dir });

  const periods = bazaToBasePeriods(baza, carIndex, dir);
  const before = periods.filter((p) => !p.dispatcherName);
  const stats = fillRecordDispatchers(periods, { facts, dir }, {
    keysOf: (p) => [...vehicleKeyVariants(String(p.carKey || '').replace(/^(car|plate):/, '')), ...vehicleKeyVariants(p.carNumber)],
    dayOf: (p) => p.arrivalDay ?? p.repairStartDay ?? p.repairEndDay ?? p.departureDay ?? null,
  });

  console.log(`Источники: карточки парка ${couplings.length}, планы ${plans.length}, справочник «машина → диспетчер» ${Object.keys(mapping || {}).length}, диспетчеры ${dir.list.length}`);
  console.log(`Записей «Учёта выезда»: ${periods.length}`);
  console.log(`Было без диспетчера: ${before.length}`);
  console.log(`Единый механизм дополнил: ${stats.filled}; осталось без диспетчера: ${stats.unresolved}`);
  const stillEmpty = periods.filter((p) => !p.dispatcherName);
  if (stillEmpty.length) {
    console.log('\nЗаписи, которым назначение неизвестно ни в одном источнике (это не ошибка, данных нет):');
    stillEmpty.forEach((p) => console.log(`  · ${p.carNumber || '(номер не указан)'} — запись ${p.id}`));
  }
  const idless = periods.filter((p) => p.dispatcherName && !p.dispatcherId);
  console.log(`\nЗаписей с именем, но без идентификатора (уходят в «Без диспетчера»): ${idless.length}`);
  idless.slice(0, 10).forEach((p) => console.log(`  ! ${p.carNumber} = ${p.dispatcherName}`));
  console.log(stats.unresolved === 0 && idless.length === 0 ? '\nИТОГ: ложных «Без диспетчера» не осталось ✓' : '\nИТОГ: есть записи для разбора (см. выше)');
})();
