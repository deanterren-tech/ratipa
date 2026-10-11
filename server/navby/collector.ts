/**
 * Постоянный сбор истории одометра («CAN-пробег») — серверная оркестрация.
 *
 * Что делает цикл (вызывается launchd-агентом каждые 5 минут, см.
 * scripts/navby-collect.ts и deploy/launchd/*):
 *
 *  1) Почасовой съём (object-stat-data): для каждой сопоставленной машины
 *     запрашивается последнее(ие) закрытое(ые) окно(а) — до 2 измерений с
 *     РЕАЛЬНЫМ временем на окно. Значения целые км — точность помечается.
 *  2) Суточная догрузка сегментов (city-or-track + parking-movement-report)
 *     за последние полные дни: float-значения на границах сегментов
 *     движения/стоянок с реальными временами.
 *  3) Снимки current-position (каждые 5 минут) собирает обычный цикл поллера
 *     (runPollCycle); отдельно они здесь НЕ дублируются.
 *  4) Покрытие дня и состояние сбора пишутся в telemetry_can_coverage /
 *     telemetry_can_collect — UI различает четыре состояния (см. отчёт).
 *
 * Принципы: сбор НЕ зависит от рейса и от браузера; дедупликация по
 * идентичности измерения (store.writeCanMeasurements); отсутствующее
 * значение не превращается в ноль; лимит API уважается клиентом (40 req/min
 * при аккаунтном 100).
 */

import type { Database } from 'firebase-admin/database';
import { adminDb } from '../../firebaseAdmin.ts';
import { NavbyClient, navbyClientFromEnv } from './client.ts';
import { TelemetryStore, type CanCollectState, type TelemetryConfig } from './store.ts';
import {
  dedupeCanMeasurements,
  measurementsFromParkingIntervals,
  missingStatWindows,
  recentFullDays,
  sortCanMeasurements,
  type CanMeasurement,
} from './canHistory.ts';
import { navbyDayKey } from './config.ts';

export interface CanCollectSummary {
  mode: 'ok' | 'degraded' | 'skipped' | 'disabled' | 'unconfigured' | 'dry_run';
  reason?: string;
  sweepWindows: number;
  sweepCars: number;
  sweepPoints: number;
  sweepNew: number;
  sweepDup: number;
  backfillDays: number;
  backfillCars: number;
  backfillPoints: number;
  backfillNew: number;
  backfillDup: number;
  durationMs: number;
  errors: string[];
}

export interface CanCollectOptions {
  db?: Database | null;
  client?: NavbyClient;
  log?: (line: string) => void;
  dryRun?: boolean;
  nowMs?: number;
  /** Только почасовой съём (догрузка дня не запускается). */
  statOnly?: boolean;
  /** Только суточная догрузка. */
  backfillOnly?: boolean;
  /** Форсировать съём вне зависимости от расписания. */
  force?: boolean;
  /** Игнорировать single-flight блокировку (только ручные тесты). */
  ignoreLock?: boolean;
  prefix?: string;
}

interface CarTarget {
  carKey: string;
  objectId: string;
  imei: string | null;
}

/** Сопоставленные машины с IMEI (objectId → mapping; uid — из снимка объектов). */
export async function resolveCarTargets(store: TelemetryStore): Promise<CarTarget[]> {
  const mapping = await store.readMapping();
  const objects = ((await store.read('telemetry_navby_objects')) as Record<string, { uid?: string | null }> | null) || {};
  const out: CarTarget[] = [];
  for (const [carKey, m] of Object.entries(mapping || {})) {
    if (!m || !m.navbyObjectId) continue;
    const imei = (m.imei && String(m.imei)) || (objects[m.navbyObjectId]?.uid ? String(objects[m.navbyObjectId]?.uid) : null);
    if (!imei) continue;
    out.push({ carKey, objectId: String(m.navbyObjectId), imei });
  }
  return out.sort((a, b) => a.carKey.localeCompare(b.carKey));
}

function emptySummary(): CanCollectSummary {
  return {
    mode: 'skipped', sweepWindows: 0, sweepCars: 0, sweepPoints: 0, sweepNew: 0, sweepDup: 0,
    backfillDays: 0, backfillCars: 0, backfillPoints: 0, backfillNew: 0, backfillDup: 0,
    durationMs: 0, errors: [],
  };
}

/**
 * Один цикл постоянного сбора истории одометра. Исключений наружу не бросает.
 */
export async function runCanCollectionOnce(opts: CanCollectOptions = {}): Promise<CanCollectSummary> {
  const startedAt = Date.now();
  const nowMs = opts.nowMs ?? Date.now();
  const log = opts.log || ((s: string) => console.log(s));
  const db = opts.db !== undefined ? opts.db : adminDb;
  const summary = emptySummary();

  if (!db && !opts.dryRun) {
    summary.mode = 'unconfigured';
    summary.reason = 'no_admin_credentials';
    log('[navby-can] Firebase Admin не сконфигурирован — сбор истории невозможен');
    return summary;
  }
  const client = opts.client || navbyClientFromEnv(process.env, { ratePerMin: 30 });
  if (!client.hasCredentials()) {
    summary.mode = 'unconfigured';
    summary.reason = 'no_navby_credentials';
    if (db && !opts.dryRun) {
      const store = new TelemetryStore(db, { prefix: opts.prefix });
      await store.writeCanCollectState({ lastRunAt: new Date().toISOString(), mode: 'unconfigured', lastError: { at: new Date().toISOString(), kind: 'not_configured', detail: 'нет креденшелов Nav.by' } }).catch(() => {});
    }
    log('[navby-can] нет креденшелов Nav.by — сбор истории невозможен');
    return summary;
  }

  const store = db ? new TelemetryStore(db, { prefix: opts.prefix, log }) : null;
  const config: TelemetryConfig = store
    ? await store.readConfig()
    : ({ canCollectEnabled: true, canWindowMin: 60, canSweepMin: 60, canSweepMaxWindows: 3, canBackfillHours: 24, canBackfillDays: 2 } as TelemetryConfig);

  if (config.canCollectEnabled === false && !opts.force && !opts.dryRun) {
    summary.mode = 'disabled';
    summary.reason = 'can_collect_disabled';
    if (store) await store.writeCanCollectState({ lastRunAt: new Date().toISOString(), mode: 'disabled' }).catch(() => {});
    log('[navby-can] сбор истории выключен в настройках (telemetry_config.canCollectEnabled=false)');
    return summary;
  }

  const state: CanCollectState = store ? await store.readCanCollectState() : {};
  const targets = store ? await resolveCarTargets(store) : [];
  const errors: string[] = [];

  // Single-flight: один съём истории в момент времени (сервер-integrated
  // поллер, launchd-агент и ручные запуски не дублируют запросы).
  const runId = `can_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  let lockHeld = false;
  if (store && !opts.dryRun && !opts.ignoreLock) {
    lockHeld = await store.acquireRunLock(runId, Math.max((config.canSweepMin ?? 60) * 60_000, 300_000), 'telemetry_poller/can_lock').catch(() => false);
    if (!lockHeld) {
      summary.mode = 'skipped';
      summary.reason = 'locked';
      log('[navby-can] цикл пропущен: съём истории уже выполняется (single-flight)');
      return summary;
    }
  }

  try {
    /* ── 1) Почасовой съём измерений (object-stat-data) ── */
    const doSweep = !opts.backfillOnly && (opts.force || state.lastSweepAtMs == null || nowMs - (state.lastSweepAtMs || 0) >= (config.canSweepMin ?? 60) * 60_000);
    if (doSweep && targets.length) {
      const windows = missingStatWindows(opts.force ? nowMs - (config.canWindowMin ?? 60) * 60_000 : state.lastSweepAtMs ?? null, nowMs, config.canWindowMin ?? 60, config.canSweepMaxWindows ?? 3);
      for (const w of windows) {
        for (const target of targets) {
          try {
            const res = await client.getStatData(target.imei as string, w.fromMs, w.toMs);
            if (!res.ok || !res.data) {
              if (res.error?.kind && res.error.kind !== 'not_configured') errors.push(`stat:${target.carKey}:${res.error.kind}`);
              continue;
            }
            const points = dedupeCanMeasurements(res.data);
            summary.sweepPoints += points.length;
            if (points.length) {
              if (store && !opts.dryRun) {
                const wr = await store.writeCanMeasurements(target.carKey, points);
                summary.sweepNew += wr.written;
                summary.sweepDup += wr.duplicates + wr.revised;
                const byDay = groupByDay(points);
                for (const [day, dayPoints] of byDay) {
                  await store.writeCanCoverage(target.carKey, day, {
                    sw: { ok: true, pts: dayPoints.length },
                    ptsTotal: dayPoints.length,
                    firstMs: Math.min(...dayPoints.map((p) => p.measuredAtMs ?? Infinity)),
                    lastMs: Math.max(...dayPoints.map((p) => p.measuredAtMs ?? 0)),
                  }).catch(() => {});
                }
              } else {
                summary.sweepNew += points.length;
              }
            } else if (store && !opts.dryRun) {
              // Источник ответил, но измерений в окне нет (машина стояла) —
              // это не ошибка и НЕ «ноль км»; отмечаем только факт опроса.
              const day = navbyDayKey(w.toMs);
              await store.writeCanCoverage(target.carKey, day, { sw: { ok: true, pts: 0 } }).catch(() => {});
            }
          } catch (e) {
            errors.push(`stat:${target.carKey}:${String(e).slice(0, 60)}`);
          }
        }
        summary.sweepWindows += 1;
      }
      summary.sweepCars = targets.length;
      if (store && !opts.dryRun && windows.length) {
        await store.writeCanCollectState({ lastSweepAtMs: windows[windows.length - 1].toMs }).catch(() => {});
      }
    }

    /* ── 2) Суточная догрузка сегментов (city-or-track + parking) ── */
    const doBackfill = !opts.statOnly && (opts.force || state.lastBackfillAtMs == null || nowMs - (state.lastBackfillAtMs || 0) >= (config.canBackfillHours ?? 24) * 3_600_000);
    if (doBackfill && targets.length) {
      const days = recentFullDays(nowMs, config.canBackfillDays ?? 2);
      const perRun = Math.max(1, config.canBackfillCarsPerRun ?? 50);
      const startIdx = targets.length > perRun ? (state.backfillCursor || 0) % targets.length : 0;
      const batch = targets.length > perRun
        ? Array.from({ length: Math.min(perRun, targets.length) }, (_, i) => targets[(startIdx + i) % targets.length])
        : targets;
      const yesterdayKey = navbyDayKey(nowMs - 86_400_000);
      for (const target of batch) {
        let coverage: Record<string, Record<string, unknown>> = {};
        if (store) coverage = await store.readCanCoverage(target.carKey).catch(() => ({}));
        for (const day of days) {
          // Дни старше вчерашнего, уже закрытые догрузкой, не перезапрашиваем
          // (поздние данные за свежие дни подхватываются каждым циклом).
          const covered = coverage[day.dayKey]?.cs && (coverage[day.dayKey].cs as { ok?: boolean }).ok === true;
          if (covered && day.dayKey < yesterdayKey) continue;
          try {
            const all: CanMeasurement[] = [];
            const city = await client.getCityOrTrack(target.imei as string, day.fromMs, day.toMs);
            const cityPoints = city.ok && city.data ? dedupeCanMeasurements(city.data) : [];
            if (!city.ok && city.error) errors.push(`city:${target.carKey}:${city.error.kind}`);
            const park = await client.getParkingReport(target.imei as string, day.fromMs, day.toMs);
            const parkPoints = park.ok && park.data
              ? dedupeCanMeasurements(measurementsFromParkingIntervals(park.data.intervals, {
                  objectId: target.objectId, imei: target.imei, receivedAt: new Date(nowMs).toISOString(),
                }))
              : [];
            if (!park.ok && park.error) errors.push(`park:${target.carKey}:${park.error.kind}`);
            all.push(...cityPoints, ...parkPoints);
            summary.backfillPoints += all.length;
            const sorted = sortCanMeasurements(all);
            if (store && !opts.dryRun) {
              const wr = await store.writeCanMeasurements(target.carKey, sorted);
              summary.backfillNew += wr.written;
              summary.backfillDup += wr.duplicates + wr.revised;
              const dayPoints = sorted.filter((p) => p.measuredAtMs != null);
              await store.writeCanCoverage(target.carKey, day.dayKey, {
                cs: { ok: city.ok, pts: cityPoints.length },
                ps: { ok: park.ok, pts: parkPoints.length },
                ...(dayPoints.length
                  ? { firstMs: Math.min(...dayPoints.map((p) => p.measuredAtMs as number)), lastMs: Math.max(...dayPoints.map((p) => p.measuredAtMs as number)) }
                  : {}),
              }).catch(() => {});
            } else {
              summary.backfillNew += sorted.length;
            }
          } catch (e) {
            errors.push(`backfill:${target.carKey}:${String(e).slice(0, 60)}`);
          }
        }
      }
      summary.backfillCars = batch.length;
      summary.backfillDays = days.length;
      if (store && !opts.dryRun) {
        await store.writeCanCollectState({
          lastBackfillAtMs: nowMs,
          backfillCursor: targets.length > perRun ? (startIdx + perRun) % targets.length : 0,
        }).catch(() => {});
      }
    }

    summary.mode = errors.length ? 'degraded' : (opts.dryRun ? 'dry_run' : 'ok');
    summary.durationMs = Date.now() - startedAt;
    summary.errors = errors.slice(0, 10);
    if (store && !opts.dryRun) {
      await store.writeCanCollectState({
        lastRunAt: new Date().toISOString(),
        mode: summary.mode,
        lastError: errors.length ? { at: new Date().toISOString(), kind: errors[0].split(':')[2] || 'error', detail: errors[0].slice(0, 160) } : null,
        sweepStat: { windows: summary.sweepWindows, cars: summary.sweepCars, points: summary.sweepPoints, durationMs: summary.durationMs },
        backfillStat: { days: summary.backfillDays, cars: summary.backfillCars, points: summary.backfillPoints, durationMs: summary.durationMs },
      }).catch(() => {});
    }
    log(`[navby-can] цикл: mode=${summary.mode} окна=${summary.sweepWindows} машин=${summary.sweepCars} точек_съёма=${summary.sweepPoints} (новых ${summary.sweepNew}, дублей ${summary.sweepDup}) догрузка: дней=${summary.backfillDays} машин=${summary.backfillCars} точек=${summary.backfillPoints} (новых ${summary.backfillNew}) за ${summary.durationMs} мс${summary.errors.length ? `, ошибок ${summary.errors.length}` : ''}`);
    return summary;
  } catch (e) {
    summary.mode = 'degraded';
    summary.errors.push(String(e).slice(0, 120));
    summary.durationMs = Date.now() - startedAt;
    if (store && !opts.dryRun) {
      await store.writeCanCollectState({ lastRunAt: new Date().toISOString(), mode: 'degraded', lastError: { at: new Date().toISOString(), kind: 'internal', detail: String(e).slice(0, 160) } }).catch(() => {});
    }
    log(`[navby-can] цикл завершился ошибкой: ${String(e).slice(0, 200)}`);
    return summary;
  } finally {
    if (store && lockHeld) await store.releaseRunLockById(runId, 'telemetry_poller/can_lock').catch(() => {});
  }
}

/**
 * Догрузка истории по требованию (открытие дня/рейса в UI либо CLI):
 * сегменты (city + parking) за диапазон по дням + почасовые окна stat за
 * последние сутки диапазона. Возвращает сводку; идемпотентно (дедуп хранит).
 */
export async function backfillCanRange(params: {
  carKey: string;
  objectId: string;
  imei: string;
  fromMs: number;
  toMs: number;
  store: TelemetryStore;
  client?: NavbyClient;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; days: number; statPoints: number; segPoints: number; written: number; duplicates: number; errors: string[] }> {
  const { carKey, objectId, imei, store } = params;
  const log = params.log || (() => {});
  const client = params.client || navbyClientFromEnv(process.env);
  if (!client.hasCredentials()) return { ok: false, days: 0, statPoints: 0, segPoints: 0, written: 0, duplicates: 0, errors: ['no_navby_credentials'] };
  const MAX_RANGE_MS = 92 * 86_400_000;
  const fromMs = Math.max(params.fromMs, params.toMs - MAX_RANGE_MS);
  const toMs = params.toMs;
  const errors: string[] = [];
  let written = 0;
  let duplicates = 0;
  let statPoints = 0;
  let segPoints = 0;
  let days = 0;

  // Сегменты по дням (в поясе +03): city-or-track + parking.
  const dayStarts: number[] = [];
  for (let t = fromMs; t <= toMs; t += 86_400_000) dayStarts.push(t);
  for (let d = 0; d < dayStarts.length && d < 40; d += 1) {
    const dayFrom = d === 0 ? fromMs : Math.max(fromMs, dayStarts[d]);
    const dayTo = d === dayStarts.length - 1 ? toMs : Math.min(toMs, dayStarts[d] + 86_400_000 - 1);
    if (dayTo <= dayFrom) continue;
    days += 1;
    try {
      const city = await client.getCityOrTrack(imei, dayFrom, dayTo);
      const cityPoints = city.ok && city.data ? dedupeCanMeasurements(city.data) : [];
      if (!city.ok && city.error) errors.push(`city:${city.error.kind}`);
      const park = await client.getParkingReport(imei, dayFrom, dayTo);
      const parkPoints = park.ok && park.data
        ? dedupeCanMeasurements(measurementsFromParkingIntervals(park.data.intervals, { objectId, imei, receivedAt: new Date().toISOString() }))
        : [];
      if (!park.ok && park.error) errors.push(`park:${park.error.kind}`);
      const points = sortCanMeasurements([...cityPoints, ...parkPoints]);
      segPoints += points.length;
      const wr = await store.writeCanMeasurements(carKey, points);
      written += wr.written;
      duplicates += wr.duplicates + wr.revised;
      const dayKey = navbyDayKey(Math.min(dayTo, Math.max(dayFrom, toMs)));
      await store.writeCanCoverage(carKey, dayKey, {
        cs: { ok: city.ok, pts: cityPoints.length },
        ps: { ok: park.ok, pts: parkPoints.length },
      }).catch(() => {});
    } catch (e) {
      errors.push(`seg:${String(e).slice(0, 60)}`);
    }
  }

  // Почасовые окна stat — для последних 24 часов диапазона (если он свежий).
  try {
    const statFrom = Math.max(fromMs, toMs - 24 * 3_600_000);
    if (statFrom < toMs) {
      const windows = missingStatWindows(statFrom, Math.min(toMs, Date.now()), 60, 48);
      for (const w of windows) {
        const res = await client.getStatData(imei, w.fromMs, Math.min(w.toMs, toMs));
        if (!res.ok || !res.data) { if (res.error) errors.push(`stat:${res.error.kind}`); continue; }
        statPoints += res.data.length;
        const wr = await store.writeCanMeasurements(carKey, dedupeCanMeasurements(res.data));
        written += wr.written;
        duplicates += wr.duplicates + wr.revised;
      }
      if (windows.length) await store.writeCanCoverage(carKey, navbyDayKey(toMs), { sw: { ok: true, pts: statPoints } }).catch(() => {});
    }
  } catch (e) {
    errors.push(`stat:${String(e).slice(0, 60)}`);
  }
  log(`[navby-can] догрузка ${carKey}: дней=${days} точек_сегментов=${segPoints} точек_окон=${statPoints} записано=${written} дублей=${duplicates}${errors.length ? ` ошибок=${errors.length}` : ''}`);
  return { ok: errors.length === 0, days, statPoints, segPoints, written, duplicates, errors: errors.slice(0, 6) };
}

function groupByDay(points: CanMeasurement[]): Map<string, CanMeasurement[]> {
  const out = new Map<string, CanMeasurement[]>();
  for (const p of points) {
    if (p.measuredAtMs == null) continue;
    const day = navbyDayKey(p.measuredAtMs);
    if (!out.has(day)) out.set(day, []);
    (out.get(day) as CanMeasurement[]).push(p);
  }
  return out;
}
