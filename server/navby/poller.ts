/**
 * Единый серверный поллер телеметрии Nav.by («Пробег и связь»).
 *
 * Принципы (п.3 спецификации):
 *  - опрашивает Nav.by РОВНО ОДИН процесс портала, не браузеры;
 *  - single-flight: блокировка в RTDB (telemetry_poller/lock) исключает
 *    параллельные дубли;
 *  - интервал — из telemetry_config (настраивается без перезапуска);
 *  - недоступность API не обнуляет данные: обновляется только статус,
 *    последние значения остаются в telemetry_current;
 *  - пишет: telemetry_current, telemetry_history (только НОВЫЕ измерения),
 *    telemetry_integration, telemetry_navby_objects, автопривязки,
 *    уведомления (по конфигу).
 *
 * Запуск: scripts/navby-poll.ts (npm run navby:poll / navby:poller),
 * либо из server.ts при NAVBY_POLLER_ENABLED=1.
 */

import type { Database } from 'firebase-admin/database';
import { adminDb } from '../../firebaseAdmin.ts';
import { NavbyClient, navbyClientFromEnv, type NavbyClientOptions } from './client.ts';
import { TelemetryStore, matchFleet, type TelemetryConfig } from './store.ts';
import { planAlerts, type AlertCarInput, type RfEntryLite } from './alerts.ts';

export interface PollSummary {
  mode: 'ok' | 'degraded' | 'skipped' | 'unconfigured' | 'dry_run';
  reason?: string;
  vehicleListOk: boolean;
  positionsOk: boolean;
  objectsTotal: number;
  objectsWithPosition: number;
  samplesNew: number;
  samplesSame: number;
  samplesOlder: number;
  samplesUnmapped: number;
  autoMapped: number;
  matchedCars: number;
  alertsUpserted: number;
  alertsRemoved: number;
  prunedDays: number;
  durationMs: number;
  lastError?: { kind: string; status?: number; detail?: string };
}

export interface PollOptions {
  /** Ничего не пишет в RTDB (только читает Nav.by и считает план). */
  dryRun?: boolean;
  /** Префикс изолированных веток RTDB (тесты поллера). */
  prefix?: string;
  client?: NavbyClient;
  clientOptions?: Partial<NavbyClientOptions>;
  db?: Database | null;
  log?: (line: string) => void;
  /** Игнорировать single-flight (используется только в тестах). */
  ignoreLock?: boolean;
  forcePrune?: boolean;
}

let loopStarted = false;

function buildPortalCars(tractorsRaw: unknown): Array<{ carKey: string; plate: string | null; label: string }> {
  const tractors = (tractorsRaw || {}) as Record<string, Record<string, unknown>>;
  return Object.entries(tractors).map(([key, t]) => ({
    carKey: key,
    plate: (typeof t.carNumber === 'string' && t.carNumber.trim()) || (typeof t.vehicleNumbers === 'string' && t.vehicleNumbers.trim()) || null,
    label: String(t.carNumber || t.vehicleNumbers || key),
  }));
}

/** Один цикл опроса. Возвращает сводку; исключений наружу не бросает. */
export async function runPollCycle(opts: PollOptions = {}): Promise<PollSummary> {
  const startedAt = Date.now();
  const log = opts.log || ((s: string) => console.log(s));
  const db = opts.db !== undefined ? opts.db : adminDb;

  const empty: PollSummary = {
    mode: 'skipped', vehicleListOk: false, positionsOk: false, objectsTotal: 0, objectsWithPosition: 0,
    samplesNew: 0, samplesSame: 0, samplesOlder: 0, samplesUnmapped: 0, autoMapped: 0, matchedCars: 0,
    alertsUpserted: 0, alertsRemoved: 0, prunedDays: 0, durationMs: 0,
  };

  if (!db && !opts.dryRun) {
    log('[navby] Firebase Admin не сконфигурирован — поллер не может писать. Задайте FIREBASE_SERVICE_ACCOUNT.');
    return { ...empty, mode: 'unconfigured', reason: 'no_admin_credentials', durationMs: Date.now() - startedAt };
  }

  const client = opts.client || navbyClientFromEnv(process.env, opts.clientOptions);
  if (!client.hasCredentials()) {
    log('[navby] нет креденшелов Nav.by — задайте NAVBY_LOGIN/NAVBY_PASSWORD (или NAVBY_TOKEN).');
    if (db && !opts.dryRun) {
      const store = new TelemetryStore(db, { prefix: opts.prefix });
      await store.writeIntegration({
        mode: 'unconfigured',
        lastRunAt: new Date().toISOString(),
        lastError: { at: new Date().toISOString(), kind: 'not_configured', detail: 'нет креденшелов Nav.by на сервере' },
      }).catch(() => {});
    }
    return { ...empty, mode: 'unconfigured', reason: 'no_navby_credentials', durationMs: Date.now() - startedAt };
  }

  const store = db ? new TelemetryStore(db, { prefix: opts.prefix, log }) : null;
  const config: TelemetryConfig = store ? await store.readConfig() : {
    enabled: true, intervalSec: 300, staleHours: 24, rfWindowHours: 48, retentionDays: 120,
    alertsEnabled: true, alertRoles: ['root_admin', 'admin', 'manager'], replyRemindHours: 72,
    alertCooldownHours: 12, maxAlertsPerRun: 30,
  };

  if (!config.enabled && !opts.dryRun) {
    log('[navby] опрос выключен в настройках модуля (telemetry_config.enabled=false)');
    if (store) await store.writeIntegration({ mode: 'disabled', lastRunAt: new Date().toISOString() }).catch(() => {});
    return { ...empty, mode: 'skipped', reason: 'disabled', durationMs: Date.now() - startedAt };
  }

  const runId = `run_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  if (store && !opts.dryRun && !opts.ignoreLock) {
    const ttl = Math.max(config.intervalSec * 2, 300) * 1000;
    const acquired = await store.acquireRunLock(runId, ttl);
    if (!acquired) {
      log('[navby] цикл пропущен: другой опрос уже выполняется (single-flight)');
      return { ...empty, mode: 'skipped', reason: 'locked', durationMs: Date.now() - startedAt };
    }
  }

  const summary: PollSummary = { ...empty };
  try {
    // 1) Список объектов + позиции (по одному батч-запросу на метод).
    const vl = await client.getVehicleList();
    summary.vehicleListOk = vl.ok;
    const objects = vl.ok && vl.data ? vl.data : [];
    summary.objectsTotal = objects.length;

    const cp = await client.getCurrentPositions();
    summary.positionsOk = cp.ok;
    const samples = cp.ok && cp.data ? cp.data.samples : [];
    summary.objectsWithPosition = samples.length;

    if (!vl.ok && vl.error) summary.lastError = { kind: vl.error.kind, status: vl.error.status, detail: vl.error.detail };
    else if (!cp.ok && cp.error) summary.lastError = { kind: cp.error.kind, status: cp.error.status, detail: cp.error.detail };

    if (store && !opts.dryRun && objects.length) {
      await store.writeNavbyObjects(objects).catch((e) => log(`[navby] запись объектов не удалась: ${String(e).slice(0, 120)}`));
    }

    // 2) Сопоставление автопарка.
    const tractorsRaw = store ? await store.readGlobal('tractors').catch(() => null) : null;
    const cars = buildPortalCars(tractorsRaw);
    const match = matchFleet(cars, objects.map((o) => ({ objectId: o.objectId, uid: o.uid, autoNumber: o.autoNumber, name: o.name, status: o.status })));
    if (store && !opts.dryRun) {
      summary.autoMapped = await store.applyAutoMappings(match).catch(() => 0);
    } else {
      summary.autoMapped = match.auto.length;
    }
    const mapping = store ? await store.readMapping() : {};
    const byObject = new Map<string, string>();
    for (const [carKey, m] of Object.entries(mapping || {})) {
      if (m && m.navbyObjectId) byObject.set(String(m.navbyObjectId), carKey);
    }
    summary.matchedCars = byObject.size;

    // 3) Запись измерений: только новое время; повторная метка не пишется.
    const prevCoords = store ? await store.readCurrentCoords() : {};
    const latestCoordByCar: Record<string, number | null> = { ...prevCoords };
    for (const s of samples) {
      const carKey = byObject.get(s.objectId);
      if (!carKey) { summary.samplesUnmapped++; continue; }
      const prev = prevCoords[carKey] ?? null;
      if (opts.dryRun || !store) {
        if (prev == null || s.coordAtMs > prev) { summary.samplesNew++; latestCoordByCar[carKey] = s.coordAtMs; }
        else if (s.coordAtMs === prev) summary.samplesSame++;
        else summary.samplesOlder++;
        continue;
      }
      const res = await store.writeSample(carKey, s, prev);
      if (res === 'new') { summary.samplesNew++; latestCoordByCar[carKey] = s.coordAtMs; }
      else if (res === 'same_timestamp') summary.samplesSame++;
      else summary.samplesOlder++;
    }

    // 4) Уведомления (по конфигу; дедупликация и cooldown внутри planAlerts).
    if (store && !opts.dryRun) {
      const [requestsRaw, rfRaw, alertState] = await Promise.all([
        store.read('telemetry_requests').catch(() => null),
        store.read('telemetry_rf_entry').catch(() => null),
        store.readAlertState().catch(() => ({})),
      ]);
      const requests = (requestsRaw || {}) as Record<string, { carKey?: string; status?: string; createdAtMs?: number; updatedAtMs?: number }>;
      const requestsByCar: Record<string, AlertCarInput['requests']> = {};
      for (const [id, r] of Object.entries(requests)) {
        const carKey = r?.carKey;
        if (!carKey) continue;
        (requestsByCar[carKey] ||= []).push({
          id,
          status: String(r.status || 'draft'),
          createdAtMs: typeof r.createdAtMs === 'number' ? r.createdAtMs : null,
          updatedAtMs: typeof r.updatedAtMs === 'number' ? r.updatedAtMs : null,
        });
      }
      const rfEntries: Record<string, RfEntryLite> = {};
      for (const [carKey, v] of Object.entries((rfRaw || {}) as Record<string, RfEntryLite>)) {
        if (v && typeof v.atMs === 'number') rfEntries[carKey] = { atMs: v.atMs };
      }
      const alertCars: AlertCarInput[] = [];
      for (const [carKey, m] of Object.entries(mapping || {})) {
        if (!m || !m.navbyObjectId) continue;
        alertCars.push({
          carKey,
          plate: m.plateRaw || m.plate || carKey,
          coordAtMs: latestCoordByCar[carKey] ?? null,
          requests: requestsByCar[carKey] || [],
        });
      }
      const planned = planAlerts({
        nowMs: Date.now(),
        cars: alertCars,
        rfEntries,
        config: {
          enabled: config.alertsEnabled,
          staleHours: config.staleHours,
          rfWindowHours: config.rfWindowHours,
          replyRemindHours: config.replyRemindHours,
          cooldownHours: config.alertCooldownHours,
          maxAlertsPerRun: config.maxAlertsPerRun,
          roles: config.alertRoles,
        },
        state: alertState,
      });
      const applied = await store.applyAlerts(planned).catch(() => ({ upserts: 0, removes: 0 }));
      summary.alertsUpserted = applied.upserts;
      summary.alertsRemoved = applied.removes;
    } else if (opts.dryRun) {
      // План без записи: считаем автомобили, которым бы ушли уведомления.
      const nowMs = Date.now();
      let would = 0;
      for (const [carKey, m] of Object.entries(mapping || {})) {
        if (!m || !m.navbyObjectId) continue;
        const ms = latestCoordByCar[carKey];
        if (ms != null && nowMs - ms > config.staleHours * 3_600_000) would++;
      }
      summary.alertsUpserted = would;
    }

    // 5) Срок хранения истории (раз в сутки).
    if (store && !opts.dryRun) {
      const integration = ((await store.read('telemetry_integration')) || {}) as { lastPruneAtMs?: number };
      const lastPrune = typeof integration.lastPruneAtMs === 'number' ? integration.lastPruneAtMs : 0;
      if (opts.forcePrune || Date.now() - lastPrune > 24 * 3_600_000) {
        summary.prunedDays = await store.pruneHistory(config.retentionDays).catch(() => 0);
      }
    }

    // 6) Статус интеграции.
    const ok = vl.ok && cp.ok;
    summary.mode = ok ? (opts.dryRun ? 'dry_run' : 'ok') : 'degraded';
    if (store && !opts.dryRun) {
      const at = new Date().toISOString();
      const integrationUpdate: Record<string, unknown> = {
        lastRunAt: at,
        mode: summary.mode,
        runId,
        durationMs: Date.now() - startedAt,
        objectsTotal: summary.objectsTotal,
        objectsWithPosition: summary.objectsWithPosition,
        matchedCars: summary.matchedCars,
        samplesNew: summary.samplesNew,
        tokenSource: client.tokenSource(),
      };
      if (ok) {
        integrationUpdate.lastOkAt = at;
        integrationUpdate.lastError = null;
      } else if (summary.lastError) {
        integrationUpdate.lastError = { at, kind: summary.lastError.kind, status: summary.lastError.status ?? null, detail: summary.lastError.detail || null };
      }
      if (summary.prunedDays) integrationUpdate.lastPruneAtMs = Date.now();
      await store.writeIntegration(integrationUpdate).catch(() => {});
    }

    summary.durationMs = Date.now() - startedAt;
    return summary;
  } catch (e) {
    summary.mode = 'degraded';
    summary.lastError = { kind: 'internal', detail: String(e instanceof Error ? e.message : e).slice(0, 200) };
    summary.durationMs = Date.now() - startedAt;
    if (store && !opts.dryRun) {
      await store.writeIntegration({
        lastRunAt: new Date().toISOString(),
        mode: 'degraded',
        lastError: { at: new Date().toISOString(), kind: 'internal', detail: summary.lastError.detail },
      }).catch(() => {});
    }
    return summary;
  } finally {
    if (store && !opts.dryRun && !opts.ignoreLock) {
      await store.releaseRunLock(runId).catch(() => {});
    }
  }
}

/** Интервал опроса из telemetry_config (для CLI-цикла), сек. */
export async function getPollIntervalSec(prefix?: string, fallbackSec = 300): Promise<number> {
  if (!adminDb) return fallbackSec;
  try {
    const store = new TelemetryStore(adminDb, { prefix });
    const cfg = await store.readConfig();
    return Math.max(60, Number(cfg.intervalSec) || fallbackSec);
  } catch {
    return fallbackSec;
  }
}

/**
 * Фоновый цикл для server.ts (включается NAVBY_POLLER_ENABLED=1).
 * Интервал перечитывается из telemetry_config каждый раз.
 */
export function startNavbyPoller(opts?: { log?: (s: string) => void }): void {
  if (loopStarted) return;
  loopStarted = true;
  const log = opts?.log || ((s: string) => console.log(s));
  const tick = async () => {
    let intervalMs = 300_000;
    try {
      const summary = await runPollCycle({ log });
      log(`[navby] цикл: mode=${summary.mode} новых=${summary.samplesNew} совпало=${summary.samplesSame} старее=${summary.samplesOlder} матч=${summary.matchedCars} уведомл=${summary.alertsUpserted}/${summary.alertsRemoved} (${summary.durationMs} мс)`);
      intervalMs = (await getPollIntervalSec()) * 1000;
    } catch (e) {
      log(`[navby] цикл завершился ошибкой: ${String(e).slice(0, 200)}`);
    } finally {
      setTimeout(tick, intervalMs);
    }
  };
  // Первый запуск — не мгновенно, чтобы не конкурировать со стартом сервера.
  setTimeout(tick, 15_000);
  log('[navby] серверный поллер запущен (NAVBY_POLLER_ENABLED=1)');
}
