import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, set, push, onValue, remove, update, off } from 'firebase/database';
import { 
  UserProfile, 
  Vehicle, 
  RouteCalculation, 
  SalaryLog, 
  TripPlan, 
  Permit, 
  ChatMessage, 
  AuditLog, 
  AppSettings,
  FerryTemplate,
  RouteTemplate,
  DistancePreset,
  CarRateGroup,
  DirectionPreset,
  Driver,
  CurrencyPreset
} from './types';

// The verified production config for the Ratipa system
export const firebaseConfig = {
  apiKey: "AIzaSyClwtHhyRs4v5z7fhMrcujg8qkPohgw",
  authDomain: "ratipa-panel.firebaseapp.com",
  databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  projectId: "ratipa-panel",
  storageBucket: "ratipa-panel.firebasestorage.app",
  messagingSenderId: "726344734944",
  appId: "1:726344734944:web:10f511be867e03f9e71885"
};

// Resilient initialization
let app;
let auth: any = null;
export let database: any = null;
export let useFirebase = false;

try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  auth = getAuth(app);
  database = getDatabase(app);
  useFirebase = true;
  console.log("Firebase initialized successfully on projectId: ratipa-panel");

  // Attempt silent anonymous auth to satisfy "auth != null" DB access rules
  signInAnonymously(auth)
    .then((cred) => {
      console.log("Firebase Auth signed in anonymously: " + cred.user.uid);
    })
    .catch((err) => {
      console.warn("Firebase Auth anonymous sign-in failed. If Rules allow public access, this is fine:", err);
    });
} catch (error) {
  console.warn("Firebase failed to initialize or client is offline, using localized sync engine:", error);
}

// Resilient memory & localstorage state
const getLocalStorageData = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setLocalStorageData = <T>(key: string, data: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error("Storage error:", err);
  }
};

// Seed initial mock user data, matching known administrators (Sergei, Sergei Terez) with password 'ratipa2026'
const DEFAULT_USERS: UserProfile[] = [
  {
    uid: "sergei-ru-uid-112",
    name: "Сергей",
    email: "sergei.ru@ratipa.com",
    role: "root_admin",
    permissions: {
      dohod: "write",
      salary: "write",
      planDohod: "write",
      planZagruzok: "write",
      baza: "write",
      dozvola: "write",
      documentTracking: "write",
      disposition: "write",
      settings: "write",
      admin: "write"
    },
    createdAt: new Date().toISOString()
  }
];

// Seed other core tables to avoid blank views
const INITIAL_VEHICLES: Vehicle[] = [
  { id: "v1", carNumber: "AA1234BB", driverName: "Иван Петров", dateArrival: "2026-06-08", dateLoading: "2026-06-09", dateRepairStart: "", dateRepairEnd: "", dateDeparture: "2026-06-11", comment: "Груз готов", status: "departure" },
  { id: "v2", carNumber: "EE9876BC", driverName: "Сергей Семенов", dateArrival: "2026-06-09", dateLoading: "", dateRepairStart: "2026-06-10", dateRepairEnd: "", dateDeparture: "", comment: "Замена тормозных колодок", status: "repair" },
  { id: "v3", carNumber: "HH4567KK", driverName: "Дмитрий Козлов", dateArrival: "2026-06-10", dateLoading: "2026-06-11", dateRepairStart: "", dateRepairEnd: "", dateDeparture: "", comment: "Ожидает таможню", status: "base" }
];

const INITIAL_TRIPS: TripPlan[] = [
  { 
    id: "t1", 
    carNumber: "AA1234BB", 
    dispatcher: "Aleksey", 
    logist: "Василий", 
    direction: "BY-PL-DE", 
    dateStart: "2026-06-11", 
    dateEnd: "2026-06-16", 
    days: 5,
    totalKm: 1250, 
    totalFreight: 2200, 
    totalExpenses: 950, 
    extraExpense: 0,
    extraExpenseNote: '',
    profit: 1250, 
    factKm: 1250,
    profitFact: 1250,
    tripNote: "Загрузка 20 тонн", 
    stripColor: "#10B981", 
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false
  },
  { 
    id: "t2", 
    carNumber: "HH4567KK", 
    dispatcher: "Aleksey", 
    logist: "Татьяна", 
    direction: "BY-DE-FR", 
    dateStart: "2026-06-12", 
    dateEnd: "2026-06-18", 
    days: 6,
    totalKm: 1850, 
    totalFreight: 3100, 
    totalExpenses: 1400, 
    extraExpense: 0,
    extraExpenseNote: '',
    profit: 1700, 
    factKm: 1850,
    profitFact: 1700,
    tripNote: "Сборный рейс", 
    stripColor: "#3B82F6", 
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false
  }
];

const INITIAL_PERMITS: Permit[] = [
  { id: "p1", country: "Польша", type: "Транзит квоты", permitNumber: "PL-005691-26", status: "available", dateIssued: "2026-05-20", assignedVehicle: "", comments: "Оригинал в офисе", history: [] },
  { id: "p2", country: "Германия", type: "Двусторонний", permitNumber: "DE-883511-26", status: "used", dateIssued: "2026-06-01", assignedVehicle: "AA1234BB", comments: "Выдан водителю Иван Петров", history: [{ date: "2026-06-01", action: "Польша-Германия транзит", user: "Aleksey" }] }
];

const INITIAL_FERRY_TEMPLATES: FerryTemplate[] = [
  { id: "f1", name: "Liepaja - Travemünde", price: 420 },
  { id: "f2", name: "Klaipeda - Kiel", price: 480 },
  { id: "f3", name: "Ventspils - Nynashamn", price: 310 }
];

const INITIAL_DISTANCES: DistancePreset[] = [
  { id: "d1", from: "Минск", to: "Варшава", distance: 550 },
  { id: "d2", from: "Варшава", to: "Берлин", distance: 570 },
  { id: "d3", from: "Берлин", to: "Париж", distance: 1050 }
];

const INITIAL_CARS_POOL: CarRateGroup[] = [
  { id: "c1", name: "Группа 0.14", rate: 0.14, vehicles: ["АЕ 5541-7"], comment: "" },
  { id: "c2", name: "Группа 0.15", rate: 0.15, vehicles: ["АЕ 1120-7"], comment: "" }
];

const INITIAL_DIRECTIONS: DirectionPreset[] = [
  { id: "dir1", name: 'Турция', coeff: 0 },
  { id: "dir2", name: 'Китай', coeff: 1.5 }
];

const INITIAL_SETTINGS: AppSettings = {
  googleSheetsId: "1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM",
  googleSheetsUrl: "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit?pli=1&gid=0#gid=0",
  googleSheetsEmbedUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT39hGnyX0R0WjE5wV3g_j_iY16A9-q_y9y-H4S3-B87Hdfm4g/pubhtml",
  planZagruzokSheetUrl: "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  dispositionSheetUrl: "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  announcements: [
    { id: "a1", text: "С 15 июня вводится летнее ограничение на проезд тяжеловозов по южным трассам.", date: "2026-06-10", author: "Сергей", important: true },
    { id: "a2", text: "База дозволов обновлена, новые бланки по Германии прибыли в отдел логистики.", date: "2026-06-09", author: "Aleksey", important: false }
  ],
  highlight: {
     title: "Внимание: Летние ограничения",
     text: "Вводится летнее ограничение на проезд тяжеловозов по южным трассам. Пожалуйста, скорректируйте маршруты.",
     imageUrl: "https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop",
     date: "2026-06-11",
     author: ""
  },
  quickLinks: [
    { id: "l1", title: "Таможенные Калькуляторы", url: "https://customs.gov" },
    { id: "l2", title: "Паромные Расписания DFDS", url: "https://www.dfds.com" }
  ],
  idleRate: 30,
  perDiemRate: 7,
  moduleOrder: ['dashboard', 'dohod', 'salary', 'planDohod', 'planZagruzok', 'currentPlanning', 'baza', 'dozvola', 'disposition', 'settings', 'admin'],
  customPhrases: ["Сдал отчетность", "На погрузке", "В пути", "Завершил рейс"]
};

const userKey = (name: string) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.#$[\]\/]/g, '_');

// Database Services mapping with robust localized fallbacks and error handling helpers
export const dbService = {
  // Test/Connectivity state
  isOnline: () => useFirebase,

  // AUDIT LOGS
  getAuditLogs: (callback: (logs: AuditLog[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'auditLogs');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: AuditLog[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          list.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Audit logs stream permission denied, using offline fallback:", err);
        const logs = getLocalStorageData<AuditLog[]>('ratipa_auditLogs', []);
        logs.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        callback(logs);
      });
    } else {
      const logs = getLocalStorageData<AuditLog[]>('ratipa_auditLogs', []);
      logs.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      callback(logs);
      return () => {};
    }
  },

  logAction: (user: string, role: string, actionType: string, module: string, entityId: string, details: string) => {
    const newLog: AuditLog = {
      id: "log_" + Date.now() + "_" + Math.floor(Math.random()*1000),
      date: new Date().toISOString(),
      user,
      role,
      actionType,
      module,
      entityId,
      details
    };
    if (useFirebase) {
      const dbRef = ref(database, 'auditLogs');
      push(dbRef, newLog).catch(err => {
        console.warn("Failed sync audit log to live firebase:", err);
        // Fallback to offline tracker
        const logs = getLocalStorageData<AuditLog[]>('ratipa_auditLogs', []);
        logs.push(newLog);
        setLocalStorageData('ratipa_auditLogs', logs);
      });
    } else {
      const logs = getLocalStorageData<AuditLog[]>('ratipa_auditLogs', []);
      logs.push(newLog);
      setLocalStorageData('ratipa_auditLogs', logs);
    }
  },

  // USERS / PROFILE
  getUsers: (callback: (users: UserProfile[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'users_list');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.keys(data).map(key => ({ uid: key, ...data[key] }));
          callback(list);
        } else {
          // Sync default seed to Firebase
          DEFAULT_USERS.forEach(u => {
            set(ref(database, `users_list/${u.uid}`), u).catch(e => console.warn("Seed users key lock: ", e));
          });
          callback(DEFAULT_USERS);
        }
      }, (err) => {
        console.warn("Firebase users fetch failed (permission lock?), falling back to template users:", err);
        const localUsers = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
        callback(localUsers);
      });
    } else {
      const localUsers = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
      callback(localUsers);
      return () => {};
    }
  },

  saveUser: (user: UserProfile) => {
    if (useFirebase) {
      set(ref(database, `users_list/${user.uid}`), user).catch(err => {
        console.warn("Failed live save user:", err);
        const users = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
        const existingIdx = users.findIndex(u => u.uid === user.uid);
        if (existingIdx >= 0) users[existingIdx] = user;
        else users.push(user);
        setLocalStorageData('ratipa_users', users);
      });
      // Legacy paths sync for ratipa.html compatibility
      if (user.name) {
        const key = userKey(user.name);
        set(ref(database, `ratipa_home_known_users/${key}`), user.name);
        set(ref(database, `ratipa_home_users/${key}`), { name: user.name, password: user.password || '' });
        if (user.role === 'admin' || user.role === 'root_admin') {
          set(ref(database, `ratipa_home_admins/${key}`), true);
        } else {
          remove(ref(database, `ratipa_home_admins/${key}`));
        }
      }
    } else {
      const users = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
      const existingIdx = users.findIndex(u => u.uid === user.uid);
      if (existingIdx >= 0) {
        users[existingIdx] = user;
      } else {
        users.push(user);
      }
      setLocalStorageData('ratipa_users', users);
    }
    dbService.logAction("System", "Admin", "User Update", "Admin", user.uid, `User updated: ${user.name} (${user.role})`);
  },

  deleteUser: (uid: string, name?: string) => {
    if (useFirebase) {
      remove(ref(database, `users_list/${uid}`)).catch(err => {
        console.warn("Failed live remove user:", err);
        const users = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
        const filtered = users.filter(u => u.uid !== uid);
        setLocalStorageData('ratipa_users', filtered);
      });
      if (name) {
        const key = userKey(name);
        remove(ref(database, `ratipa_home_known_users/${key}`));
        remove(ref(database, `ratipa_home_users/${key}`));
        remove(ref(database, `ratipa_home_admins/${key}`));
      }
    } else {
      const users = getLocalStorageData<UserProfile[]>('ratipa_users', DEFAULT_USERS);
      const filtered = users.filter(u => u.uid !== uid);
      setLocalStorageData('ratipa_users', filtered);
    }
    dbService.logAction("System", "Admin", "User Delete", "Admin", uid, `User deleted: ${uid}`);
  },

  // ACTIVE FLEET / VEHICLES (Baza)
  getVehicles: (callback: (vehicles: Vehicle[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'bazacars');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Vehicle[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          // Feed initial structure
          INITIAL_VEHICLES.forEach(v => {
            set(ref(database, `bazacars/${v.id}`), v).catch(e => console.warn(e));
          });
          callback(INITIAL_VEHICLES);
        }
      }, (err) => {
        console.warn("Vehicles get snapshot error, falling back locally:", err);
        const local = getLocalStorageData<Vehicle[]>('ratipa_bazacars', INITIAL_VEHICLES);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<Vehicle[]>('ratipa_bazacars', INITIAL_VEHICLES);
      callback(local);
      return () => {};
    }
  },

  saveVehicle: (vehicle: Vehicle, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `bazacars/${vehicle.id}`), vehicle).catch(err => {
        console.warn("Live write vehicle base failed:", err);
      });
    } else {
      const local = getLocalStorageData<Vehicle[]>('ratipa_bazacars', INITIAL_VEHICLES);
      const idx = local.findIndex(v => v.id === vehicle.id);
      if (idx >= 0) {
        local[idx] = vehicle;
      } else {
        local.push(vehicle);
      }
      setLocalStorageData('ratipa_bazacars', local);
    }
    dbService.logAction(user, role, vehicle.status === 'archive' ? 'Archive Vehicle' : 'Save Vehicle', 'Baza', vehicle.id, `Vehicle ${vehicle.carNumber} (${vehicle.driverName}) updated/archived`);
  },

  // ARCHIVE VEHICLES
  getArchiveVehicles: (callback: (vehicles: Vehicle[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'archivecars');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Vehicle[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Archive vehicles fetch failed:", err);
        const local = getLocalStorageData<Vehicle[]>('ratipa_archivecars', []);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<Vehicle[]>('ratipa_archivecars', []);
      callback(local);
      return () => {};
    }
  },

  archiveVehicle: (vehicle: Vehicle, user: string, role: string) => {
    const archived: Vehicle = { ...vehicle, status: 'archive' };
    
    // First, remove from bazacars
    if (useFirebase) {
      remove(ref(database, `bazacars/${vehicle.id}`));
      set(ref(database, `archivecars/${vehicle.id}`), archived);
    } else {
      const active = getLocalStorageData<Vehicle[]>('ratipa_bazacars', INITIAL_VEHICLES);
      const filtered = active.filter(v => v.id !== vehicle.id);
      setLocalStorageData('ratipa_bazacars', filtered);

      const archivedList = getLocalStorageData<Vehicle[]>('ratipa_archivecars', []);
      archivedList.push(archived);
      setLocalStorageData('ratipa_archivecars', archivedList);
    }
    dbService.logAction(user, role, 'Archive', 'Baza', vehicle.id, `Vehicle ${vehicle.carNumber} sent to archive`);
  },

  restoreVehicle: (vehicle: Vehicle, user: string, role: string) => {
    const restored: Vehicle = { ...vehicle, status: 'base' };
    
    if (useFirebase) {
      remove(ref(database, `archivecars/${vehicle.id}`));
      set(ref(database, `bazacars/${vehicle.id}`), restored);
    } else {
      const archives = getLocalStorageData<Vehicle[]>('ratipa_archivecars', []);
      const filtered = archives.filter(v => v.id !== vehicle.id);
      setLocalStorageData('ratipa_archivecars', filtered);

      const active = getLocalStorageData<Vehicle[]>('ratipa_bazacars', INITIAL_VEHICLES);
      active.push(restored);
      setLocalStorageData('ratipa_bazacars', active);
    }
    dbService.logAction(user, role, 'Restore', 'Archive', vehicle.id, `Vehicle ${vehicle.carNumber} restored from archive`);
  },

  // ROUTE CALCULATIONS (Dohod)
  getRouteCalculations: (callback: (calculations: RouteCalculation[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'calculationsHistory');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: RouteCalculation[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          list.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
          });
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Calculations fetch error:", err);
        const local = getLocalStorageData<RouteCalculation[]>('ratipa_calculations', []);
        local.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
        });
        callback(local);
      });
    } else {
      const local = getLocalStorageData<RouteCalculation[]>('ratipa_calculations', []);
      local.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
      });
      callback(local);
      return () => {};
    }
  },

  saveRouteCalculation: (calc: RouteCalculation, user: string, role: string) => {
    if (useFirebase) {
      const dbRef = ref(database, 'calculationsHistory');
      const newRef = push(dbRef);
      calc.id = newRef.key || calc.id;
      set(newRef, calc);
    } else {
      const local = getLocalStorageData<RouteCalculation[]>('ratipa_calculations', []);
      local.push(calc);
      setLocalStorageData('ratipa_calculations', local);
    }
    dbService.logAction(user, role, 'Calculate Route', 'Dohod', calc.id, `Calculated route from ${calc.from} to ${calc.to} (${calc.totalKm} km)`);
  },

  deleteRouteCalculation: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `calculationsHistory/${id}`));
    } else {
      const local = getLocalStorageData<RouteCalculation[]>('ratipa_calculations', []);
      const filtered = local.filter(c => c.id !== id);
      setLocalStorageData('ratipa_calculations', filtered);
    }
    dbService.logAction(user, role, 'Delete Route Calc', 'Dohod', id, `Calculation history item deleted`);
  },

  updateRouteCalculation: (id: string, updates: Partial<RouteCalculation>, user: string, role: string) => {
    if (useFirebase) {
      update(ref(database, `calculationsHistory/${id}`), updates);
    } else {
      const local = getLocalStorageData<RouteCalculation[]>('ratipa_calculations', []);
      const idx = local.findIndex(c => c.id === id);
      if (idx >= 0) {
        local[idx] = { ...local[idx], ...updates };
        setLocalStorageData('ratipa_calculations', local);
      }
    }
    dbService.logAction(user, role, 'Update Route Calc', 'Dohod', id, `Calculation history item updated`);
  },

  // SALARY LOGS (Salary)
  getSalaries: (callback: (logs: SalaryLog[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'salaryHistory');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: SalaryLog[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          list.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
          });
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Salary stream failed:", err);
        const local = getLocalStorageData<SalaryLog[]>('ratipa_salaries', []);
        local.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
        });
        callback(local);
      });
    } else {
      const local = getLocalStorageData<SalaryLog[]>('ratipa_salaries', []);
      local.sort((a,b) => {
            const aTime = parseInt(a.id.replace(/\D/g, '')) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, '')) || 0;
            return bTime - aTime;
      });
      callback(local);
      return () => {};
    }
  },

  saveSalary: (log: SalaryLog, user: string, role: string) => {
    if (useFirebase) {
      const dbRef = ref(database, 'salaryHistory');
      const newRef = push(dbRef);
      log.id = newRef.key || log.id;
      set(newRef, log);
    } else {
      const local = getLocalStorageData<SalaryLog[]>('ratipa_salaries', []);
      local.push(log);
      setLocalStorageData('ratipa_salaries', local);
    }
    dbService.logAction(user, role, 'Calculate Salary', 'Salary', log.id, `Driver ${log.driver} on ${log.car} salary calculated (${log.totalSalary} EUR)`);
  },

  deleteSalary: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `salaryHistory/${id}`));
    } else {
      const local = getLocalStorageData<SalaryLog[]>('ratipa_salaries', []);
      const filtered = local.filter(s => s.id !== id);
      setLocalStorageData('ratipa_salaries', filtered);
    }
    dbService.logAction(user, role, 'Delete Salary Calc', 'Salary', id, `Salary record deleted`);
  },

  updateSalary: (id: string, updates: Partial<SalaryLog>, user: string, role: string) => {
    if (useFirebase) {
      update(ref(database, `salaryHistory/${id}`), updates);
    } else {
      const local = getLocalStorageData<SalaryLog[]>('ratipa_salaries', []);
      const idx = local.findIndex(s => s.id === id);
      if (idx >= 0) {
        local[idx] = { ...local[idx], ...updates };
        setLocalStorageData('ratipa_salaries', local);
      }
    }
    dbService.logAction(user, role, 'Update Salary Calc', 'Salary', id, `Salary record updated`);
  },

  // TRIP PLANS (Plan Dohod)
  getTrips: (callback: (trips: TripPlan[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'tripsdashboard');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: TripPlan[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          INITIAL_TRIPS.forEach(t => {
            set(ref(database, `tripsdashboard/${t.id}`), t).catch(err => console.warn(err));
          });
          callback(INITIAL_TRIPS);
        }
      }, (err) => {
        console.warn("Trip plans read lock:", err);
        const local = getLocalStorageData<TripPlan[]>('ratipa_trips', INITIAL_TRIPS);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<TripPlan[]>('ratipa_trips', INITIAL_TRIPS);
      callback(local);
      return () => {};
    }
  },

  saveTrip: (trip: TripPlan, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `tripsdashboard/${trip.id}`), trip);
    } else {
      const local = getLocalStorageData<TripPlan[]>('ratipa_trips', INITIAL_TRIPS);
      const idx = local.findIndex(t => t.id === trip.id);
      if (idx >= 0) {
        local[idx] = trip;
      } else {
        local.push(trip);
      }
      setLocalStorageData('ratipa_trips', local);
    }
    dbService.logAction(user, role, 'Save Trip Plan', 'PlanDohod', trip.id, `Trip plan for ${trip.carNumber} (${trip.direction}) saved/updated`);
  },

  deleteTrip: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `tripsdashboard/${id}`));
    } else {
      const local = getLocalStorageData<TripPlan[]>('ratipa_trips', INITIAL_TRIPS);
      const filtered = local.filter(t => t.id !== id);
      setLocalStorageData('ratipa_trips', filtered);
    }
    dbService.logAction(user, role, 'Delete Trip Plan', 'PlanDohod', id, `Trip plan deleted`);
  },

  // PERMITS (Dozvola)
  getPermits: (callback: (permits: Permit[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'dozvolaPermits');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Permit[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          INITIAL_PERMITS.forEach(p => {
            set(ref(database, `dozvolaPermits/${p.id}`), p).catch(err => console.warn(err));
          });
          callback(INITIAL_PERMITS);
        }
      }, (err) => {
        console.warn("Permits failed list:", err);
        const local = getLocalStorageData<Permit[]>('ratipa_permits', INITIAL_PERMITS);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<Permit[]>('ratipa_permits', INITIAL_PERMITS);
      callback(local);
      return () => {};
    }
  },

  savePermit: (permit: Permit, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `dozvolaPermits/${permit.id}`), permit);
    } else {
      const local = getLocalStorageData<Permit[]>('ratipa_permits', INITIAL_PERMITS);
      const idx = local.findIndex(p => p.id === permit.id);
      if (idx >= 0) {
        local[idx] = permit;
      } else {
        local.push(permit);
      }
      setLocalStorageData('ratipa_permits', local);
    }
    dbService.logAction(user, role, 'Save Permit', 'Dozvola', permit.id, `Permit ${permit.permitNumber} for ${permit.country} updated`);
  },

  deletePermit: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `dozvolaPermits/${id}`));
    } else {
      const local = getLocalStorageData<Permit[]>('ratipa_permits', INITIAL_PERMITS);
      const filtered = local.filter(p => p.id !== id);
      setLocalStorageData('ratipa_permits', filtered);
    }
    dbService.logAction(user, role, 'Delete Permit', 'Dozvola', id, `Permit deleted`);
  },

  // CHATS
  getChatMessages: (moduleId: string, callback: (msgs: ChatMessage[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, `panelChat`);
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // The old code stored author instead of username, and time instead of timestamp mostly. We map them.
          const list: ChatMessage[] = Object.keys(data)
            .filter(key => (data[key].moduleId === moduleId) || (!data[key].moduleId && (moduleId === 'ai' || moduleId === 'ai_dispatcher' || moduleId === 'dohod'))) // fallback for old chats? Or strictly check
            .map(key => ({ 
            id: key, 
            moduleId: data[key].moduleId || moduleId,
            text: data[key].text,
            username: data[key].author || data[key].username || 'User',
            timestamp: data[key].timestamp || Date.now(),
            userId: data[key].owner || data[key].userId || 'legacy',
            time: data[key].time
          }));
          list.sort((a,b) => a.timestamp - b.timestamp);
          callback(list.slice(-50)); // max 50
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Chats failed feed stream:", err);
      });
    } else {
      // LocalStorage local simulation
      const updateList = () => {
        const allChats = getLocalStorageData<any[]>('ratipa_chats', []);
        const filtered = allChats.filter((c: any) => c.moduleId === moduleId || (!c.moduleId && (moduleId === 'ai' || moduleId === 'ai_dispatcher' || moduleId === 'dohod')));
        
        filtered.sort((a, b) => a.timestamp - b.timestamp);
        callback(filtered.slice(-50));
      };
      
      updateList();
      window.addEventListener('storage', updateList);
      window.addEventListener('ratipa_chats_changed', updateList);
      
      return () => {
        window.removeEventListener('storage', updateList);
        window.removeEventListener('ratipa_chats_changed', updateList);
      };
    }
  },

  sendChatMessage: (moduleId: string, text: string, username: string, userId: string) => {
    if (useFirebase) {
      const dbRef = ref(database, `panelChat`);
      push(dbRef, {
          moduleId,
          author: username,
          owner: userId,
          text: text,
          time: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}),
          timestamp: Date.now()
      });
    } else {
      const allChats = getLocalStorageData<any[]>('ratipa_chats', []);
      const newMsg = {
        id: 'msg_' + Date.now(),
        moduleId,
        username,
        author: username,
        userId,
        owner: userId,
        text,
        time: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}),
        timestamp: Date.now()
      };
      allChats.push(newMsg);
      setLocalStorageData('ratipa_chats', allChats);
      window.dispatchEvent(new Event('ratipa_chats_changed'));
    }
  },

  updateChatMessage: (id: string, text: string) => {
    if (useFirebase) {
      update(ref(database, `panelChat/${id}`), { text: text, isEdited: true });
    } else {
      const allChats = getLocalStorageData<any[]>('ratipa_chats', []);
      const updatedChats = allChats.map(m => m.id === id ? { ...m, text, isEdited: true } : m);
      setLocalStorageData('ratipa_chats', updatedChats);
      window.dispatchEvent(new Event('ratipa_chats_changed'));
    }
  },

  deleteChatMessage: (id: string) => {
    if (useFirebase) {
      remove(ref(database, `panelChat/${id}`));
    } else {
      const allChats = getLocalStorageData<any[]>('ratipa_chats', []);
      const updatedChats = allChats.filter(m => m.id !== id);
      setLocalStorageData('ratipa_chats', updatedChats);
      window.dispatchEvent(new Event('ratipa_chats_changed'));
    }
  },

  // ROUTE TEMPLATES
  getRouteTemplates: (callback: (templates: RouteTemplate[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'routeTemplates');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: RouteTemplate[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("routeTemplates error:", err);
        callback([]);
      });
    } else {
      callback([]);
      return () => {};
    }
  },

  saveRouteTemplate: (t: RouteTemplate, user: string, role: string) => {
    if (useFirebase) {
      const dbRef = ref(database, 'routeTemplates');
      const newRef = push(dbRef);
      t.id = newRef.key || t.id;
      set(newRef, t);
    }
  },

  deleteRouteTemplate: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `routeTemplates/${id}`));
    }
  },

  // PRESENCE
  trackPresence: (user: UserProfile | null, currentModule: string) => {
    if (!user) return () => {};
    const presenceId = user.uid;
    
    let sessionLoginTime = '';
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        let stored = sessionStorage.getItem('ratipa_session_login_time');
        if (!stored) {
          stored = new Date().toISOString();
          sessionStorage.setItem('ratipa_session_login_time', stored);
        }
        sessionLoginTime = stored;
      }
    } catch (e) {
      sessionLoginTime = new Date().toISOString();
    }

    const item = {
      uid: user.uid,
      name: user.name,
      role: user.role,
      currentModule,
      lastActive: new Date().toISOString(),
      loginTime: sessionLoginTime || new Date().toISOString()
    };

    if (useFirebase) {
      const pRef = ref(database, `ratipapresence/${presenceId}`);
      set(pRef, item).catch(err => {
        console.warn("Silent presence set fail:", err);
      });
      
      // Cleanup of presence on unloading if possible
      const handleUnload = () => {
        remove(pRef);
      };
      window.addEventListener('beforeunload', handleUnload);
      
      return () => {
        remove(pRef);
        window.removeEventListener('beforeunload', handleUnload);
      };
    } else {
      const list = getLocalStorageData<any[]>('ratipa_presence', []);
      const filtered = list.filter(p => p.uid !== user.uid);
      filtered.push(item);
      setLocalStorageData('ratipa_presence', filtered);

      return () => {
        const current = getLocalStorageData<any[]>('ratipa_presence', []);
        const clean = current.filter(p => p.uid !== user.uid);
        setLocalStorageData('ratipa_presence', clean);
      };
    }
  },

  getOnlineUsers: (callback: (users: any[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'ratipapresence');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.keys(data).map(key => ({ presenceId: key, ...data[key] }));
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Online users read fail:", err);
        const current = getLocalStorageData<any[]>('ratipa_presence', []);
        callback(current);
      });
    } else {
      // simulate online user changes
      const updateList = () => {
        const current = getLocalStorageData<any[]>('ratipa_presence', []);
        callback(current);
      };
      updateList();
      const interval = setInterval(updateList, 4000);
      return () => clearInterval(interval);
    }
  },

  // SYSTEM / APP SETTINGS (Google Sheets, etc.)
  getSettings: (callback: (settings: AppSettings) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'appSettings');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Ensure new fields exist
          let updated = false;
          if (!data.highlight) {
            data.highlight = INITIAL_SETTINGS.highlight;
            updated = true;
          }
          
          if (updated) {
            set(dbRef, data).catch(err => console.warn("Failed to update database schema:", err));
          }
          
          callback(data);
        } else {
          set(dbRef, INITIAL_SETTINGS).catch(err => console.warn(err));
          callback(INITIAL_SETTINGS);
        }
      }, (err) => {
        console.warn("Settings error lock:", err);
        const local = getLocalStorageData<AppSettings>('ratipa_settings', INITIAL_SETTINGS);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<AppSettings>('ratipa_settings', INITIAL_SETTINGS);
      callback(local);
      return () => {};
    }
  },

  saveSettings: (settings: AppSettings, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, 'appSettings'), settings);
    } else {
      setLocalStorageData('ratipa_settings', settings);
    }
    dbService.logAction(user, role, 'Update Settings', 'Settings', 'global', 'Global AppSettings / Google Sheets layout configuration altered');
  },

  // FERRY TEMPLATES
  getFerryTemplates: (callback: (templates: FerryTemplate[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'ferryTemplates');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: FerryTemplate[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          INITIAL_FERRY_TEMPLATES.forEach(f => {
            set(ref(database, `ferryTemplates/${f.id}`), f).catch(e => console.warn(e));
          });
          callback(INITIAL_FERRY_TEMPLATES);
        }
      }, (err) => {
        console.warn("Ferry templates read fail:", err);
        const local = getLocalStorageData<FerryTemplate[]>('ratipa_ferry_templates', INITIAL_FERRY_TEMPLATES);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<FerryTemplate[]>('ratipa_ferry_templates', INITIAL_FERRY_TEMPLATES);
      callback(local);
      return () => {};
    }
  },

  saveFerryTemplate: (t: FerryTemplate, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `ferryTemplates/${t.id}`), t);
    } else {
      const local = getLocalStorageData<FerryTemplate[]>('ratipa_ferry_templates', INITIAL_FERRY_TEMPLATES);
      const idx = local.findIndex(x => x.id === t.id);
      if (idx >= 0) local[idx] = t;
      else local.push(t);
      setLocalStorageData('ratipa_ferry_templates', local);
    }
    dbService.logAction(user, role, 'Save Ferry Template', 'Settings', t.id, `Ferry template ${t.name} price ${t.price} EUR saved`);
  },

  deleteFerryTemplate: (id: string, user: string, role: string) => {
    if (!id) {
       console.error("Attempted to delete ferry with empty ID");
       return;
    }
    const path = `ferryTemplates/${id}`;
    console.log(`dbService: Attempting remove path: ${path}`);
    if (useFirebase) {
      remove(ref(database, path))
        .then(() => console.log(`Ferry ${path} removed successfully by remove()`))
        .catch(err => console.error(`Error removing ferry ${path}:`, err));
    } else {
      const local = getLocalStorageData<FerryTemplate[]>('ratipa_ferry_templates', INITIAL_FERRY_TEMPLATES);
      console.log(`dbService: Local storage deletion, total was ${local.length}`);
      const filtered = local.filter(x => x.id !== id);
      setLocalStorageData('ratipa_ferry_templates', filtered);
      console.log(`dbService: Local storage deletion, now ${filtered.length}`);
    }
    dbService.logAction(user, role, 'Delete Ferry Template', 'Settings', id, `Ferry template deleted`);
  },

  // DISTANCES Presets
  getDistances: (callback: (presets: DistancePreset[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'knownDistancesList');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: DistancePreset[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list);
        } else {
          INITIAL_DISTANCES.forEach(d => {
            set(ref(database, `knownDistancesList/${d.id}`), d).catch(e => console.warn(e));
          });
          callback(INITIAL_DISTANCES);
        }
      }, (err) => {
        console.warn("Distances query fail:", err);
        const local = getLocalStorageData<DistancePreset[]>('ratipa_distances', INITIAL_DISTANCES);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<DistancePreset[]>('ratipa_distances', INITIAL_DISTANCES);
      callback(local);
      return () => {};
    }
  },

  saveDistance: (d: DistancePreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `knownDistancesList/${d.id}`), d);
    } else {
      const local = getLocalStorageData<DistancePreset[]>('ratipa_distances', INITIAL_DISTANCES);
      const idx = local.findIndex(x => x.id === d.id);
      if (idx >= 0) local[idx] = d;
      else local.push(d);
      setLocalStorageData('ratipa_distances', local);
    }
    dbService.logAction(user, role, 'Save Distance Preset', 'Settings', d.id, `Distance from ${d.from} to ${d.to} is set to ${d.distance} km`);
  },

  deleteDistance: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `knownDistancesList/${id}`));
    } else {
      const local = getLocalStorageData<DistancePreset[]>('ratipa_distances', INITIAL_DISTANCES);
      const filtered = local.filter(x => x.id !== id);
      setLocalStorageData('ratipa_distances', filtered);
    }
    dbService.logAction(user, role, 'Delete Distance Preset', 'Settings', id, `Distance preset deleted`);
  },

  // CURRENCIES Presets
  getCurrencies: (callback: (presets: CurrencyPreset[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'currenciesList');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: CurrencyPreset[] = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          callback(list.sort((a,b) => a.code.localeCompare(b.code)));
        } else {
          const INITIAL_CURRENCIES: CurrencyPreset[] = [
            { id: '1', code: 'USD' },
            { id: '2', code: 'EUR' },
            { id: '3', code: 'RUB' },
            { id: '4', code: 'BYN' },
            { id: '5', code: 'TRY' },
            { id: '6', code: 'KZT' },
            { id: '7', code: 'CNY' }
          ];
          INITIAL_CURRENCIES.forEach(c => {
            set(ref(database, `currenciesList/${c.id}`), c).catch(e => console.warn(e));
          });
          callback(INITIAL_CURRENCIES);
        }
      }, (err) => {
        console.warn("Currencies query fail:", err);
      });
    } else {
      return () => {};
    }
  },

  saveCurrency: (c: CurrencyPreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `currenciesList/${c.id}`), c);
    }
    dbService.logAction(user, role, 'Save Currency', 'Settings', c.id, `Currency saved: ${c.code}`);
  },

  deleteCurrency: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `currenciesList/${id}`));
    }
    dbService.logAction(user, role, 'Delete Currency', 'Settings', id, `Currency deleted`);
  },

  // CARS POOL (Тарифы по машинам)
  getCarRateGroups: (callback: (groups: CarRateGroup[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'carsPool');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: CarRateGroup[] = Object.keys(data).map(key => {
            const val = data[key];
            const vehicles = Array.isArray(val.vehicles) ? val.vehicles : Object.values(val.vehicles || {});
            return { 
              id: key, 
              name: val.name || '',
              rate: Number(val.rate || 0),
              perDiemRate: val.perDiemRate ? Number(val.perDiemRate) : undefined,
              vehicles,
              comment: val.comment || ''
            };
          });
          callback(list);
        } else {
          INITIAL_CARS_POOL.forEach(c => {
            set(ref(database, `carsPool/${c.id}`), { name: c.name, rate: c.rate, vehicles: c.vehicles, comment: c.comment || '' }).catch(e => console.warn(e));
          });
          callback(INITIAL_CARS_POOL);
        }
      }, (err) => {
        console.warn("Cars pool read fail:", err);
        const local = getLocalStorageData<CarRateGroup[]>('ratipa_cars_pool', INITIAL_CARS_POOL);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<CarRateGroup[]>('ratipa_cars_pool', INITIAL_CARS_POOL);
      callback(local);
      return () => {};
    }
  },

  saveCarRateGroup: (g: CarRateGroup, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `carsPool/${g.id}`), { 
        name: g.name, 
        rate: g.rate, 
        perDiemRate: g.perDiemRate || null,
        vehicles: g.vehicles, 
        comment: g.comment || '' 
      });
    } else {
      const local = getLocalStorageData<CarRateGroup[]>('ratipa_cars_pool', INITIAL_CARS_POOL);
      const idx = local.findIndex(x => x.id === g.id);
      if (idx >= 0) local[idx] = g;
      else local.push(g);
      setLocalStorageData('ratipa_cars_pool', local);
    }
    dbService.logAction(user, role, 'Save Car Rate Group', 'Settings', g.id, `Car rate group ${g.name} saved`);
  },

  deleteCarRateGroup: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `carsPool/${id}`));
    } else {
      const local = getLocalStorageData<CarRateGroup[]>('ratipa_cars_pool', INITIAL_CARS_POOL);
      const filtered = local.filter(x => x.id !== id);
      setLocalStorageData('ratipa_cars_pool', filtered);
    }
    dbService.logAction(user, role, 'Delete Car Rate Group', 'Settings', id, `Car rate group deleted`);
  },

  // DIRECTIONS POOL (Направления и коэффициенты)
  getDirections: (callback: (presets: DirectionPreset[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'directionsPool');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: DirectionPreset[] = Object.keys(data).map(key => ({ id: key, name: String(data[key].name || ''), coeff: Number(data[key].coeff || 0) }));
          callback(list);
        } else {
          INITIAL_DIRECTIONS.forEach(d => {
            set(ref(database, `directionsPool/${d.id}`), { name: d.name, coeff: d.coeff }).catch(e => console.warn(e));
          });
          callback(INITIAL_DIRECTIONS);
        }
      }, (err) => {
        console.warn("Directions pool read fail:", err);
        const local = getLocalStorageData<DirectionPreset[]>('ratipa_directions', INITIAL_DIRECTIONS);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<DirectionPreset[]>('ratipa_directions', INITIAL_DIRECTIONS);
      callback(local);
      return () => {};
    }
  },

  saveDirection: (d: DirectionPreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `directionsPool/${d.id}`), { name: d.name, coeff: d.coeff });
    } else {
      const local = getLocalStorageData<DirectionPreset[]>('ratipa_directions', INITIAL_DIRECTIONS);
      const idx = local.findIndex(x => x.id === d.id);
      if (idx >= 0) local[idx] = d;
      else local.push(d);
      setLocalStorageData('ratipa_directions', local);
    }
    dbService.logAction(user, role, 'Save Direction Preset', 'Settings', d.id, `Direction preset ${d.name} coefficient is set to ${d.coeff}`);
  },

  deleteDirection: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `directionsPool/${id}`));
    } else {
      const local = getLocalStorageData<DirectionPreset[]>('ratipa_directions', INITIAL_DIRECTIONS);
      const filtered = local.filter(x => x.id !== id);
      setLocalStorageData('ratipa_directions', filtered);
    }
    dbService.logAction(user, role, 'Delete Direction Preset', 'Settings', id, `Direction preset deleted`);
  },

  // DRIVERS POOL (Справочник водителей)
  getDrivers: (callback: (drivers: Driver[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, 'driversPool');
      return onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Driver[] = Object.keys(data).map(key => ({
            id: key,
            name: String(data[key].name || ''),
            phone: data[key].phone ? String(data[key].phone) : undefined,
            license: data[key].license ? String(data[key].license) : undefined,
            rateGroupId: data[key].rateGroupId ? String(data[key].rateGroupId) : undefined,
            comment: data[key].comment ? String(data[key].comment) : undefined
          }));
          callback(list);
        } else {
          callback([]);
        }
      }, (err) => {
        console.warn("Drivers pool read fail, falling back locally:", err);
        const local = getLocalStorageData<Driver[]>('ratipa_drivers', []);
        callback(local);
      });
    } else {
      const local = getLocalStorageData<Driver[]>('ratipa_drivers', []);
      callback(local);
      return () => {};
    }
  },

  saveDriver: (d: Driver, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `driversPool/${d.id}`), {
        name: d.name,
        phone: d.phone || '',
        license: d.license || '',
        rateGroupId: d.rateGroupId || '',
        comment: d.comment || ''
      });
    } else {
      const local = getLocalStorageData<Driver[]>('ratipa_drivers', []);
      const idx = local.findIndex(x => x.id === d.id);
      if (idx >= 0) local[idx] = d;
      else local.push(d);
      setLocalStorageData('ratipa_drivers', local);
    }
    dbService.logAction(user, role, 'Save Driver', 'Settings', d.id, `Driver ${d.name} saved`);
  },

  deleteDriver: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `driversPool/${id}`));
    } else {
      const local = getLocalStorageData<Driver[]>('ratipa_drivers', []);
      const filtered = local.filter(x => x.id !== id);
      setLocalStorageData('ratipa_drivers', filtered);
    }
    dbService.logAction(user, role, 'Delete Driver', 'Settings', id, `Driver deleted`);
  }
};
