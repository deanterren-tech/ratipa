/**
 * Контрольные чтения: повторные dry-run'ы НЕ создают и НЕ меняют данные.
 *  1) снять отпечатки городовых веток (JSON-хэш);
 *  2) сбросить тестовые настройки appSettings/geonames (чтобы dry-run шёл
 *     с настройками по умолчанию — как у владельца перед --apply);
 *  3) прогнать migrate-cities.ts (dry-run) и import-geonames.ts (dry-run);
 *  4) снять отпечатки снова и сравнить.
 * Результат: scratch/cities2/control-reads.json
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb } from '../server/firebaseAdmin.ts';

const OUT = '/Users/sergei/.hermes/cache/scratch/cities2';
const BRANCHES = [
  'cities',
  'appSettings',
  'trips_dashboard',
  'calculationsHistory',
  'knownDistancesList',
  'routedesk',
  'ratipa_loading_plan',
  'tripTimeline',
  'baza',
  'archive',
  'driverTasks',
  'multiTemplates',
];

const hashOf = (v: unknown): string => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);

/**
 * Отпечаток ветки. appSettings нормализуется: узел `geonames` исключается —
 * его сброс (удаление тестовой настройки) делается этим же скриптом
 * СОЗНАТЕЛЬНО, чтобы dry-run шёл с настройками по умолчанию.
 */
function normalized(branch: string, v: unknown): unknown {
  if (branch !== 'appSettings') return v ?? null;
  const o = { ...(v as Record<string, unknown> | null || {}) };
  delete o.geonames;
  return o;
}

async function fingerprints(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const b of BRANCHES) {
    const v = (await adminDb!.ref(b).get()).val();
    out[b] = hashOf(normalized(b, v));
  }
  return out;
}

async function main(): Promise<number> {
  if (!adminDb) return 2;
  mkdirSync(OUT, { recursive: true });

  const before = await fingerprints();
  console.log('[control] Отпечатки ДО:', JSON.stringify(before, null, 1));

  // сброс тестовых настроек GeoNames (если тест их создавал)
  const gn = (await adminDb.ref('appSettings/geonames').get()).val();
  if (gn) {
    await adminDb.ref('appSettings/geonames').remove();
    console.log('[control] appSettings/geonames удалён (тестовая настройка; будут умолчания)');
  }

  // dry-run №1: миграция городов
  console.log('[control] dry-run migrate-cities…');
  const m1 = execFileSync('npx', ['tsx', 'scripts/migrate-cities.ts', '--json'], { cwd: '/Users/sergei/ratipa-fresh-rewrite', encoding: 'utf8', timeout: 300000 });
  // dry-run №1: GeoNames
  console.log('[control] dry-run import-geonames…');
  const g1 = execFileSync('npx', ['tsx', 'scripts/import-geonames.ts', '--json'], { cwd: '/Users/sergei/ratipa-fresh-rewrite', encoding: 'utf8', timeout: 600000 });
  // повторные dry-run'ы (идемпотентность отчётов)
  console.log('[control] повторные dry-run…');
  const m2 = execFileSync('npx', ['tsx', 'scripts/migrate-cities.ts', '--json'], { cwd: '/Users/sergei/ratipa-fresh-rewrite', encoding: 'utf8', timeout: 300000 });
  const g2 = execFileSync('npx', ['tsx', 'scripts/import-geonames.ts', '--json'], { cwd: '/Users/sergei/ratipa-fresh-rewrite', encoding: 'utf8', timeout: 600000 });

  const after = await fingerprints();
  console.log('[control] Отпечатки ПОСЛЕ:', JSON.stringify(after, null, 1));

  const diffs = BRANCHES.filter((b) => before[b] !== after[b]).map((b) => ({ branch: b, before: before[b], after: after[b] }));
  const parse = (s: string): unknown => {
    const i = s.lastIndexOf('{');
    try { return JSON.parse(s.slice(i)); } catch { return { raw: s.slice(-200) }; }
  };
  const report = {
    takenAt: new Date().toISOString(),
    branches: BRANCHES,
    before,
    after,
    diffs,
    dryRun1: { migrate: parse(m1), geonames: parse(g1) },
    dryRun2: { migrate: parse(m2), geonames: parse(g2) },
    stable: diffs.length === 0,
  };
  writeFileSync(join(OUT, 'control-reads.json'), JSON.stringify(report, null, 1), 'utf8');
  console.log(`[control] Итог: изменённых веток ${diffs.length} (${diffs.map((d) => d.branch).join(', ') || 'нет'}). Отчёт: control-reads.json`);
  return diffs.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('[control] ошибка:', (e as Error)?.message || e); process.exit(1); });
