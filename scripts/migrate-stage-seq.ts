/**
 * РУЧНАЯ миграция «seq» этапов рейсов (порядок маршрута «раньше внесён —
 * левее») + разовый отчёт по событиям на базе. Скрипт НЕ запускается
 * автоматически и НИЧЕГО не меняет без явного `--apply`.
 *
 * Что делает
 *  - Читает ветки `tripTimeline/tripStages/<planId>` (этапы рейсов «Плана
 *    дохода») и `tripTimeline/trips/<id>/stages` (ручные рейсы модуля),
 *    считает: сколько рейсов с этапами есть; у скольких этапов нет
 *    СОБСТВЕННОГО seq (у старых записей он читается миграционно:
 *    seq → order → позиция в массиве, lib/stageSchedule);
 *  - по умолчанию — только ОТЧЁТ (dry-run): ни одна запись не меняется;
 *  - с `--apply` — записывает `seq` ТОЛЬКО этапам, у которых его нет.
 *    Значение — тот же эффективный порядок, который уже показывается
 *    (seq → order → позиция), поэтому отображение не меняется;
 *  - `--match=<текст>` ограничивает прогон записями, в id которых есть текст
 *    (например, пробными) — остальные не читаются для записи и не меняются;
 *  - идемпотентно: повторный прогон не находит работы и ничего не пишет;
 *  - параллельно печатает отчёт по событиям на базе: сколько периодов с
 *    вложенной веткой `baza/<id>/events` и сколько событий без seq
 *    (порядок внесения; старые записи читаются по createdAt-фолбэку).
 *
 * В приложении seq старых этапов мигрирует ЛЕНИВО: при первой же правке этапов
 * рейса карточка дописывает номер существующим сохранением. Этот скрипт — для
 * ручного массового прогона (например, перед выгрузками), а не обязательный шаг.
 *
 * Запуск
 *   npx tsx scripts/migrate-stage-seq.ts                       # отчёт (ничего не пишет)
 *   npx tsx scripts/migrate-stage-seq.ts --apply               # записать seq (идемпотентно)
 *   npx tsx scripts/migrate-stage-seq.ts --json                # только машинный отчёт
 *   npx tsx scripts/migrate-stage-seq.ts --apply --match=probe # только пробные записи
 */
import { adminDb } from '../server/firebaseAdmin.ts';
import { normalizeStages } from '../src/components/modules/tripTimeline/lib/timeline';
import { stageSeqOf, hasStageSeq } from '../src/components/modules/tripTimeline/lib/stageSchedule';
import type { TimelineStage } from '../src/types';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const ONLY_JSON = ARGS.includes('--json');
/** Ограничение прогона: только записи, в id которых есть этот текст. */
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
const matched = (id: string): boolean => !MATCH || id.includes(MATCH);

/** Служебный этап-заглушка (показ без реального плана) — не мигрируется. */
const isFallbackStage = (s: TimelineStage): boolean => String(s?.id || '').endsWith('-fallback-load');

interface StoreScan {
  /** Рейсов/записей с непустым составом этапов. */
  tripsWithStages: number;
  /** Рейсов, у которых есть хотя бы один этап без собственного seq. */
  tripsWithoutSeq: number;
  /** Этапов всего (без служебных заглушек). */
  stagesTotal: number;
  /** Этапов без собственного seq (миграционный порядок при чтении). */
  stagesWithoutSeq: number;
}

const emptyScan = (): StoreScan => ({ tripsWithStages: 0, tripsWithoutSeq: 0, stagesTotal: 0, stagesWithoutSeq: 0 });

/** Записи → список этапов (RTDB отдаёт map; нормализация — как в приложении). */
const stagesOf = (raw: unknown): TimelineStage[] => normalizeStages(raw).filter((s) => !isFallbackStage(s));

interface BackfillItem {
  /** Путь к записи этапа в базе (без /seq). */
  path: string;
  seq: number;
  id: string;
}

/**
 * Разбор ветки-хранилища (`tripStages/<id>` или `trips/<id>/stages`):
 * считает покрытие seq и (в --apply) собирает пути на запись.
 * Порядок — ровно тот, что показывает приложение: normalizeStages →
 * stageSeqOf (seq → order → позиция в массиве).
 */
const scanStore = (storeKey: string, raw: unknown, scan: StoreScan, backfill: BackfillItem[]): void => {
  const stages = stagesOf(raw);
  if (!stages.length) return;
  scan.tripsWithStages += 1;
  let missing = 0;
  stages.forEach((s, i) => {
    scan.stagesTotal += 1;
    if (hasStageSeq(s)) return;
    scan.stagesWithoutSeq += 1;
    missing += 1;
    backfill.push({ path: storeKey, seq: stageSeqOf(s, i), id: String(s.id) });
  });
  if (missing > 0) scan.tripsWithoutSeq += 1;
};

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[migrate-stage-seq] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }
  const [stagesSnap, tripsSnap, bazaSnap] = await Promise.all([
    adminDb.ref('tripTimeline/tripStages').get(),
    adminDb.ref('tripTimeline/trips').get(),
    adminDb.ref('baza').get(),
  ]);

  const planScan = emptyScan();
  const manualScan = emptyScan();
  const backfill: BackfillItem[] = [];

  Object.entries((stagesSnap.val() || {}) as Record<string, unknown>).forEach(([tripId, store]) => {
    if (!matched(tripId)) return;
    scanStore(`tripTimeline/tripStages/${tripId}`, store, planScan, backfill);
  });
  Object.entries((tripsSnap.val() || {}) as Record<string, unknown>).forEach(([tripId, trip]) => {
    if (!matched(tripId)) return;
    const rec = (trip || {}) as Record<string, unknown>;
    scanStore(`tripTimeline/trips/${tripId}/stages`, rec.stages, manualScan, backfill);
  });

  // События на базе — только отчёт (порядок внесения seq; старые — по createdAt).
  let periodsWithEvents = 0;
  let eventsTotal = 0;
  let eventsWithoutSeq = 0;
  Object.values((bazaSnap.val() || {}) as Record<string, unknown>).forEach((rec) => {
    const ev = ((rec || {}) as Record<string, unknown>).events;
    const list = ev && typeof ev === 'object' ? Object.values(ev as Record<string, unknown>) : [];
    if (!list.length) return;
    periodsWithEvents += 1;
    list.forEach((e) => {
      eventsTotal += 1;
      const seq = Number((e as Record<string, unknown>)?.seq);
      if (!(Number.isFinite(seq) && seq >= 1)) eventsWithoutSeq += 1;
    });
  });

  let wrote = 0;
  if (APPLY && backfill.length) {
    // Одна атомарная запись: только пути seq этапов, которым его не хватает.
    const updates: Record<string, unknown> = {};
    backfill.forEach((b) => {
      updates[`${b.path}/${b.id}/seq`] = b.seq;
    });
    await adminDb.ref().update(updates);
    wrote = backfill.length;
  }

  const report = {
    apply: APPLY,
    match: MATCH || null,
    stages: {
      plan: planScan,
      manual: manualScan,
      total: {
        tripsWithStages: planScan.tripsWithStages + manualScan.tripsWithStages,
        tripsWithoutSeq: planScan.tripsWithoutSeq + manualScan.tripsWithoutSeq,
        stagesTotal: planScan.stagesTotal + manualScan.stagesTotal,
        stagesWithoutSeq: planScan.stagesWithoutSeq + manualScan.stagesWithoutSeq,
      },
    },
    events: { periodsWithEvents, eventsTotal, eventsWithoutSeq },
    backfillCandidates: backfill.length,
    wrote,
  };

  if (ONLY_JSON) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    const t = report.stages.total;
    console.log('[migrate-stage-seq] этапы: рейсов с этапами %d, из них без seq %d; этапов %d, без seq %d',
      t.tripsWithStages, t.tripsWithoutSeq, t.stagesTotal, t.stagesWithoutSeq);
    console.log('[migrate-stage-seq] план дохода: рейсов с этапами %d (без seq %d) · ручные рейсы: %d (без seq %d)',
      planScan.tripsWithStages, planScan.tripsWithoutSeq, manualScan.tripsWithStages, manualScan.tripsWithoutSeq);
    console.log('[migrate-stage-seq] события на базе: периодов с событиями %d, событий %d, без seq %d',
      periodsWithEvents, eventsTotal, eventsWithoutSeq);
    console.log(
      APPLY
        ? `[migrate-stage-seq] ЗАПИСАНО seq: ${wrote} (идемпотентно — повторный прогон запишет 0).`
        : `[migrate-stage-seq] режим отчёта (dry-run): кандидатов на дозапись seq — ${backfill.length}. Запись — только с --apply.`,
    );
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[migrate-stage-seq] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
