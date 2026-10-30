/**
 * План единого вида номеров авто по всем коллекциям (только чтение, в базу ничего не пишется).
 * Применение — apply-plate-unify.ts (по умолчанию тоже пробный прогон).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUpdates, computeChanges, SKIP_ALWAYS, SKIP_DEFAULT, type Data } from './lib/plateUnifyCore';

const DB = process.env.RATIPA_DB_URL || 'https://ratipa-portal-default-rtdb.firebaseio.com';
export const readAll = async (): Promise<Data> => {
  const roots = Object.keys((await (await fetch(`${DB}/.json?shallow=true`)).json()) || {}).filter((r) => !SKIP_ALWAYS.has(r));
  const data: Data = {};
  await Promise.all(roots.map(async (r) => { data[r] = await (await fetch(`${DB}/${r}.json`)).json(); }));
  return data;
};

const main = async () => {
  const include = (process.argv.find((a) => a.startsWith('--include='))?.slice(10) || '').split(',').filter(Boolean);
  const skip = new Set(SKIP_DEFAULT.filter((r) => !include.includes(r)));
  const data = await readAll();
  const changes = computeChanges(data, skip);
  const built = buildUpdates(data, changes);
  const by = new Map<string, number>();
  for (const c of changes) { const k = `${c.path.split('/')[0]} (${c.kind})`; by.set(k, (by.get(k) || 0) + 1); }
  const dir = join(process.cwd(), 'scripts', 'out'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `plate-unify-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ skipped: [...skip], changes, conflicts: built.conflicts }, null, 1));
  console.log(`Изменений: ${changes.length} | будет записано путей: ${Object.keys(built.updates).length} | конфликтов ключей: ${built.conflicts.length}`);
  console.log(`Не трогаем по умолчанию: ${[...skip].join(', ') || '—'}`);
  for (const [k, n] of [...by].sort()) console.log(`  ${n}\t${k}`);
  if (built.conflicts.length) console.log('Конфликты (целевой ключ уже занят, нужна ручная сверка):', built.conflicts.map((c) => `${c.path} → ${c.after}`).join('; '));
  console.log('Файл:', file);
};
main().catch((e) => { console.error(e); process.exit(1); });
