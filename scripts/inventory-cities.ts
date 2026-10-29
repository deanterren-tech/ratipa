/**
 * СПЛОШНАЯ инвентаризация RTDB: обход ВСЕХ веток и подветок без заранее
 * заданного списка. Ищет ВСЕ строковые поля и определяет, какие из них
 * содержат названия мест (погрузка/выгрузка/граница/затаможка/база/места
 * событий/рейсы/справочники/история).
 *
 * Ничего не меняет: только чтение. Никаких выдуманных полей — в отчёт попадает
 * лишь то, что реально найдено в базе (со значениями-примерами как доказательством).
 *
 * Запуск:
 *   npx tsx scripts/inventory-cities.ts --probe     # только форма базы (ключи+размеры)
 *   npx tsx scripts/inventory-cities.ts             # полный обход + отчёт
 *   npx tsx scripts/inventory-cities.ts --out=DIR   # каталог отчётов
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb, DATABASE_URL } from '../server/firebaseAdmin.ts';
import { looksLikePlaceName, normalizeCityName } from '../src/utils/cityDirectory.ts';

const ARGS = process.argv.slice(2);
const PROBE = ARGS.includes('--probe');
const OUT_DIR =
  (ARGS.find((a) => a.startsWith('--out=')) || '').split('=').slice(1).join('=') ||
  '/Users/sergei/.hermes/cache/scratch/cities2';

const objOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

/** Похож ли ключ на идентификатор записи (а не на имя поля). */
const isIdLike = (key: string): boolean =>
  /^\d{1,15}$/.test(key) ||
  /^-M[a-zA-Z0-9_-]{10,}$/.test(key) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(key) ||
  /^[A-Za-z0-9_-]{18,}$/.test(key);

interface FieldStat {
  branch: string;
  /** Шаблон пути внутри ветки: legs/[]/from → 'legs.[].from'. */
  pattern: string;
  values: number;
  nonEmpty: number;
  placeLike: number;
  short: number;
  distinct: number;
  /** distinct закончился (упёрся в предел) */
  distinctCapped: boolean;
  samples: string[];
  longSamples: string[];
  numbers: number;
  booleans: number;
}

/** Строковые «статусы» и флаги — для подтверждения, что архив/удалённые обойдены. */
const STATUS_KEYS = new Set(['status', 'state', 'archived', 'deleted', 'isDeleted', 'removed', 'isArchived']);

interface BranchStat {
  branch: string;
  bytes: number;
  keys: number;
  scanned: number;
}

const DISTINCT_CAP = 3000;

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[inventory] Firebase Admin недоступен (нет service-account).');
    return 2;
  }
  console.log(`[inventory] База: ${DATABASE_URL}`);

  const t0 = Date.now();
  const rootRaw = (await adminDb.ref('/').get()).val();
  const root = objOf(rootRaw);
  const topKeys = Object.keys(root).sort();
  const rootBytes = JSON.stringify(rootRaw ?? null).length;
  console.log(`[inventory] Корень: ${topKeys.length} веток, ~${(rootBytes / 1024 / 1024).toFixed(1)} МБ, ${((Date.now() - t0) / 1000).toFixed(1)}с`);
  topKeys.forEach((k) => {
    const node = root[k];
    const bytes = JSON.stringify(node ?? null).length;
    const kids = node && typeof node === 'object' ? Object.keys(objOf(node)).length : 0;
    console.log(`    ${k}: ~${(bytes / 1024 / 1024).toFixed(2)} МБ, детей ${kids}`);
  });

  if (PROBE) return 0;

  const fieldMap = new Map<string, FieldStat>();
  const branchStats: BranchStat[] = [];
  const statusCounts = new Map<string, Map<string, number>>(); // branch::key → value → count

  const pushStatus = (branch: string, key: string, v: unknown): void => {
    const mapKey = `${branch} :: ${key}`;
    let m = statusCounts.get(mapKey);
    if (!m) {
      m = new Map();
      statusCounts.set(mapKey, m);
    }
    const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v).trim() || '(пусто)';
    m.set(s, (m.get(s) || 0) + 1);
  };

  let scannedStrings = 0;

  const walk = (branch: string, node: unknown, pattern: string, idLevelDepth: number): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      // листовая строка
      let st = fieldMap.get(`${branch}|${pattern}`);
      if (!st) {
        st = {
          branch, pattern, values: 0, nonEmpty: 0, placeLike: 0, short: 0,
          distinct: 0, distinctCapped: false, samples: [], longSamples: [], numbers: 0, booleans: 0,
        };
        fieldMap.set(`${branch}|${pattern}`, st);
      }
      st.values += 1;
      scannedStrings += 1;
      const v = node.trim();
      if (v) {
        st.nonEmpty += 1;
        if (v.length <= 60 && looksLikePlaceName(normalizeCityName(v))) st.placeLike += 1;
        if (v.length <= 40) {
          st.short += 1;
          if (st.samples.length < 12 && !st.samples.includes(v)) st.samples.push(v);
        } else if (st.longSamples.length < 5 && !st.longSamples.includes(v)) {
          st.longSamples.push(v.slice(0, 140));
        }
        if (!st.distinctCapped) {
          st.distinct += 1; // приблизительно: считаем каждое вхождение до предела
          if (st.distinct >= DISTINCT_CAP) st.distinctCapped = true;
        }
      }
      return;
    }
    if (typeof node === 'number') { bumpScalar(branch, pattern, 'numbers'); return; }
    if (typeof node === 'boolean') { bumpScalar(branch, pattern, 'booleans'); return; }
    if (Array.isArray(node)) {
      const p = pattern ? `${pattern}.[]` : '[]';
      node.forEach((item) => walk(branch, item, p, idLevelDepth));
      return;
    }
    // объект
    const entries = Object.entries(node as Record<string, unknown>);
    // ключи-статусы фиксируем, даже если значение не строка
    for (const [k, v] of entries) {
      if (STATUS_KEYS.has(k)) pushStatus(branch, k, v);
    }
    const idKeys = entries.filter(([k, v]) => isIdLike(k) && v && typeof v === 'object').length;
    const objKids = entries.filter(([, v]) => v && typeof v === 'object').length;
    const idDominates = idKeys >= 3 && idKeys >= objKids * 0.8;
    for (const [k, v] of entries) {
      const idLevel = idDominates && isIdLike(k) && v && typeof v === 'object';
      const seg = idLevel ? '[]' : k;
      const p = pattern ? `${pattern}.${seg}` : seg;
      walk(branch, v, p, idLevel ? idLevelDepth + 1 : idLevelDepth);
    }
  };

  const bumpScalar = (branch: string, pattern: string, kind: 'numbers' | 'booleans'): void => {
    let st = fieldMap.get(`${branch}|${pattern}`);
    if (!st) {
      st = {
        branch, pattern, values: 0, nonEmpty: 0, placeLike: 0, short: 0,
        distinct: 0, distinctCapped: false, samples: [], longSamples: [], numbers: 0, booleans: 0,
      };
      fieldMap.set(`${branch}|${pattern}`, st);
    }
    st[kind] += 1;
  };

  // Обход: каждая топ-ветка читается заново (свежий снимок) и анализируется.
  for (const branch of topKeys) {
    const b0 = Date.now();
    const raw = (await adminDb.ref(branch).get()).val();
    const bytes = JSON.stringify(raw ?? null).length;
    const isArr = Array.isArray(raw);
    const kids = raw && typeof raw === 'object' ? Object.keys(objOf(raw)).length : 0;
    walk(branch, raw, '', 0);
    branchStats.push({ branch, bytes, keys: kids, scanned: 0 });
    console.log(`  [обход] ${branch}: ~${(bytes / 1024 / 1024).toFixed(2)} МБ, ключей ${kids}, ${((Date.now() - b0) / 1000).toFixed(1)}с`);
    void isArr;
  }

  // ---------------------------------------------------------------------
  // Классификация: какие поля содержат названия мест
  // ---------------------------------------------------------------------
  const fields = Array.from(fieldMap.values()).sort(
    (a, b) => a.branch.localeCompare(b.branch) || a.pattern.localeCompare(b.pattern),
  );
  const NAME_HINT = /(^|\.)(from|to|fromName|toName|name|label|place|city|point|origin|destination|customs\w*|comment|text|note)(\.|$)/i;
  interface Row extends FieldStat {
    placeShare: number;
    isPlaceCandidate: boolean;
    reason: string;
  }
  const rows: Row[] = fields.map((f) => {
    const placeShare = f.nonEmpty ? f.placeLike / f.nonEmpty : 0;
    const nameHint = NAME_HINT.test(f.pattern);
    const isPlaceCandidate =
      (f.placeLike >= 3 && placeShare >= 0.3) || (nameHint && f.placeLike >= 1);
    const reason = !f.nonEmpty
      ? 'нет непустых'
      : isPlaceCandidate
        ? `места: ${f.placeLike}/${f.nonEmpty} (${Math.round(placeShare * 100)}%)${nameHint ? ', имя поля похоже на место' : ''}`
        : `не место: мест ${f.placeLike}/${f.nonEmpty} (${Math.round(placeShare * 100)}%)`;
    return { ...f, placeShare, isPlaceCandidate, reason };
  });

  const placeFields = rows.filter((r) => r.isPlaceCandidate && r.nonEmpty > 0);
  const totalsDate = new Date().toISOString();

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = totalsDate.replace(/[:.]/g, '-');
  const jsonPath = join(OUT_DIR, `inventory-${stamp}.json`);
  const txtPath = join(OUT_DIR, `inventory-${stamp}.txt`);

  const report = {
    takenAt: totalsDate,
    databaseUrl: DATABASE_URL,
    totals: {
      branches: topKeys.length,
      rootBytes,
      stringValuesScanned: scannedStrings,
      stringFieldsFound: rows.length,
      placeFields: placeFields.length,
    },
    branches: branchStats,
    fields: rows.map((r) => ({
      branch: r.branch, pattern: r.pattern, values: r.values, nonEmpty: r.nonEmpty,
      placeLike: r.placeLike, placeShare: Number(r.placeShare.toFixed(3)), short: r.short,
      distinct: r.distinct, distinctCapped: r.distinctCapped,
      samples: r.samples, longSamples: r.longSamples, numbers: r.numbers, booleans: r.booleans,
      isPlaceCandidate: r.isPlaceCandidate, reason: r.reason,
    })),
    statusCounts: Array.from(statusCounts.entries()).map(([key, m]) => ({
      key, values: Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ v, c })),
    })),
  };
  writeFileSync(jsonPath, JSON.stringify(report, null, 1), 'utf8');

  const lines: string[] = [];
  const log = (s: string): void => { lines.push(s); console.log(s); };
  log(`[inventory] Просмотрено строковых значений: ${scannedStrings}; строковых полей (шаблонов): ${rows.length}; полей с местами: ${placeFields.length}`);
  log('');
  log('=== ВСЕ строковые поля (шаблон пути: непустых/всего, мест, примеры) ===');
  let curBranch = '';
  rows.forEach((r) => {
    if (r.branch !== curBranch) {
      curBranch = r.branch;
      log(`\n[${curBranch}]`);
    }
    const mark = r.isPlaceCandidate ? '★ МЕСТА' : '       ';
    log(`  ${mark} ${r.pattern}: ${r.nonEmpty}/${r.values}, мест ${r.placeLike}${r.distinctCapped ? `, форм ≥${r.distinct}` : `, форм ~${r.distinct}`}`);
    if (r.isPlaceCandidate && r.samples.length) log(`        примеры: ${r.samples.slice(0, 10).map((s) => `«${s}»`).join(', ')}`);
  });

  log('\n=== ПОЛЯ С НАЗВАНИЯМИ МЕСТ (кандидаты для миграции) ===');
  placeFields.forEach((r) => {
    log(`  ${r.branch} · ${r.pattern}: непустых ${r.nonEmpty}, мест ${r.placeLike} — ${r.samples.slice(0, 8).map((s) => `«${s}»`).join(', ')}`);
  });

  log('\n=== СТАТУСЫ (подтверждение, что архив/удалённые обойдены) ===');
  Array.from(statusCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([key, m]) => {
      const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
      log(`  ${key}: ${top.map(([v, c]) => `${v}×${c}`).join(', ')}`);
    });

  writeFileSync(txtPath, lines.join('\n'), 'utf8');
  console.log(`\n[inventory] Отчёты: ${jsonPath} и ${txtPath}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[inventory] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
