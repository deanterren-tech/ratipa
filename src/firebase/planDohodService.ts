import { ref, set, remove, push, update, onDisconnect, query, orderByChild, equalTo, get } from 'firebase/database';
import { database, useFirebase, dbService, onValue } from '../firebase';
import { appendPlanRecordHistory } from './tripHistoryService';
import { TripPlan } from '../types';

const safeUserKey = (name: string) =>
  String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.#$[\]\/]/g, "_");

const getLocalData = <T>(key: string, defaultValue: T): T => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setLocalData = <T>(key: string, value: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(e);
  }
};

/**
 * Полезная нагрузка записи «Плана дохода», создаваемой формой «Новый рейс»
 * таймлайна (см. `createLinkedTimelineTrip`). Финансовые поля намеренно
 * отсутствуют: фрахт/расходы/прибыль не выдумываются, запись создаётся в
 * состоянии «Требует заполнения» (`needsFill`).
 */
export interface TimelineLinkedPlanPayload {
  carNumber: string;
  logist: string;
  dateStart?: string;
  dateEnd?: string;
  days?: number;
  /** Плечи из маршрута формы: только города (from/to), без ставок и пробега. */
  legs?: Array<{ from: string; to: string }>;
  tripNote?: string;
  stripColor: string;
  isArchived: false;
  needsFill: true;
  createdFrom: 'timeline';
  dispatcher?: string;
  dispatcherName?: string;
  dispatcherId?: string;
  /** Количество кругов рейса — целое от 1 (единое поле записи «Плана дохода»). */
  circles?: number;
  /**
   * Направление рейса — КАНОНИЧЕСКОЕ значение записи: НАЗВАНИЕ направления из
   * единого справочника (`directories/directions`, то же значение у «Плана
   * дохода»). Старые записи с кодом «TR»/«CN» читаются маппингом с фолбэком
   * (lib/directionCatalog), миграции старых записей нет.
   */
  direction?: string;
  /** Предложенные этапы нового рейса — черновик плана (той же операцией). */
  stages?: Array<Record<string, unknown>>;
}


// The new methods specifically for Plan Dohod matching exact schema requested

export const pdService = {
  // --- TRIPS DASHBOARD ---
  subscribeTrips: (callback: (trips: TripPlan[]) => void, isArchivedFilter?: boolean) => {
    if (!useFirebase) return () => {};
    let dbRef: any = ref(database, 'trips_dashboard');
    if (isArchivedFilter !== undefined) {
      dbRef = query(dbRef, orderByChild('isArchived'), equalTo(isArchivedFilter));
    }
    return onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Convert to array
        const list: TripPlan[] = Object.keys(data).map(key => ({
          ...data[key],
          id: key
        }));
        callback(list);
      } else {
        callback([]);
      }
    });
  },

  createTrip: async (trip: TripPlan, user: string, role: string) => {
    if (!useFirebase) return;
    try {
      const dbRef = ref(database, 'trips_dashboard');
      const newRef = push(dbRef);
      const now = new Date().toLocaleString('ru-RU');
      const tripWithMeta = { 
        ...trip, 
        id: newRef.key,
        updatedAt: now,
        updatedBy: user,
      };
      if (!(trip as any).createdAt) (tripWithMeta as any).createdAt = now;
      if (!(trip as any).createdBy) (tripWithMeta as any).createdBy = user;
      const cleanTrip = JSON.parse(JSON.stringify(tripWithMeta, (k, v) => v === undefined ? null : v));
      await set(newRef, cleanTrip);
      dbService.logAction(user, role, 'Создание плана рейса', 'PlanDohod', newRef.key!, `Создан план рейса для ТС ${trip.carNumber}`);
    } catch (e) {
      console.error("Error creating trip in Firebase:", e);
      alert("Ошибка при сохранении в БД: " + (e as Error).message);
    }
  },

  /**
   * Создание записи «Плана дохода» из формы «Новый рейс» таймлайна — одной
   * атомарной парой (запись + предложенные этапы).
   *
   * Ключ записи задаёт вызывающая сторона (таймлайн): повторная отправка с тем
   * же id перезаписывает ту же запись — повторные нажатия и ретраи после ошибки
   * дубликатов не создают. Маркер черновика плана этапов (tripTimeline/planGuard)
   * больше НЕ пишется: механизм разрешений на изменение плана удалён, запись
   * плана редактируется без ограничений, изменения фиксирует история изменений
   * рейса (tripTimeline/tripHistory).
   * Финансовые поля сюда не кладутся: запись создаётся с состоянием
   * «Требует заполнения» (needsFill), числа не выдумываются.
   *
   * Ошибка пробрасывается наверх (без alert) — форма сохраняет введённые
   * данные и показывает понятное сообщение.
   */
  createLinkedTimelineTrip: async (
    id: string,
    /** Ключ рейса таймлайна (`pd:<id>`) — параметр вызова сохранён ради совместимости. */
    planTripKey: string,
    payload: TimelineLinkedPlanPayload,
    user: string,
    role: string,
  ): Promise<string> => {
    if (!useFirebase) throw new Error('нет подключения к базе');
    if (!id) throw new Error('не задан идентификатор записи');
    const now = new Date().toLocaleString('ru-RU');
    const record: Record<string, unknown> = {};
    Object.entries(payload).forEach(([k, v]) => {
      // Этапы в запись плана НЕ кладутся: они живут в отдельной ветке
      // tripTimeline/tripStages/<id> (та же, что у карточки рейса) — ниже.
      if (k === 'stages') return;
      if (v !== undefined) record[k] = v;
    });
    record.id = id;
    record.createdAt = now;
    record.createdBy = user;
    record.updatedAt = now;
    record.updatedBy = user;
    // Предложенные этапы нового рейса — тем же atomic-обновлением, что запись
    // плана: без этапов — ветка не создаётся вовсе.
    const stageUpdates: Record<string, unknown> = {};
    (payload.stages || []).forEach((s) => {
      const sid = String((s as { id?: unknown })?.id || '');
      if (sid) stageUpdates[`tripTimeline/tripStages/${id}/${sid}`] = s;
    });
    try {
      await update(ref(database), {
        [`trips_dashboard/${id}`]: record,
        ...stageUpdates,
      });
    } catch (e) {
      console.error('Error creating timeline-linked trip in Firebase:', e);
      throw new Error(String((e as Error)?.message || e));
    }
    dbService.logAction(
      user,
      role,
      'Создание плана рейса',
      'PlanDohod',
      id,
      `Создан план рейса из таймлайна (требует заполнения) для ТС ${payload.carNumber || id}`,
    );
    return id;
  },

  /**
   * Обновление записи «Плана дохода». Плановые поля (даты, круги, направление)
   * попадают в ЕДИНУЮ историю изменений рейса (`tripTimeline/tripHistory/<pd:id>`)
   * с source='plan' и тем же opKey: одно изменение, пришедшее и отсюда, и из
   * окна таймлайна, не даёт двух записей, а инициатор записи не подменяется.
   * Финансовые поля и статусы историю НЕ пишут.
   */
  updateTrip: async (id: string, tripInfo: any, user: string, role: string) => {
    if (!useFirebase) return;
    try {
      const now = new Date().toLocaleString('ru-RU');
      const cleanInfo = JSON.parse(JSON.stringify({ 
        ...tripInfo, 
        updatedAt: now,
        updatedBy: user,
      }, (k, v) => v === undefined ? null : v));
      // Снимок «до» — только для расчёта изменений плана (даты/круги/направление).
      let before: Record<string, unknown> | null = null;
      try {
        const snap = await get(ref(database, `trips_dashboard/${id}`));
        before = (snap.val() || null) as Record<string, unknown> | null;
      } catch (err) {
        console.warn('Plan record pre-read for trip history failed:', err);
      }
      await update(ref(database, `trips_dashboard/${id}`), cleanInfo);
      if (before) {
        const after: Record<string, unknown> = { ...before, ...cleanInfo };
        await appendPlanRecordHistory({ planId: id, before, after, by: user });
      }
      dbService.logAction(user, role, 'Обновление плана рейса', 'PlanDohod', id, `Обновлен план рейса для ТС ${tripInfo.carNumber || id}`);
    } catch (e) {
      console.error("Error updating trip in Firebase:", e);
      alert("Ошибка при обновлении в БД: " + (e as Error).message);
    }
  },

  /**
   * Перевод записи плана в архив («дата закрытия»). Ставок и снимков нет:
   * упрощено по требованию владельца (никаких пересчётов по направлению).
   */
  archiveTrip: (id: string, currentMonth: string, user: string, role: string) => {
    if (!useFirebase) return;
    update(ref(database, `trips_dashboard/${id}`), { isArchived: true, currentMonth });
    dbService.logAction(user, role, 'Архивирование плана рейса', 'PlanDohod', id, `Архивирован план рейса ${id}`);
  },

  restoreTrip: (id: string, user: string, role: string) => {
    if (!useFirebase) return;
    update(ref(database, `trips_dashboard/${id}`), { isArchived: false });
    dbService.logAction(user, role, 'Восстановление плана рейса', 'PlanDohod', id, `Восстановлен план рейса ${id}`);
  },

  deleteTrip: async (id: string, user: string, role: string) => {
    if (!useFirebase) return;
    remove(ref(database, `trips_dashboard/${id}`));
    dbService.logAction(user, role, 'Удаление плана рейса', 'PlanDohod', id, `Удален план рейса ${id}`);
  },


  // --- PLAN DOHOD SETTINGS ---
  subscribePlanDohodSettings: (callback: (settings: any) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'plan_dohod_settings'), (snapshot) => {
      callback(snapshot.val() || { useDistanceLookup: false, distanceLookupMode: 'cities' });
    });
  },

  updatePlanDohodSettings: (settings: any) => {
    if (!useFirebase) return;
    update(ref(database, 'plan_dohod_settings'), settings);
  },

  // --- KNOWN DISTANCES (реальные расстояния, не дубль) ---
  subscribeKnownDistances: (callback: (distances: any[]) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'knownDistancesList'), (snapshot) => {
      const data = snapshot.val();
      callback(data ? Object.values(data) : []);
    });
  },

  // --- УДАЛЕНО: дублирующие ветки (dispatchers/dispatchers_order/dispatchers_colors/app_directions/saved_vehicles_list) ---
  // Теперь диспетчеры/направления/авто читаются из единой базы (directoryService / dbService).

  // --- DISPATCHERS CAR MAPPING ---
  // Firebase RTDB keys cannot contain '.', '#', '$', '/', '[', ']'. Coupling strings
  // (e.g. "AC 0247-7 / A 1633 E-7") contain '/', which makes set() throw
  // "invalid key". We sanitize keys on write and restore them on read so the UI
  // keeps using the real coupling string while the DB stores a safe key.
  sanitizeMappingKey: (k: string) => (k || '').replace(/\//g, '·').replace(/[.#$\[\]]/g, '_'),
  desanitizeMappingKey: (k: string) => (k || '').replace(/·/g, '/'),

  subscribeDispatchersCarMapping: (callback: (mapping: Record<string, string>) => void) => {
    if (!useFirebase) {
        callback({});
        return () => {};
    }
    const dbRef = ref(database, 'dispatchers_car_mapping');
    return onValue(dbRef, (s) => {
      const raw = s.val() || {};
      const restored: Record<string, string> = {};
      Object.keys(raw).forEach((k) => { restored[pdService.desanitizeMappingKey(k)] = raw[k]; });
      callback(restored);
    });
  },

  updateDispatchersCarMapping: (mapping: Record<string, string>) => {
    if (!useFirebase) return;
    const safe: Record<string, string> = {};
    Object.keys(mapping).forEach((k) => { safe[pdService.sanitizeMappingKey(k)] = mapping[k]; });
    set(ref(database, 'dispatchers_car_mapping'), safe);
  },

    // --- DRIVERS CAR MAPPING ---
  subscribeDriversCarMapping: (callback: (mapping: Record<string, string>) => void) => {
    if (!useFirebase) {
        callback({});
        return () => {};
    }
    const dbRef = ref(database, 'drivers_car_mapping');
    return onValue(dbRef, (s) => {
      const raw = s.val() || {};
      const restored: Record<string, string> = {};
      Object.keys(raw).forEach((k) => { restored[pdService.desanitizeMappingKey(k)] = raw[k]; });
      callback(restored);
    });
  },

  updateDriversCarMapping: (mapping: Record<string, string>) => {
    if (!useFirebase) return;
    const safe: Record<string, string> = {};
    Object.keys(mapping).forEach((k) => { safe[pdService.sanitizeMappingKey(k)] = mapping[k]; });
    set(ref(database, 'drivers_car_mapping'), safe);
  },

  // --- USER NOTEBOOK ---
  subscribeNotebook: (username: string, callback: (notes: Record<string, string>, order: string[]) => void) => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      const notes = getLocalData<Record<string, string>>(`ratipa_nb_notes_${key}`, {});
      const order = getLocalData<string[]>(`ratipa_nb_order_${key}`, []);
      callback(notes, order);

      const handleLocalChange = () => {
        const updatedNotes = getLocalData<Record<string, string>>(`ratipa_nb_notes_${key}`, {});
        const updatedOrder = getLocalData<string[]>(`ratipa_nb_order_${key}`, []);
        callback(updatedNotes, updatedOrder);
      };

      window.addEventListener(`ratipa_nb_changed_${key}`, handleLocalChange);
      return () => {
        window.removeEventListener(`ratipa_nb_changed_${key}`, handleLocalChange);
      };
    }

    let notes: Record<string, string> = {};
    let order: string[] = [];
    const unsubWidgets = onValue(ref(database, `user_widgets/${key}`), (s) => {
      notes = s.val() || {};
      callback(notes, order);
    });
    const unsubOrder = onValue(ref(database, `user_widgets_order/${key}`), (s) => {
      order = s.val() || [];
      callback(notes, order);
    });
    return () => { unsubWidgets(); unsubOrder(); };
  },

  saveNotebookNote: (username: string, carNumber: string, text: string) => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      const notes = getLocalData<Record<string, string>>(`ratipa_nb_notes_${key}`, {});
      notes[carNumber] = text;
      setLocalData(`ratipa_nb_notes_${key}`, notes);
      window.dispatchEvent(new Event(`ratipa_nb_changed_${key}`));
      return;
    }
    set(ref(database, `user_widgets/${key}/${carNumber}`), text);
  },

  removeNotebookCar: (username: string, carNumber: string) => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      const notes = getLocalData<Record<string, string>>(`ratipa_nb_notes_${key}`, {});
      delete notes[carNumber];
      setLocalData(`ratipa_nb_notes_${key}`, notes);

      const statuses = getLocalData<Record<string, "baza" | "reis" | "none">>(`ratipa_nb_statuses_${key}`, {});
      delete statuses[carNumber];
      setLocalData(`ratipa_nb_statuses_${key}`, statuses);

      window.dispatchEvent(new Event(`ratipa_nb_changed_${key}`));
      window.dispatchEvent(new Event(`ratipa_nb_statuses_changed_${key}`));
      return;
    }
    remove(ref(database, `user_widgets/${key}/${carNumber}`));
    remove(ref(database, `user_widgets_status/${key}/${carNumber}`));
  },

  saveNotebookOrder: (username: string, order: string[]) => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      setLocalData(`ratipa_nb_order_${key}`, order);
      window.dispatchEvent(new Event(`ratipa_nb_changed_${key}`));
      return;
    }
    set(ref(database, `user_widgets_order/${key}`), order);
  },

  subscribeNotebookStatuses: (username: string, callback: (statuses: Record<string, "baza" | "reis" | "none">) => void) => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      const statuses = getLocalData<Record<string, "baza" | "reis" | "none">>(`ratipa_nb_statuses_${key}`, {});
      callback(statuses);

      const handleLocalChange = () => {
        const updatedStatuses = getLocalData<Record<string, "baza" | "reis" | "none">>(`ratipa_nb_statuses_${key}`, {});
        callback(updatedStatuses);
      };

      window.addEventListener(`ratipa_nb_statuses_changed_${key}`, handleLocalChange);
      return () => {
        window.removeEventListener(`ratipa_nb_statuses_changed_${key}`, handleLocalChange);
      };
    }

    const unsubStatuses = onValue(ref(database, `user_widgets_status/${key}`), (s) => {
      callback(s.val() || {});
    });
    return unsubStatuses;
  },

  saveNotebookStatus: (username: string, carNumber: string, status: "baza" | "reis" | "none") => {
    const key = safeUserKey(username);
    if (!useFirebase) {
      const statuses = getLocalData<Record<string, "baza" | "reis" | "none">>(`ratipa_nb_statuses_${key}`, {});
      statuses[carNumber] = status;
      setLocalData(`ratipa_nb_statuses_${key}`, statuses);
      window.dispatchEvent(new Event(`ratipa_nb_statuses_changed_${key}`));
      return;
    }
    set(ref(database, `user_widgets_status/${key}/${carNumber}`), status);
  },

  // --- SYSTEM REGISTRY ---
  registerUser: (username: string) => {
    if (!useFirebase) return;
    const key = safeUserKey(username);
    update(ref(database, `system_users_registry/${key}`), {
      username,
      lastLogin: new Date().toISOString()
    });
  },

  subscribePermissions: (username: string, callback: (isAdmin: boolean, isNotebookViewer: boolean) => void) => {
    if (!useFirebase) {
      // Offline mode defaults to full privileges for the developer/user
      callback(true, true);
      return () => {};
    }
    let isAdmin = false;
    let isViewer = false;
    const key = safeUserKey(username);
    const unsubAdmin = onValue(ref(database, `permitted_admin_users/${key}`), (s) => {
      isAdmin = !!s.val();
      callback(isAdmin, isViewer);
    });
    const unsubView = onValue(ref(database, `permitted_notebook_viewers/${key}`), (s) => {
      isViewer = !!s.val();
      callback(isAdmin, isViewer);
    });
    return () => { unsubAdmin(); unsubView(); };
  },

  // --- SYSTEM CHAT ---
  subscribeChat: (callback: (msgs: any[]) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'system_chat'), (snapshot) => {
      const data = snapshot.val();
      if (data) {
        callback(Object.keys(data).map(key => ({ id: key, ...data[key] })));
      } else {
        callback([]);
      }
    });
  },

  subscribeChatReads: (userKey: string, callback: (reads: any) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, `system_chat_reads/${userKey}`), (snapshot) => {
      callback(snapshot.val());
    });
  },

  sendChatMessage: (msgInfo: any) => {
    if (!useFirebase) return;
    const dbRef = ref(database, 'system_chat');
    push(dbRef, msgInfo);
  },

  editChatMessage: (id: string, text: string) => {
    if (!useFirebase) return;
    update(ref(database, `system_chat/${id}`), { text, editedAt: Date.now() });
  },

  updateChatReadState: (userKey: string, username: string, lastReadAt: number) => {
    if (!useFirebase) return;
    set(ref(database, `system_chat_reads/${userKey}`), {
      username,
      lastReadAt,
      updatedAt: Date.now()
    });
  },

  // --- PRESENCE ---
  setPresence: (username: string) => {
    if (!useFirebase) return;
    const key = safeUserKey(username);
    const presenceRef = ref(database, `ratipa_presence/${key}`);
    set(presenceRef, {
      name: username,
      app: 'Plan-dohod',
      at: Date.now()
    });
    onDisconnect(presenceRef).remove();
  }
};