/**
 * Вычистка ИСТОРИЧЕСКИХ названий из справочника `cities`.
 *
 * Владелец: «исторические названия нам не нужны в базе». В GeoNames у городов
 * есть альтернативные имена с флагом isHistoric (7-я колонка alternateNamesV2):
 * «Горький» у Нижнего Новгорода, «Калинин» у Твери, «Куйбышев» у Самары и т.д.
 * При импорте флаг не учитывался, поэтому часть таких форм попала в aliases.
 *
 * ПРАВИЛО (важно!): форму убираем из алиасов города ТОЛЬКО если она помечена
 * исторической ИМЕННО ДЛЯ ЭТОГО geonameId. Одноимённая форма может быть
 * исторической для одного города и современной для другого: «Gorki» — историческое
 * имя Нижнего Новгорода и в то же время современное имя белорусских Горок.
 * Глобальное вычитание по строке уничтожило бы настоящие города.
 *
 * Режимы:
 *   npx tsx scripts/strip-historic-names.ts                # сухой прогон (по умолчанию)
 *   npx tsx scripts/strip-historic-names.ts --apply --yes  # запись с бэкапом
 *   npx tsx scripts/strip-historic-names.ts --verify       # проверка после применения
 * Дополнительно (всегда, только чтение): сверка убранных форм с РЕАЛЬНЫМИ данными —
 * какие убранные формы встречаются в полях мест портала (для отчёта владельцу).
 */
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { adminDb } from '../firebaseAdmin.ts';
import { normalizeCityName } from '../src/utils/cityDirectory.ts';
import { parseAlternateNameRow } from '../src/utils/geonames.ts';
import { collectSources } from './cities-walk.ts';
import { historicFormsToStrip } from '../src/utils/cityCleanup.ts';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const SAY_YES = ARGS.includes('--yes');
const VERIFY = ARGS.includes('--verify');

const DATA_DIR = '/Users/sergei/.hermes/cache/scratch/cities2/geonames';
const ALT_TXT = join(DATA_DIR, 'alternateNamesV2.txt');
const HIST_CACHE = join(DATA_DIR, 'historic-forms-cache.json');
const OUT_DIR = '/Users/sergei/.hermes/cache/scratch/historic';
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = (s: string): void => console.log(s);

const db = adminDb;

/** Все geonameId справочника (только для них собираем исторические формы). */
const citiesRaw = (await db.ref('cities').get()).val() as Record<string, Record<string, unknown>> | null;
const cities = citiesRaw || {};
const idsWanted = new Set<number>();
Object.values(cities).forEach((c) => {
  const gid = Number((c || {}).geonameId);
  if (Number.isFinite(gid) && gid > 0) idsWanted.add(gid);
});
log(`[historic] Записей в справочнике: ${Object.keys(cities).length}, geonameId: ${idsWanted.size}`);

// ── 1. Исторические формы по geonameId (кэш) ────────────────────────────────
let hist = new Map<number, Set<string>>();
if (existsSync(HIST_CACHE)) {
  try {
    const cached = JSON.parse(readFileSync(HIST_CACHE, 'utf8')) as Record<string, string[]>;
    Object.entries(cached).forEach(([k, v]) => {
      const id = Number(k);
      if (Number.isFinite(id) && Array.isArray(v)) hist.set(id, new Set(v));
    });
    const covered = Array.from(idsWanted).filter((id) => hist.has(id)).length;
    log(`[historic] Кэш исторических форм: покрыто ${covered}/${idsWanted.size}`);
  } catch (e) {
    log(`[historic] Кэш не прочитан (${(e as Error).message}) — читаю источник`);
    hist = new Map();
  }
}
const covered = Array.from(idsWanted).filter((id) => hist.has(id)).length;
if (covered < idsWanted.size && existsSync(ALT_TXT)) {
  log(`[historic] Читаю ${ALT_TXT} (флаг isHistoric для ${idsWanted.size} городов)…`);
  const t0 = Date.now();
  const rl = createInterface({ input: createReadStream(ALT_TXT, 'utf8'), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    lines += 1;
    if (lines % 5000000 === 0) log(`[historic] прочитано строк ${lines}…`);
    const row = parseAlternateNameRow(line);
    if (!row || !row.isHistoric || !idsWanted.has(row.geonameId)) continue;
    const norm = normalizeCityName(row.name);
    if (!norm) continue;
    const set = hist.get(row.geonameId) || new Set<string>();
    set.add(norm);
    hist.set(row.geonameId, set);
  }
  log(`[historic] Исторических форм: ${hist.size} городов (за ${((Date.now() - t0) / 1000).toFixed(1)}с)`);
  try {
    const obj: Record<string, string[]> = {};
    hist.forEach((v, k) => { obj[String(k)] = Array.from(v); });
    writeFileSync(HIST_CACHE, JSON.stringify(obj), 'utf8');
    log(`[historic] Кэш сохранён: ${HIST_CACHE}`);
  } catch (e) {
    log(`[historic] Кэш не сохранён: ${(e as Error).message}`);
  }
} else if (!existsSync(ALT_TXT)) {
  log('[historic] ВНИМАНИЕ: alternateNamesV2.txt недоступен — исторические формы не определены.');
}

// ── 2. Что убираем ──────────────────────────────────────────────────────────
interface Op {
  id: string;
  name: string;
  alias: string;
  geonameId: number;
}
/**
 * ОСОЗНАННЫЕ ИСКЛЮЧЕНИЯ: формы, помеченные историческими, но РЕАЛЬНО
 * используемые в данных портала. Убрав их, мы бы сломали поиск по названию,
 * которым диспетчеры пользуются (проверяется сверкой с данными ниже).
 */
const KEEP_FOR_USAGE = new Set(['капшагай']); // Қонаев: в рейсах пишут «Капшагай»
const ops: Op[] = [];
const keptForUsage: Array<{ id: string; name: string; alias: string }> = [];
const removedNorm = new Map<string, string[]>(); // норма → записи, где форма убрана
Object.entries(cities).forEach(([id, c]) => {
  const rec = c || {};
  const gid = Number(rec.geonameId);
  const aliases = Array.isArray(rec.aliases) ? (rec.aliases as unknown[]).map(String) : [];
  const set = Number.isFinite(gid) ? hist.get(gid) : undefined;
  if (!set || !set.size || !aliases.length) return;
  historicFormsToStrip(aliases, set, KEEP_FOR_USAGE).forEach((a) => {
    ops.push({ id, name: String(rec.name || ''), alias: a, geonameId: gid });
    const list = removedNorm.get(normalizeCityName(a)) || [];
    list.push(`${id} (${String(rec.name || '')})`);
    removedNorm.set(normalizeCityName(a), list);
  });
  aliases.forEach((a) => {
    const n = normalizeCityName(a);
    if (n && set.has(n) && KEEP_FOR_USAGE.has(n)) keptForUsage.push({ id, name: String(rec.name || ''), alias: a });
  });
});
if (keptForUsage.length) {
  log(`[historic] Оставлено осознанно (используется в данных): ${keptForUsage.length}`);
  keptForUsage.forEach((k) => log(`   ${k.name} (${k.id}) ← «${k.alias}»`));
}

log(`\n[historic] Исторических… форм в алиасах: ${ops.length} у ${new Set(ops.map((o) => o.id)).size} городов`);
log('[historic] Примеры:');
ops.slice(0, 12).forEach((o) => log(`   ${o.name} (${o.id}) ← «${o.alias}»`));

// ── 3. Сверка с РЕАЛЬНЫМИ данными (только чтение) ───────────────────────────
/** Поля мест: значение = форма, которую убираем → в каких ветках встречается. */
const usedForms: Array<{ form: string; count: number; paths: string[] }> = [];
if (removedNorm.size) {
  log('[historic] Сверка с реальными данными (полный обход источников мест)…');
  const collected = await collectSources((path) => db.ref(path).get().then((sn: { val: () => unknown }) => sn.val()));
  const values = collected.occurrences;
  const byNorm = new Map<string, { form: string; count: number; paths: string[] }>();
  values.forEach((v: { value: string; path: string; field: string }) => {
    const norm = normalizeCityName(v.value);
    if (!norm || !removedNorm.has(norm)) return;
    const rec = byNorm.get(norm) || { form: v.value, count: 0, paths: [] };
    rec.count += 1;
    if (rec.paths.length < 3) rec.paths.push(`${v.path}#${v.field}`);
    byNorm.set(norm, rec);
  });
  byNorm.forEach((v) => usedForms.push(v));
  log(`[historic] Убираемые формы, встречающиеся в данных портала: ${usedForms.length}`);
  usedForms.slice(0, 10).forEach((u) => log(`   «${u.form}» ×${u.count} — ${u.paths[0]}`));
}

// ── 4. Запись ───────────────────────────────────────────────────────────────
if (VERIFY) {
  const left = ops.length;
  const report = { mode: 'verify', takenAt: new Date().toISOString(), left, ops: ops.slice(0, 200) };
  writeFileSync(join(OUT_DIR, `historic-verify-${stamp}.json`), JSON.stringify(report, null, 1), 'utf8');
  log(`\n[historic --verify] Исторических форм в алиасах осталось: ${left}`);
  if (left) log(`[historic --verify] Отчёт: ${join(OUT_DIR, `historic-verify-${stamp}.json`)}`);
  process.exit(left ? 1 : 0);
}

if (!APPLY) {
  const report = {
    mode: 'dry-run',
    takenAt: new Date().toISOString(),
    cities: Object.keys(cities).length,
    historicMapCities: hist.size,
    ops: ops.length,
    citiesAffected: new Set(ops.map((o) => o.id)).size,
    usedInData: usedForms,
    keptForUsage,
    samples: ops.slice(0, 200),
    all: ops,
  };
  writeFileSync(join(OUT_DIR, `historic-dry-run-${stamp}.json`), JSON.stringify(report, null, 1), 'utf8');
  log(`\n[historic] Отчёт: ${join(OUT_DIR, `historic-dry-run-${stamp}.json`)}`);
  log('[historic] Ничего не записано (сухой прогон). Запись — только `--apply --yes`.');
  process.exit(0);
}

if (!SAY_YES) {
  console.error('[historic] --apply без --yes в неинтерактивном запуске: запись отменена.');
  process.exit(2);
}

const byCity = new Map<string, string[]>();
ops.forEach((o) => {
  const list = byCity.get(o.id) || [];
  list.push(o.alias);
  byCity.set(o.id, list);
});
const backup: Record<string, unknown> = {};
byCity.forEach((_v, id) => { backup[`cities/${id}`] = cities[id]; });
const backupFile = join(OUT_DIR, `historic-apply-backup-${stamp}.json`);
writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), note: 'Записи городов ДО вычистки исторических названий', cities: backup }, null, 1), 'utf8');
log(`[historic] Бэкап до записи: ${backupFile}`);

const updates: Record<string, unknown> = {};
byCity.forEach((aliases, id) => {
  const rec = cities[id] || {};
  const all = Array.isArray(rec.aliases) ? (rec.aliases as unknown[]).map(String) : [];
  const keep = all.filter((a) => !aliases.includes(a));
  updates[`cities/${id}/aliases`] = keep.length ? keep : null;
});
// Пакетами по 400 путей: update() отклоняет пачку с «предком» и вообще много путей сразу.
const paths = Object.keys(updates);
let written = 0;
for (let i = 0; i < paths.length; i += 400) {
  const slice = paths.slice(i, i + 400);
  const chunk: Record<string, unknown> = {};
  slice.forEach((p) => { chunk[p] = updates[p]; });
  await db.ref().update(chunk);
  written += slice.length;
  log(`[historic] Пакет: ${written}/${paths.length} путей записано…`);
}
log(`[historic] ЗАПИСЬ: убрано исторических форм ${ops.length} у ${byCity.size} городов; путей записано ${written}.`);
const report = { mode: 'apply', takenAt: new Date().toISOString(), removed: ops.length, cities: byCity.size, backupFile, usedInData: usedForms };
writeFileSync(join(OUT_DIR, `historic-apply-${stamp}.json`), JSON.stringify(report, null, 1), 'utf8');
process.exit(0);
