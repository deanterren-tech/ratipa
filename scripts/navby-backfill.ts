/**
 * CLI догрузки истории одометра («CAN-пробег») за период по одной машине
 * (или всем сопоставленным): сегменты city-or-track + parking по дням,
 * почасовые окна object-stat-data за последние сутки периода.
 *
 *   npm run navby:backfill -- --car <carKey> --from 2026-10-05 --to 2026-10-09
 *   npm run navby:backfill -- --imei 352093080153272 --from ... --to ...
 *   npm run navby:backfill -- --all --days 3
 *   npm run navby:backfill -- --dry-run ...   — без записи в RTDB
 *
 * Даты --from/--to принимаются как YYYY-MM-DD (полные сутки +03), либо мс epoch.
 */

import '../server/navby/env.ts';
import { adminDb } from '../server/firebaseAdmin.ts';
import { TelemetryStore } from '../server/navby/store.ts';
import { backfillCanRange, resolveCarTargets } from '../server/navby/collector.ts';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (name: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) return args[idx + 1];
  return undefined;
};

const DAY = 86_400_000;
const TZ = 180 * 60_000; // +03

function parseBoundary(v: string | undefined, fallbackMs: number, edge: 'start' | 'end'): number {
  if (!v) return fallbackMs;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n > 1e12 ? n : n * 1000;
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ;
    return edge === 'start' ? base : base + DAY - 1;
  }
  const t = Date.parse(v);
  if (Number.isFinite(t)) return t;
  throw new Error(`не понял дату: ${v}`);
}

const dryRun = has('--dry-run');
const prefix = valueOf('--prefix');
const carArg = valueOf('--car');
const imeiArg = valueOf('--imei');
const all = has('--all');
const daysArg = Number(valueOf('--days') || '2');
const fromMs = parseBoundary(valueOf('--from'), Date.now() - Math.max(1, daysArg) * DAY, 'start');
const toMs = parseBoundary(valueOf('--to'), Date.now(), 'end');

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

async function main() {
  if (!adminDb) {
    console.error('[navby-can] Firebase Admin не сконфигурирован (FIREBASE_SERVICE_ACCOUNT_PATH)');
    process.exit(1);
  }
  const store = new TelemetryStore(adminDb, { prefix, log });
  const targets = await resolveCarTargets(store);
  let selected = targets;
  if (carArg) selected = targets.filter((t) => t.carKey === carArg);
  else if (imeiArg) selected = targets.filter((t) => t.imei === imeiArg);
  else if (!all) {
    console.error('Укажите --car <carKey>, --imei <imei> или --all. Машины:');
    for (const t of targets) console.error(`  ${t.carKey} imei=${t.imei}`);
    process.exit(2);
  }
  if (!selected.length) {
    console.error('Машина не найдена среди сопоставленных.');
    process.exit(2);
  }
  console.log(`Догрузка ${selected.length} машин за ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}${dryRun ? ' (dry-run)' : ''}`);
  let totalWritten = 0;
  for (const t of selected) {
    if (dryRun) {
      console.log(`[dry-run] ${t.carKey} imei=${t.imei} — запросы не выполняются в dry-run режиме догрузки`);
      continue;
    }
    const res = await backfillCanRange({
      carKey: t.carKey, objectId: t.objectId, imei: t.imei as string,
      fromMs, toMs, store, log,
    });
    totalWritten += res.written;
    console.log(`  ${t.carKey}: дней=${res.days} точек=${res.segPoints + res.statPoints} записано=${res.written} дублей=${res.duplicates}${res.errors.length ? ` ошибки: ${res.errors.join(', ')}` : ''}`);
  }
  console.log(`Итого записано новых измерений: ${totalWritten}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[navby-can] фатальная ошибка:', String(e).slice(0, 300));
  process.exit(1);
});
