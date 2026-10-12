/**
 * Импорт городов из GeoNames (официальные дампы download.geonames.org) в
 * справочник `cities`.
 *
 * Что делает
 *  - Берёт официальные дампы: cities5000.zip (населённые пункты), при отсутствии
 *    cities15000.zip; alternateNamesV2.zip — для русских названий (isoLanguage=ru).
 *    Если дампов нет — скачивает (curl), если распакованных .txt нет — распаковывает
 *    (unzip). Никакие данные не выдумываются: только строки из дампов.
 *  - Настройки (admin, «Настройки → Справочник городов») из `appSettings/geonames`:
 *    список стран ISO-2 (по умолчанию BY, RU, KZ, CN, TR, UZ, TJ, AM, GE, MN, KG)
 *    и порог населения (15000; для BY, KZ, UZ, TJ, AM, GE, MN, KG — 5000).
 *    CLI-флаги перекрывают настройки.
 *  - Запись: id, name (русское, иначе основное), country, aliases[], geonameId,
 *    lat, lng, population, type='город', source='geonames', createdAt.
 *  - ИДЕМПОТЕНТНОСТЬ: поиск по geonameId, затем по нормализованному
 *    названию/алиасам; при совпадении — ДОПОЛНИТЬ aliases/geonameId/координаты,
 *    НЕ переименовывать и НЕ затирать записи (source user/migration сохраняются);
 *    дубли по нормализованному названию не создаются (в т.ч. внутри прогона).
 *    Границы/таможни/терминалы (type ≠ «город») не трогаются вовсе.
 *  - По умолчанию — только ОТЧЁТ (dry-run): по каждой стране Найдено /
 *    Будет создано / Дополнено / Пропущено (с причинами).
 *  - С `--apply` (подтверждение владельца): БЭКАП ветки `cities` ДО записи,
 *    пакеты ≤500 путей, прогресс и ЧЕКПОЙНТ-файл (продолжение после сбоя).
 *
 * Запуск
 *   npx tsx scripts/import-geonames.ts                     # dry-run (ничего не пишет)
 *   npx tsx scripts/import-geonames.ts --only=BY           # только Беларусь
 *   npx tsx scripts/import-geonames.ts --apply --yes       # запись после бэкапа
 *   npx tsx scripts/import-geonames.ts --data-dir=DIR      # каталог дампов
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { adminDb } from '../firebaseAdmin.ts';
import { normalizeCityName } from '../src/utils/cityDirectory.ts';
import {
  GEONAMES_DEFAULT_COUNTRIES,
  GEONAMES_DEFAULT_THRESHOLD,
  GEONAMES_SMALL_THRESHOLD,
  buildGeonamesCity,
  decideCityImport,
  parseAlternateNameRow,
  parseCitiesRow,
  resolveGeonamesSettings,
  thresholdForCountry,
  CityIndex,
  type GeonamesRow,
  type GeonamesSettings,
  type ExistingCityEntry,
} from '../src/utils/geonames.ts';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const SAY_YES = ARGS.includes('--yes');
const ONLY_JSON = ARGS.includes('--json');
const REBUILD_RU = ARGS.includes('--rebuild-ru');
const ONLY = ((ARGS.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').toUpperCase();
const LIMIT = Number((ARGS.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0) || 0;
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities2';
const DATA_DIR =
  (ARGS.find((a) => a.startsWith('--data-dir=')) || '').split('=').slice(1).join('=') ||
  join(OUT_DIR, 'geonames');
const CLI_COUNTRIES = ((ARGS.find((a) => a.startsWith('--countries=')) || '').split('=')[1] || '')
  .toUpperCase().split(',').map((s) => s.trim()).filter((s) => /^[A-Z]{2}$/.test(s));
const CLI_THRESHOLD = Number((ARGS.find((a) => a.startsWith('--threshold=')) || '').split('=')[1] || 0) || 0;
const CLI_SMALL = Number((ARGS.find((a) => a.startsWith('--small-threshold=')) || '').split('=')[1] || 0) || 0;

const BATCH = 500; // ≤500 путей на один update (пакетная запись)
const MAX_LATIN_DISPLAY = 40; // сколько примеров в отчёте

const objOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

const ensureDumps = (): { citiesTxt: string; altTxt: string | null } => {
  mkdirSync(DATA_DIR, { recursive: true });
  const want = ['cities5000', 'cities15000'];
  let citiesTxt: string | null = null;
  for (const base of want) {
    const txt = join(DATA_DIR, `${base}.txt`);
    const zip = join(DATA_DIR, `${base}.zip`);
    if (existsSync(txt)) { citiesTxt = txt; break; }
    if (!existsSync(zip)) {
      console.log(`[geonames] скачиваю ${base}.zip…`);
      execFileSync('curl', ['-sS', '-o', zip, `https://download.geonames.org/export/dump/${base}.zip`], { stdio: 'inherit' });
    }
    console.log(`[geonames] распаковываю ${base}.zip…`);
    execFileSync('unzip', ['-o', zip, '-d', DATA_DIR], { stdio: 'inherit' });
    if (existsSync(txt)) { citiesTxt = txt; break; }
  }
  if (!citiesTxt) throw new Error('cities5000/cities15000 txt недоступны — скачайте дампы вручную в ' + DATA_DIR);
  let altTxt: string | null = join(DATA_DIR, 'alternateNamesV2.txt');
  if (!existsSync(altTxt)) {
    const zip = join(DATA_DIR, 'alternateNamesV2.zip');
    if (!existsSync(zip)) {
      console.log('[geonames] скачиваю alternateNamesV2.zip (≈205 МБ)…');
      execFileSync('curl', ['-sS', '-o', zip, 'https://download.geonames.org/export/dump/alternateNamesV2.zip'], { stdio: 'inherit' });
    }
    console.log('[geonames] распаковываю alternateNamesV2.zip…');
    execFileSync('unzip', ['-o', zip, '-d', DATA_DIR], { stdio: 'inherit' });
    altTxt = existsSync(altTxt) ? altTxt : null;
  }
  return { citiesTxt, altTxt };
};

/** Потоковый разбор строк TSV. */
async function readTsv<T>(path: string, parse: (line: string) => T | null, onRow: (row: T) => void, label = ''): Promise<number> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    const row = parse(line);
    if (row) onRow(row);
    n += 1;
    if (label && n % 2000000 === 0) console.log(`[geonames] ${label}: прочитано строк ${n}…`);
  }
  rl.close();
  return n;
}

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[geonames] Firebase Admin недоступен (нет service-account).');
    return 2;
  }

  // --- настройки: CLI > appSettings/geonames > умолчания ---
  const rawSettings = (await adminDb.ref('appSettings/geonames').get()).val();
  const settings: GeonamesSettings = resolveGeonamesSettings({
    ...objOf(rawSettings),
    ...(CLI_COUNTRIES.length ? { countries: CLI_COUNTRIES } : {}),
    ...(CLI_THRESHOLD ? { threshold: CLI_THRESHOLD } : {}),
    ...(CLI_SMALL ? { smallThreshold: CLI_SMALL } : {}),
  });
  if (ONLY) settings.countries = [ONLY];
  console.log(`[geonames] Страны: ${settings.countries.join(', ')}; порог ${settings.threshold}; малые страны — ${settings.smallThreshold}`);
  const thresholds = settings.countries.map((c) => `${c}≥${thresholdForCountry(settings, c)}`).join(', ');
  console.log(`[geonames] Пороги: ${thresholds}`);

  const { citiesTxt, altTxt } = ensureDumps();
  console.log(`[geonames] Дамп: ${citiesTxt}`);

  // --- отбор городов по странам/порогам ---
  const selected: GeonamesRow[] = [];
  const perCountryFound = new Map<string, number>();
  {
    const wanted = new Set(settings.countries);
    const rl = createInterface({ input: createReadStream(citiesTxt, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      const row = parseCitiesRow(line);
      if (!row || !wanted.has(row.country) || row.featureClass !== 'P') continue;
      perCountryFound.set(row.country, (perCountryFound.get(row.country) || 0) + 1);
      if (row.featureCode === 'PPLC' || row.population >= thresholdForCountry(settings, row.country)) {
        selected.push(row);
      }
    }
    rl.close();
  }
  console.log(`[geonames] Найдено строк-городов: ${selected.length} (по странам: ${settings.countries.map((c) => `${c}=${perCountryFound.get(c) || 0}`).join(', ')})`);
  if (LIMIT) {
    selected.splice(LIMIT);
    console.log(`[geonames] Ограничение --limit: оставлено ${selected.length}`);
  }

  // --- русские названия (alternateNamesV2, isoLanguage=ru), с кэшем ---
  const ruCachePath = join(DATA_DIR, 'ru-names-cache.json');
  const idsWanted = new Set(selected.map((r) => r.geonameId));
  let ruMap = new Map<number, string[]>();
  /** Полный кэш (все страны прошлых прогонов) — объединяем, а не затираем. */
  const cacheAll = new Map<number, string[]>();
  if (existsSync(ruCachePath)) {
    try {
      const cached = JSON.parse(readFileSync(ruCachePath, 'utf8')) as Record<string, string[]>;
      Object.entries(cached).forEach(([k, v]) => {
        const id = Number(k);
        if (Number.isFinite(id) && Array.isArray(v)) cacheAll.set(id, v);
      });
    } catch (e) {
      console.warn('[geonames] кэш ru-названий не прочитан:', (e as Error).message);
    }
  }
  if (!REBUILD_RU) {
    idsWanted.forEach((id) => {
      const v = cacheAll.get(id);
      if (v) ruMap.set(id, v);
    });
  } else {
    cacheAll.clear();
  }
  console.log(`[geonames] Кэш русских названий: покрыто ${ruMap.size}/${idsWanted.size}`);
  if (ruMap.size < idsWanted.size && altTxt) {
    const preferred = new Map<number, string>();
    const any = new Map<number, string[]>();
    console.log(`[geonames] Читаю ${altTxt} (извлекаю isoLanguage=ru для ${idsWanted.size} городов)…`);
    const t0 = Date.now();
    await readTsv(
      altTxt,
      parseAlternateNameRow,
      (row) => {
        if (row.language !== 'ru' || !idsWanted.has(row.geonameId)) return;
        const list = any.get(row.geonameId) || [];
        if (!list.includes(row.name)) list.push(row.name);
        any.set(row.geonameId, list);
        if (row.isPreferred && !row.isHistoric) preferred.set(row.geonameId, row.name);
      },
      'alternateNamesV2',
    );
    any.forEach((list, id) => {
      const pref = preferred.get(id);
      const ordered = pref ? [pref, ...list.filter((n) => n !== pref)] : list;
      ruMap.set(id, ordered);
      cacheAll.set(id, ordered);
    });
    console.log(`[geonames] Русских названий: ${ruMap.size} (за ${((Date.now() - t0) / 1000).toFixed(1)}с)`);
    try {
      const cacheObj: Record<string, string[]> = {};
      cacheAll.forEach((v, k) => { cacheObj[String(k)] = v; });
      writeFileSync(ruCachePath, JSON.stringify(cacheObj), 'utf8');
    } catch (e) {
      console.warn('[geonames] кэш ru-названий не сохранён:', (e as Error).message);
    }
  } else if (!altTxt) {
    console.warn('[geonames] alternateNamesV2.txt недоступен — русские названия не добавлены (останутся латинские).');
  }

  // --- существующий справочник cities ---
  const existingCities = objOf(await adminDb.ref('cities').get().then((s) => s.val()));
  const existingList: Array<ExistingCityEntry & { id: string }> = Object.entries(existingCities).map(([id, recRaw]) => {
    const rec = objOf(recRaw);
    return {
      id,
      name: String(rec.name ?? ''),
      aliases: Array.isArray(rec.aliases) ? (rec.aliases as unknown[]).map(String) : [],
      type: rec.type != null ? String(rec.type) : undefined,
      source: rec.source != null ? String(rec.source) : undefined,
      country: rec.country != null ? String(rec.country) : undefined,
      geonameId: rec.geonameId != null ? Number(rec.geonameId) || undefined : undefined,
      lat: rec.lat != null ? Number(rec.lat) : undefined,
      lng: rec.lng != null ? Number(rec.lng) : undefined,
      population: rec.population != null ? Number(rec.population) || 0 : undefined,
    };
  });
  console.log(`[geonames] Существующих записей в cities: ${existingList.length}`);

  // --- чекпойнт (продолжение после сбоя) ---
  const checkpointPath = join(OUT_DIR, 'geonames-checkpoint.json');
  const checkpoint: { done: number[]; batches: number; lastAt: string } =
    !REBUILD_RU && existsSync(checkpointPath)
      ? JSON.parse(readFileSync(checkpointPath, 'utf8'))
      : { done: [], batches: 0, lastAt: '' };
  const doneSet = new Set<number>(checkpoint.done);
  if (doneSet.size) console.log(`[geonames] Чекпойнт: уже обработано ${doneSet.size} городов (продолжаю с остатка)`);

  const index = new CityIndex(existingList);

  // --- решения по каждому городу ---
  interface Outcome {
    country: string;
    action: 'create' | 'extend' | 'skip';
    id: string;
    name: string;
    reason: string;
    addAliases: string[];
    patch: Record<string, unknown>;
    city: ReturnType<typeof buildGeonamesCity>;
  }
  const outcomes: Outcome[] = [];
  let skippedCheckpoint = 0;
  selected.forEach((row) => {
    if (doneSet.has(row.geonameId)) { skippedCheckpoint += 1; return; }
    const city = buildGeonamesCity(row, ruMap.get(row.geonameId));
    const existing = index.find(city);
    const decision = decideCityImport(city, existing);
    if (decision.action === 'create') {
      const id = index.uniqueId(city);
      outcomes.push({
        country: row.country, action: 'create', id, name: city.name, reason: decision.reason,
        addAliases: city.aliases, patch: {}, city,
      });
      // регистрируем сразу — защита от дублей внутри прогона
      index.add({ id, name: city.name, aliases: city.aliases, type: 'город', source: 'geonames', country: city.country, geonameId: city.geonameId, lat: city.lat, lng: city.lng, population: city.population });
    } else if (decision.action === 'extend' && decision.id) {
      outcomes.push({
        country: row.country, action: 'extend', id: decision.id, name: city.name, reason: decision.reason,
        addAliases: decision.addAliases, patch: decision.patch, city,
      });
      const prev = index.getById(decision.id) || { id: decision.id, name: city.name };
      const merged: ExistingCityEntry & { id: string } = {
        ...prev,
        id: decision.id,
        aliases: [...(prev.aliases || []), ...decision.addAliases],
        geonameId: (prev.geonameId || decision.patch.geonameId) as number | undefined,
        lat: (prev.lat ?? decision.patch.lat) as number | undefined,
        lng: (prev.lng ?? decision.patch.lng) as number | undefined,
        population: (prev.population || decision.patch.population) as number | undefined,
        country: (prev.country || decision.patch.country) as string | undefined,
      };
      index.add(merged);
    } else {
      outcomes.push({
        country: row.country, action: 'skip', id: decision.id || '', name: city.name, reason: decision.reason,
        addAliases: [], patch: {}, city,
      });
    }
  });

  // --- отчёт по странам ---
  const perCountry = new Map<string, { found: number; passed: number; create: number; extend: number; skip: number }>();
  settings.countries.forEach((c) => perCountry.set(c, { found: perCountryFound.get(c) || 0, passed: 0, create: 0, extend: 0, skip: 0 }));
  outcomes.forEach((o) => {
    const row = perCountry.get(o.country) || { found: 0, passed: 0, create: 0, extend: 0, skip: 0 };
    row[o.action] += 1;
    row.passed += 1;
    perCountry.set(o.country, row);
  });
  const skipReasons = new Map<string, number>();
  outcomes.filter((o) => o.action === 'skip').forEach((o) => {
    const short = o.reason.replace(/\(.*\)/, '').trim();
    skipReasons.set(short, (skipReasons.get(short) || 0) + 1);
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, APPLY ? `geonames-apply-${stamp}` : `geonames-dry-run-${stamp}`);
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    takenAt: new Date().toISOString(),
    settings,
    dataDir: DATA_DIR,
    checkpoint: { alreadyDone: skippedCheckpoint, doneTotal: doneSet.size },
    totals: {
      selected: selected.length,
      create: outcomes.filter((o) => o.action === 'create').length,
      extend: outcomes.filter((o) => o.action === 'extend').length,
      skip: outcomes.filter((o) => o.action === 'skip').length,
    },
    perCountry: Array.from(perCountry.entries()).map(([country, v]) => ({ country, ...v })),
    skipReasons: Array.from(skipReasons.entries()).map(([reason, count]) => ({ reason, count })),
    samples: {
      create: outcomes.filter((o) => o.action === 'create').slice(0, MAX_LATIN_DISPLAY).map((o) => ({ id: o.id, name: o.name, country: o.country, population: o.city.population, aliases: o.addAliases.slice(0, 6) })),
      extend: outcomes.filter((o) => o.action === 'extend').slice(0, MAX_LATIN_DISPLAY).map((o) => ({ id: o.id, name: o.name, addAliases: o.addAliases.slice(0, 4), patch: o.patch })),
      skip: outcomes.filter((o) => o.action === 'skip').slice(0, MAX_LATIN_DISPLAY).map((o) => ({ name: o.name, reason: o.reason, id: o.id })),
    },
  };
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1), 'utf8');

  const lines: string[] = [];
  const log = (s: string): void => { lines.push(s); console.log(s); };
  log(`[geonames] Режим: ${APPLY ? 'ЗАПИСЬ (--apply)' : 'ОТЧЁТ (dry-run; запись только с --apply)'}`);
  log(`[geonames] Страны: ${settings.countries.join(', ')} (порог ${settings.threshold}/${settings.smallThreshold}); городов из дампа: ${selected.length}`);
  log('[geonames] По странам (Найдено НП в дампе / прошло порог; из них создано / дополнено / пропущено):');
  report.perCountry.forEach((c) => log(`    ${c.country}: ${c.found} / ${c.passed} → ${c.create} / ${c.extend} / ${c.skip}`));
  log(`[geonames] Итого: создано ${report.totals.create}, дополнено ${report.totals.extend}, пропущено ${report.totals.skip}`);
  if (skipReasons.size) {
    log('[geonames] Причины пропуска:');
    report.skipReasons.forEach((s) => log(`    ${s.reason}: ${s.count}`));
  }
  log(`[geonames] Отчёт: ${base}.json`);

  if (!APPLY) {
    log('[geonames] Ничего не записано (dry-run). Запись — только `--apply` после подтверждения владельца.');
    writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
    if (ONLY_JSON) console.log(JSON.stringify(report.totals, null, 1));
    return 0;
  }

  if (!SAY_YES) {
    if (!process.stdin.isTTY) {
      console.error('[geonames] --apply без --yes в неинтерактивном запуске: запись отменена.');
      return 3;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('[geonames] Записать города в справочник cities? Введите ДА: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'да' && answer !== 'yes') {
      console.log('[geonames] Отменено — ничего не записано.');
      return 0;
    }
  }

  // --- бэкап существующей ветки cities ДО записи ---
  const backupFile = `${OUT_DIR}/geonames-apply-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify({
    takenAt: new Date().toISOString(),
    note: 'Бэкап ветки cities ДО импорта GeoNames (записи не переименовываются и не удаляются — только дополняются пустые поля).',
    cities: existingCities,
  }, null, 1), 'utf8');
  console.log(`[geonames] Бэкап до записи: ${backupFile}`);

  // --- пакетная запись ≤500 с прогрессом и чекпойнтом ---
  const now = new Date().toISOString();
  type Op = { path: string; value: unknown; geonameId: number; kind: 'create' | 'extend' };
  const ops: Op[] = [];
  outcomes.forEach((o) => {
    if (o.action === 'create') {
      ops.push({
        path: `cities/${o.id}`,
        value: {
          id: o.id,
          name: o.name,
          country: o.country,
          aliases: o.addAliases,
          type: 'город',
          usageCount: 0,
          geonameId: o.city.geonameId,
          lat: o.city.lat,
          lng: o.city.lng,
          population: o.city.population,
          source: 'geonames',
          createdAt: now,
        },
        geonameId: o.city.geonameId,
        kind: 'create',
      });
    } else if (o.action === 'extend' && o.id) {
      const prev = index.getById(o.id);
      const patch = { ...o.patch } as Record<string, unknown>;
      if (o.addAliases.length) {
        patch.aliases = Array.from(new Set([...(prev?.aliases || []), ...o.addAliases]));
      }
      if (Object.keys(patch).length) {
        Object.entries(patch).forEach(([k, v]) => {
          ops.push({ path: `cities/${o.id}/${k}`, value: v, geonameId: o.city.geonameId, kind: 'extend' });
        });
      }
    }
  });
  let written = 0;
  let batches = checkpoint.batches;
  for (let i = 0; i < ops.length; i += BATCH) {
    const slice = ops.slice(i, i + BATCH);
    const updates: Record<string, unknown> = {};
    const batchIds: number[] = [];
    slice.forEach((op) => {
      updates[op.path] = op.value;
      batchIds.push(op.geonameId);
    });
    try {
      await adminDb.ref().update(updates);
    } catch (e) {
      // чекпойнт уже сохранён для прошлых пакетов — повторный запуск продолжит с места сбоя
      writeFileSync(checkpointPath, JSON.stringify({ done: Array.from(doneSet), batches, lastAt: new Date().toISOString() }, null, 0), 'utf8');
      console.error(`[geonames] Ошибка записи на пакете ${batches + 1} (путей ${written}): ${(e as Error).message}`);
      console.error('[geonames] Чекпойнт сохранён — повторный запуск продолжит с места сбоя.');
      return 1;
    }
    batchIds.forEach((id) => doneSet.add(id));
    batches += 1;
    written += slice.length;
    writeFileSync(checkpointPath, JSON.stringify({ done: Array.from(doneSet), batches, lastAt: new Date().toISOString() }, null, 0), 'utf8');
    console.log(`[geonames] Пакет ${batches}: ${written}/${ops.length} путей записано…`);
  }
  log(`[geonames] ЗАПИСЬ: создано ${report.totals.create}, дополнено ${report.totals.extend}; путей записано ${written}; пакетов ${batches - checkpoint.batches}.`);
  writeFileSync(`${base}.txt`, lines.join('\n'), 'utf8');
  if (ONLY_JSON) console.log(JSON.stringify(report.totals, null, 1));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[geonames] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
