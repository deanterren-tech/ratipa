/**
 * Слой доступа к RTDB для модуля «Пробег и связь».
 * Используется только серверной частью (firebase-admin). Клиентская БД
 * этих узлов — для чтения; запись привязок/обращений идёт из UI отдельно.
 *
 * Все ветки модуля живут под единым префиксом (по умолчанию пустым):
 *   [prefix/]telemetry_config, [prefix/]telemetry_current, ...
 * Префикс нужен для изолированных проверок поллера (--prefix test) —
 * продовые ветки при этом не трогаются.
 */

import type { Database } from 'firebase-admin/database';
import {
  CAN_COLLECT_DEFAULTS,
  TELEMETRY_DEFAULTS,
  navbyDayKey,
  navbyTimeKey,
  NAVBY_ODO_UNIT,
} from './config.ts';
import type { NormalizedNavbyObject, TelemetrySample } from './parse.ts';
import type { AlertStateEntry, PlannedAlert } from './alerts.ts';
import { matchFleet, type AutoMatch, type FleetMatchResult } from './match.ts';
import {
  canMeasurementIdentity,
  canMeasurementNodeKey,
  fromCanNode,
  toCanNode,
  type CanMeasurement,
} from './canHistory.ts';

export interface TelemetryConfig {
  enabled: boolean;
  intervalSec: number;
  staleHours: number;
  rfWindowHours: number;
  retentionDays: number;
  alertsEnabled: boolean;
  alertRoles: string[];
  replyRemindHours: number;
  alertCooldownHours: number;
  maxAlertsPerRun: number;
  /* ── постоянный сбор истории CAN-пробега (значения по умолчанию — CAN_COLLECT_DEFAULTS) ── */
  canCollectEnabled?: boolean;
  canWindowMin?: number;
  canSweepMin?: number;
  canSweepMaxWindows?: number;
  canBackfillHours?: number;
  canBackfillDays?: number;
  canBackfillCarsPerRun?: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** Состояние постоянного сбора истории (telemetry_can_collect). */
export interface CanCollectState {
  lastSweepAtMs?: number;
  lastBackfillAtMs?: number;
  lastRunAt?: string;
  mode?: string;
  lastError?: { at: string; kind: string; detail?: string | null } | null;
  sweepStat?: { windows: number; cars: number; points: number; durationMs: number };
  backfillStat?: { days: number; cars: number; points: number; durationMs: number };
  /** Курсор догрузки машин (продолжение со следующего цикла). */
  backfillCursor?: number;
  totals?: { statPoints?: number; cityPoints?: number; parkPoints?: number };
}

export interface MappingRecord {
  navbyObjectId: string;
  imei: string | null;
  plate: string | null;
  /** Госномер для отображения (как в портале). */
  plateRaw?: string | null;
  status: 'auto' | 'confirmed' | 'conflict';
  source: 'auto_plate' | 'manual';
  updatedBy?: string;
  updatedAt?: string;
}

export interface PortalCar {
  carKey: string;
  plate: string | null;
  label: string;
}

export class TelemetryStore {
  private db: Database;
  private prefix: string;
  private log: (s: string) => void;

  constructor(db: Database, opts?: { prefix?: string; log?: (s: string) => void }) {
    this.db = db;
    this.prefix = (opts?.prefix || '').replace(/^\/+|\/+$/g, '');
    this.log = opts?.log || (() => {});
  }

  p(...parts: string[]): string {
    return [this.prefix, ...parts].filter(Boolean).join('/');
  }

  /** Узел уведомлений портала (при изолированном префиксе — свой). */
  notificationsRoot(): string {
    return this.prefix ? this.p('ratipa_notifications') : 'ratipa_notifications';
  }

  async read(path: string): Promise<unknown> {
    const snap = await this.db.ref(this.p(path)).once('value');
    return snap.val();
  }

  async readGlobal(path: string): Promise<unknown> {
    const snap = await this.db.ref(path).once('value');
    return snap.val();
  }

  async readConfig(): Promise<TelemetryConfig> {
    const raw = (await this.read('telemetry_config')) as Partial<TelemetryConfig> | null;
    return { ...TELEMETRY_DEFAULTS, ...CAN_COLLECT_DEFAULTS, ...(raw || {}) };
  }

  async readMapping(): Promise<Record<string, MappingRecord>> {
    return ((await this.read('telemetry_mapping')) as Record<string, MappingRecord>) || {};
  }

  /** Автоприсвоения сервером (source auto_plate) не перетирают ручные/подтверждённые. */
  async applyAutoMappings(result: FleetMatchResult): Promise<number> {
    const existing = await this.readMapping();
    const usedObjects = new Set(Object.values(existing).map((m) => String(m.navbyObjectId)));
    const updates: Record<string, MappingRecord> = {};
    for (const pair of result.auto) {
      if (existing[pair.carKey]) continue;
      if (usedObjects.has(pair.objectId)) continue;
      updates[pair.carKey] = {
        navbyObjectId: pair.objectId,
        imei: pair.imei,
        plate: pair.plateNormalized,
        plateRaw: pair.plateRaw,
        status: 'auto',
        source: 'auto_plate',
        updatedBy: 'poller',
        updatedAt: new Date().toISOString(),
      };
      usedObjects.add(pair.objectId);
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      await this.db.ref(this.p('telemetry_mapping')).update(updates);
      // История автопривязок — чтобы «откуда взялось» было видно администратору.
      const history: Record<string, unknown> = {};
      const at = new Date().toISOString();
      for (const carKey of keys) {
        const rec = updates[carKey];
        history[this.p('telemetry_mapping_history', carKey, `auto_${Date.now().toString(36)}_${carKey.slice(-6)}`)] = {
          at, by: 'Поллер Nav.by', byId: 'poller', action: 'bind',
          to: { navbyObjectId: rec.navbyObjectId, imei: rec.imei },
          comment: 'Автопривязка по однозначному совпадению госномера',
        };
      }
      await this.db.ref().update(history);
    }
    return keys.length;
  }

  /** Снимок списка объектов Nav.by — для UI сопоставления (без секретов). */
  async writeNavbyObjects(objects: NormalizedNavbyObject[]): Promise<void> {
    const map: Record<string, unknown> = {};
    const at = new Date().toISOString();
    for (const o of objects) {
      map[o.objectId] = {
        objectId: o.objectId,
        uid: o.uid,
        name: o.name,
        autoNumber: o.autoNumber,
        garageNumber: o.garageNumber,
        status: o.status,
        seenAt: at,
      };
    }
    await this.db.ref(this.p('telemetry_navby_objects')).set(map);
  }

  /**
   * Single-flight: захват блокировки цикла. Если свежая блокировка уже есть —
   * цикл пропускается (дублирующие параллельные опросы запрещены).
   */
  async acquireRunLock(runId: string, ttlMs: number, lockPath = 'telemetry_poller/lock'): Promise<boolean> {
    const ref = this.db.ref(this.p(lockPath));
    const now = Date.now();
    const res = await ref.transaction((cur: unknown) => {
      const c = cur as { id?: string; expiresAtMs?: number } | null;
      if (c && typeof c.expiresAtMs === 'number' && c.expiresAtMs > now && c.id !== runId) {
        return; // занято — прерываем транзакцию
      }
      return { id: runId, atMs: now, expiresAtMs: now + ttlMs, status: 'running' };
    });
    return res.committed;
  }

  /** Снятие блокировки по указанному пути (не чужой). */
  async releaseRunLockById(runId: string, lockPath = 'telemetry_poller/lock'): Promise<void> {
    const ref = this.db.ref(this.p(lockPath));
    await ref.transaction((cur: unknown) => {
      const c = cur as { id?: string } | null;
      if (c && c.id !== runId) return; // чужую не трогаем
      return null;
    }).catch(() => {});
  }

  async releaseRunLock(runId: string): Promise<void> {
    await this.releaseRunLockById(runId, 'telemetry_poller/lock');
  }

  async readCurrentCoords(): Promise<Record<string, number>> {
    const cur = ((await this.read('telemetry_current')) as Record<string, { coordAtMs?: number }>) || {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cur)) {
      if (v && typeof v.coordAtMs === 'number') out[k] = v.coordAtMs;
    }
    return out;
  }

  /**
   * Запись текущего состояния и — если измерение НОВОЕ — записи в историю.
   * Повторная метка времени не пишется ни в current, ни в history;
   * более старая метка не откатывает текущее состояние.
   */
  async writeSample(carKey: string, sample: TelemetrySample, prevCoordAtMs: number | null): Promise<'new' | 'same_timestamp' | 'older'> {
    const receivedAt = new Date().toISOString();
    if (prevCoordAtMs != null && sample.coordAtMs < prevCoordAtMs) return 'older';
    if (prevCoordAtMs != null && sample.coordAtMs === prevCoordAtMs) return 'same_timestamp';

    const current: Record<string, unknown> = {
      navbyObjectId: sample.objectId,
      lat: sample.lat,
      lon: sample.lon,
      coordAt: sample.coordAt,
      coordAtMs: sample.coordAtMs,
      receivedAt,
      // Явные маркеры недоступности — UI показывает «неизвестно», а не причину.
      coordIsLastKnown: true,
      deviceLastMessageAt: null,
    };
    if (sample.speed != null) current.speed = sample.speed;
    if (sample.azimuth != null) current.azimuth = sample.azimuth;
    if (sample.satellites != null) current.satellites = sample.satellites;
    if (sample.ignition != null) current.ignition = sample.ignition;
    if (sample.gsm != null) current.gsm = sample.gsm;
    if (sample.place) current.place = sample.place;
    if (sample.country) current.country = sample.country;
    if (sample.countryCode) current.countryCode = sample.countryCode;
    current.odoSource = sample.odoSource;
    current.odoUnit = NAVBY_ODO_UNIT;
    current.odoQuality = sample.odoQuality;
    current.odoPresent = sample.odoPresent;
    if (sample.odoKm != null) current.odoKm = sample.odoKm;
    if (sample.odoVirtKm != null) current.odoVirtKm = sample.odoVirtKm;

    const history: Record<string, unknown> = {
      coordAtMs: sample.coordAtMs,
      coordAt: sample.coordAt,
      lat: sample.lat,
      lon: sample.lon,
      receivedAt,
      odoSource: sample.odoSource,
    };
    if (sample.speed != null) history.speed = sample.speed;
    if (sample.odoKm != null) history.odoKm = sample.odoKm;
    if (sample.satellites != null) history.satellites = sample.satellites;

    const updates: Record<string, unknown> = {
      [this.p('telemetry_current', carKey)]: current,
      [this.p('telemetry_history', carKey, navbyDayKey(sample.coordAtMs), navbyTimeKey(sample.coordAtMs))]: history,
    };
    await this.db.ref().update(updates);
    return 'new';
  }

  async writeIntegration(state: Record<string, unknown>): Promise<void> {
    await this.db.ref(this.p('telemetry_integration')).update(state);
  }

  /* ───────────────────────── История измерений одометра («CAN-пробег») ─────────────────────────
   *
   * Ветка: telemetry_can_history/<carKey>/<YYYYMMDD>/<HHMMSSmmm_tag>.
   * Хранятся ТОЛЬКО измерения с подтверждённым временем источника (методы
   * object-stat-data / city-or-track / parking-movement-report). Снимки
   * портала отдельно НЕ дублируются — читаются проекцией telemetry_history.
   * Дедупликация по идентичности измерения (источник + время): повтор с тем
   * же значением пропускается, повтор с другим значением — уточнение
   * источника (перезапись, rAt2). Одинаковое значение с новым временем —
   * полноценная новая точка (отсутствие изменения).
   */

  async writeCanMeasurements(carKey: string, list: CanMeasurement[]): Promise<{ written: number; duplicates: number; revised: number }> {
    if (!list.length) return { written: 0, duplicates: 0, revised: 0 };
    // Группировка по дням; чтение дня — один раз.
    const byDay = new Map<string, CanMeasurement[]>();
    for (const m of list) {
      if (m.measuredAtMs == null || !(m.valueKm > 0)) continue;
      const day = navbyDayKey(m.measuredAtMs);
      if (!byDay.has(day)) byDay.set(day, []);
      (byDay.get(day) as CanMeasurement[]).push(m);
    }
    let written = 0;
    let duplicates = 0;
    let revised = 0;
    const updates: Record<string, unknown> = {};
    for (const [day, items] of byDay) {
      const nodePath = this.p('telemetry_can_history', carKey, day);
      const existing = ((await this.db.ref(nodePath).once('value')).val() as Record<string, Record<string, unknown>> | null) || {};
      const identities = new Map<string, { key: string; value: number }>();
      for (const [key, node] of Object.entries(existing)) {
        const m = fromCanNode(key, node);
        if (m && m.measuredAtMs != null) identities.set(canMeasurementIdentity(m.source, m.measuredAtMs), { key, value: m.valueKm });
      }
      for (const m of items) {
        const key = canMeasurementNodeKey(m);
        const id = canMeasurementIdentity(m.source, m.measuredAtMs);
        const prev = identities.get(id);
        if (prev && Math.abs(prev.value - m.valueKm) < 1e-9) {
          duplicates++; // повтор того же измерения из API — не новая точка
          continue;
        }
        if (prev && prev.key === key) {
          const update: Record<string, unknown> = { ...toCanNode(m) };
          update.rAt2 = m.receivedAt; // пересмотр значения источником
          updates[`${nodePath}/${key}`] = update;
          revised++;
          identities.set(id, { key, value: m.valueKm });
          continue;
        }
        updates[`${nodePath}/${key}`] = { ...toCanNode(m) };
        identities.set(id, { key, value: m.valueKm });
        written++;
      }
    }
    if (Object.keys(updates).length) await this.db.ref().update(updates);
    return { written, duplicates, revised };
  }

  /** Чтение измерений одометра за диапазон (по дневным папкам в поясе +03). */
  async readCanHistory(carKey: string, fromMs: number, toMs: number): Promise<CanMeasurement[]> {
    const out: CanMeasurement[] = [];
    const seen = new Set<string>();
    for (let t = fromMs; t <= toMs + 86_400_000; t += 12 * 3_600_000) {
      const day = navbyDayKey(Math.min(t, toMs));
      if (seen.has(day)) continue;
      seen.add(day);
      if (seen.size > 200) break;
      const node = ((await this.db.ref(this.p('telemetry_can_history', carKey, day)).once('value')).val() as Record<string, Record<string, unknown>> | null) || {};
      for (const [key, raw] of Object.entries(node)) {
        const m = fromCanNode(key, raw);
        if (m && m.measuredAtMs != null && m.measuredAtMs >= fromMs && m.measuredAtMs <= toMs) out.push(m);
      }
    }
    return out.sort((a, b) => (a.measuredAtMs ?? 0) - (b.measuredAtMs ?? 0));
  }

  /** Сводка покрытия дня (какие методы отработали, сколько точек дали). */
  async writeCanCoverage(carKey: string, day: string, patch: Record<string, unknown>): Promise<void> {
    const at = new Date().toISOString();
    await this.db.ref(this.p('telemetry_can_coverage', carKey, day)).update({ ...patch, filledAt: at });
  }

  async readCanCoverage(carKey: string): Promise<Record<string, Record<string, unknown>>> {
    return ((await this.read(`telemetry_can_coverage/${carKey}`)) as Record<string, Record<string, unknown>>) || {};
  }

  async readCanCollectState(): Promise<CanCollectState> {
    return ((await this.read('telemetry_can_collect')) as CanCollectState) || {};
  }

  async writeCanCollectState(patch: Record<string, unknown>): Promise<void> {
    await this.db.ref(this.p('telemetry_can_collect')).update(patch);
  }

  async readAlertState(): Promise<Record<string, AlertStateEntry>> {
    return ((await this.read('telemetry_alerts')) as Record<string, AlertStateEntry>) || {};
  }

  /**
   * Применение плана уведомлений: upsert обновляет ОДНУ запись события
   * (дедупликация по id), remove закрывает её. Отдельно ведётся состояние
   * telemetry_alerts для cooldown.
   */
  async applyAlerts(planned: PlannedAlert[]): Promise<{ upserts: number; removes: number }> {
    if (!planned.length) return { upserts: 0, removes: 0 };
    let upserts = 0;
    let removes = 0;
    const nowIso = new Date().toISOString();
    for (const a of planned) {
      if (a.action === 'upsert') {
        if (a.kind === 'restored') {
          await this.db.ref(`${this.notificationsRoot()}/${a.id}`).set({
            title: a.title,
            text: a.text,
            type: 'success',
            date: new Date(a.atMs).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' }).replace(',', ''),
            dispatcher: 'Пробег и связь',
            targetRoles: a.roles,
            kind: `mileageComms:${a.kind}`,
            carKey: a.carKey,
            atIso: nowIso,
          });
          upserts++;
        } else {
          await this.db.ref(`${this.notificationsRoot()}/${a.id}`).set({
            title: a.title,
            text: a.text,
            type: 'warning',
            date: new Date(a.atMs).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' }).replace(',', ''),
            dispatcher: 'Пробег и связь',
            targetRoles: a.roles,
            kind: `mileageComms:${a.kind}`,
            carKey: a.carKey,
            atIso: nowIso,
          });
          upserts++;
        }
        await this.db.ref(this.p('telemetry_alerts', a.id)).set({ lastAtMs: a.atMs, lastKind: a.kind, active: true });
      } else {
        await this.db.ref(`${this.notificationsRoot()}/${a.id}`).remove().catch(() => {});
        await this.db.ref(this.p('telemetry_alerts', a.id)).set({ lastAtMs: a.atMs, lastKind: a.kind, active: false });
        removes++;
      }
    }
    return { upserts, removes };
  }

  /** Удаление истории старше retentionDays (по дневным папкам YYYYMMDD). */
  async pruneHistory(retentionDays: number): Promise<number> {
    const cutoff = navbyDayKey(Date.now() - Math.max(1, retentionDays) * 86_400_000);
    let removed = 0;
    const pruneTree = async (root: string): Promise<void> => {
      const hist = (await this.read(root)) as Record<string, Record<string, unknown>> | null;
      if (!hist) return;
      for (const [carKey, days] of Object.entries(hist)) {
        const staleDays = Object.keys(days || {}).filter((d) => /^\d{8}$/.test(d) && d < cutoff);
        for (const d of staleDays) {
          await this.db.ref(this.p(root, carKey, d)).remove();
          removed++;
        }
      }
    };
    await pruneTree('telemetry_history');
    // История измерений одометра и покрытие — тот же срок хранения.
    await pruneTree('telemetry_can_history');
    await pruneTree('telemetry_can_coverage');
    return removed;
  }
}

export { matchFleet };
export type { AutoMatch };
