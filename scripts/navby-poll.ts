/**
 * CLI поллера «Пробег и связь» (Nav.by → RTDB).
 *
 *   npm run navby:poll                 — один цикл (реальные ветки telemetry_*)
 *   npm run navby:poll -- --dry-run    — только чтение Nav.by, без записи
 *   npm run navby:poll -- --prefix test — изолированные ветки test/telemetry_*
 *   npm run navby:poller               — цикл по интервалу из telemetry_config
 *
 * Секреты: NAVBY_BASE/NAVBY_LOGIN/NAVBY_PASSWORD либо NAVBY_TOKEN,
 * FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) — из .env.local/.env.
 */

import '../server/navby/env.ts'; // ПЕРВЫМ: env до инициализации firebase-admin
import { runPollCycle, getPollIntervalSec, type PollSummary } from '../server/navby/poller.ts';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (name: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) return args[idx + 1];
  return undefined;
};

const dryRun = has('--dry-run');
const loop = has('--loop');
const prefix = valueOf('--prefix');
const ignoreLock = has('--ignore-lock');
const forcePrune = has('--force-prune');

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

function printSummary(s: PollSummary) {
  console.log(JSON.stringify({
    mode: s.mode,
    reason: s.reason ?? null,
    vehicleListOk: s.vehicleListOk,
    positionsOk: s.positionsOk,
    objectsTotal: s.objectsTotal,
    objectsWithPosition: s.objectsWithPosition,
    samplesNew: s.samplesNew,
    samplesSame: s.samplesSame,
    samplesOlder: s.samplesOlder,
    samplesUnmapped: s.samplesUnmapped,
    autoMapped: s.autoMapped,
    matchedCars: s.matchedCars,
    alertsUpserted: s.alertsUpserted,
    alertsRemoved: s.alertsRemoved,
    prunedDays: s.prunedDays,
    durationMs: s.durationMs,
    lastError: s.lastError ?? null,
  }, null, 2));
}

async function main() {
  if (loop) {
    const tick = async () => {
      let intervalMs = 300_000;
      try {
        const s = await runPollCycle({ dryRun, prefix, ignoreLock, forcePrune, log });
        log(`[navby] цикл: mode=${s.mode} новых=${s.samplesNew} уведомл=${s.alertsUpserted}/${s.alertsRemoved}`);
        intervalMs = (await getPollIntervalSec(prefix, 300)) * 1000;
      } catch (e) {
        log(`[navby] ошибка цикла: ${String(e).slice(0, 200)}`);
      } finally {
        setTimeout(tick, Math.max(60_000, intervalMs));
      }
    };
    log(`[navby] поллер в режиме цикла${prefix ? ` (prefix=${prefix})` : ''}${dryRun ? ' (dry-run)' : ''}`);
    await tick();
    return;
  }
  const summary = await runPollCycle({ dryRun, prefix, ignoreLock, forcePrune, log });
  printSummary(summary);
  process.exit(summary.mode === 'degraded' ? 2 : 0);
}

main().catch((e) => {
  console.error('[navby] фатальная ошибка:', String(e).slice(0, 300));
  process.exit(1);
});
