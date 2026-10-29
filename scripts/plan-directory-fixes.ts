/**
 * План исправлений СПРАВОЧНИКОВ (только чтение — в базу ничего не пишется).
 *
 * Проверяет directories/*: дубли марок, «мусорные» записи, несовпадение ключа
 * записи с её id/dbKey, ссылки (rateGroupId, направления рейсов), пустые поля.
 * Результат — список «что и на что заменить» в консоль и в scripts/out/.
 * Применение — отдельным шагом и только по согласованию.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandCompareKey, canonicalBrand, directoryKeyOf, type BrandKind } from '../src/utils/vehicleRecordNormalize';
import { directoryUsageCount } from '../src/utils/directoryUsage';

const DB = process.env.RATIPA_DB_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const get = async (path: string): Promise<unknown> => (await fetch(`${DB}/${path}.json`)).json();
const rows = (v: unknown): Array<[string, Record<string, unknown>]> => {
  if (!v || typeof v !== 'object') return [];
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as [string, unknown]) : Object.entries(v as Record<string, unknown>);
  return entries.filter(([, x]) => x && typeof x === 'object') as Array<[string, Record<string, unknown>]>;
};

interface Fix { group: string; path: string; action: string; note: string; auto: boolean }
const fixes: Fix[] = [];

const main = async () => {
  const [dirs, tractors, couplings, trailers, drivers, trips] = await Promise.all(
    ['directories', 'tractors', 'couplings', 'trailers', 'drivers', 'trips_dashboard'].map(get),
  );
  const d = (dirs || {}) as Record<string, unknown>;
  const data = { tractors, couplings, trailers, drivers, trips };

  // 1. Марки: дубли одной марки и «мусорные» ключи
  for (const [coll, kind] of [['vehicleBrands', 'vehicle'], ['trailerBrands', 'trailer']] as Array<[string, BrandKind]>) {
    const seen = new Map<string, string>();
    for (const [key, rec] of rows(d[coll])) {
      const text = String(rec.name || rec.key || key);
      const canon = canonicalBrand(kind, text);
      const cmp = brandCompareKey(kind, text.split('/')[kind === 'trailer' ? text.split('/').length - 1 : 0] || text);
      const target = canon ? directoryKeyOf(canon) : key;
      if (target !== key) {
        fixes.push({
          group: 'D1 Дубли марок', path: `directories/${coll}/${key}`, auto: true,
          action: `УДАЛИТЬ запись, ссылки перевести на «${target}»`,
          note: `«${rec.name}» — та же марка, что «${canon?.name}» (в ${directoryUsageCount(coll as 'vehicleBrands', { key, name: String(rec.name || '') }, data)} карточках)`,
        });
        continue;
      }
      if (seen.has(cmp)) {
        fixes.push({ group: 'D1 Дубли марок', path: `directories/${coll}/${key}`, auto: false, action: 'ОБЪЕДИНИТЬ', note: `совпадает с «${seen.get(cmp)}»` });
      }
      seen.set(cmp, key);
    }
    // Марки, которые есть в карточках, но отсутствуют в справочнике
    const used = new Set<string>();
    for (const src of kind === 'vehicle' ? [tractors, couplings] : [tractors, couplings]) {
      for (const [, r] of rows(src)) {
        const info = canonicalBrand(kind, kind === 'vehicle' ? r.brand : r.trailerBrand || r.trailerMake);
        if (info) used.add(directoryKeyOf(info));
      }
    }
    const have = new Set(rows(d[coll]).map(([k]) => k));
    for (const k of used) {
      if (!have.has(k)) fixes.push({ group: 'D2 Марки без записи', path: `directories/${coll}/${k}`, auto: true, action: `ДОБАВИТЬ {key:"${k}"}`, note: 'марка стоит в карточках, пункта в справочнике нет' });
    }
  }

  // 2. Ключ записи не совпадает с её id/dbKey (правка/удаление попадают «мимо»)
  for (const coll of ['directions', 'rateGroups']) {
    for (const [key, rec] of rows(d[coll])) {
      const want = String(rec.dbKey || rec.id || key);
      if (want !== key) {
        fixes.push({ group: 'D3 Ключ ≠ id', path: `directories/${coll}/${key}`, auto: true, action: `ПЕРЕНЕСТИ в directories/${coll}/${want}`, note: 'ключ узла отличается от dbKey/id записи' });
      }
    }
  }

  // 3. Ссылки на группы ставок: пустые и «висячие»
  const groupIds = new Set(rows(d.rateGroups).flatMap(([k, r]) => [k, String(r.id || '')]));
  for (const [label, src] of [['tractors', tractors], ['couplings', couplings], ['drivers', drivers]] as Array<[string, unknown]>) {
    for (const [key, r] of rows(src)) {
      const id = r.rateGroupId;
      if (id === undefined) continue;
      if (id === '' || id == null) fixes.push({ group: 'D4 Группа ставок не выбрана', path: `${label}/${key}/rateGroupId`, auto: false, action: 'ВЫБРАТЬ группу', note: 'пустое значение — ставка считается по запасному правилу' });
      else if (!groupIds.has(String(id))) fixes.push({ group: 'D5 Висячая группа ставок', path: `${label}/${key}/rateGroupId`, auto: false, action: 'ВЫБРАТЬ группу', note: `«${id}» нет в справочнике` });
    }
  }

  // 4. Направления рейсов, которых нет в справочнике, и рейсы без направления
  const dirNames = new Set(rows(d.directions).map(([, r]) => String(r.label || r.name || '').trim()));
  for (const [key, t] of rows(trips)) {
    const dir = String(t.direction || '').trim();
    if (!dir) fixes.push({ group: 'D6 Рейс без направления', path: `trips_dashboard/${key}/direction`, auto: false, action: 'УКАЗАТЬ направление', note: `рейс ${t.carNumber || key}` });
    else if (!dirNames.has(dir)) fixes.push({ group: 'D7 Направление не из справочника', path: `trips_dashboard/${key}/direction`, auto: false, action: 'ЗАМЕНИТЬ', note: `«${dir}»` });
  }

  // 5. Стандартные расстояния: города и названия
  const cities = ((await get('cities')) || {}) as Record<string, { name?: string }>;
  for (const [key, r] of rows(d.standardDistances)) {
    for (const side of ['from', 'to'] as const) {
      const cid = String(r[`${side}CityId`] || '');
      if (!cid || !cities[cid]) fixes.push({ group: 'D8 Расстояния: город', path: `directories/standardDistances/${key}/${side}CityId`, auto: false, action: 'ВЫБРАТЬ город', note: `«${r[side]}»` });
      else if (cities[cid].name !== r[side]) fixes.push({ group: 'D8 Расстояния: город', path: `directories/standardDistances/${key}/${side}`, auto: true, action: `ЗАМЕНИТЬ на «${cities[cid].name}»`, note: 'название не совпадает с городом' });
    }
    if (!(Number(r.km) > 0)) fixes.push({ group: 'D9 Расстояния: км', path: `directories/standardDistances/${key}/km`, auto: false, action: 'ЗАПОЛНИТЬ', note: `${r.from} — ${r.to}` });
  }

  const byGroup = new Map<string, Fix[]>();
  fixes.forEach((f) => byGroup.set(f.group, [...(byGroup.get(f.group) || []), f]));
  console.log('План исправлений справочников (только чтение)\nБаза:', DB, '\n');
  [...byGroup.entries()].sort().forEach(([g, list]) => {
    console.log(`── ${g}  [${list.every((f) => f.auto) ? 'АВТО' : 'нужно решение'}] — ${list.length}`);
    list.slice(0, 8).forEach((f) => console.log(`   ${f.path}\n      ${f.action} · ${f.note}`));
    if (list.length > 8) console.log(`   … и ещё ${list.length - 8}`);
  });
  const dir = join(process.cwd(), 'scripts', 'out');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `directory-fix-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(fixes, null, 2));
  console.log('\nПлан сохранён:', file, '(в базу ничего не записано)');
};

main().catch((e) => { console.error(e); process.exit(1); });
