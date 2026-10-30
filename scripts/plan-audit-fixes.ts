/**
 * План исправлений по сквозному аудиту (только чтение, в базу ничего не пишется).
 * Для каждой спорной ссылки ищет кандидата ТОЛЬКО по точному совпадению
 * (ФИО / номер после нормализации); без однозначного кандидата — «ручная сверка».
 * Полный файл с ПДн — scripts/out (не коммитить); в консоль идут маскированные значения.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plateKey } from '../src/utils/rateGroupsSingle';

const DB = process.env.RATIPA_DB_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const get = async (p: string): Promise<any> => (await fetch(`${DB}/${p}.json`)).json();
const ent = (v: any): Array<[string, any]> => (v && typeof v === 'object' ? Object.entries(v).filter(([, x]) => x && typeof x === 'object') as any : []);
const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const mask = (s: unknown) => { const t = String(s ?? ''); return t.length > 5 ? `${t.slice(0, 2)}***${t.slice(-2)}` : '***'; };

interface Item { step: string; path: string; field: string; current: unknown; candidate: unknown; verdict: 'авто-кандидат' | 'ручная сверка' | 'удалить после «да»'; note: string }
const items: Item[] = [];

const main = async () => {
  const [drivers, tractors, couplings, trailers, baza, trips, salary, users, usersList] = await Promise.all(
    ['drivers', 'tractors', 'couplings', 'trailers', 'baza', 'trips_dashboard', 'salaryHistory', 'users', 'users_list'].map(get),
  );
  const driverByName = new Map<string, string[]>();
  for (const [id, d] of ent(drivers)) for (const n of [d.name, d.nameLat, `${d.lastNameRu ?? ''}${d.firstNameRu ?? ''}`]) {
    const k = nameKey(n); if (k) driverByName.set(k, [...new Set([...(driverByName.get(k) || []), id])]);
  }
  const oneDriver = (...names: unknown[]) => {
    for (const n of names) { const c = driverByName.get(nameKey(n)); if (c?.length === 1) return c[0]; }
    return null;
  };
  const fleetByPlate = new Map(ent(tractors).map(([id, t]) => [plateKey(t.carNumber || id), id]));

  // Шаг 1: ссылки на водителей / авто / диспетчеров
  for (const [k, b] of ent(baza)) if (b.driverId && !drivers?.[b.driverId]) {
    const c = oneDriver(b.driverName, b.driverNameRu, b.driverRaw);
    items.push({ step: '1', path: `baza/${k}`, field: 'driverId', current: b.driverId, candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: `текст в записи: ${mask(b.driverName || b.driverRaw)}` });
  }
  for (const [k, b] of ent(baza)) if (!b.driverId) {
    const c = oneDriver(b.driverName, b.driverNameRu, b.driverRaw);
    items.push({ step: '1', path: `baza/${k}`, field: 'driverId', current: null, candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: `текст в записи: ${mask(b.driverName || b.driverRaw)}` });
  }
  for (const [k, s] of ent(salary)) {
    if (s.driverId && !drivers?.[s.driverId]) {
      const c = oneDriver(s.driver);
      items.push({ step: '1', path: `salaryHistory/${k}`, field: 'driverId', current: s.driverId, candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: 'снимок на дату начисления: ссылку не терять, имя оставить как подпись' });
    }
    if (s.carId && !tractors?.[s.carId]) {
      const c = fleetByPlate.get(plateKey(s.car)) ?? null;
      items.push({ step: '1', path: `salaryHistory/${k}`, field: 'carId', current: s.carId, candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: `номер в записи: ${mask(s.car)}` });
    }
  }
  const userByName = new Map(ent(usersList).filter(([, u]) => u.name).map(([id, u]) => [nameKey(u.name), id]));
  for (const [k, t] of ent(trips)) {
    if (t.carNumber && !fleetByPlate.has(plateKey(t.carNumber)))
      items.push({ step: '1', path: `trips_dashboard/${k}`, field: 'carNumber', current: mask(t.carNumber), candidate: null, verdict: 'ручная сверка', note: 'авто нет в справочнике: добавить машину или оставить как историю' });
    if (!t.dispatcherId) {
      const c = userByName.get(nameKey(t.dispatcherName || t.dispatcher)) ?? null;
      items.push({ step: '1', path: `trips_dashboard/${k}`, field: 'dispatcherId', current: null, candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: `имя: ${mask(t.dispatcherName || t.dispatcher)}` });
    }
  }
  const trailerByPlate = new Map(ent(trailers).map(([id, t]) => [plateKey(t.trailerNumber), id]));
  for (const [k, t] of ent(tractors)) if (t.trailerId && !trailers?.[t.trailerId] && !trailerByPlate.has(plateKey(t.trailerId))) {
    const c = trailerByPlate.get(plateKey(t.trailerNumber)) ?? null;
    items.push({ step: '1', path: `tractors/${k}`, field: 'trailerId', current: mask(t.trailerId), candidate: c, verdict: c ? 'авто-кандидат' : 'ручная сверка', note: 'прицеп указан текстом другого формата' });
  }

  // Шаг 2: мусор
  for (const [k] of ent(usersList)) if (/^probe-/.test(k)) items.push({ step: '2', path: `users_list/${k}`, field: '*', current: 'служебная запись', candidate: null, verdict: 'удалить после «да»', note: 'тестовый пользователь без роли' });
  const empty = ent(usersList).find(([k, u]) => !u.role && !u.name && !/^probe-/.test(k));
  if (empty) items.push({ step: '2', path: `users_list/${empty[0]}`, field: '*', current: 'без имени и роли', candidate: null, verdict: 'ручная сверка', note: 'проверить, не нужна ли' });
  for (const [k] of ent(users)) if (!usersList?.[k]) items.push({ step: '2', path: `users/${k}`, field: '*', current: 'настройки уведомлений', candidate: null, verdict: 'удалить после «да»', note: 'нет в users_list' });

  // Шаг 4 (справочно): переименование ключа A042HY67
  for (const root of ['tractors', 'couplings']) if (['A042HY67'].some((k) => (root === 'tractors' ? tractors : couplings)?.[k]))
    items.push({ step: '4', path: `${root}/A042HY67`, field: 'ключ', current: 'A042HY67', candidate: (root === 'tractors' ? tractors : couplings)['A042HY67'].id, verdict: 'ручная сверка', note: 'перенос записи на ключ из её id; ссылки на старый ключ искать в telemetry_mapping, vehicle_statuses, vehicleFleet, baza' });

  const backup = [...new Set(items.map((i) => i.path.split('/')[0]))];
  const dir = join(process.cwd(), 'scripts', 'out'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `audit-fix-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ backupNodes: backup, items }, null, 1));
  const by = (v: string) => items.filter((i) => i.verdict === v).length;
  console.log(`Позиций: ${items.length} | авто-кандидат: ${by('авто-кандидат')} | ручная сверка: ${by('ручная сверка')} | удалить после «да»: ${by('удалить после «да»')}`);
  console.log('Резервная копия перед применением: ', backup.join(', '));
  for (const s of ['1', '2', '4']) console.log(`Шаг ${s}:`, items.filter((i) => i.step === s).length);
  console.log('Файл:', file);
};
main().catch((e) => { console.error(e); process.exit(1); });
