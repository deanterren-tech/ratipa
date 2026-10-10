/**
 * Доступ к данным модуля «Пробег и связь» из интерфейса.
 * Чтение — подписки RTDB; запись — прямые обновления (как в других разделах
 * портала). Секретов Nav.by здесь нет и быть не может: браузер видит только
 * ветки telemetry_* (backend-токены живут на сервере).
 */

import { ref, onValue, update, set, remove, push, get } from 'firebase/database';
import { database, useFirebase, dbService } from '../../../api';
import { UserProfile } from '../../../types';
import type {
  McConfig, McCurrent, McIntegration, McMapping, McMappingHistoryEntry,
  McNavbyObject, McRequest, McRequestJournalEntry, McRfEntry,
} from './mcTypes';
import { MC_CONFIG_DEFAULTS } from './mcTypes';

const ROOT = 'telemetry';

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
};
