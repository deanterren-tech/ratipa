/**
 * Типы и маленькие чистые помощники модуля «Пробег и связь».
 * Формы узлов согласованы с серверным поллером (server/navby/store.ts).
 * Здесь дублируются только те поля, которые читает UI.
 */

import type { MeasureSample, TechMarkRecord } from './engine/types';

export interface McMapping {
  navbyObjectId: string;
  imei: string | null;
  plate: string | null;
  plateRaw?: string | null;
  status: 'auto' | 'confirmed' | 'conflict';
  source: 'auto_plate' | 'manual';
  updatedBy?: string;
  updatedAt?: string;
}

export interface McMappingHistoryEntry {
  at: string;
  by: string;
  byId?: string;
  action: 'bind' | 'rebind' | 'unbind' | 'confirm';
  from?: { navbyObjectId?: string; imei?: string | null };
  to?: { navbyObjectId?: string; imei?: string | null };
  comment?: string;
}

export interface McCurrent {
  navbyObjectId: string;
  lat: number;
  lon: number;
  coordAt: string | null;
  coordAtMs: number;
  receivedAt: string;
  coordIsLastKnown?: boolean;
  deviceLastMessageAt: string | null;
  speed?: number;
  azimuth?: number;
  satellites?: number;
  ignition?: number;
  gsm?: number;
  place?: string;
  country?: string;
  countryCode?: string;
  odoSource: string;
  odoUnit: string;
  odoQuality: 'ok' | 'zero_missing' | 'absent';
  odoPresent: boolean;
  odoKm?: number;
  odoVirtKm?: number;
}

export interface McIntegration {
  mode?: 'ok' | 'degraded' | 'disabled' | 'unconfigured';
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: { at?: string; kind?: string; status?: number | null; detail?: string | null } | null;
  objectsTotal?: number;
  objectsWithPosition?: number;
  matchedCars?: number;
  samplesNew?: number;
  tokenSource?: 'env' | 'login' | null;
  durationMs?: number;
}

export interface McConfig {
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
  updatedAt?: string;
  updatedBy?: string;
}

/* ─────────────── Проверка пробега по рейсу (этап 2) ─────────────── */

/** Узел проверки рейса: telemetry_checks/<carKey>/<tripKey>. */
export interface McCheckNoteRecord {
  at: string;
  atMs: number;
  by: string;
  byId?: string;
  action: string;
  note?: string;
  stopId?: string;
}

export interface McCheckRecords {
  bounds?: {
    fromMs: number;
    toMs: number;
    by?: string;
    byId?: string;
    at: string;
    comment?: string;
  } | null;
  notes?: Record<string, McCheckNoteRecord>;
  tech?: Record<string, TechMarkRecord>;
  resolved?: Record<string, { at: string; atMs: number; by: string; byId?: string; note?: string }>;
}

/** Измерение портала — единый тип движка проверки (без дублирования полей). */
export type McEngineSample = MeasureSample;

export const MC_CONFIG_DEFAULTS: McConfig = {
  enabled: true,
  intervalSec: 300,
  staleHours: 24,
  rfWindowHours: 48,
  retentionDays: 120,
  alertsEnabled: true,
  alertRoles: ['root_admin', 'admin', 'manager'],
  replyRemindHours: 72,
  alertCooldownHours: 12,
  maxAlertsPerRun: 30,
};

export interface McNavbyObject {
  objectId: string;
  uid: string | null;
  name: string;
  autoNumber: string | null;
  garageNumber?: string | null;
  status: 'active' | 'paused';
  seenAt?: string;
}

export type McRequestStatus =
  | 'draft'
  | 'sent'
  | 'awaiting_reply'
  | 'diagnostics'
  | 'master_needed'
  | 'restored'
  | 'closed';

export const MC_REQUEST_STATUS_LABELS: Record<McRequestStatus, string> = {
  draft: 'Черновик',
  sent: 'Отправлено',
  awaiting_reply: 'Ожидается ответ',
  diagnostics: 'Диагностика',
  master_needed: 'Требуется мастер',
  restored: 'Восстановлено',
  closed: 'Закрыто',
};

export const MC_REQUEST_STATUS_ORDER: McRequestStatus[] = [
  'draft', 'sent', 'awaiting_reply', 'diagnostics', 'master_needed', 'restored', 'closed',
];

/** Статус, при котором обращение считается открытым. */
export const isOpenRequest = (s: McRequestStatus): boolean =>
  s !== 'closed' && s !== 'restored';

/**
 * Нормализация госномера для подсказок сопоставления (клиентская копия
 * серверного правила: кириллица→латиница, только буквы/цифры).
 * Совпадение здесь — ПОДСКАЗКА; решение принимает администратор.
 */
const MC_CYR_TO_LAT: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p',
  с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ё: 'e', б: 'b', г: 'g',
  д: 'd', ж: 'j', з: 'z', и: 'i', й: 'i', л: 'l', п: 'p', ф: 'f', ц: 'c',
  ч: 'c', ш: 's', щ: 's', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'y', я: 'y',
};

export function plateNorm(v: string | null | undefined): string {
  if (!v) return '';
  let out = '';
  for (const ch of v.toLowerCase()) {
    if (MC_CYR_TO_LAT[ch] !== undefined) out += MC_CYR_TO_LAT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

export interface McRequestJournalEntry {
  at: string;
  by: string;
  byId?: string;
  action: string;
  note?: string;
}

export interface McRequest {
  id: string;
  carKey: string;
  plate: string;
  objectId: string | null;
  imei: string | null;
  status: McRequestStatus;
  problem: string;
  draftText: string;
  createdAt: string;
  createdAtMs: number;
  createdBy: string;
  createdById?: string;
  updatedAt?: string;
  updatedAtMs?: number;
  sentAt?: string;
  replyText?: string;
  replyAt?: string;
  restoredAt?: string;
  closedAt?: string;
  journal?: Record<string, McRequestJournalEntry>;
}

export interface McRfEntry {
  at: string;
  atMs: number;
  source: string;
  authorId?: string;
  authorName?: string;
  comment?: string;
}

/** Источники подтверждения въезда (ручные; автопредположений нет). */
export const MC_RF_SOURCES = [
  'Сообщение водителя',
  'Телефонный разговор',
  'Данные перевозчика/таможни',
  'Другое',
] as const;

/** Возраст в мс → «2 ч 15 мин» / «3 дн 4 ч» / «< 1 мин». */
export function ageLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const abs = Math.max(0, ms);
  const min = Math.floor(abs / 60_000);
  if (min < 1) return '< 1 мин';
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} дн ${h % 24} ч`;
  if (h >= 1) return `${h} ч ${min % 60} мин`;
  return `${min} мин`;
}

/** Время для таблиц: 10.10.2026 14:17 (в поясе Минска/МСК, +03). */
export function fmtTs(ms: number | string | null | undefined): string {
  if (ms == null) return '—';
  const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Minsk',
  });
}

/** До/после въезда в РФ: окно ожидания. */
export function rfWindowState(
  rf: McRfEntry | null | undefined,
  coordAtMs: number | null | undefined,
  nowMs: number,
  rfWindowHours: number,
): 'none' | 'in_window' | 'window_over' | 'restored_after_entry' {
  if (!rf || typeof rf.atMs !== 'number') return 'none';
  const windowMs = Math.max(1, rfWindowHours) * 3_600_000;
  const freshAfterEntry = coordAtMs != null && coordAtMs > rf.atMs;
  if (freshAfterEntry) return 'restored_after_entry';
  if (nowMs - rf.atMs < windowMs) return 'in_window';
  return 'window_over';
}

/**
 * Обобщённое состояние строки «Нет обновлений». Честные категории без
 * названных причин: что известно — то и показываем.
 */
export type McRowState =
  | 'integration_down'     // данные портала не обновляются (API недоступно)
  | 'no_data'              // объект сопоставлен, но данных от него нет вовсе
  | 'stale'                // координата старая
  | 'fresh_no_odo'         // данные свежие, одометр не передаётся
  | 'fresh';               // всё свежо

export function rowStateOf(params: {
  current: McCurrent | null;
  integrationMode?: string;
  nowMs: number;
  staleHours: number;
}): McRowState {
  const { current, integrationMode, nowMs, staleHours } = params;
  if (integrationMode === 'unconfigured' || integrationMode === 'degraded') return 'integration_down';
  if (!current) return 'no_data';
  const age = nowMs - current.coordAtMs;
  if (age > Math.max(1, staleHours) * 3_600_000) return 'stale';
  if (current.odoQuality !== 'ok' && current.odoQuality !== undefined) return 'fresh_no_odo';
  return 'fresh';
}

/** Рекомендуемое действие — по строке и контексту; без домыслов о причинах. */
export function recommendedAction(params: {
  state: McRowState;
  rfState: 'none' | 'in_window' | 'window_over' | 'restored_after_entry';
  openRequest: McRequest | null;
}): string {
  const { state, rfState, openRequest } = params;
  if (openRequest) {
    if (openRequest.status === 'awaiting_reply') return 'Дождаться ответа поддержки или зафиксировать его вручную';
    if (openRequest.status === 'master_needed') return 'Запланировать осмотр мастером';
    if (openRequest.status === 'draft') return 'Отправить черновик обращения (вручную)';
    if (openRequest.status === 'sent') return 'Отметить ожидание ответа или зафиксировать ответ';
    if (openRequest.status === 'diagnostics') return 'Дождаться диагностики';
    if (openRequest.status === 'restored') return 'Проверить данные и закрыть обращение';
    return 'Проверить состояние обращения';
  }
  if (state === 'integration_down') return 'Проверить настройки интеграции (опрос приостановлен)';
  if (rfState === 'in_window') return 'Дождаться окна после въезда в РФ; при необходимости — обращение';
  if (rfState === 'window_over') return 'Окно после въезда истекло — создать обращение в поддержку';
  if (state === 'no_data') return 'У объекта нет данных — проверить привязку и создать обращение';
  if (state === 'stale') return 'Создать обращение в поддержку';
  if (state === 'fresh_no_odo') return 'Данные идут, одометр не передаётся — уточнить у поддержки при необходимости';
  return 'Действий не требуется';
}

/** Черновик обращения по шаблону п.12 спецификации. */
export function buildRequestDraft(params: {
  plate: string;
  objectId: string | null;
  imei: string | null;
  current: McCurrent | null;
  rfEntry: McRfEntry | null;
  problem: string;
  nowMs: number;
}): string {
  const { plate, objectId, imei, current, rfEntry, problem, nowMs } = params;
  const lastCoord = current
    ? `${fmtTs(current.coordAtMs)}${current.place ? `, ${current.place}` : ''}`
    : 'нет данных';
  const age = current ? ageLabel(nowMs - current.coordAtMs) : '—';
  const rf = rfEntry ? fmtTs(rfEntry.atMs) : 'неизвестно';
  return [
    `Автомобиль: ${plate}`,
    `Объект Nav.by: ${objectId || '—'}`,
    `IMEI: ${imei || '—'}`,
    `Последняя координата: ${lastCoord}`,
    `Возраст координаты: ${age}`,
    `Последнее сообщение устройства: ${current?.deviceLastMessageAt ? fmtTs(current.deviceLastMessageAt) : 'недоступно (API не предоставляет отдельного времени сообщения)'}`,
    `Въезд в РФ: ${rf}`,
    `Проблема: ${problem}`,
    '',
    'Просим проверить связь устройства с сервером, состояние SIM и получение спутниковых координат. При необходимости выполнить удалённый перезапуск. Сообщить причину, возможность восстановления накопленной истории и необходимость осмотра оборудования.',
  ].join('\n');
}

/** Сводка по парку для вкладки «Проверка пробега» (каркас без вердиктов). */
export interface McFleetSummary {
  total: number;
  fresh: number;
  stale: number;
  noData: number;
  noOdo: number;
  inRfWindow: number;
}

export function summarizeFleet(params: {
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  rfEntries: Record<string, McRfEntry>;
  integrationMode?: string;
  nowMs: number;
  staleHours: number;
  rfWindowHours: number;
}): McFleetSummary {
  const { mapping, current, rfEntries, integrationMode, nowMs, staleHours, rfWindowHours } = params;
  const s: McFleetSummary = { total: 0, fresh: 0, stale: 0, noData: 0, noOdo: 0, inRfWindow: 0 };
  for (const carKey of Object.keys(mapping)) {
    const m = mapping[carKey];
    if (!m || !m.navbyObjectId) continue;
    s.total += 1;
    const cur = current[carKey] || null;
    const st = rowStateOf({ current: cur, integrationMode, nowMs, staleHours });
    if (st === 'fresh') s.fresh += 1;
    else if (st === 'stale') s.stale += 1;
    else if (st === 'no_data') s.noData += 1;
    if (cur && cur.odoQuality !== 'ok') s.noOdo += 1;
    if (rfWindowState(rfEntries[carKey], cur?.coordAtMs, nowMs, rfWindowHours) === 'in_window') s.inRfWindow += 1;
  }
  return s;
}
