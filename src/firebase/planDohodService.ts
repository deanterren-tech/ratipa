import { ref, set, remove, push, update, onDisconnect } from 'firebase/database';
import { database, useFirebase, dbService, onValue } from '../firebase';
import { TripPlan } from '../types';

// The new methods specifically for Plan Dohod matching exact schema requested

export const pdService = {
  // --- TRIPS DASHBOARD ---
  subscribeTrips: (callback: (trips: TripPlan[]) => void) => {
    if (!useFirebase) return () => {};
    const dbRef = ref(database, 'trips_dashboard');
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

  createTrip: (trip: TripPlan, user: string, role: string) => {
    if (!useFirebase) return;
    try {
      const dbRef = ref(database, 'trips_dashboard');
      const newRef = push(dbRef);
      const cleanTrip = JSON.parse(JSON.stringify({ ...trip, id: newRef.key }, (k, v) => v === undefined ? null : v));
      set(newRef, cleanTrip);
      dbService.logAction(user, role, 'Create Trip Plan', 'PlanDohod', newRef.key!, `Created trip plan for ${trip.carNumber}`);
    } catch (e) {
      console.error("Error creating trip in Firebase:", e);
      alert("Ошибка при сохранении в БД: " + (e as Error).message);
    }
  },

  updateTrip: (id: string, tripInfo: any, user: string, role: string) => {
    if (!useFirebase) return;
    try {
      const cleanInfo = JSON.parse(JSON.stringify(tripInfo, (k, v) => v === undefined ? null : v));
      update(ref(database, `trips_dashboard/${id}`), cleanInfo);
      dbService.logAction(user, role, 'Update Trip Plan', 'PlanDohod', id, `Updated trip plan for ${tripInfo.carNumber || id}`);
    } catch (e) {
      console.error("Error updating trip in Firebase:", e);
      alert("Ошибка при обновлении в БД: " + (e as Error).message);
    }
  },

  archiveTrip: (id: string, currentMonth: string, user: string, role: string) => {
    if (!useFirebase) return;
    update(ref(database, `trips_dashboard/${id}`), { isArchived: true, currentMonth });
    dbService.logAction(user, role, 'Archive Trip Plan', 'PlanDohod', id, `Archived trip plan ${id}`);
  },

  restoreTrip: (id: string, user: string, role: string) => {
    if (!useFirebase) return;
    update(ref(database, `trips_dashboard/${id}`), { isArchived: false });
    dbService.logAction(user, role, 'Restore Trip Plan', 'PlanDohod', id, `Restored trip plan ${id}`);
  },

  deleteTrip: (id: string, user: string, role: string) => {
    if (!useFirebase) return;
    remove(ref(database, `trips_dashboard/${id}`));
    dbService.logAction(user, role, 'Delete Trip Plan', 'PlanDohod', id, `Deleted trip plan ${id}`);
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
  subscribeDispatchersCarMapping: (callback: (mapping: Record<string, string>) => void) => {
    if (!useFirebase) {
        callback({});
        return () => {};
    }
    const dbRef = ref(database, 'dispatchers_car_mapping');
    return onValue(dbRef, (s) => {
      callback(s.val() || {});
    });
  },

  updateDispatchersCarMapping: (mapping: Record<string, string>) => {
    if (!useFirebase) return;
    set(ref(database, 'dispatchers_car_mapping'), mapping);
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
    if (!useFirebase) return () => {};
    let notes: Record<string, string> = {};
    let order: string[] = [];
    const unsubWidgets = onValue(ref(database, `user_widgets/${username}`), (s) => {
      notes = s.val() || {};
      callback(notes, order);
    });
    const unsubOrder = onValue(ref(database, `user_widgets_order/${username}`), (s) => {
      order = s.val() || [];
      callback(notes, order);
    });
    return () => { unsubWidgets(); unsubOrder(); };
  },

  saveNotebookNote: (username: string, carNumber: string, text: string) => {
    if (!useFirebase) return;
    set(ref(database, `user_widgets/${username}/${carNumber}`), text);
  },

  removeNotebookCar: (username: string, carNumber: string) => {
    if (!useFirebase) return;
    remove(ref(database, `user_widgets/${username}/${carNumber}`));
  },

  saveNotebookOrder: (username: string, order: string[]) => {
    if (!useFirebase) return;
    set(ref(database, `user_widgets_order/${username}`), order);
  },

  // --- SYSTEM REGISTRY ---
  registerUser: (username: string) => {
    if (!useFirebase) return;
    const lower = username.toLowerCase();
    update(ref(database, `system_users_registry/${lower}`), {
      username,
      lastLogin: new Date().toISOString()
    });
  },

  subscribePermissions: (username: string, callback: (isAdmin: boolean, isNotebookViewer: boolean) => void) => {
    if (!useFirebase) return () => {};
    let isAdmin = false;
    let isViewer = false;
    const unsubAdmin = onValue(ref(database, `permitted_admin_users/${username}`), (s) => {
      isAdmin = !!s.val();
      callback(isAdmin, isViewer);
    });
    const unsubView = onValue(ref(database, `permitted_notebook_viewers/${username}`), (s) => {
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
    const lower = username.toLowerCase();
    const presenceRef = ref(database, `ratipa_presence/${lower}`);
    set(presenceRef, {
      name: username,
      app: 'Plan-dohod',
      at: Date.now()
    });
    onDisconnect(presenceRef).remove();
  }
};
