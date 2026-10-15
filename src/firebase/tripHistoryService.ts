/**
 * Хранение и чтение единой истории изменений рейса.
 *
 * Ветка базы: `tripTimeline/tripHistory/<tripKey>/<opKey>` — одна запись на
 * одну УСПЕШНУЮ операцию сохранения (поля: at — serverTimestamp, by/byUid —
 * автор, source — timeline | plan | system, opKey, summary, lines с
 * «было → стало»). Ключ записи = opKey (содержимое изменений + окно времени):
 * та же правка, пришедшая из другой вкладки/по пути «Плана дохода», попадает в
 * ТУ ЖЕ запись — дублей при синхронизации не появляется.
 *
 * Записи истории доступны только на чтение из интерфейса: правки/удаления
 * истории в UI нет.
 *
 * Старая история плана (`tripTimeline/planGuard/<tripKey>/history`) НЕ удаляется
 * и НЕ перезаписывается: она подмешивается в тот же список при показе
 * (legacyPlanHistoryViews, lib/tripHistory).
 */
import { get, onValue, ref, set, serverTimestamp } from 'firebase/database';
import type { TimelinePlanHistoryEntry, TimelineStage } from '../types';
import { database, useFirebase } from '../firebase';
import {
  buildTripHistoryDraft,
  mergeTripHistoryViews,
  planRecordHistoryLines,
  tripHistoryOpKey,
  tripHistoryPath,
  tripHistoryLiveFromStore,
  type TripHistoryDraft,
  type TripHistoryEntry,
  type TripHistoryLine,
  type TripHistorySnapshot,
  type TripHistorySource,
  type TripHistoryView,
} from '../components/modules/tripTimeline/lib/tripHistory';

/** Узел старой истории плана (механизм разрешений) — только чтение. */
const LEGACY_GUARD_HISTORY_PATH = (tripKey: string): string =>
  `tripTimeline/planGuard/${String(tripKey || '').replace(/[.#$/[\]]/g, '_')}/history`;

export interface TripHistorySnapshotParams {
  tripKey: string;
  before: TripHistorySnapshot;
  after: TripHistorySnapshot;
  by?: string;
  byUid?: string;
  source: TripHistorySource;
  nameOf?: (s: TimelineStage) => string;
  summary?: string;
}

/**
 * Запись истории операции сохранения окна рейса: возвращает черновик записи
 * (путь + содержимое без времени — время ставит база). null — изменений нет
 * либо нет автора у человеческой правки: записи не будет.
 */
export const tripHistoryDraftOf = (
  params: TripHistorySnapshotParams & { atMs?: number },
): TripHistoryDraft | null =>
  buildTripHistoryDraft({
    tripKey: params.tripKey,
    before: params.before,
    after: params.after,
    ...(params.by ? { by: params.by } : {}),
    ...(params.byUid ? { byUid: params.byUid } : {}),
    source: params.source,
    atMs: params.atMs ?? Date.now(),
    ...(params.nameOf ? { nameOf: params.nameOf } : {}),
    ...(params.summary ? { summary: params.summary } : {}),
  });

/**
 * Запись истории ПОСЛЕ успешного сохранения. Дубль-защита: ключ записи — opKey,
 * а существующая запись с тем же ключом не перезаписывается — инициатор
 * сохраняется (правка из другой вкладки только дополняет, а не подменяет автора).
 */
export const appendTripHistory = async (draft: TripHistoryDraft | null): Promise<boolean> => {
  if (!draft || !useFirebase) return false;
  const node = ref(database, draft.path);
  try {
    const existing = await get(node);
    if (existing.exists()) return false; // та же операция уже зафиксирована
    await set(node, { ...draft.entry, at: serverTimestamp() });
    return true;
  } catch (err) {
    // История — не критичный путь: ошибку не роняем в сохранение рейса.
    console.warn('Trip history append failed:', err);
    return false;
  }
};

/**
 * Запись истории по операции «Плана дохода» (`pdService.updateTrip`): строки
 * строятся по изменённым плановым полям записи (даты, круги, направление).
 * Инициатор — пользователь, сохранивший запись; source = 'plan'.
 */
export const appendPlanRecordHistory = async (params: {
  planId: string;
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
  by: string;
  byUid?: string;
  tripKey?: string;
}): Promise<boolean> => {
  if (!useFirebase) return false;
  const lines: TripHistoryLine[] = planRecordHistoryLines(params.before, params.after);
  if (!lines.length) return false;
  const tripKey = params.tripKey || `pd:${params.planId}`;
  const atMs = Date.now();
  const opKey = tripHistoryOpKey(tripKey, lines, atMs);
  return appendTripHistory({
    opKey,
    path: tripHistoryPath(tripKey, opKey),
    lines,
    entry: {
      by: String(params.by || '').trim() || 'Система',
      ...(params.byUid ? { byUid: params.byUid } : {}),
      source: 'plan',
      opKey,
      summary: 'Изменение из «Плана дохода»',
      lines,
    },
  });
};

/**
 * Подписка на историю изменений рейса: живая ветка + старая история плана,
 * единый список, сверху свежие. Возвращает функцию отписки.
 */
export const subscribeTripHistory = (
  tripKey: string,
  callback: (views: TripHistoryView[]) => void,
): (() => void) => {
  if (!useFirebase || !tripKey) {
    callback([]);
    return () => {};
  }
  let live: Array<{ key: string; entry: TripHistoryEntry }> = [];
  let legacy: TimelinePlanHistoryEntry[] = [];
  const emit = (): void => callback(mergeTripHistoryViews(live, legacy));
  const unsubLive = onValue(
    ref(database, `tripTimeline/tripHistory/${tripKey}`),
    (snap) => {
      live = tripHistoryLiveFromStore((snap.val() || {}) as Record<string, unknown>);
      emit();
    },
    (err) => {
      console.warn('Trip history read failed:', err);
      live = [];
      emit();
    },
  );
  const unsubLegacy = onValue(
    ref(database, LEGACY_GUARD_HISTORY_PATH(tripKey)),
    (snap) => {
      const val = snap.val();
      legacy = Array.isArray(val) ? (val as TimelinePlanHistoryEntry[]) : [];
      emit();
    },
    (err) => {
      console.warn('Legacy trip plan history read failed:', err);
      legacy = [];
      emit();
    },
  );
  return () => {
    unsubLive();
    unsubLegacy();
  };
};
