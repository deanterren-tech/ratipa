import { ref, set, remove, push, update, onDisconnect, query, orderByChild, equalTo } from 'firebase/database';
import { database, useFirebase, dbService, onValue } from '../firebase';
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
      const cleanTrip = JSON.parse(JSON.stringify({ ...trip, id: newRef.key }, (k, v) => v === undefined ? null : v));
      await set(newRef, cleanTrip);
      dbService.logAction(user, role, 'Создание плана рейса', 'PlanDohod', newRef.key!, `Создан план рейса для ТС ${trip.carNumber}`);
    } catch (e) {
      console.error("Error creating trip in Firebase:", e);
      alert("Ошибка при сохранении в БД: " + (e as Error).message);
    }
  },

  updateTrip: async (id: string, tripInfo: any, user: string, role: string) => {
    if (!useFirebase) return;
    try {
      const cleanInfo = JSON.parse(JSON.stringify(tripInfo, (k, v) => v === undefined ? null : v));
      update(ref(database, `trips_dashboard/${id}`), cleanInfo);
      dbService.logAction(user, role, 'Обновление плана рейса', 'PlanDohod', id, `Обновлен план рейса для ТС ${tripInfo.carNumber || id}`);
    } catch (e) {
      console.error("Error updating trip in Firebase:", e);
      alert("Ошибка при обновлении в БД: " + (e as Error).message);
    }
  },

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

  // --- SAVED VEHICLES LIST ---
  subscribeCars: (callback: (cars: string[]) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'saved_vehicles_list'), (snapshot) => {
      const data = snapshot.val();
      callback(data ? (Array.isArray(data) ? data : Object.values(data)) : []);
    });
  },

  addCar: (carNumbers: string[]) => {
    if (!useFirebase) return;
    set(ref(database, 'saved_vehicles_list'), carNumbers);
  },

  removeCar: (carNumbers: string[]) => {
    if (!useFirebase) return;
    set(ref(database, 'saved_vehicles_list'), carNumbers);
  },

  // --- APP DIRECTIONS ---
  subscribeDirections: (callback: (directions: Record<string, number>) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'app_directions'), (snapshot) => {
      callback(snapshot.val() || {});
    });
  },

  addDirection: (directions: Record<string, number>) => {
    if (!useFirebase) return;
    set(ref(database, 'app_directions'), directions);
  },

  removeDirection: (directions: Record<string, number>) => {
    if (!useFirebase) return;
    set(ref(database, 'app_directions'), directions);
  },

  // --- KNOWN DISTANCES ---
  subscribeKnownDistances: (callback: (distances: any[]) => void) => {
    if (!useFirebase) return () => {};
    return onValue(ref(database, 'knownDistancesList'), (snapshot) => {
      const data = snapshot.val();
      callback(data ? Object.values(data) : []);
    });
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

  // --- DISPATCHERS ---
  subscribeDispatchers: (callback: (dispatchers: string[], order: string[]) => void) => {
    if (!useFirebase) return () => {};
    let disp: string[] = [];
    let order: string[] = [];
    const unsubDisp = onValue(ref(database, 'dispatchers'), (s) => {
      disp = s.val() || [];
      callback(disp, order);
    });
    const unsubOrder = onValue(ref(database, 'dispatchers_order'), (s) => {
      order = s.val() || [];
      callback(disp, order);
    });
    return () => { unsubDisp(); unsubOrder(); };
  },

  updateDispatchersOrder: (order: string[]) => {
    if (!useFirebase) return;
    set(ref(database, 'dispatchers_order'), order);
  },

  updateDispatchers: (dispatchers: string[]) => {
    if (!useFirebase) return;
    set(ref(database, 'dispatchers'), dispatchers);
  },

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

  // --- DISPATCHERS COLORS ---
  subscribeDispatchersColors: (callback: (colors: Record<string, string>) => void) => {
    if (!useFirebase) return () => {};
    const dbRef = ref(database, 'dispatchers_colors');
    return onValue(dbRef, (s) => {
      callback(s.val() || {});
    });
  },

  updateDispatcherColor: (dispatcherName: string, color: string) => {
    if (!useFirebase) return;
    set(ref(database, `dispatchers_colors/${dispatcherName}`), color);
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
