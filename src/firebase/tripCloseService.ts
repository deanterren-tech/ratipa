/**
 * Состояние сценария «Закрыть рейс» — в RTDB (`tripClose/<tripId>`).
 *
 * Почему на сервере, а не в localStorage: сценарий длинный, его ведут разные
 * сотрудники и продолжают после перезагрузки/нового входа. Здесь же блокировка
 * от параллельного ведения и защита операций от повторного выполнения.
 *
 * Идемпотентность: каждая значимая операция (архивация плана, запись зарплаты,
 * запись выезда, приём документов) отмечается в `operations/<ключ>` транзакцией —
 * если запись там уже есть, повтор не выполняется и функция честно возвращает false.
 */
import { ref, onValue, update, runTransaction, get } from 'firebase/database';
import { database, useFirebase, dbService } from '../firebase';
import {
  emptyState,
  normalizeState,
  nextStep,
  LOCK_TTL_MS,
  type StepKey,
  type StepState,
  type StepStatus,
  type TripCloseOperation,
  type TripCloseState,
} from '../components/modules/tripClose/core';

const ROOT = 'tripClose';

const keyOf = (tripId: string): string => String(tripId || '').trim();

export interface TripCloseSeed {
  tripId: string;
  carNumber: string;
  driverNames?: string[];
  route?: string;
  dateStart?: string;
  dateEnd?: string;
  planDohodId?: string;
  initiator?: { uid?: string; name?: string };
}

export const tripCloseService = {
  /** Подписка на состояние сценария конкретного рейса. */
  subscribe(tripId: string, callback: (state: TripCloseState) => void): () => void {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return () => {};
    const r = ref(database, `${ROOT}/${id}`);
    return onValue(r, (snap) => {
      callback(normalizeState((snap.val() || null) as Partial<TripCloseState> | null, id));
    });
  },

  async load(tripId: string): Promise<TripCloseState | null> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return null;
    const snap = await get(ref(database, `${ROOT}/${id}`));
    if (!snap.exists()) return null;
    return normalizeState(snap.val() as Partial<TripCloseState>, id);
  },

  /**
   * Возвращает существующий сценарий либо создаёт новый, НЕ перетирая
   * заполненные шаги (повторный запуск продолжает, а не начинает заново).
   */
  async ensure(seed: TripCloseSeed, user: string, role: string): Promise<TripCloseState> {
    const id = keyOf(seed.tripId);
    if (!useFirebase || !id) return emptyState(seed);
    const existing = await this.load(id);
    if (existing) {
      // Номер машины/маршрут/даты держим актуальными, шаги не трогаем.
      await update(ref(database, `${ROOT}/${id}`), {
        carNumber: seed.carNumber || existing.carNumber,
        driverNames: seed.driverNames?.length ? seed.driverNames : existing.driverNames,
        route: seed.route || existing.route,
        dateStart: seed.dateStart || existing.dateStart,
        dateEnd: seed.dateEnd || existing.dateEnd,
        planDohodId: seed.planDohodId || existing.planDohodId,
        updatedAt: new Date().toISOString(),
        updatedBy: user,
      });
      return (await this.load(id)) || existing;
    }
    const fresh = emptyState(seed);
    fresh.createdAt = new Date().toISOString();
    fresh.updatedAt = fresh.createdAt;
    fresh.updatedBy = user;
    fresh.initiator = seed.initiator || { name: user };
    fresh.currentStep = nextStep(fresh) || 'planDohod';
    await update(ref(database, `${ROOT}/${id}`), fresh);
    dbService.logAction(user, role, 'Открыт сценарий закрытия рейса', 'TripClose', id, `Автомобиль ${seed.carNumber}`);
    return fresh;
  },

  async patch(tripId: string, patch: Partial<TripCloseState>, user: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    await update(ref(database, `${ROOT}/${id}`), { ...patch, updatedAt: new Date().toISOString(), updatedBy: user });
  },

  /** Смена состояния шага (выполнен / отложен / не требуется с причиной). */
  async setStep(tripId: string, key: StepKey, status: StepStatus, user: string, note?: string, refs?: Record<string, string>): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    const state: StepState = {
      status,
      at: new Date().toISOString(),
      by: user,
      ...(note ? { note } : {}),
      ...(refs ? { refs } : {}),
    };
    await update(ref(database, `${ROOT}/${id}`), {
      [`steps/${key}`]: state,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    });
  },

  async setCurrentStep(tripId: string, key: StepKey, user: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    // Текущий шаг помечаем «в работе», если он ещё не начат.
    const snap = await get(ref(database, `${ROOT}/${id}/steps/${key}/status`));
    const patch: Record<string, unknown> = { currentStep: key, updatedAt: new Date().toISOString(), updatedBy: user };
    if (!snap.exists() || snap.val() === 'pending') {
      patch[`steps/${key}`] = { status: 'in_progress', at: new Date().toISOString(), by: user };
    }
    await update(ref(database, `${ROOT}/${id}`), patch);
  },

  /**
   * Блокировка сценария: чужую ЖИВУЮ блокировку не перебиваем, свою — продлеваем.
   * Возвращает false, если сценарий ведёт другой сотрудник.
   */
  async claimLock(tripId: string, user: string, uid: string): Promise<boolean> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return true;
    const lockRef = ref(database, `${ROOT}/${id}/lock`);
    const res = await runTransaction(lockRef, (current: TripCloseState['lock'] | null) => {
      const now = Date.now();
      const active = current?.expiresAt ? new Date(current.expiresAt).getTime() > now : false;
      const mine = current?.uid && uid ? current.uid === uid : current?.by === user;
      if (active && !mine) return undefined; // не перебиваем чужую живую блокировку
      return { by: user, uid, at: new Date(now).toISOString(), expiresAt: new Date(now + LOCK_TTL_MS).toISOString() };
    });
    return Boolean(res.committed);
  },

  async releaseLock(tripId: string, uid: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    const lockRef = ref(database, `${ROOT}/${id}/lock`);
    await runTransaction(lockRef, (current: TripCloseState['lock'] | null) => {
      if (current?.uid && uid && current.uid !== uid) return undefined;
      return null;
    });
  },

  /**
   * Отметка выполненной операции. Транзакция гарантирует однократность:
   * повторный вызов (двойной клик, возврат назад, второе окно) вернёт false.
   */
  async recordOperation(tripId: string, key: string, op: TripCloseOperation, user: string): Promise<boolean> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return true;
    const opRef = ref(database, `${ROOT}/${id}/operations/${key}`);
    const res = await runTransaction(opRef, (current: TripCloseOperation | null) => {
      if (current && current.at) return undefined; // уже выполнено
      return { ...op, at: new Date().toISOString(), by: user };
    });
    return Boolean(res.committed);
  },

  async pushError(tripId: string, step: StepKey, message: string, user: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    const errorsRef = ref(database, `${ROOT}/${id}/errors`);
    await runTransaction(errorsRef, (current: Array<{ at: string; step: StepKey; message: string }> | null) => {
      const list = Array.isArray(current) ? current.slice(-19) : [];
      list.push({ at: new Date().toISOString(), step, message: `${message} — ${user}` });
      return list;
    });
  },

  async complete(tripId: string, user: string, role: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    await update(ref(database, `${ROOT}/${id}`), {
      completedAt: new Date().toISOString(),
      completedBy: user,
      currentStep: 'mdp',
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    });
    dbService.logAction(user, role, 'Сценарий закрытия рейса завершён', 'TripClose', id, 'Все обязательные шаги закрыты');
  },

  async reopen(tripId: string, user: string, role: string): Promise<void> {
    const id = keyOf(tripId);
    if (!useFirebase || !id) return;
    await update(ref(database, `${ROOT}/${id}`), {
      completedAt: null,
      completedBy: null,
      updatedAt: new Date().toISOString(),
      updatedBy: user,
    });
    dbService.logAction(user, role, 'Сценарий закрытия переоткрыт', 'TripClose', id, 'Сценарий снова доступен для правок');
  },
};
