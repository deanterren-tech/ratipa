/**
 * План перевода РАССТОЯНИЙ и ГРУПП СТАВОК на одно хранилище (только чтение).
 *
 * Расстояния: knownDistancesList — единственное место; сюда же переносятся
 * directories/standardDistances и distanceDb; на пару мест — одна запись
 * с fromCityId/toCityId. Группы ставок: только directories/rateGroups,
 * легаси carsPool убирается. В базу ничего не пишется.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupByPair, placeKey, type DistanceLike } from '../src/utils/distancePairs';
import { plateKey } from '../src/utils/rateGroupsSingle';

const DB = process.env.RATIPA_DB_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const get = async (path: string): Promise<any> => (await fetch(`${DB}/${path}.json`)).json();
const entries = (v: any): Array<[string, any]> =>
  !v || typeof v !== 'object' ? [] : (Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, any]) : Object.entries(v)).filter(([, x]) => x && typeof x === 'object');

interface Step { group: string; path: string; action: string; note: string; auto: boolean }
const steps: Step[] = [];
const add = (s: Step) => steps.push(s);

type Rec = DistanceLike & { src: string; key: string };

const main = async () => {
  const [known, dirs, distanceDb, cities, carsPool, tractors, couplings] = await Promise.all(
    ['knownDistancesList', 'directories', 'distanceDb', 'cities', 'carsPool', 'tractors', 'couplings'].map(get),
  );
  const cityByName = new Map<string, string[]>();
  for (const [id, c] of entries(cities)) {
    const k = placeKey(c.name);
    if (k) cityByName.set(k, [...(cityByName.get(k) || []), id]);
  }
  const cityOk = (id?: string) => !!id && !!cities?.[id];

  // ── Расстояния ──
  const all: Rec[] = [
    ...entries(known).map(([k, d]) => ({ ...d, id: `knownDistancesList/${k}`, src: 'knownDistancesList', key: k })),
    ...entries(dirs?.standardDistances).map(([k, d]) => ({ ...d, distance: d.km, id: `directories/standardDistances/${k}`, src: 'standardDistances', key: k })),
    ...entries(distanceDb).map(([k, d]) => ({ ...d, from: d.fromName, to: d.toName, id: `distanceDb/${k}`, src: 'distanceDb', key: k })),
  ];
  // Города: битая или пустая ссылка — пробуем найти город по названию (только однозначно).
  for (const r of all) {
    for (const side of ['from', 'to'] as const) {
      const f = `${side}CityId` as const;
      if (cityOk(r[f])) continue;
      const hits = cityByName.get(placeKey(r[side])) || [];
      if (hits.length === 1) {
        add({ group: 'R1 Город расстояния найден по названию', path: `${r.id}/${f}`, auto: true, action: `ЗАПОЛНИТЬ «${hits[0]}»`, note: `«${r[side]}»${r[f] ? ` (было «${r[f]}» — нет такого города)` : ''}` });
        r[f] = hits[0];
      } else {
        add({ group: 'R2 Город расстояния не определён', path: `${r.id}/${f}`, auto: false, action: hits.length ? `ВЫБРАТЬ из: ${hits.join(', ')}` : 'ВЫБРАТЬ город', note: `«${r[side] || '—'}»` });
      }
    }
  }
  for (const g of groupByPair(all)) {
    const recs = g.records as Rec[];
    const keep = recs.find((r) => r.src === 'knownDistancesList' && cityOk(r.fromCityId) && cityOk(r.toCityId)) || recs.find((r) => r.src === 'knownDistancesList') || recs[0];
    const label = `${keep.from} — ${keep.to}`;
    if (g.conflict) {
      add({ group: 'R3 Разные км у одной пары — нужно решение', path: keep.id!, auto: false, action: `ВЫБРАТЬ км: ${[...new Set(recs.map((r) => r.distance))].join(' / ')}`, note: `${label}: ${recs.map((r) => `${r.src}=${r.distance}`).join(', ')}` });
    }
    if (keep.src !== 'knownDistancesList') {
      add({ group: 'R4 Перенести в knownDistancesList', path: keep.id!, auto: !g.conflict, action: 'ПЕРЕНЕСТИ', note: `${label}, ${keep.distance} км` });
    }
    for (const r of recs) {
      if (r === keep) continue;
      add({ group: 'R5 Лишняя запись пары — удалить', path: r.id!, auto: !g.conflict, action: 'УДАЛИТЬ', note: `${label}: остаётся ${keep.id}` });
    }
  }
  add({ group: 'R6 Старые хранилища расстояний', path: 'directories/standardDistances, distanceDb', auto: true, action: 'УДАЛИТЬ после переноса', note: 'в коде портала не читаются' });

  // ── Группы ставок ──
  const fleet = [...entries(tractors), ...entries(couplings)].map(([id, r]) => ({ id, plate: plateKey(r.carNumber || id), rateGroupId: r.rateGroupId }));
  const dirGroups = entries(dirs?.rateGroups);
  for (const [gid, g] of entries(carsPool)) {
    const same = dirGroups.find(([, d]) => Number(d.rate) === Number(g.rate));
    if (dirGroups.some(([k]) => k === gid)) {
      add({ group: 'S1 Один id в двух местах', path: `carsPool/${gid}`, auto: false, action: 'УДАЛИТЬ легаси-запись', note: `carsPool/${gid}: «${g.name}» ${g.rate} €/км, а в справочнике ${gid} — другая группа` });
    }
    for (const plate of g.vehicles || []) {
      const cars = fleet.filter((f) => f.plate === plateKey(plate));
      if (!cars.length) {
        add({ group: 'S2 Машина из carsPool не в автопарке', path: `carsPool/${gid}/vehicles`, auto: false, action: 'ПОДТВЕРДИТЬ удаление', note: `${plate} (${g.rate} €/км) — нет в тягачах и сцепках` });
        continue;
      }
      for (const c of cars) {
        if (c.rateGroupId) continue;
        add({ group: 'S3 Назначить группу ставок', path: `${c.id}/rateGroupId`, auto: !!same, action: same ? `ЗАПОЛНИТЬ «${same[0]}»` : `СОЗДАТЬ группу ${g.rate} €/км`, note: plate });
      }
    }
  }
  add({ group: 'S4 Легаси carsPool', path: 'carsPool', auto: false, action: 'УДАЛИТЬ после подтверждения', note: 'код портала его больше не читает' });

  const byGroup = new Map<string, Step[]>();
  steps.forEach((s) => byGroup.set(s.group, [...(byGroup.get(s.group) || []), s]));
  console.log('План: расстояния и группы ставок (только чтение)\nБаза:', DB, '\n');
  [...byGroup.entries()].sort().forEach(([g, list]) => {
    console.log(`── ${g} — ${list.length}`);
    list.slice(0, 6).forEach((s) => console.log(`   ${s.path}\n      ${s.action} · ${s.note}${s.auto ? '' : '  [решение]'}`));
    if (list.length > 6) console.log(`   … и ещё ${list.length - 6}`);
  });
  const dir = join(process.cwd(), 'scripts', 'out');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `distances-rates-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(steps, null, 2));
  console.log('\nПлан сохранён:', file, '(в базу ничего не записано)');
};

main().catch((e) => { console.error(e); process.exit(1); });
