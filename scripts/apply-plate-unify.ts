/**
 * Применение единого вида номеров авто.
 *
 *   npx tsx scripts/apply-plate-unify.ts                      # пробный прогон: ничего не пишет
 *   npx tsx scripts/apply-plate-unify.ts --apply --yes        # записать (нужен ключ сервисного аккаунта)
 *   npx tsx scripts/apply-plate-unify.ts --rollback=<папка>   # вернуть прежние значения из резервной копии
 *   флаг --include=telemetry_navby_objects,ratipa_zagruzok_log включает исключённые по умолчанию ветки
 *
 * Ключ: FIREBASE_SERVICE_ACCOUNT_PATH (файл) или FIREBASE_SERVICE_ACCOUNT (JSON).
 * Перед записью: полная копия затронутых веток + карта записи + карта отката в scripts/out/backup-<время>/.
 * Запись — одним multi-path update (всё или ничего); значения «до» пересверяются с живой базой.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRollback, buildUpdates, computeChanges, SKIP_ALWAYS, SKIP_DEFAULT, type Data } from './lib/plateUnifyCore';

const DB = process.env.RATIPA_DB_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply') && process.argv.includes('--yes');
const ROLLBACK = arg('rollback');

const readRoots = async (roots: string[]): Promise<Data> => {
  const d: Data = {};
  await Promise.all(roots.map(async (r) => { d[r] = await (await fetch(`${DB}/${r}.json`)).json(); }));
  return d;
};
const adminDb = async () => {
  const { adminDb: db } = await import('../server/firebaseAdmin');
  if (!db) throw new Error('Нет ключа сервисного аккаунта: задайте FIREBASE_SERVICE_ACCOUNT_PATH или FIREBASE_SERVICE_ACCOUNT');
  return db;
};

const main = async () => {
  if (ROLLBACK) {
    const rb = JSON.parse(readFileSync(join(ROLLBACK, 'rollback.json'), 'utf8'));
    if (!process.argv.includes('--yes')) { console.log(`Откат: ${Object.keys(rb).length} путей из ${ROLLBACK}. Добавьте --yes, чтобы записать.`); return; }
    await (await adminDb()).ref().update(rb);
    console.log('Откат выполнен.'); return;
  }
  const include = (arg('include') || '').split(',').filter(Boolean);
  const skip = new Set(SKIP_DEFAULT.filter((r) => !include.includes(r)));
  const roots = Object.keys((await (await fetch(`${DB}/.json?shallow=true`)).json()) || {}).filter((r) => !SKIP_ALWAYS.has(r));
  const data = await readRoots(roots);
  const changes = computeChanges(data, skip);
  const { updates, conflicts, applied } = buildUpdates(data, changes);
  const touched = [...new Set(Object.keys(updates).map((p) => p.split('/')[0]))];
  console.log(`Изменений: ${applied.length} | путей записи: ${Object.keys(updates).length} | конфликтов: ${conflicts.length} | ветки: ${touched.join(', ')}`);
  for (const c of conflicts) console.log(`  КОНФЛИКТ ${c.path} → ${c.after}: целевой ключ занят или повторяется, пропущено`);
  if (!APPLY) { console.log('Пробный прогон: в базу ничего не записано. Для записи: --apply --yes'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'scripts', 'out', `backup-plate-${stamp}`);
  mkdirSync(dir, { recursive: true });
  for (const r of touched) writeFileSync(join(dir, `${r}.json`), JSON.stringify(data[r] ?? null));
  writeFileSync(join(dir, 'updates.json'), JSON.stringify(updates, null, 1));
  writeFileSync(join(dir, 'rollback.json'), JSON.stringify(buildRollback(data, updates), null, 1));
  console.log(`Резервная копия: ${dir}`);

  const db = await adminDb();
  await db.ref().update(updates);
  // Проверка чтением: все значения совпали с записанными.
  const after = await readRoots(touched);
  const bad = Object.entries(updates).filter(([p, v]) => JSON.stringify(p.split('/').reduce((o: any, k) => o?.[k], after) ?? null) !== JSON.stringify(v ?? null));
  console.log(bad.length ? `ВНИМАНИЕ: не совпало ${bad.length} путей: ${bad.slice(0, 5).map(([p]) => p).join(', ')}` : 'Проверка чтением: все пути совпали.');
  console.log(`Откат: npx tsx scripts/apply-plate-unify.ts --rollback=${dir} --yes`);
};
main().catch((e) => { console.error(e); process.exit(1); });
