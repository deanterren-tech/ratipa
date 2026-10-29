/**
 * АУДИТ ПОРЯДКА ЭТАПОВ РЕЙСОВ (единый компаратор «дата, затем seq»,
 * lib/stageSchedule) — поиск нарушений хронологии и предупреждений шаблона
 * направления, с безопасным автоисправлением однозначных случаев.
 *
 * Что проверяется (обход ВСЕХ хранилищ этапов):
 *  · `tripTimeline/tripStages/<planId>` — рейсы из «Плана дохода»;
 *  · `tripTimeline/trips/<id>/stages` — ручные рейсы модуля.
 *  1) ЖЁСТКОЕ нарушение хронологии (lib/stageSchedule.stageOrderConflicts):
 *     дата этапа с БОЛЬШИМ seq раньше даты этапа с меньшим seq — в карточке
 *     такое сохранение блокируется, здесь — список на исправление;
 *  2) ПРЕДУПРЕЖДЕНИЕ шаблона направления (lib/stageTemplates.templateOrderWarnings):
 *     в один день этапы стоят не в порядке шаблона направления («Выгрузка»
 *     раньше «Границы» и т.п.).
 * Шаблон берётся из ветки `stageTemplates` (при пустой — стартовые «Китай»/
 * «Турция», как в модуле) по направлению рейса; справочник типов — из
 * `tripTimeline/config/stageTypes` (fallback — встроенный).
 *
 * Режимы:
 *  · по умолчанию — DRY-RUN: только отчёт, ничего не пишется;
 *  · `--apply --yes` — АВТОИСПРАВЛЕНИЕ ТОЛЬКО ОДНОЗНАЧНЫХ случаев: нарушение
 *    шаблона, все пары — в ОДНУ дату, жёстких нарушений у рейса нет. Этапы
 *    этой даты переставляются по порядку шаблона (обмен seq, перенумерация
 *    1..N), даты не меняются; ПЕРЕД записью делается бэкап (JSON со старыми
 *    значениями). Всё остальное — явным списком на ручную проверку;
 *  · `--verify` — повторный прогон (после --apply или самостоятельно):
 *    печатает остаток нарушений и выходит с кодом 1, если что-то осталось.
 * Дополнительно: `--json` (машинный отчёт в stdout), `--out=<путь>` (JSON-файл
 * отчёта), `--backup=<путь>` (файл бэкапа), `--match=<текст>` (ограничение по id).
 *
 * Запуск:
 *   npx tsx scripts/audit-stage-order.ts                       # отчёт (dry-run)
 *   npx tsx scripts/audit-stage-order.ts --json                # машинный отчёт
 *   npx tsx scripts/audit-stage-order.ts --apply --yes         # автоисправление + бэкап
 *   npx tsx scripts/audit-stage-order.ts --apply --yes --verify
 *   npx tsx scripts/audit-stage-order.ts --match=probe --apply --yes
 */
import fs from 'fs';
import path from 'path';
import { adminDb } from '../server/firebaseAdmin.ts';
import { normalizeStages } from '../src/components/modules/tripTimeline/lib/timeline';
import {
  isServiceStageId,
  renumberStageSeq,
  sortStagesRoute,
  stageOrderConflicts,
  stageSeqOf,
  swapStageOrderInList,
} from '../src/components/modules/tripTimeline/lib/stageSchedule';
import {
  effectiveStageTemplates,
  stageTemplatesFromDb,
  templateForDirection,
  templateOrderWarnings,
  type StageTemplate,
  type TemplateOrderWarning,
} from '../src/components/modules/tripTimeline/lib/stageTemplates';
import { DEFAULT_DIRECTIONS, mergeDirections, resolveDirection } from '../src/components/modules/tripTimeline/lib/directions';
import { effectiveStageTypes } from '../src/components/modules/tripTimeline/lib/catalog';
import {
  directionLabelOf,
  directionOptionsFromDb,
  effectiveDirectionOptions,
} from '../src/components/modules/tripTimeline/lib/directionCatalog';
import type { TimelineStage, TimelineStageType } from '../src/types';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const CONFIRMED = ARGS.includes('--yes');
const VERIFY = ARGS.includes('--verify');
const ONLY_JSON = ARGS.includes('--json');
const MATCH = (ARGS.find((a) => a.startsWith('--match=')) || '').split('=')[1] || '';
const OUT = (ARGS.find((a) => a.startsWith('--out=')) || '').split('=')[1] || 'scripts/out/audit-stage-order.json';
const BACKUP_ARG = (ARGS.find((a) => a.startsWith('--backup=')) || '').split('=')[1] || '';
const matched = (id: string): boolean => !MATCH || id.includes(MATCH);

/** Этапы рейса из ветки базы (map → список; служебные строки плана убираются). */
const stagesOf = (raw: unknown): TimelineStage[] => normalizeStages(raw).filter((s) => !isServiceStageId(s.id));

interface TripIssueReport {
  store: 'tripStages' | 'trips';
  tripId: string;
  /** Машина/маршрут — из источника (если нашлись). */
  carNumber: string;
  route: string;
  direction: string;
  template: string;
  stages: Array<{ id: string; type: string; label: string; plannedDate: string; seq: number }>;
  conflicts: Array<{ aId: string; aLabel: string; aDate: string; bId: string; bLabel: string; bDate: string }>;
  warnings: Array<{ day: string; aId: string; aName: string; bId: string; bName: string }>;
  autoFixable: boolean;
}

interface ApplyItem {
  path: string;
  id: string;
  before: { seq: number | null; order: number | null };
  after: { seq: number; order: number };
}

const labelOf = (types: TimelineStageType[], s: TimelineStage): string => {
  const t = types.find((x) => x.key === s.type);
  const base = t?.name || s.type || 'этап';
  return s.label ? `${base} — ${s.label}` : base;
};

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[audit-stage-order] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }
  if (APPLY && !CONFIRMED) {
    console.error('[audit-stage-order] --apply требует подтверждения --yes (запись в базу с бэкапом). Сначала прогоните dry-run.');
    return 2;
  }

  // ── Чтение источников ────────────────────────────────────────────────────
  const [stagesSnap, tripsSnap, dashSnap, tplSnap, typesSnap, dirsSnap] = await Promise.all([
    adminDb.ref('tripTimeline/tripStages').get(),
    adminDb.ref('tripTimeline/trips').get(),
    adminDb.ref('trips_dashboard').get(),
    adminDb.ref('stageTemplates').get(),
    adminDb.ref('tripTimeline/config/stageTypes').get(),
    adminDb.ref('directories/directions').get(),
  ]);
  const templates: StageTemplate[] = effectiveStageTemplates(stageTemplatesFromDb((tplSnap.val() || {}) as Record<string, unknown>));
  const typesRaw = (typesSnap.val() || {}) as Record<string, Record<string, unknown>>;
  const stageTypes: TimelineStageType[] = effectiveStageTypes(
    Object.keys(typesRaw).map((key) => {
      const rec = typesRaw[key] || {};
      const b = Number(rec.bufferDays);
      return {
        key: String(rec.key || key),
        name: String(rec.name || key),
        order: Number(rec.order) || 0,
        bufferDays: Number.isFinite(b) && b > 0 ? Math.floor(b) : 0,
      } satisfies TimelineStageType;
    }),
  );
  const dirs = mergeDirections(Object.values((dirsSnap.val() || {}) as Record<string, Record<string, unknown>>));
  const directionOptions = effectiveDirectionOptions(directionOptionsFromDb(Object.values((dirsSnap.val() || {}) as Array<Record<string, unknown>>)));
  const dash = (dashSnap.val() || {}) as Record<string, Record<string, unknown>>;

  /** Шаблон направления для записи: по названию/коду из данных. */
  const templateOf = (sourceId: string, manual: boolean, raw: Record<string, unknown>): StageTemplate | null => {
    const dashDir = dash[sourceId]?.direction;
    const text = String((manual ? raw.direction : undefined) || dashDir || '').trim();
    if (!text) return null;
    const def = resolveDirection(text, dirs) || DEFAULT_DIRECTIONS.find((d) => d.name === text || d.code === text) || null;
    return templateForDirection(templates, def?.name || text, def?.code || text);
  };

  // ── Сканирование ─────────────────────────────────────────────────────────
  const reports: TripIssueReport[] = [];
  const scans: Array<{ store: 'tripStages' | 'trips'; tripId: string; raw: Record<string, unknown> }> = [];
  Object.entries((stagesSnap.val() || {}) as Record<string, unknown>).forEach(([tripId, store]) => {
    if (matched(tripId)) scans.push({ store: 'tripStages', tripId, raw: (store || {}) as Record<string, unknown> });
  });
  Object.entries((tripsSnap.val() || {}) as Record<string, unknown>).forEach(([tripId, trip]) => {
    if (!matched(tripId)) return;
    const rec = (trip || {}) as Record<string, unknown>;
    scans.push({ store: 'trips', tripId, raw: rec });
  });

  let tripsWithStages = 0;
  let totalConflicts = 0;
  let totalWarnings = 0;
  for (const sc of scans) {
    const stages = stagesOf(sc.store === 'tripStages' ? sc.raw : sc.raw.stages);
    if (!stages.length) continue;
    tripsWithStages += 1;
    const ordered = sortStagesRoute(stages);
    const conflicts = stageOrderConflicts(ordered);
    const tpl = templateOf(sc.tripId, sc.store === 'trips', sc.raw);
    const warnings = tpl ? templateOrderWarnings(ordered, tpl, stageTypes) : [];
    totalConflicts += conflicts.length;
    totalWarnings += warnings.length;
    if (!conflicts.length && !warnings.length) continue;

    // Однозначный автофикс: есть предупреждения шаблона, все — в одну дату,
    // жёстких нарушений нет.
    const warningDays = new Set(warnings.map((w) => w.dayIso));
    const autoFixable = APPLY && conflicts.length === 0 && warnings.length > 0 && warningDays.size === 1;
    // Машина/маршрут для отчёта.
    const src = sc.store === 'trips' ? sc.raw : dash[sc.tripId] || {};
    reports.push({
      store: sc.store,
      tripId: sc.tripId,
      carNumber: String(src.carNumber || ''),
      route: String(src.route || src.direction || ''),
      direction: directionLabelOf(directionOptions, (sc.store === 'trips' ? sc.raw.direction : dash[sc.tripId]?.direction) || ''),
      template: tpl?.name || '',
      stages: ordered.map((s) => ({ id: String(s.id), type: String(s.type || ''), label: String(s.label || ''), plannedDate: String(s.plannedDate || ''), seq: stageSeqOf(s, 0) })),
      conflicts: conflicts.map((c) => ({
        aId: String(c.a.id), aLabel: labelOf(stageTypes, c.a), aDate: String(c.a.plannedDate || ''),
        bId: String(c.b.id), bLabel: labelOf(stageTypes, c.b), bDate: String(c.b.plannedDate || ''),
      })),
      warnings: warnings.map((w) => ({ day: w.dayIso, aId: String(w.a.id), aName: w.nameA, bId: String(w.b.id), bName: w.nameB })),
      autoFixable,
    });
  }

  // ── Применение (только однозначные) ─────────────────────────────────────
  const applyItems: ApplyItem[] = [];
  const appliedTrips: string[] = [];
  if (APPLY) {
    const updates: Record<string, unknown> = {};
    for (const rep of reports) {
      if (!rep.autoFixable) continue;
      const sc = scans.find((s) => s.tripId === rep.tripId && s.store === rep.store);
      if (!sc) continue;
      const stored = stagesOf(sc.store === 'tripStages' ? sc.raw : sc.raw.stages);
      const tpl = templates.find((t) => t.name === rep.template) || null;
      if (!tpl) continue;
      let list = sortStagesRoute(stored);
      const dayIso = rep.warnings[0].day;
      // Обмен пар по шаблону до чистоты в этой дате (детерминированно, даты не трогаются).
      const maxIter = list.length * list.length + 4;
      for (let i = 0; i < maxIter; i += 1) {
        const wn = templateOrderWarnings(list, tpl, stageTypes).filter((w: TemplateOrderWarning) => w.dayIso === dayIso);
        if (!wn.length) break;
        list = swapStageOrderInList(list, wn[0].a.id, wn[0].b.id);
      }
      const canonical = renumberStageSeq(sortStagesRoute(list));
      const base = sc.store === 'tripStages' ? `tripTimeline/tripStages/${sc.tripId}` : `tripTimeline/trips/${sc.tripId}/stages`;
      let changed = 0;
      canonical.forEach((s, idx) => {
        const before = stored.find((x) => String(x.id) === String(s.id));
        if (!before) return;
        const seqBeforeRaw = stored.find((x) => String(x.id) === String(s.id))!.seq;
        const seqBefore = stageSeqOf(before, stored.indexOf(before));
        const nextSeq = idx + 1;
        if (seqBefore === nextSeq) return;
        updates[`${base}/${s.id}/seq`] = nextSeq;
        updates[`${base}/${s.id}/order`] = nextSeq;
        changed += 1;
        applyItems.push({
          path: `${base}/${s.id}`,
          id: String(s.id),
          before: { seq: Number.isFinite(Number(seqBeforeRaw)) && Number(seqBeforeRaw) > 0 ? Math.floor(Number(seqBeforeRaw)) : null, order: Number.isFinite(Number(before.order)) && Number(before.order) > 0 ? Math.floor(Number(before.order)) : null },
          after: { seq: nextSeq, order: nextSeq },
        });
      });
      if (changed) appliedTrips.push(`${rep.store}#${rep.tripId}`);
    }
    if (Object.keys(updates).length) {
      // Бэкап ДО записи: старые значения каждого изменяемого пути.
      const backupPath = BACKUP_ARG || `scripts/out/stage-order-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(
        backupPath,
        JSON.stringify({ at: new Date().toISOString(), match: MATCH || null, updatesPathCount: Object.keys(updates).length, items: applyItems }, null, 1),
        'utf8',
      );
      if (!ONLY_JSON) console.log(`[audit-stage-order] БЭКАП старых значений: ${backupPath} (путей: ${Object.keys(updates).length})`);
      await adminDb.ref().update(updates);
      if (!ONLY_JSON) console.log(`[audit-stage-order] ЗАПИСАНО путей: ${Object.keys(updates).length} (рейсов: ${appliedTrips.length})`);
    } else if (!ONLY_JSON) {
      console.log('[audit-stage-order] однозначных автоисправлений нет — запись не выполнялась');
    }
  }

  // ── --verify: повторная проверка (после apply или самостоятельная) ──────
  let verifyRemaining: { conflicts: number; warnings: number } | null = null;
  if (VERIFY) {
    const [s2, t2] = await Promise.all([adminDb.ref('tripTimeline/tripStages').get(), adminDb.ref('tripTimeline/trips').get()]);
    let vc = 0;
    let vw = 0;
    Object.entries((s2.val() || {}) as Record<string, unknown>).forEach(([tripId, store]) => {
      if (!matched(tripId)) return;
      const stages = stagesOf(store);
      if (!stages.length) return;
      const ordered = sortStagesRoute(stages);
      vc += stageOrderConflicts(ordered).length;
      const tpl = templateOf(tripId, false, (store || {}) as Record<string, unknown>);
      vw += tpl ? templateOrderWarnings(ordered, tpl, stageTypes).length : 0;
    });
    Object.entries((t2.val() || {}) as Record<string, unknown>).forEach(([tripId, trip]) => {
      if (!matched(tripId)) return;
      const rec = (trip || {}) as Record<string, unknown>;
      const stages = stagesOf(rec.stages);
      if (!stages.length) return;
      const ordered = sortStagesRoute(stages);
      vc += stageOrderConflicts(ordered).length;
      const tpl = templateOf(tripId, true, rec);
      vw += tpl ? templateOrderWarnings(ordered, tpl, stageTypes).length : 0;
    });
    verifyRemaining = { conflicts: vc, warnings: vw };
  }

  // ── Отчёт ────────────────────────────────────────────────────────────────
  const manual = reports.filter((r) => !r.autoFixable);
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    at: new Date().toISOString(),
    match: MATCH || null,
    templatesFromDb: (Object.keys((tplSnap.val() || {}) as object).length > 0),
    tripsWithStages,
    tripsWithIssues: reports.length,
    conflicts: totalConflicts,
    warnings: totalWarnings,
    autoFixableTrips: reports.filter((r) => r.autoFixable).length,
    appliedTrips: APPLY ? appliedTrips : [],
    appliedPathCount: applyItems.length,
    manualTrips: manual.map((r) => `${r.store}#${r.tripId}`),
    verify: verifyRemaining,
    reports,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');

  if (ONLY_JSON) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log(`[audit-stage-order] режим: ${report.mode}${MATCH ? ` (match=${MATCH})` : ''}`);
    console.log(`[audit-stage-order] записей с этапами: ${tripsWithStages}; с проблемами: ${reports.length}`);
    console.log(`[audit-stage-order] нарушений хронологии: ${totalConflicts}; предупреждений шаблона: ${totalWarnings}`);
    console.log(`[audit-stage-order] однозначных (одна дата + шаблон): ${report.autoFixableTrips}${APPLY ? `; применено рейсов: ${appliedTrips.length}, путей: ${applyItems.length}` : ''}`);
    for (const r of reports) {
      const tpl = r.template ? `шаблон «${r.template}»` : 'шаблон не найден';
      console.log(`  · ${r.store}#${r.tripId}${r.carNumber ? ` (${r.carNumber})` : ''} — ${tpl}, конфликтов ${r.conflicts.length}, предупреждений ${r.warnings.length}${r.autoFixable ? ' [авто]' : APPLY ? ' [вручную]' : ''}`);
      r.conflicts.slice(0, 3).forEach((c) => console.log(`      ! хронология: «${c.bLabel}» (${c.bDate}) позже «${c.aLabel}» (${c.aDate}) по маршруту`));
      r.warnings.slice(0, 3).forEach((w) => console.log(`      ~ шаблон, ${w.day}: «${w.aName}» раньше «${w.bName}» — по шаблону наоборот`));
    }
    if (verifyRemaining) {
      console.log(`[audit-stage-order] ПРОВЕРКА после прогона: конфликтов ${verifyRemaining.conflicts}, предупреждений ${verifyRemaining.warnings}`);
    }
    console.log(`[audit-stage-order] JSON-отчёт: ${OUT}`);
    if (!APPLY) {
      console.log(`[audit-stage-order] dry-run: ничего не записано. Запись однозначных — только с --apply --yes (бэкап делается автоматически).`);
    }
  }

  if (VERIFY && verifyRemaining && (verifyRemaining.conflicts > 0 || verifyRemaining.warnings > 0)) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[audit-stage-order] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });
