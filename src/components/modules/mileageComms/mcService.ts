/**
 * Доступ к данным модуля «Пробег и связь» из интерфейса.
 * Чтение — подписки RTDB; запись — прямые обновления (как в других разделах
 * портала). Секретов Nav.by здесь нет и быть не может: браузер видит только
 * ветки telemetry_* (backend-токены живут на сервере).
 */

import { ref, onValue, update, set, remove, push, get } from 'firebase/database';
import { database, useFirebase, dbService, ensureAuth } from '../../../api';
import { UserProfile } from '../../../types';
import type {
  McCheckNoteRecord, McCheckRecords, McConfig, McCurrent, McIntegration, McMapping, McMappingHistoryEntry,
  McNavbyObject, McRequest, McRequestJournalEntry, McRfEntry,
} from './mcTypes';
import { MC_CONFIG_DEFAULTS } from './mcTypes';
import { MC_CHECK_DEFAULTS, mergeCheckParams, type CheckParams } from './engine/params';
import { normalizeSample, type HistoryNodeRaw } from './engine/samples';
import type { BoundsOverride, MeasureSample, ParkingIntervalRaw, TechMarkRecord } from './engine/types';

const ROOT = 'telemetry';

/** Ключ дня YYYYMMDD в поясе API (+03) — как navbyDayKey на сервере. */
const dayKeyOf = (ms: number): string => {
  const shifted = new Date(ms + 180 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${p(shifted.getUTCMonth() + 1)}${p(shifted.getUTCDate())}`;
};

/**
 * Firebase RTDB `set()/update()` падает при `undefined` в значении.
 * Вычищаем undefined рекурсивно (null остаётся — это осознанное «пусто»).
 */
function stripUndef<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndef) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = stripUndef(val);
    }
    return out as T;
  }
  return v;
}

function sub<T>(path: string, cb: (v: T | null) => void): () => void {
  if (!useFirebase) { cb(null); return () => {}; }
  try {
    return onValue(ref(database, path), (snap) => cb((snap.val() as T) || null), () => cb(null));
  } catch {
    cb(null);
    return () => {};
  }
}

async function addJournal(id: string, entry: McRequestJournalEntry): Promise<void> {
  if (!useFirebase) return;
  await set(push(ref(database, `${ROOT}_requests/${id}/journal`)), stripUndef(entry));
}

export const mcService = {
  subscribeConfig: (cb: (v: McConfig) => void) =>
    sub<McConfig>(`${ROOT}_config`, (v) => cb({ ...MC_CONFIG_DEFAULTS, ...(v || {}) })),
  subscribeIntegration: (cb: (v: McIntegration | null) => void) => sub<McIntegration>(`${ROOT}_integration`, cb),
  subscribeCurrent: (cb: (v: Record<string, McCurrent>) => void) => sub<Record<string, McCurrent>>(`${ROOT}_current`, (v) => cb(v || {})),
  subscribeMapping: (cb: (v: Record<string, McMapping>) => void) => sub<Record<string, McMapping>>(`${ROOT}_mapping`, (v) => cb(v || {})),
  subscribeMappingHistory: (cb: (v: Record<string, Record<string, McMappingHistoryEntry>>) => void) =>
    sub<Record<string, Record<string, McMappingHistoryEntry>>>(`${ROOT}_mapping_history`, (v) => cb(v || {})),
  subscribeNavbyObjects: (cb: (v: Record<string, McNavbyObject>) => void) => sub<Record<string, McNavbyObject>>(`${ROOT}_navby_objects`, (v) => cb(v || {})),
  subscribeRfEntries: (cb: (v: Record<string, McRfEntry>) => void) => sub<Record<string, McRfEntry>>(`${ROOT}_rf_entry`, (v) => cb(v || {})),
  subscribeRequests: (cb: (v: McRequest[]) => void) =>
    sub<Record<string, Omit<McRequest, 'id'>>>(
      `${ROOT}_requests`,
      (v) => cb(Object.entries(v || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))),
    ),

  async readCurrentOnce(): Promise<Record<string, McCurrent>> {
    if (!useFirebase) return {};
    try {
      const snap = await get(ref(database, `${ROOT}_current`));
      return (snap.val() as Record<string, McCurrent>) || {};
    } catch {
      return {};
    }
  },

  addJournal,

  // ─────────────── Сопоставление ───────────────

  async bindMapping(params: {
    carKey: string;
    objectId: string;
    imei: string | null;
    plateRaw: string | null;
    plateNormalized: string;
    user: UserProfile;
    prev?: McMapping | null;
    action: 'bind' | 'rebind' | 'confirm';
    comment?: string;
  }): Promise<void> {
    const { carKey, objectId, imei, plateRaw, plateNormalized, user, prev, action, comment } = params;
    if (!useFirebase) return;
    const at = new Date().toISOString();
    const record: McMapping = {
      navbyObjectId: objectId,
      imei,
      plate: plateNormalized,
      plateRaw: plateRaw || prev?.plateRaw || null,
      status: 'confirmed',
      source: 'manual',
      updatedBy: user.name,
      updatedAt: at,
    };
    await update(ref(database, `${ROOT}_mapping/${carKey}`), stripUndef(record));
    const entry: McMappingHistoryEntry = {
      at,
      by: user.name,
      byId: user.uid,
      action,
      from: prev ? { navbyObjectId: prev.navbyObjectId, imei: prev.imei } : undefined,
      to: { navbyObjectId: objectId, imei },
      comment: comment || (action === 'confirm' ? 'Привязка подтверждена администратором' : 'Привязка изменена вручную'),
    };
    await set(push(ref(database, `${ROOT}_mapping_history/${carKey}`)), stripUndef(entry));
    dbService.logAction(user.name, user.role, action === 'confirm' ? 'Подтверждение привязки Nav.by' : 'Изменение привязки Nav.by', 'MileageComms', carKey, `Объект ${objectId} (IMEI ${imei || '—'})`);
  },

  async unbindMapping(params: { carKey: string; user: UserProfile; prev: McMapping }): Promise<void> {
    const { carKey, user, prev } = params;
    if (!useFirebase) return;
    await remove(ref(database, `${ROOT}_mapping/${carKey}`));
    const entry: McMappingHistoryEntry = {
      at: new Date().toISOString(),
      by: user.name,
      byId: user.uid,
      action: 'unbind',
      from: { navbyObjectId: prev.navbyObjectId, imei: prev.imei },
      comment: 'Привязка снята администратором',
    };
    await set(push(ref(database, `${ROOT}_mapping_history/${carKey}`)), stripUndef(entry));
    dbService.logAction(user.name, user.role, 'Снятие привязки Nav.by', 'MileageComms', carKey, `Был объект ${prev.navbyObjectId}`);
  },

  // ─────────────── Въезд в РФ ───────────────

  async writeRfEntry(params: { carKey: string; atMs: number; source: string; comment: string; user: UserProfile }): Promise<void> {
    const { carKey, atMs, source, comment, user } = params;
    if (!useFirebase) return;
    const record: McRfEntry = {
      at: new Date(atMs).toISOString(),
      atMs,
      source,
      authorId: user.uid,
      authorName: user.name,
      comment: comment.trim() || undefined,
    };
    await set(ref(database, `${ROOT}_rf_entry/${carKey}`), stripUndef(record));
    dbService.logAction(user.name, user.role, 'Фиксация въезда в РФ', 'MileageComms', carKey, `Источник: ${source}`);
  },

  async clearRfEntry(params: { carKey: string; user: UserProfile }): Promise<void> {
    const { carKey, user } = params;
    if (!useFirebase) return;
    await remove(ref(database, `${ROOT}_rf_entry/${carKey}`));
    dbService.logAction(user.name, user.role, 'Удаление отметки въезда в РФ', 'MileageComms', carKey, '');
  },

  // ─────────────── Обращения ───────────────

  async createRequest(params: {
    carKey: string;
    plate: string;
    objectId: string | null;
    imei: string | null;
    problem: string;
    draftText: string;
    user: UserProfile;
  }): Promise<string> {
    const { carKey, plate, objectId, imei, problem, draftText, user } = params;
    if (!useFirebase) throw new Error('База недоступна');
    const id = `mc_req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const at = new Date().toISOString();
    const record: Omit<McRequest, 'id'> = {
      carKey, plate, objectId, imei,
      status: 'draft',
      problem,
      draftText,
      createdAt: at,
      createdAtMs: Date.now(),
      createdBy: user.name,
      createdById: user.uid,
      updatedAt: at,
      updatedAtMs: Date.now(),
    };
    await set(ref(database, `${ROOT}_requests/${id}`), record);
    await addJournal(id, { at, by: user.name, byId: user.uid, action: 'Создан черновик обращения' });
    dbService.logAction(user.name, user.role, 'Создание обращения (Пробег и связь)', 'MileageComms', carKey, id);
    return id;
  },

  async patchRequest(params: {
    id: string;
    carKey: string;
    user: UserProfile;
    patch: Record<string, unknown>;
    journalAction: string;
    journalNote?: string;
  }): Promise<void> {
    const { id, carKey, user, patch, journalAction, journalNote } = params;
    if (!useFirebase) return;
    const at = new Date().toISOString();
    await update(ref(database, `${ROOT}_requests/${id}`), stripUndef({ ...patch, updatedAt: at, updatedAtMs: Date.now() }));
    await addJournal(id, { at, by: user.name, byId: user.uid, action: journalAction, note: journalNote });
    dbService.logAction(user.name, user.role, 'Обращение (Пробег и связь)', 'MileageComms', carKey, `${id}: ${journalAction}`);
  },

  async removeRequest(params: { id: string; carKey: string; user: UserProfile }): Promise<void> {
    const { id, carKey, user } = params;
    if (!useFirebase) return;
    await remove(ref(database, `${ROOT}_requests/${id}`));
    dbService.logAction(user.name, user.role, 'Удаление обращения (Пробег и связь)', 'MileageComms', carKey, id);
  },

  /** Смена статуса с простановкой времени события. */
  async setRequestStatus(params: {
    id: string;
    carKey: string;
    user: UserProfile;
    status: McRequest['status'];
    journalAction: string;
    journalNote?: string;
  }): Promise<void> {
    const { status } = params;
    const at = new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === 'sent') patch.sentAt = at;
    if (status === 'restored') patch.restoredAt = at;
    if (status === 'closed') patch.closedAt = at;
    await this.patchRequest({ ...params, patch });
  },

  // ─────────────── Настройки модуля ───────────────

  async saveConfig(params: { patch: Partial<McConfig>; user: UserProfile }): Promise<void> {
    const { patch, user } = params;
    if (!useFirebase) return;
    await update(ref(database, `${ROOT}_config`), stripUndef({ ...patch, updatedAt: new Date().toISOString(), updatedBy: user.name }));
    dbService.logAction(user.name, user.role, 'Настройки «Пробег и связь»', 'MileageComms', 'config', JSON.stringify(patch).slice(0, 200));
  },

  // ─────────────── Проверка пробега по рейсу (этап 2) ───────────────

  /** Параметры проверки (пороги/окна) — общие, хранятся в telemetry_check_config. */
  subscribeCheckConfig: (cb: (v: CheckParams) => void) =>
    sub<Partial<CheckParams>>(`${ROOT}_check_config`, (v) => cb(mergeCheckParams(v))),

  async saveCheckConfig(params: { patch: Partial<CheckParams>; user: UserProfile }): Promise<void> {
    const { patch, user } = params;
    if (!useFirebase) return;
    await update(
      ref(database, `${ROOT}_check_config`),
      stripUndef({ ...patch, updatedAt: new Date().toISOString(), updatedBy: user.name }),
    );
    dbService.logAction(user.name, user.role, 'Параметры проверки пробега', 'MileageComms', 'check_config', JSON.stringify(patch).slice(0, 200));
  },

  /** Записи проверки конкретного рейса: границы, журнал, техотметки, закрытые события. */
  subscribeCheckRecords: (carKey: string, tripKey: string, cb: (v: McCheckRecords) => void): (() => void) =>
    sub<McCheckRecords>(`${ROOT}_checks/${carKey}/${tripKey}`, (v) => cb(v || {})),

  /**
   * История измерений за диапазон: чтение дневных папок telemetry_history
   * (ключи дней в поясе +03) + «хвост» telemetry_current, если он новее.
   * Загружается ТОЛЬКО выбранная машина и её окно — не весь автопарк.
   */
  async readHistoryRange(carKey: string, fromMs: number, toMs: number): Promise<MeasureSample[]> {
    if (!useFirebase || !carKey) return [];
    const padMs = 36 * 3_600_000;
    const start = fromMs - padMs;
    const end = Math.max(toMs, Date.now()) + padMs;
    const days: string[] = [];
    for (let t = start; t <= end + 86_400_000; t += 12 * 3_600_000) {
      const k = dayKeyOf(t);
      if (!days.includes(k)) days.push(k);
      if (days.length > 135) break; // больше срока хранения не читаем
    }
    const list: MeasureSample[] = [];
    const chunks = await Promise.all(
      days.map(async (d) => {
        try {
          const snap = await get(ref(database, `${ROOT}_history/${carKey}/${d}`));
          return snap.val() as Record<string, HistoryNodeRaw> | null;
        } catch {
          return null;
        }
      }),
    );
    for (const chunk of chunks) {
      if (!chunk) continue;
      for (const node of Object.values(chunk)) {
        const s = normalizeSample(node);
        if (s) list.push(s);
      }
    }
    try {
      const snap = await get(ref(database, `${ROOT}_current/${carKey}`));
      const cur = snap.val();
      const s = cur ? normalizeSample(cur as HistoryNodeRaw) : null;
      if (s && s.atMs >= start && s.atMs <= end) list.push(s);
    } catch {
      /* нет текущего состояния — не страшно */
    }
    return list;
  },

  /** Отчёт Nav.by «Стоянка-движение» через серверный прокси (токен Nav.by в браузер не попадает). */
  async fetchParkingReport(carKey: string, fromMs: number, toMs: number): Promise<{
    ok: boolean;
    reason?: string;
    intervals?: ParkingIntervalRaw[];
    fetchedAt?: string;
    cached?: boolean;
  }> {
    try {
      const authUser = useFirebase ? await ensureAuth() : null;
      if (!authUser) return { ok: false, reason: 'нет авторизации Firebase' };
      const token = await authUser.getIdToken();
      const url = `/api/navby/parking-report?carKey=${encodeURIComponent(carKey)}&from=${Math.round(fromMs)}&to=${Math.round(toMs)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        intervals?: ParkingIntervalRaw[];
        fetchedAt?: string;
        cached?: boolean;
      } | null;
      if (data && data.ok === false) return { ok: false, reason: parkingReasonLabel(data.reason) };
      if (!res.ok || !data) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true, intervals: data.intervals || [], fetchedAt: data.fetchedAt, cached: data.cached };
    } catch (e) {
      return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 120) };
    }
  },

  /** Комментарий проверяющего (журнал рейса; опционально — к стоянке). */
  async addCheckNote(params: {
    carKey: string;
    tripKey: string;
    action: string;
    note?: string;
    stopId?: string | null;
    user: UserProfile;
  }): Promise<void> {
    const { carKey, tripKey, action, note, stopId, user } = params;
    if (!useFirebase) return;
    const entry: McCheckNoteRecord = {
      at: new Date().toISOString(),
      atMs: Date.now(),
      by: user.name,
      byId: user.uid,
      action,
      note: note?.trim() || undefined,
      stopId: stopId || undefined,
    };
    await set(push(ref(database, `${ROOT}_checks/${carKey}/${tripKey}/notes`)), stripUndef(entry));
    dbService.logAction(user.name, user.role, 'Проверка пробега: комментарий', 'MileageComms', `${carKey}/${tripKey}`, action);
  },

  /** Техническая отметка (работы, замена трекера, настройка счётчика). */
  async addTechMark(params: {
    carKey: string;
    tripKey: string;
    atMs: number;
    kind: TechMarkRecord['kind'];
    comment?: string;
    user: UserProfile;
  }): Promise<void> {
    const { carKey, tripKey, atMs, kind, comment, user } = params;
    if (!useFirebase) return;
    const id = `tm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const record: TechMarkRecord = {
      id,
      atMs,
      kind,
      label: kind === 'works' ? 'Технические работы' : kind === 'tracker_replace' ? 'Замена трекера' : 'Изменение настройки счётчика',
      comment: comment?.trim() || undefined,
      by: user.name,
      byId: user.uid,
    };
    await set(ref(database, `${ROOT}_checks/${carKey}/${tripKey}/tech/${id}`), stripUndef(record));
    await this.addCheckNote({
      carKey, tripKey, user,
      action: `Техническая отметка: ${record.label}`,
      note: comment,
    });
  },

  /** Уточнение границ анализа (уполномоченный сотрудник) + запись в историю изменения. */
  async saveBoundsOverride(params: {
    carKey: string;
    tripKey: string;
    fromMs: number;
    toMs: number;
    comment?: string;
    user: UserProfile;
  }): Promise<void> {
    const { carKey, tripKey, fromMs, toMs, comment, user } = params;
    if (!useFirebase) return;
    const at = new Date().toISOString();
    const record: BoundsOverride = { fromMs, toMs, by: user.name, byId: user.uid, at, comment: comment?.trim() || undefined };
    await set(ref(database, `${ROOT}_checks/${carKey}/${tripKey}/bounds`), stripUndef(record));
    await this.addCheckNote({
      carKey, tripKey, user,
      action: 'Границы анализа уточнены вручную',
      note: comment,
    });
  },

  /** Возврат к границам источника (сброс ручного уточнения). */
  async clearBoundsOverride(params: { carKey: string; tripKey: string; user: UserProfile }): Promise<void> {
    const { carKey, tripKey, user } = params;
    if (!useFirebase) return;
    await remove(ref(database, `${ROOT}_checks/${carKey}/${tripKey}/bounds`));
    await this.addCheckNote({ carKey, tripKey, user, action: 'Границы анализа возвращены к источнику' });
  },

  /** Отметка события проверенным («принято к сведению»). Техотметка событие НЕ закрывает. */
  async resolveEvent(params: {
    carKey: string;
    tripKey: string;
    eventId: string;
    note?: string;
    user: UserProfile;
  }): Promise<void> {
    const { carKey, tripKey, eventId, note, user } = params;
    if (!useFirebase) return;
    await set(
      ref(database, `${ROOT}_checks/${carKey}/${tripKey}/resolved/${eventId.replace(/[.#$/[\]]/g, '_')}`),
      stripUndef({ at: new Date().toISOString(), atMs: Date.now(), by: user.name, byId: user.uid, note: note?.trim() || undefined }),
    );
    await this.addCheckNote({
      carKey, tripKey, user,
      action: 'Событие отмечено проверенным',
      note: note,
      stopId: eventId.startsWith('ev:') ? eventId.slice(3) : null,
    });
  },

  async unresolveEvent(params: { carKey: string; tripKey: string; eventId: string; user: UserProfile }): Promise<void> {
    const { carKey, tripKey, eventId, user } = params;
    if (!useFirebase) return;
    await remove(ref(database, `${ROOT}_checks/${carKey}/${tripKey}/resolved/${eventId.replace(/[.#$/[\]]/g, '_')}`));
    await this.addCheckNote({ carKey, tripKey, user, action: 'Событие возвращено в проверку' });
  },
};

function parkingReasonLabel(reason?: string): string {
  switch (reason) {
    case 'navby_unconfigured': return 'доступы Nav.by не заданы на сервере';
    case 'no_mapping': return 'объект Nav.by не сопоставлен';
    case 'auth': return 'ошибка авторизации Nav.by';
    case 'forbidden': return 'нет прав у учётной записи Nav.by';
    case 'rate_limit': return 'превышен лимит запросов Nav.by';
    case 'timeout': return 'таймаут запроса к Nav.by';
    case 'network': return 'сеть недоступна';
    case 'bad_token': return 'сессия устарела — обновите страницу';
    case 'rate_limited': return 'слишком частые запросы — подождите минуту';
    default: return reason || 'отчёт недоступен';
  }
}
