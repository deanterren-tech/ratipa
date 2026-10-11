/**
 * CLI постоянного сбора «Пробег и связь» + история одометра («CAN-пробег»).
 * Запускается launchd-агентом каждые 5 минут (см. deploy/launchd и
 * scripts/install-navby-collect.sh), а также вручную:
 *
 *   npm run navby:collect                 — один цикл: снимки позиций + съём истории
 *   npm run navby:collect -- --stat-only  — только почасовой съём измерений
 *   npm run navby:collect -- --backfill-only --force — только догрузка сегментов
 *   npm run navby:collect -- --dry-run    — только чтение Nav.by, без записи
 *   npm run navby:collect -- --prefix test — изолированные ветки test/telemetry_*
 *
 * Больше не запускает процесс-цикл: расписание задаёт launchd/systemd
 * (интервал — StartInterval/OnUnitActiveSec, по умолчанию 5 минут;
 * логика съёма внутри цикла опирается на telemetry_config).
 */

import '../server/navby/env.ts'; // ПЕРВЫМ: env до инициализации firebase-admin
import { runPollCycle } from '../server/navby/poller.ts';
import { runCanCollectionOnce } from '../server/navby/collector.ts';

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
const prefix = valueOf('--prefix');
const ignoreLock = has('--ignore-lock');
const statOnly = has('--stat-only');
const backfillOnly = has('--backfill-only');
const noPoll = has('--no-poll');
const force = has('--force');

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

async function main() {
  // 1) Снимки позиций/текущего состояния (быстрый цикл, single-flight lock).
  if (!noPoll && !statOnly && !backfillOnly) {
    const poll = await runPollCycle({ dryRun, prefix, ignoreLock, log });
    log(`[navby] снимки: mode=${poll.mode} новых=${poll.samplesNew} совпало=${poll.samplesSame} матч=${poll.matchedCars} уведомл=${poll.alertsUpserted}/${poll.alertsRemoved} (${poll.durationMs} мс)`);
    if (poll.mode === 'unconfigured') {
      console.error(JSON.stringify({ poll: { mode: poll.mode, reason: poll.reason } }));
      process.exit(1);
    }
  }

  // 2) История одометра: почасовой съём + суточная догрузка сегментов.
  const can = await runCanCollectionOnce({ dryRun, prefix, statOnly, backfillOnly, force, log });
  console.log(JSON.stringify({
    can: {
      mode: can.mode,
      reason: can.reason ?? null,
      sweepWindows: can.sweepWindows,
      sweepCars: can.sweepCars,
      sweepPoints: can.sweepPoints,
      sweepNew: can.sweepNew,
      sweepDup: can.sweepDup,
      backfillDays: can.backfillDays,
      backfillCars: can.backfillCars,
      backfillPoints: can.backfillPoints,
      backfillNew: can.backfillNew,
      durationMs: can.durationMs,
      errors: can.errors,
    },
  }, null, 2));

  if (can.mode === 'unconfigured') process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error('[navby-can] фатальная ошибка:', String(e).slice(0, 300));
  process.exit(1);
});
