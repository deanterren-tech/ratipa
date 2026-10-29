/**
 * plan-data-fixes — ПЛАН ИСПРАВЛЕНИЙ ДАННЫХ: автомобили, водители, справочники.
 * ТОЛЬКО ЧТЕНИЕ — в базу НИЧЕГО не записывается.
 *
 * Что делает: читает рабочую базу (REST, только GET), находит механические
 * ошибки и строит ПЛАН: «путь → было → станет». План печатается сводкой и
 * сохраняется целиком в scripts/out/data-fix-plan-<время>.json (каталог в
 * .gitignore, значения — настоящие, включая персональные данные: файл только
 * локальный). В консоли документы и телефоны показываются масками.
 *
 * Уровни:
 *   auto    — механическая правка без вариантов (одинаково выглядящие буквы,
 *             единый знак «x», нулевой год → пусто);
 *   confirm — правка понятна, но удаляет записи или трогает много записей:
 *             применять только после просмотра;
 *   manual  — нужно решение человека, правки в плане нет.
 *
 * Запись плана в базу — отдельный шаг (его здесь НЕТ): план применяется только
 * после просмотра и явного «да».
 *
 * Проверка «скрипт не пишет»: единственный сетевой вызов — fetch с method: 'GET';
 * firebase-admin и методы записи (set / update / remove / PUT / PATCH / DELETE)
 * в файле не используются (проверка: npm run test:plan-no-writes).
 *
 * Запуск:
 *   npx tsx scripts/plan-data-fixes.ts              # сводка (по 6 примеров на группу)
 *   npx tsx scripts/plan-data-fixes.ts --all        # все изменения
 *   npx tsx scripts/plan-data-fixes.ts --group=G1   # одна группа
 *   npx tsx scripts/plan-data-fixes.ts --brands=names   # марки по названию, а не по ключу
 *   RATIPA_DB=https://… npx tsx scripts/plan-data-fixes.ts   # другая база
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const ARGS = process.argv.slice(2);
const SHOW_ALL = ARGS.includes('--all');
const ONLY = (ARGS.find((a) => a.startsWith('--group=')) || '').slice('--group='.length).toUpperCase();
const OUT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'out');

// ───────────────────────── принятые написания (можно поменять) ─────────────────────────
/**
 * Как писать марку В КАРТОЧКЕ авто. Две формы приложения пишут по-разному:
 *   keys  — по КЛЮЧУ справочника заглавными (так пишет выпадающий список редактора
 *           сцепок: MERCEDES-BENZ, KOEGEL…) — значение совпадает с пунктом списка;
 *   names — по НАЗВАНИЮ (так пишет свободный ввод в форме «Автопарк и водители»:
 *           Mercedes-Benz, Kassbohrer…).
 * По умолчанию keys; режим names — флаг --brands=names.
 * Ключ сравнения: нижний регистр, без знаков (для тягача — ещё без слова «benz»,
 * для прицепа — oe→o).
 */
const BRAND_MODE: 'keys' | 'names' = ARGS.includes('--brands=names') ? 'names' : 'keys';
const VEHICLE_NAMES: Record<string, string> = { mercedes: 'Mercedes-Benz', volvo: 'Volvo', daf: 'DAF' };
const VEHICLE_KEYS: Record<string, string> = { mercedes: 'MERCEDES-BENZ', volvo: 'VOLVO', daf: 'DAF' };
const TRAILER_NAMES: Record<string, string> = { kogel: 'KOEGEL', schwarzmuller: 'Schwarzmuller', kassbohrer: 'Kassbohrer', kazberer: 'Kassbohrer' };
const TRAILER_KEYS: Record<string, string> = { kogel: 'KOEGEL', schwarzmuller: 'SCHWARZMULLER', kassbohrer: 'KASSBOHRER', kazberer: 'KASSBOHRER' };
const VEHICLE_BRANDS = BRAND_MODE === 'keys' ? VEHICLE_KEYS : VEHICLE_NAMES;
const TRAILER_BRANDS = BRAND_MODE === 'keys' ? TRAILER_KEYS : TRAILER_NAMES;
/** Страна города: слово → код (как у 98% записей справочника городов). */
const COUNTRY_FIX: Record<string, string> = {
  россия: 'RU', рф: 'RU', rus: 'RU', армения: 'AM', турция: 'TR', грузия: 'GE', рб: 'BY',
  иран: 'IR', германия: 'DE', болгария: 'BG', польша: 'PL',
};

// ───────────────────────── типы и вспомогательное ─────────────────────────
type Obj = Record<string, unknown>;
type Level = 'auto' | 'confirm';
interface Op { group: string; path: string; before: unknown; after: unknown; why: string; pii?: boolean }
interface Manual { area: 'Авто' | 'Водители' | 'Справочники'; text: string }

const GROUPS: Record<string, { title: string; level: Level }> = {
  G1: { title: 'Единое написание марок (тягач, прицеп)', level: 'auto' },
  G2: { title: 'Знак «x» в габаритах (латиница вместо кириллицы)', level: 'auto' },
  G3: { title: 'Нулевой год проверки паспорта → пусто', level: 'auto' },
  G4: { title: 'Страна города — код вместо слова', level: 'auto' },
  G5: { title: 'Документы водителей: кириллица → латиница', level: 'auto' },
  G6: { title: 'Города: латинские буквы внутри русских слов', level: 'confirm' },
  G7: { title: 'Двойные записи авто (латиница/кириллица, пробелы, дефисы)', level: 'confirm' },
  G8: { title: 'Даты водителей — единый вид ДД.ММ.ГГГГ', level: 'confirm' },
  G9: { title: 'Телефоны водителей — единый вид', level: 'confirm' },
  G10: { title: 'Реестр водителей ← карточки авто (пустые поля)', level: 'confirm' },
  G11: { title: 'Обрывки в реестре водителей (удаление)', level: 'confirm' },
  G12: { title: 'Справочник марок: объединить дубли', level: 'confirm' },
};

const ops: Op[] = [];
const manual: Manual[] = [];
const add = (group: string, path: string, before: unknown, after: unknown, why: string, pii = false) => ops.push({ group, path, before, after, why, pii });
const note = (area: Manual['area'], text: string) => manual.push({ area, text });

const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const entries = (v: unknown): Array<[string, Obj]> => Object.entries(asObj(v)).filter(([, x]) => x && typeof x === 'object' && !Array.isArray(x)) as Array<[string, Obj]>;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const LOOK: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };
const LOOK_BACK: Record<string, string> = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У', a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' };
const hasCyr = (s: string) => /[А-Яа-яЁё]/.test(s);
const hasLat = (s: string) => /[A-Za-z]/.test(s);
/** Номер без пробелов/дефисов, заглавными, похожие кириллические буквы → латиница. */
const np = (s: unknown) => String(s || '').toUpperCase().replace(/[АВЕКМНОРСТХУ]/g, (c) => LOOK[c]).replace(/[^A-Z0-9]/g, '');
/** Кириллические «двойники» в номере документа → латиница (только заглавные). */
const toLatinDoc = (s: string) => s.replace(/[АВЕКМНОРСТХУ]/g, (c) => LOOK[c]);
const shortName = (full: unknown) => {
  const p = str(full).split(/\s+/).filter(Boolean);
  return p.length ? p[0] + (p[1] ? ` ${p[1][0]}.` : '') + (p[2] ? `${p[2][0]}.` : '') : '(без имени)';
};
/** Для консоли: цифры → #, чтобы не печатать персональные данные. */
const mask = (v: unknown) => String(v ?? '∅').replace(/\d/g, '#');

const parseDate = (s: unknown): { y: number; m: number; d: number } | null => {
  const t = str(s);
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(t))) return { y: +m[3], m: +m[2], d: +m[1] };
  return null;
};
const fmtDate = (p: { y: number; m: number; d: number }) => `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}.${p.y}`;
const validDate = (p: { y: number; m: number; d: number } | null) => !!p && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31 && p.y >= 1900 && p.y <= 2100;

/** Телефон → единый вид; null — не удалось (неверное число цифр). */
const fmtPhone = (s: string): string | null => {
  const dg = s.replace(/\D/g, '');
  if (dg.length === 12 && dg.startsWith('375')) return `+375 ${dg.slice(3, 5)} ${dg.slice(5, 8)}-${dg.slice(8, 10)}-${dg.slice(10, 12)}`;
  if (dg.length === 11 && dg.startsWith('7')) return `+7 ${dg.slice(1, 4)} ${dg.slice(4, 7)}-${dg.slice(7, 9)}-${dg.slice(9, 11)}`;
  return null;
};

const brandKeyVehicle = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/g, '').replace(/benz/g, '');
const brandKeyTrailer = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '').replace(/oe/g, 'o');

async function rest(path: string): Promise<unknown> {
  try {
    const r = await fetch(`${DB}/${path}.json`, { method: 'GET' });
    if (!r.ok) {
      console.log(`  ! ${path}: HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.log(`  ! ${path}: ${String(e).slice(0, 100)}`);
    return null;
  }
}

/** Склейка двойников: объект-значения; конфликт — если у двух записей разные непустые значения поля. */
function planMerge(group: string, branch: string, canon: string, members: Array<[string, unknown]>, why: string): boolean {
  const objects = members.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  if (!objects) {
    const vals = [...new Set(members.map(([, v]) => JSON.stringify(v)).filter((x) => x && x !== 'null' && x !== '""'))];
    if (vals.length > 1) {
      note('Авто', `${branch}: двойники «${members.map(([k]) => k).join('» ↔ «')}» с разными значениями ${vals.join(' / ')} — выберите вручную`);
      return false;
    }
    const keep = members.find(([k]) => k === canon);
    if (!keep) add(group, `${branch}/${canon}`, null, JSON.parse(vals[0] || 'null'), why);
    members.filter(([k]) => k !== canon).forEach(([k, v]) => add(group, `${branch}/${k}`, v, null, why));
    return true;
  }
  const merged: Obj = {};
  const conflicts: string[] = [];
  // Порядок: сначала каноническая запись, затем остальные.
  const ordered = [...members].sort(([a], [b]) => (a === canon ? -1 : b === canon ? 1 : 0));
  for (const [, v] of ordered) {
    for (const [f, val] of Object.entries(asObj(v))) {
      const empty = val === '' || val === null || val === undefined;
      if (empty) continue;
      if (!(f in merged)) merged[f] = val;
      else if (!same(merged[f], val)) conflicts.push(f);
    }
  }
  if (conflicts.length) {
    note('Авто', `${branch}: двойники «${members.map(([k]) => k).join('» ↔ «')}» расходятся по полям ${[...new Set(conflicts)].join(', ')} — выберите вручную`);
    return false;
  }
  const canonVal = asObj(members.find(([k]) => k === canon)?.[1]);
  const has = members.some(([k]) => k === canon);
  for (const [f, val] of Object.entries(merged)) {
    if (!has || !same(canonVal[f], val)) add(group, `${branch}/${canon}/${f}`, has ? canonVal[f] ?? null : null, val, why);
  }
  members.filter(([k]) => k !== canon).forEach(([k, v]) => add(group, `${branch}/${k}`, v, null, `${why} (лишняя запись)`));
  return true;
}

async function main() {
  console.log(`План исправлений данных (только чтение)\nБаза: ${DB}\n`);
  const [tractors, couplings, trailers, vehicleFleet, vehicleStatuses, drivers, cities, directories, ferryCouples, baza, salaryHistory, driverTasks, knownFleet, knownFleetCars, carsPool] = await Promise.all(
    ['tractors', 'couplings', 'trailers', 'vehicleFleet', 'vehicle_statuses', 'drivers', 'cities', 'directories', 'ferryCouples', 'baza', 'salaryHistory', 'driverTasks', 'known_fleet', 'knownFleetCars', 'carsPool'].map(rest),
  );

  const T = entries(tractors);
  const C = entries(couplings);
  const Tr = entries(trailers);
  const Dr = entries(drivers);
  const Ci = entries(cities);
  const dir = asObj(directories);

  // ═════════ G1. марки ═════════
  const fixBrand = (path: string, rec: Obj, fields: string[], map: Record<string, string>, keyFn: (s: string) => string, kind: string) => {
    for (const f of fields) {
      const cur = str(rec[f]);
      if (!cur) continue;
      if (cur.includes('/')) {
        const tail = cur.split('/').pop()!.trim();
        note('Авто', `${path}/${f}: «${cur}» — пара «тягач / прицеп» в поле марки ${kind}; предложение: «${map[keyFn(tail)] || tail}»`);
        continue;
      }
      const want = map[keyFn(cur)];
      if (want && want !== cur) add('G1', `${path}/${f}`, rec[f], want, `марка ${kind}: «${cur}» → «${want}»`);
      if (!want) note('Авто', `${path}/${f}: марка «${cur}» не распознана (${kind}) — проверьте написание`);
    }
  };
  T.forEach(([k, t]) => {
    fixBrand(`tractors/${k}`, t, ['brand', 'brandModel', 'brands', 'brandsRu'], VEHICLE_BRANDS, brandKeyVehicle, 'тягача');
    fixBrand(`tractors/${k}`, t, ['trailerBrand', 'trailerMake', 'brandsLat'], TRAILER_BRANDS, brandKeyTrailer, 'прицепа');
  });
  C.forEach(([k, c]) => {
    fixBrand(`couplings/${k}`, c, ['brand'], VEHICLE_BRANDS, brandKeyVehicle, 'тягача');
    fixBrand(`couplings/${k}`, c, ['trailerBrand'], TRAILER_BRANDS, brandKeyTrailer, 'прицепа');
  });
  Tr.forEach(([k, t]) => fixBrand(`trailers/${k}`, t, ['trailerBrand'], TRAILER_BRANDS, brandKeyTrailer, 'прицепа'));
  const noBrand = T.filter(([, t]) => !str(t.brand) && !str(t.brands) && !str(t.brandModel) && !str(t.brandRu) && str(t.carNumber));
  if (noBrand.length) note('Авто', `У ${noBrand.length} тягачей марка не указана ни в одном поле: ${noBrand.map(([, t]) => str(t.carNumber)).join(', ')}`);
  const brandRuTypos = T.filter(([, t]) => /бенз/i.test(str(t.brandRu)));
  brandRuTypos.forEach(([k, t]) => note('Авто', `tractors/${k}/brandRu: «${str(t.brandRu)}» — вероятная опечатка («Бенц»)`));

  // ═════════ G2. габариты ═════════
  const fixDims = (branch: string, list: Array<[string, Obj]>) =>
    list.forEach(([k, r]) => {
      const cur = str(r.dimensions);
      if (/[хХ]/.test(cur)) add('G2', `${branch}/${k}/dimensions`, r.dimensions, cur.replace(/[хХ]/g, 'x'), 'кириллическая «х» → латинская «x»');
    });
  fixDims('tractors', T);
  fixDims('couplings', C);
  fixDims('ferryCouples', entries(ferryCouples));
  entries(ferryCouples).forEach(([k, f]) => {
    const m = str(f.model);
    if (m && (/\d{2,}$/.test(m) && /[A-Za-z]\d{3,}$/.test(m) || /^\d+$/.test(m))) note('Авто', `ferryCouples/${k}/model: «${m}» — похоже на ошибочный ввод (марка тягача)`);
  });

  // ═════════ G3. нулевой год проверки паспорта ═════════
  T.forEach(([k, t]) => {
    if (t.lastPassportVerificationYear === 0) add('G3', `tractors/${k}/lastPassportVerificationYear`, 0, null, 'ноль вместо «не проверялось» (форма сохранения пишет 0)');
  });

  // ═════════ G4–G5(города): страна и названия ═════════
  Ci.forEach(([k, c]) => {
    const country = str(c.country);
    const fix = COUNTRY_FIX[country.toLowerCase()];
    if (country && fix && fix !== country) add('G4', `cities/${k}/country`, c.country, fix, `страна «${country}» → код «${fix}»`);
    const name = str(c.name);
    if (name) {
      const fixed = name
        .split(/(\s+|-)/)
        .map((w) => {
          if (!(hasCyr(w) && hasLat(w))) return w;
          const cyrCount = (w.match(/[А-Яа-яЁё]/g) || []).length;
          const latCount = (w.match(/[A-Za-z]/g) || []).length;
          if (cyrCount < latCount) return w;
          return w.replace(/[A-Za-z]/g, (ch) => LOOK_BACK[ch] || ch);
        })
        .join('');
      if (fixed !== name && !hasLat(fixed.replace(/[^A-Za-z]/g, '')) ) add('G6', `cities/${k}/name`, c.name, fixed, 'латинские буквы внутри русского слова → кириллица');
      else if (fixed !== name) note('Справочники', `cities/${k}: «${name}» — смесь алфавитов, автозамена неоднозначна`);
    }
  });
  const noCountry = Ci.filter(([, c]) => !str(c.country));
  if (noCountry.length) {
    const used = noCountry.filter(([, c]) => Number(c.usageCount) > 0).length;
    note('Справочники', `Городов без страны: ${noCountry.length} (используются в расчётах: ${used}), все без координат — страну по названию не угадать, заполнить вручную (например: ${noCountry.slice(0, 5).map(([, c]) => `«${str(c.name)}»`).join(', ')})`);
  }
  const accents = Ci.filter(([, c]) => /[̀-ͯ]/.test(str(c.name)));
  accents.forEach(([k, c]) => {
    const clean = str(c.name).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
    const twin = Ci.find(([k2, c2]) => k2 !== k && str(c2.name).toLowerCase() === clean.toLowerCase() && str(c2.country) === str(c.country));
    note('Справочники', `Город «${str(c.name)}» (знак ударения) ${twin ? `дублирует «${str(twin[1].name)}» — объединить вручную: у записей разное число использований (${Number(c.usageCount) || 0} и ${Number(twin[1].usageCount) || 0})` : 'содержит знак ударения'}`);
  });

  // ═════════ G7. двойные записи авто ═════════
  const twinGroups = (branch: string, obj: unknown) => {
    const m = new Map<string, Array<[string, unknown]>>();
    Object.entries(asObj(obj)).forEach(([k, v]) => {
      const key = np(k);
      if (!key) return;
      (m.get(key) || m.set(key, []).get(key)!).push([k, v]);
    });
    return [...m.entries()].filter(([, v]) => v.length > 1).map(([key, v]) => ({ branch, key, members: v }));
  };
  for (const g of twinGroups('vehicleFleet', vehicleFleet)) {
    planMerge('G7', 'vehicleFleet', g.key, g.members, `двойник автомобиля ${g.key}`);
  }
  for (const g of twinGroups('vehicle_statuses', vehicleStatuses)) planMerge('G7', 'vehicle_statuses', g.key, g.members, `двойник автомобиля ${g.key}`);
  for (const [branch, obj] of [['tractors', tractors], ['couplings', couplings]] as const) {
    for (const g of twinGroups(branch, obj)) {
      const main = g.members.find(([, v]) => str(asObj(v).carNumber)) || g.members[0];
      planMerge('G7', branch, main[0], g.members, `кириллический/неполный двойник ${g.key}`);
    }
  }
  // ключи, не совпадающие с номером
  T.forEach(([k, t]) => {
    const car = str(t.carNumber);
    if (!car) return;
    if (/^\d{10,}$/.test(k)) note('Авто', `tractors/${k}: ключ — число (время создания), а номер «${car}»; перенос на ключ ${np(car)} затрагивает id в tractors/couplings/истории — вручную`);
    else if (np(k) !== np(car)) note('Авто', `tractors/${k}: ключ от старого номера, сейчас «${car}»; в vehicleFleet/vehicle_statuses остался старый ключ ${k}, нового ${np(car)} нет — переименовать вручную`);
  });
  // прицепы: цифровые ключи, двойники по номеру, отсутствующие
  const trByNum = new Map<string, string[]>();
  Tr.forEach(([k, t]) => {
    const n = np(str(t.trailerNumber) || str(t.number) || k);
    (trByNum.get(n) || trByNum.set(n, []).get(n)!).push(k);
  });
  [...trByNum.entries()].filter(([, v]) => v.length > 1).forEach(([n, v]) => note('Авто', `Прицеп ${n} записан дважды: ${v.map((x) => `«${x}»`).join(' и ')} — оставить одну запись (какую — выберите)`));
  Tr.filter(([k]) => /^\d+$/.test(k)).forEach(([k, t]) => {
    if (!str(t.trailerNumber) && !str(t.number)) note('Авто', `trailers/${k}: ключ из одних цифр и нет номера (только марка «${str(t.trailerBrand)}») — буквы номера потерялись; проверьте, к какому тягачу относится`);
  });
  const trKeys = new Set(Tr.map(([k]) => np(k)).concat(Tr.map(([, t]) => np(t.trailerNumber)).filter(Boolean)));
  T.forEach(([k, t]) => {
    const tn = str(t.trailerNumber);
    if (tn && !trKeys.has(np(tn))) note('Авто', `Тягач ${str(t.carNumber) || k}: прицепа «${tn}» нет в списке прицепов`);
  });

  // ═════════ G12. справочник марок (directories/*) ═════════
  const dirFix = (name: 'vehicleBrands' | 'trailerBrands', names: Record<string, string>, keys: Record<string, string>, keyFn: (s: string) => string) => {
    const items = entries(dir[name]);
    const byKey = new Map<string, Array<[string, Obj]>>();
    items.forEach(([k, v]) => {
      const nm = str(v.name) || k;
      if (nm.includes('/')) {
        add('G12', `directories/${name}/${k}`, v, null, `«${nm}» — это пара тягач/прицеп, а не марка`);
        return;
      }
      const canonKey = keys[keyFn(nm)];
      if (!canonKey) return;
      (byKey.get(canonKey) || byKey.set(canonKey, []).get(canonKey)!).push([k, v]);
    });
    byKey.forEach((list, canonKey) => {
      const canonName = names[keyFn(str(list[0][1].name) || list[0][0])];
      const keep = list.find(([k]) => k === canonKey) || list[0];
      if (str(keep[1].name) !== canonName) add('G12', `directories/${name}/${keep[0]}/name`, keep[1].name, canonName, `единое название «${canonName}»`);
      list.filter(([k]) => k !== keep[0]).forEach(([k, v]) => add('G12', `directories/${name}/${k}`, v, null, `дубль марки «${canonName}» (ключ ${k})`));
    });
    if (name === 'trailerBrands') {
      const have = new Set(items.map(([, v]) => keyFn(str(v.name))));
      new Set(Object.values(keys)).forEach((canonKey) => {
        const bk = Object.keys(keys).find((x) => keys[x] === canonKey)!;
        const used = T.some(([, t]) => keyFn(str(t.trailerBrand)) === bk || (keys[keyFn(str(t.trailerBrand))] === canonKey)) || Tr.some(([, t]) => keys[keyFn(str(t.trailerBrand))] === canonKey);
        if (used && !have.has(bk)) add('G12', `directories/trailerBrands/${canonKey}`, null, { name: names[bk], key: canonKey }, `марка «${names[bk]}» есть в карточках, но нет в справочнике`);
      });
    }
  };
  dirFix('vehicleBrands', VEHICLE_NAMES, VEHICLE_KEYS, brandKeyVehicle);
  dirFix('trailerBrands', TRAILER_NAMES, TRAILER_KEYS, brandKeyTrailer);
  note('Справочники', 'Старые копии справочника марок на корне базы (vehicleBrands, trailerBrands, brands) приложение ещё читает (firebase.ts:1524–1552); в них те же разночтения — привести к тем же названиям после решения, нужны ли они.');
  note('Справочники', 'Корень проблемы с марками: при сохранении карточки приложение само создаёт запись в справочнике из введённого текста (firebase.ts:1739–1749), поэтому «Kogel» и «KOEGEL» снова разойдутся — нужна правка кода (приводить к единому написанию перед сохранением).');

  // ═════════ водители ═════════
  // G5 документы: кириллица → латиница
  const docFields = ['passport', 'personalId', 'license', 'licenseNumber'];
  Dr.forEach(([k, d]) => {
    docFields.forEach((f) => {
      const cur = str(d[f]);
      if (!cur || !hasCyr(cur)) return;
      const fixed = toLatinDoc(cur);
      if (hasCyr(fixed)) note('Водители', `drivers/${k} (${shortName(d.name)}): в поле ${f} есть кириллица без латинской пары («${mask(cur)}») — исправить вручную`);
      else add('G5', `drivers/${k}/${f}`, d[f], fixed, `${f}: кириллица → латиница (${shortName(d.name)})`, true);
    });
  });
  T.forEach(([k, t]) => {
    ['passportNumber', 'personalId', 'licenseNumber'].forEach((f) => {
      const cur = str(t[f]);
      if (!cur || !hasCyr(cur)) return;
      const fixed = toLatinDoc(cur);
      if (!hasCyr(fixed)) add('G5', `tractors/${k}/${f}`, t[f], fixed, `${f}: кириллица → латиница (карточка ${str(t.carNumber) || k})`, true);
    });
  });

  // G8 даты
  Dr.forEach(([k, d]) => {
    ['birthDate', 'passportStart', 'passportEnd'].forEach((f) => {
      const cur = str(d[f]);
      if (!cur) return;
      const p = parseDate(cur);
      if (!validDate(p)) {
        note('Водители', `drivers/${k} (${shortName(d.name)}): ${f} «${mask(cur)}» не распознана`);
        return;
      }
      const want = fmtDate(p!);
      if (want !== cur) add('G8', `drivers/${k}/${f}`, d[f], want, `${f}: «${mask(cur)}» → «${mask(want)}»`, true);
    });
  });
  note('Водители', 'Даты в карточках тягачей тоже в разных видах, а форма сохранения карточки пишет ISO (toISODate, VehicleDriverDataModule) — без правки кода формат снова разойдётся; карточки в этот план не включены.');

  // G9 телефоны
  const phoneOwners = new Map<string, string[]>();
  Dr.forEach(([k, d]) => {
    const list = Array.isArray(d.phones) ? (d.phones as unknown[]) : [];
    list.forEach((p, i) => {
      const num = str(asObj(p).number);
      if (!num) return;
      const dg = num.replace(/\D/g, '');
      (phoneOwners.get(dg) || phoneOwners.set(dg, []).get(dg)!).push(k);
      const want = fmtPhone(num);
      if (!want) note('Водители', `drivers/${k} (${shortName(d.name)}): телефон «${mask(num)}» — ${dg.length} цифр, ожидается 12 (375…) или 11 (7…) — исправить вручную`);
      else if (want !== num) add('G9', `drivers/${k}/phones/${i}/number`, num, want, `телефон: «${mask(num)}» → «${mask(want)}»`, true);
    });
    const one = str(d.phone);
    if (one) {
      const want = fmtPhone(one);
      if (want && want !== one) add('G9', `drivers/${k}/phone`, one, want, `телефон: «${mask(one)}» → «${mask(want)}»`, true);
      const primary = list.map(asObj).find((p) => p.isPrimary) || list.map(asObj)[0];
      if (primary && one.replace(/\D/g, '') !== str(primary.number).replace(/\D/g, '')) note('Водители', `drivers/${k} (${shortName(d.name)}): одиночное поле phone не совпадает с основным номером из списка phones — решить, какой верный`);
    }
  });
  [...phoneOwners.entries()].filter(([, v]) => new Set(v).size > 1).forEach(([, v]) => note('Водители', `Один номер телефона у разных водителей: ${[...new Set(v)].map((id) => `${shortName(asObj(asObj(drivers)[id]).name)} [${id}]`).join(' и ')} — у одного из них опечатка`));

  // личные номера: невозможная дата / расхождение с датой рождения
  Dr.forEach(([k, d]) => {
    const pid = str(d.personalId);
    if (!/^\d{7}[A-Z]\d{3}[A-Z]{2}\d$/.test(toLatinDoc(pid))) return;
    const dd = +pid.slice(1, 3);
    const mm = +pid.slice(3, 5);
    const yy = +pid.slice(5, 7);
    const c = pid[0];
    const century = c === '1' || c === '2' ? 1800 : c === '3' || c === '4' ? 1900 : 2000;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
      note('Водители', `drivers/${k} (${shortName(d.name)}): личный номер содержит невозможную дату (день ${dd}, месяц ${mm}) — опечатка в номере`);
      return;
    }
    const b = parseDate(d.birthDate);
    if (b && (b.d !== dd || b.m !== mm || b.y !== century + yy)) note('Водители', `drivers/${k} (${shortName(d.name)}): дата рождения в карточке не совпадает с датой в личном номере — одно из двух неверно`);
  });

  // G10 реестр ← карточки
  const FILL: Array<[string, string, boolean]> = [
    ['passport', 'passportNumber', true], ['passportStart', 'passportStart', false], ['passportEnd', 'passportEnd', false],
    ['passportIssued', 'passportIssuedBy', false], ['personalId', 'personalId', true], ['nameLat', 'driverNameLat', false],
    ['birthDate', 'birthDate', false], ['licenseNumber', 'licenseNumber', true],
  ];
  const dateFields = new Set(['passportStart', 'passportEnd', 'birthDate']);
  let phonesOnlyOnCards = 0;
  Dr.forEach(([k, d]) => {
    const cards = T.filter(([, t]) => str(t.driverId) === k);
    cards.forEach(([tk, t]) => {
      FILL.forEach(([regF, cardF, isDoc]) => {
        let val = str(t[cardF]);
        if (!val) return;
        if (isDoc) val = toLatinDoc(val);
        if (dateFields.has(regF)) {
          const p = parseDate(val);
          if (!validDate(p)) return;
          val = fmtDate(p!);
        }
        const cur = str(d[regF]);
        if (regF === 'licenseNumber' && (str(d.license) || cur)) {
          if (!cur && str(d.license) && toLatinDoc(str(d.license)).replace(/\s/g, '') !== val.replace(/\s/g, '')) note('Водители', `drivers/${k} (${shortName(d.name)}): номер прав в реестре и в карточке ${str(t.carNumber) || tk} различается`);
          return;
        }
        if (!cur) add('G10', `drivers/${k}/${regF}`, null, val, `${regF} ← карточка ${str(t.carNumber) || tk} (${shortName(d.name)})`, true);
        else {
          const norm = (x: string) => (dateFields.has(regF) ? x : toLatinDoc(x).replace(/\s/g, '').toLowerCase());
          if (norm(cur) !== norm(val) && !(dateFields.has(regF) && parseDate(cur) && fmtDate(parseDate(cur)!) === val)) note('Водители', `drivers/${k} (${shortName(d.name)}): ${regF} в реестре и в карточке ${str(t.carNumber) || tk} различается — решить, какое верное`);
        }
      });
      const cardPhones = (Array.isArray(t.phones) ? (t.phones as unknown[]) : []).map((p) => (typeof p === 'string' ? p : str(asObj(p).number))).filter(Boolean);
      const regDigits = new Set((Array.isArray(d.phones) ? (d.phones as unknown[]) : []).map((p) => str(asObj(p).number).replace(/\D/g, '')));
      if (cardPhones.some((p) => !regDigits.has(p.replace(/\D/g, '')))) phonesOnlyOnCards += 1;
    });
  });
  if (phonesOnlyOnCards) note('Водители', `У ${phonesOnlyOnCards} водителей в карточках авто есть телефоны, которых нет в реестре — добавить вручную (формат списка phones в план не включён)`);

  // G11 обрывки реестра
  const haystack = [tractors, couplings, baza, salaryHistory, driverTasks, ferryCouples].map((x) => JSON.stringify(x ?? null)).join('\n');
  Dr.forEach(([k, d]) => {
    const name = str(d.name);
    const noDocs = !str(d.passport) && !str(d.personalId) && !(Array.isArray(d.phones) && d.phones.length) && !str(d.phone);
    const referenced = haystack.includes(`"${k}"`);
    if (!/\s/.test(name) && noDocs && !referenced) add('G11', `drivers/${k}`, d, null, `обрывок «${name}»: одно слово, нет документов и телефона, ссылок на запись нет`, true);
  });
  Dr.filter(([, d]) => str(d.name) && str(d.name).split(/\s+/).length < 3).forEach(([k, d]) => {
    if (!ops.some((o) => o.path === `drivers/${k}`)) note('Водители', `drivers/${k}: «${str(d.name)}» — ФИО неполное (нет отчества)`);
  });
  const noParts = Dr.filter(([, d]) => !str(d.lastNameRu) || !str(d.firstNameRu) || !str(d.middleNameRu)).length;
  if (noParts) note('Водители', `ФИО не разложено на фамилию/имя/отчество у ${noParts} записей реестра`);
  const noDisp = Dr.filter(([, d]) => !str(d.dispatcherName) || !str(d.dispatcherId));
  if (noDisp.length) note('Водители', `Без диспетчера: ${noDisp.map(([k, d]) => `${shortName(d.name)} [${k}]`).join('; ')}`);

  // устаревшие списки
  const tractorPlates = new Set(T.map(([, t]) => np(t.carNumber)));
  const stale = [...Object.keys(asObj(knownFleet)), ...Object.values(asObj(knownFleetCars)).flatMap((v) => Object.keys(asObj(v)))].filter((p) => !tractorPlates.has(np(p)));
  if (stale.length) note('Авто', `Старые списки known_fleet / knownFleetCars содержат номера, которых нет среди тягачей: ${[...new Set(stale)].join(', ')}`);
  if (Object.keys(asObj(carsPool)).length) note('Авто', `carsPool — старые группы ставок (${entries(carsPool).map(([, g]) => `${str(g.name)} = ${g.rate}`).join(', ')}), которых нет в справочнике групп; решить, удалять ли ветку`);
  // группа ставок
  const rgIds = new Set(entries(dir.rateGroups).flatMap(([k, v]) => [k, str(v.id)]));
  T.forEach(([k, t]) => {
    const g = entries(dir.rateGroups).map(([, v]) => v).find((v) => str(v.id) === str(t.rateGroupId));
    if (g && t.rate != null && Number(g.rate) !== Number(t.rate)) note('Авто', `Тягач ${str(t.carNumber) || k}: ставка ${t.rate} ≠ ставке его группы «${str(g.name)}» (${g.rate})`);
    if (t.rateGroupId && !rgIds.has(str(t.rateGroupId))) note('Авто', `Тягач ${str(t.carNumber) || k}: группа ставок «${t.rateGroupId}» отсутствует в справочнике`);
  });
  let rgMis = 0;
  T.forEach(([k, t]) => {
    const c = C.find(([ck, cv]) => np(ck) === np(k) || np(cv.carNumber) === np(t.carNumber));
    if (c && str(t.rateGroupId) !== str(c[1].rateGroupId)) rgMis += 1;
  });
  if (rgMis) note('Авто', `Группа ставок у тягача и у его сцепки расходится у ${rgMis} автомобилей (где-то пусто, где-то заполнено) — заполнить в обоих местах одинаково`);

  // ═════════ вывод ═════════
  const levelOf = (g: string): Level => GROUPS[g].level;
  console.log('Принятые написания (можно поменять в начале скрипта):');
  console.log(`  марки в карточках авто (режим --brands=${BRAND_MODE}): тягачи — ${[...new Set(Object.values(VEHICLE_BRANDS))].join(', ')}; прицепы — ${[...new Set(Object.values(TRAILER_BRANDS))].join(', ')}`);
  console.log(`  другой вариант: --brands=${BRAND_MODE === 'keys' ? 'names' : 'keys'}`);
  console.log('  страна города — двухбуквенный код (RU, TR, CN…); габариты — «x» латиницей; даты — ДД.ММ.ГГГГ; телефоны — +375 29 123-45-67 / +7 905 123-45-67\n');

  const ids = Object.keys(GROUPS);
  const show = ONLY ? ids.filter((g) => g === ONLY) : ids;
  const label = (l: Level) => (l === 'auto' ? 'АВТО — механическая правка' : 'ПОДТВЕРДИТЬ — после просмотра');
  for (const g of show) {
    const list = ops.filter((o) => o.group === g);
    const recs = new Set(list.map((o) => o.path.split('/').slice(0, 2).join('/'))).size;
    console.log(`── ${g}. ${GROUPS[g].title}  [${label(levelOf(g))}]  — изменений: ${list.length}, записей: ${recs}`);
    if (!list.length) continue;
    const lim = SHOW_ALL ? list.length : 6;
    list.slice(0, lim).forEach((o) => {
      const fmtV = (v: unknown) => (o.pii ? mask(typeof v === 'object' && v !== null ? '{запись}' : v) : v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : `«${String(v)}»`);
      const del = o.after === null && o.before !== null && o.before !== 0;
      console.log(`   ${o.path}`);
      console.log(`      ${del ? 'УДАЛИТЬ' : o.before === null ? 'ДОБАВИТЬ' : 'ЗАМЕНИТЬ'}: ${del ? fmtV(o.before) : `${fmtV(o.before)} → ${fmtV(o.after)}`}   · ${o.why}`);
    });
    if (list.length > lim) console.log(`   … и ещё ${list.length - lim} (весь список: --group=${g} --all)`);
  }

  if (!ONLY) {
    console.log('\n══ ТРЕБУЮТ РЕШЕНИЯ ЧЕЛОВЕКА (в плане правок нет) ══');
    (['Авто', 'Водители', 'Справочники'] as const).forEach((area) => {
      const list = manual.filter((m) => m.area === area);
      console.log(`\n  ${area} — ${list.length}`);
      (SHOW_ALL ? list : list.slice(0, 14)).forEach((m) => console.log(`   · ${m.text}`));
      if (!SHOW_ALL && list.length > 14) console.log(`   … и ещё ${list.length - 14} (--all)`);
    });
  }

  const byGroup = ids.map((g) => `${g}: ${ops.filter((o) => o.group === g).length}`).join('  ');
  console.log(`\nИтого изменений: ${ops.length}  (${byGroup})`);
  console.log(`Автоматических: ${ops.filter((o) => levelOf(o.group) === 'auto').length}, на подтверждение: ${ops.filter((o) => levelOf(o.group) === 'confirm').length}, вопросов человеку: ${manual.length}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(OUT_DIR, `data-fix-plan-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ db: DB, createdAt: new Date().toISOString(), brandMode: BRAND_MODE, groups: GROUPS, ops, manual }, null, 2));
  console.log(`\nПлан сохранён: ${file}\nВ базу ничего не записано.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
