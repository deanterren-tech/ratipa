import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue as firebaseOnValue,
  remove,
  update,
  off,
  query,
  orderByChild,
  limitToLast,
  get as firebaseGet,
} from "firebase/database";
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
  CurrencyPreset,
} from "./types";

const storedCustomConfig = localStorage.getItem(
  "ratipa_custom_firebase_config",
);
let customConfig = null;
if (storedCustomConfig) {
  try {
    customConfig = JSON.parse(storedCustomConfig);
  } catch (e) {}
}

const defaultFirebaseConfig = {
  apiKey: "AIzaSyClw_tHhyR_s4v5z7_fhMrcujg8qkPohgw",
  authDomain: "ratipa-panel.firebaseapp.com",
  databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
  projectId: "ratipa-panel",
  storageBucket: "ratipa-panel.firebasestorage.app",
  messagingSenderId: "726344734944",
  appId: "1:726344734944:web:10f511be867e03f9e71885",
};

export const firebaseConfig =
  customConfig && customConfig.apiKey ? customConfig : defaultFirebaseConfig;

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
      console.warn(
        "Firebase Auth anonymous sign-in failed. If Rules allow public access, this is fine:",
        err,
      );
    });
} catch (error) {
  console.warn(
    "Firebase failed to initialize or client is offline, using localized sync engine:",
    error,
  );
}

let authReadyPromise: Promise<any> | null = null;

export const ensureAuth = (): Promise<any> => {
  if (!useFirebase || !auth) {
    return Promise.resolve(null);
  }
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }
  if (authReadyPromise) {
    return authReadyPromise;
  }

  authReadyPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(user);
        unsub();
      }
    });
    // Fallback of 3.5 seconds to avoid blocking local experience if network is offline
    setTimeout(() => {
      resolve(auth.currentUser || null);
    }, 3500);
  });

  return authReadyPromise;
};

// Custom onValue wrapper to ensure that the initial reading is deferred until Auth is active, preventing immediate "Permission denied" errors.
export const onValue = (
  dbRef: any,
  callback: (snapshot: any) => void,
  errorCallback?: (error: any) => void,
) => {
  let activeUnsubscribe: (() => void) | null = null;
  let isCancelled = false;

  ensureAuth().then((user) => {
    if (isCancelled) return;
    if (user && useFirebase) {
      activeUnsubscribe = firebaseOnValue(dbRef, callback, errorCallback);
    } else {
      if (errorCallback) {
        errorCallback(new Error("Firebase auth not ready"));
      }
    }
  });

  return () => {
    isCancelled = true;
    if (activeUnsubscribe) {
      activeUnsubscribe();
    }
  };
};

// Custom onceValue wrapper to fetch data once after Auth is active.
export const onceValue = (
  dbRef: any,
  callback: (snapshot: any) => void,
  errorCallback?: (error: any) => void,
) => {
  let isCancelled = false;

  ensureAuth().then((user) => {
    if (isCancelled) return;
    if (user && useFirebase) {
      firebaseGet(dbRef)
        .then((snapshot) => {
          if (!isCancelled) {
            callback(snapshot);
          }
        })
        .catch((err) => {
          if (!isCancelled && errorCallback) {
            errorCallback(err);
          }
        });
    } else {
      if (errorCallback) {
        errorCallback(new Error("Firebase auth not ready or local mode active"));
      }
    }
  });

  return () => {
    isCancelled = true;
  };
};

// Global in-memory cache for reference catalogs to prevent redundant queries upon route transitions
const catalogCache: {
  drivers: Driver[] | null;
  users: UserProfile[] | null;
  settings: AppSettings | null;
} = {
  drivers: null,
  users: null,
  settings: null,
};

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

const sanitizeFirebaseObject = (obj: any): any => {
  if (obj === undefined) {
    return null;
  }
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeFirebaseObject);
  }
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      clean[key] = sanitizeFirebaseObject(obj[key]);
    }
  }
  return clean;
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
      documents: "write",
      settings: "write",
      admin: "write",
      dashboard: "write",
      vehicleDriverData: "write",
      analysis: "write",
      currentPlanning: "write",
    },
    createdAt: new Date().toISOString(),
  },
];

// Seed other core tables to avoid blank views
const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: "v1",
    carNumber: "AA1234BB",
    driverName: "Иван Петров",
    dateArrival: "2026-06-08",
    dateLoading: "2026-06-09",
    dateRepairStart: "",
    dateRepairEnd: "",
    dateDeparture: "2026-06-11",
    comment: "Груз готов",
    status: "departure",
  },
  {
    id: "v2",
    carNumber: "EE9876BC",
    driverName: "Сергей Семенов",
    dateArrival: "2026-06-09",
    dateLoading: "",
    dateRepairStart: "2026-06-10",
    dateRepairEnd: "",
    dateDeparture: "",
    comment: "Замена тормозных колодок",
    status: "repair",
  },
  {
    id: "v3",
    carNumber: "HH4567KK",
    driverName: "Дмитрий Козлов",
    dateArrival: "2026-06-10",
    dateLoading: "2026-06-11",
    dateRepairStart: "",
    dateRepairEnd: "",
    dateDeparture: "",
    comment: "Ожидает таможню",
    status: "base",
  },
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
    extraExpenseNote: "",
    profit: 1250,
    factKm: 1250,
    profitFact: 1250,
    tripNote: "Загрузка 20 тонн",
    stripColor: "#10B981",
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false,
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
    extraExpenseNote: "",
    profit: 1700,
    factKm: 1850,
    profitFact: 1700,
    tripNote: "Сборный рейс",
    stripColor: "#3B82F6",
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false,
  },
];

const INITIAL_PERMITS: Permit[] = [
  {
    id: "p1",
    country: "Польша",
    type: "Транзит квоты",
    permitNumber: "PL-005691-26",
    status: "available",
    dateIssued: "2026-05-20",
    assignedVehicle: "",
    comments: "Оригинал в офисе",
    history: [],
  },
  {
    id: "p2",
    country: "Германия",
    type: "Двусторонний",
    permitNumber: "DE-883511-26",
    status: "used",
    dateIssued: "2026-06-01",
    assignedVehicle: "AA1234BB",
    comments: "Выдан водителю Иван Петров",
    history: [
      {
        date: "2026-06-01",
        action: "Польша-Германия транзит",
        user: "Aleksey",
      },
    ],
  },
];

const INITIAL_FERRY_TEMPLATES: FerryTemplate[] = [
  { id: "f1", name: "Liepaja - Travemünde", price: 420 },
  { id: "f2", name: "Klaipeda - Kiel", price: 480 },
  { id: "f3", name: "Ventspils - Nynashamn", price: 310 },
];

const INITIAL_DISTANCES: DistancePreset[] = [
  { id: "d1", from: "Минск", to: "Варшава", distance: 550 },
  { id: "d2", from: "Варшава", to: "Берлин", distance: 570 },
  { id: "d3", from: "Берлин", to: "Париж", distance: 1050 },
];

const INITIAL_CARS_POOL: CarRateGroup[] = [
  {
    id: "c1",
    name: "Группа 0.14",
    rate: 0.14,
    vehicles: ["АЕ 5541-7"],
    comment: "",
  },
  {
    id: "c2",
    name: "Группа 0.15",
    rate: 0.15,
    vehicles: ["АЕ 1120-7"],
    comment: "",
  },
];

const INITIAL_DIRECTIONS: DirectionPreset[] = [
  { id: "dir1", name: "Турция", coeff: 0 },
  { id: "dir2", name: "Китай", coeff: 1.5 },
];

const INITIAL_SETTINGS: AppSettings = {
  googleSheetsId: "1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM",
  googleSheetsUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit?pli=1&gid=0#gid=0",
  googleSheetsEmbedUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT39hGnyX0R0WjE5wV3g_j_iY16A9-q_y9y-H4S3-B87Hdfm4g/pubhtml",
  planZagruzokSheetUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  dispositionSheetUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  googleDriveUrl:
    "https://drive.google.com/drive/folders/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM",
  announcements: [
    {
      id: "a1",
      text: "С 15 июня вводится летнее ограничение на проезд тяжеловозов по южным трассам.",
      date: "2026-06-10",
      author: "Сергей",
      important: true,
    },
    {
      id: "a2",
      text: "База дозволов обновлена, новые бланки по Германии прибыли в отдел логистики.",
      date: "2026-06-09",
      author: "Aleksey",
      important: false,
    },
  ],
  highlight: {
    id: "h1",
    title: "Внимание: Летние ограничения",
    text: "Вводится летнее ограничение на проезд тяжеловозов по южным трассам. Пожалуйста, скорректируйте маршруты.",
    imageUrl:
      "https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop",
    date: "2026-06-11",
    author: "",
  },
  highlights: [
    {
      id: "h1",
      title: "Внимание: Летние ограничения",
      text: "Вводится летнее ограничение на проезд тяжеловозов по южным трассам. Пожалуйста, скорректируйте маршруты.",
      imageUrl:
        "https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop",
      date: "2026-06-11",
      author: "",
    },
  ],
  quickLinks: [
    { id: "l1", title: "Таможенные Калькуляторы", url: "https://customs.gov" },
    {
      id: "l2",
      title: "Паромные Расписания DFDS",
      url: "https://www.dfds.com",
    },
  ],
  externalTabs: [],
  idleRate: 30,
  perDiemRate: 7,
  moduleOrder: [
    "dashboard",
    "dohod",
    "salary",
    "planDohod",
    "planZagruzok",
    "currentPlanning",
    "baza",
    "dozvola",
    "disposition",
    "settings",
    "admin",
  ],
  customPhrases: ["Сдал отчетность", "На погрузке", "В пути", "Завершил рейс"],
  mapboxUsage: {
    count: 0,
    limit: 100000,
    allowExceed: false,
    loadsCount: 0,
    loadsLimit: 50000,
    allowExceedLoads: false,
    currentMonth: "2026-07",
    lastReset: "2026-07-05T00:00:00.000Z"
  },
};

const userKey = (name: string) =>
  String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.#$[\]\/]/g, "_");

// Shared memory caching and subscription pooling system for high-performance catalog loading
function createSharedSubscription<T>(
  fetchLive: (onData: (data: T) => void, onError: (err: any) => void) => () => void,
  fallbackLocal: (onData: (data: T) => void) => void
) {
  let cachedData: T | null = null;
  const callbacks = new Set<(data: T) => void>();
  let unsubscribeLive: (() => void) | null = null;
  let teardownTimeout: any = null;

  return (callback: (data: T) => void) => {
    if (cachedData !== null) {
      callback(cachedData);
    }

    callbacks.add(callback);

    if (!useFirebase) {
      fallbackLocal((localData) => {
        cachedData = localData;
        callbacks.forEach((cb) => cb(localData));
      });
      return () => {
        callbacks.delete(callback);
      };
    }

    if (callbacks.size === 1) {
      if (teardownTimeout) {
        clearTimeout(teardownTimeout);
        teardownTimeout = null;
      }

      if (!unsubscribeLive) {
        unsubscribeLive = fetchLive(
          (newData) => {
            cachedData = newData;
            callbacks.forEach((cb) => cb(newData));
          },
          (err) => {
            console.warn(`Shared sub error:`, err);
            fallbackLocal((localData) => {
              cachedData = localData;
              callbacks.forEach((cb) => cb(localData));
            });
          }
        );
      }
    }

    return () => {
      callbacks.delete(callback);

      if (callbacks.size === 0) {
        if (teardownTimeout) clearTimeout(teardownTimeout);
        teardownTimeout = setTimeout(() => {
          if (callbacks.size === 0 && unsubscribeLive) {
            unsubscribeLive();
            unsubscribeLive = null;
          }
        }, 5000);
      }
    };
  };
}

const sharedGetDrivers = createSharedSubscription<Driver[]>(
  (onData, onError) => {
    const dbRef = ref(database, "driversPool");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Driver[] = Object.keys(data).map((key) => ({
            id: key,
            name: String(data[key].name || ""),
            lastNameRu: data[key].lastNameRu ? String(data[key].lastNameRu) : undefined,
            firstNameRu: data[key].firstNameRu ? String(data[key].firstNameRu) : undefined,
            middleNameRu: data[key].middleNameRu ? String(data[key].middleNameRu) : undefined,
            lastNameLat: data[key].lastNameLat ? String(data[key].lastNameLat) : undefined,
            firstNameLat: data[key].firstNameLat ? String(data[key].firstNameLat) : undefined,
            middleNameLat: data[key].middleNameLat ? String(data[key].middleNameLat) : undefined,
            shortNameRu: data[key].shortNameRu ? String(data[key].shortNameRu) : undefined,
            shortNameLat: data[key].shortNameLat ? String(data[key].shortNameLat) : undefined,
            phone: data[key].phone ? String(data[key].phone) : undefined,
            license: data[key].license ? String(data[key].license) : undefined,
            rateGroupId: data[key].rateGroupId ? String(data[key].rateGroupId) : undefined,
            comment: data[key].comment ? String(data[key].comment) : undefined,
          }));
          onData(list);
        } else {
          onData([]);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<Driver[]>("ratipa_drivers", []));
  }
);

const sharedGetVehicleFleet = createSharedSubscription<any[]>(
  (onData, onError) => {
    const q = query(ref(database, "vehicleFleet"), limitToLast(150));
    return onValue(q, (snapshot) => {
      const data = snapshot.val() || {};
      const list = Object.keys(data).map((key) => {
        const val = data[key];
        const carNum = (val.carNumber || val.vehicleNumbers || "").trim().toUpperCase();
        const brand = val.brandModel || val.brands || "";
        const disp = val.dispatcherName || val.dispatcher || "";
        const phoneNum = val.driverPhone || val.phone || "";
        return {
          id: key,
          status: val.status || "base",
          ...val,
          carNumber: carNum,
          vehicleNumbers: carNum,
          brandModel: brand,
          brands: brand,
          dispatcherName: disp,
          dispatcher: disp,
          driverPhone: phoneNum,
          phone: phoneNum,
        };
      });
      onData(list);

    }, onError);
  },
  (onData) => {
    onData(getLocalStorageData<any[]>("ratipa_vehicle_fleet", []));
  }
);

const sharedGetVehicles = createSharedSubscription<Vehicle[]>(
  (onData, onError) => {
    return sharedGetVehicleFleet((list) => {
      onData(list);
    });
  },
  (onData) => {
    onData(getLocalStorageData<Vehicle[]>("ratipa_vehicle_fleet", INITIAL_VEHICLES));
  }
);

const sharedGetCarRateGroups = createSharedSubscription<CarRateGroup[]>(
  (onData, onError) => {
    const dbRef = ref(database, "carsPool");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: CarRateGroup[] = Object.keys(data).map((key) => {
            const val = data[key];
            const vehicles = Array.isArray(val.vehicles)
              ? val.vehicles
              : Object.values(val.vehicles || {});
            return {
              id: key,
              name: val.name || "",
              rate: Number(val.rate || 0),
              perDiemRate: val.perDiemRate ? Number(val.perDiemRate) : undefined,
              vehicles,
              comment: val.comment || "",
            };
          });
          onData(list);
        } else {
          INITIAL_CARS_POOL.forEach((c) => {
            set(ref(database, `carsPool/${c.id}`), {
              name: c.name,
              rate: c.rate,
              vehicles: c.vehicles,
              comment: c.comment || "",
            }).catch((e) => console.warn(e));
          });
          onData(INITIAL_CARS_POOL);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<CarRateGroup[]>("ratipa_cars_pool", INITIAL_CARS_POOL));
  }
);

const sharedGetDirections = createSharedSubscription<DirectionPreset[]>(
  (onData, onError) => {
    const dbRef = ref(database, "directionsPool");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: DirectionPreset[] = Object.keys(data).map((key) => ({
            id: key,
            name: String(data[key].name || ""),
            coeff: Number(data[key].coeff || 0),
          }));
          onData(list);
        } else {
          INITIAL_DIRECTIONS.forEach((d) => {
            set(ref(database, `directionsPool/${d.id}`), {
              name: d.name,
              coeff: d.coeff,
            }).catch((e) => console.warn(e));
          });
          onData(INITIAL_DIRECTIONS);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<DirectionPreset[]>("ratipa_directions", INITIAL_DIRECTIONS));
  }
);

const sharedGetFerryTemplates = createSharedSubscription<FerryTemplate[]>(
  (onData, onError) => {
    const dbRef = ref(database, "ferryTemplates");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: FerryTemplate[] = Object.keys(data).map((key) => ({
            id: key,
            ...data[key],
          }));
          onData(list);
        } else {
          INITIAL_FERRY_TEMPLATES.forEach((f) => {
            set(ref(database, `ferryTemplates/${f.id}`), f).catch((e) =>
              console.warn(e)
            );
          });
          onData(INITIAL_FERRY_TEMPLATES);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<FerryTemplate[]>("ratipa_ferry_templates", INITIAL_FERRY_TEMPLATES));
  }
);

const sharedGetDistances = createSharedSubscription<DistancePreset[]>(
  (onData, onError) => {
    const dbRef = ref(database, "knownDistancesList");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: DistancePreset[] = Object.keys(data).map((key) => ({
            id: key,
            ...data[key],
          }));
          onData(list);
        } else {
          INITIAL_DISTANCES.forEach((d) => {
            set(ref(database, `knownDistancesList/${d.id}`), d).catch((e) =>
              console.warn(e)
            );
          });
          onData(INITIAL_DISTANCES);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<DistancePreset[]>("ratipa_distances", INITIAL_DISTANCES));
  }
);

const sharedGetCurrencies = createSharedSubscription<CurrencyPreset[]>(
  (onData, onError) => {
    const dbRef = ref(database, "currenciesList");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: CurrencyPreset[] = Object.keys(data).map((key) => ({
            id: key,
            ...data[key],
          }));
          onData(list.sort((a, b) => a.code.localeCompare(b.code)));
        } else {
          const INITIAL_CURRENCIES: CurrencyPreset[] = [
            { id: "1", code: "USD" },
            { id: "2", code: "EUR" },
            { id: "3", code: "RUB" },
            { id: "4", code: "BYN" },
            { id: "5", code: "TRY" },
            { id: "6", code: "KZT" },
            { id: "7", code: "CNY" },
          ];
          INITIAL_CURRENCIES.forEach((c) => {
            set(ref(database, `currenciesList/${c.id}`), c).catch((e) =>
              console.warn(e)
            );
          });
          onData(INITIAL_CURRENCIES);
        }
      },
      onError
    );
  },
  (onData) => {
    onData([]);
  }
);

const sharedGetSettings = createSharedSubscription<AppSettings>(
  (onData, onError) => {
    const dbRef = ref(database, "appSettings");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          let updated = false;
          if (!data.highlight) {
            data.highlight = INITIAL_SETTINGS.highlight;
            updated = true;
          }
          if (!data.highlights || !Array.isArray(data.highlights) || data.highlights.length === 0) {
            data.highlights = data.highlight ? [{ ...data.highlight, id: data.highlight.id || "h1" }] : INITIAL_SETTINGS.highlights;
            updated = true;
          }
          const actualMonth = new Date().toISOString().substring(0, 7);
          if (!data.mapboxUsage) {
            data.mapboxUsage = {
              count: 0,
              limit: 100000,
              allowExceed: false,
              loadsCount: 0,
              loadsLimit: 50000,
              allowExceedLoads: false,
              currentMonth: actualMonth,
              lastReset: new Date().toISOString()
            };
            updated = true;
          } else {
            let innerUpdated = false;
            if (data.mapboxUsage.loadsCount === undefined) {
              data.mapboxUsage.loadsCount = 0;
              innerUpdated = true;
            }
            if (data.mapboxUsage.loadsLimit === undefined) {
              data.mapboxUsage.loadsLimit = 50000;
              innerUpdated = true;
            }
            if (data.mapboxUsage.allowExceedLoads === undefined) {
              data.mapboxUsage.allowExceedLoads = false;
              innerUpdated = true;
            }
            if (data.mapboxUsage.currentMonth !== actualMonth) {
              data.mapboxUsage.count = 0;
              data.mapboxUsage.loadsCount = 0;
              data.mapboxUsage.currentMonth = actualMonth;
              data.mapboxUsage.lastReset = new Date().toISOString();
              innerUpdated = true;
            }
            if (innerUpdated) updated = true;
          }
          if (updated) {
            set(dbRef, data).catch((err) => console.warn(err));
          }
          onData(data);
        } else {
          set(dbRef, INITIAL_SETTINGS).catch((err) => console.warn(err));
          onData(INITIAL_SETTINGS);
        }
      },
      onError
    );
  },
  (onData) => {
    onData(getLocalStorageData<AppSettings>("ratipa_settings", INITIAL_SETTINGS));
  }
);

const sharedGetVehicleStatuses = createSharedSubscription<Record<string, 'base' | 'trip'>>(
  (onData, onError) => {
    return onValue(ref(database, "vehicle_statuses"), (snapshot) => {
      onData(snapshot.val() || {});
    }, onError);
  },
  (onData) => {
    onData(getLocalStorageData<Record<string, 'base' | 'trip'>>("ratipa_vehicle_statuses", {}));
  }
);

const sharedGetVehicleDriverData = createSharedSubscription<any[]>(
  (onData, onError) => {
    return sharedGetVehicleFleet((list) => {
      onData(list);
    });
  },
  (onData) => {
    onData(getLocalStorageData<any[]>("ratipa_vehicle_fleet", []));
  }
);

// ---- Directories service: unified reference data (brands, dispatchers, rate groups,
// status types, directions). Uses shared subscriptions for high-performance caching so
// weak devices don't re-fetch on every module mount. ----
function createDirSub<T>(path: string) {
  return createSharedSubscription<T>(
    (onData, onError) => {
      if (!useFirebase) {
        onData([] as any);
        return () => {};
      }
      return onValue(ref(database, path), (snap) => {
        const val = snap.val();
        if (!val) { onData([] as any); return; }
        const list = Object.keys(val).map((k) => ({ ...val[k], id: val[k].id || k }));
        onData(list as any);
      }, () => onError && onError(null));
    },
    (onData) => onData([] as any)
  );
}

const sharedDirVehicleBrands = createDirSub<any[]>("directories/vehicleBrands");
const sharedDirTrailerBrands = createDirSub<any[]>("directories/trailerBrands");
const sharedDirDispatchers = createDirSub<any[]>("directories/dispatchers");
const sharedDirRateGroups = createDirSub<any[]>("directories/rateGroups");
const sharedDirStatusTypes = createDirSub<any[]>("directories/statusTypes");
const sharedDirDirections = createDirSub<any[]>("directories/directions");

export const directoryService = {
  isOnline: () => useFirebase,

  getVehicleBrands: (cb: (d: any[]) => void) => sharedDirVehicleBrands(cb),
  getTrailerBrands: (cb: (d: any[]) => void) => sharedDirTrailerBrands(cb),
  getDispatchers: (cb: (d: any[]) => void) => sharedDirDispatchers(cb),
  getRateGroups: (cb: (d: any[]) => void) => sharedDirRateGroups(cb),
  getStatusTypes: (cb: (d: any[]) => void) => sharedDirStatusTypes(cb),
  getDirections: (cb: (d: any[]) => void) => sharedDirDirections(cb),

  saveDirItem: (collection: string, item: any, user = "system", role = "admin") => {
    if (useFirebase) {
      const id = item.id || item.key || Date.now().toString();
      set(ref(database, `directories/${collection}/${id}`), { ...item, id });
    } else {
      const local = getLocalStorageData<any[]>(`ratipa_dir_${collection}`, []);
      const idx = local.findIndex((x) => (x.id || x.key) === (item.id || item.key));
      if (idx >= 0) local[idx] = item; else local.push(item);
      setLocalStorageData(`ratipa_dir_${collection}`, local);
    }
    dbService.logAction(user, role, "Сохранение справочника", "Directories", item.id, `Справочник ${collection}: ${item.name || item.label || item.id}`);
  },

  deleteDirItem: (collection: string, id: string, user = "system", role = "admin") => {
    if (useFirebase) {
      remove(ref(database, `directories/${collection}/${id}`));
    } else {
      const local = getLocalStorageData<any[]>(`ratipa_dir_${collection}`, []);
      setLocalStorageData(`ratipa_dir_${collection}`, local.filter((x) => (x.id || x.key) !== id));
    }
    dbService.logAction(user, role, "Удаление из справочника", "Directories", id, `Справочник ${collection}: ${id}`);
  },
};

// Database Services mapping with robust localized fallbacks and error handling helpers
export const dbService = {
  // Test/Connectivity state
  isOnline: () => useFirebase,

  // AUDIT LOGS
  getAuditLogs: (callback: (logs: AuditLog[]) => void, limitCount = 100) => {
    if (useFirebase) {
      
      const dbRef = query(ref(database, "auditLogs"), orderByChild("timestamp"), limitToLast(limitCount));
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: AuditLog[] = Object.keys(data).map((key) => ({
              ...data[key],
              id: key,
            }));
            list.sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn(
            "Audit logs stream permission denied, using offline fallback:",
            err,
          );
          const logs = getLocalStorageData<AuditLog[]>("ratipa_auditLogs", []);
          logs.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
          callback(logs);
        },
      );
    } else {
      const logs = getLocalStorageData<AuditLog[]>("ratipa_auditLogs", []);
      logs.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      callback(logs);
      return () => {};
    }
  },

  logAction: (
    user: string,
    role: string,
    actionType: string,
    module: string,
    entityId: string,
    details: string,
  ) => {
    const newLog: AuditLog = {
      id: "log_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      date: new Date().toISOString(),
      user,
      role,
      actionType,
      module,
      entityId,
      details,
    };
    if (useFirebase) {
      const dbRef = ref(database, "auditLogs");
      push(dbRef, newLog).catch((err) => {
        console.warn("Failed sync audit log to live firebase:", err);
        // Fallback to offline tracker
        const logs = getLocalStorageData<AuditLog[]>("ratipa_auditLogs", []);
        logs.push(newLog);
        setLocalStorageData("ratipa_auditLogs", logs);
      });
    } else {
      const logs = getLocalStorageData<AuditLog[]>("ratipa_auditLogs", []);
      logs.push(newLog);
      setLocalStorageData("ratipa_auditLogs", logs);
    }
  },

  // USERS / PROFILE
  getUsers: (callback: (users: UserProfile[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "users_list");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            let list = Object.keys(data).map((key) => ({
              uid: key,
              ...data[key],
            }));
            // Self-healing: Deduplicate "Сергей" entries to prevent multiple accounts in UI
            const sergeiList = list.filter((u) => u.name === "Сергей");
            if (sergeiList.length > 1) {
              const bestSergei =
                sergeiList.find((u) => u.uid === "sergei-ru-uid-112") ||
                sergeiList.find((u) => u.isRootAdmin) ||
                sergeiList[0];
              sergeiList.forEach((u) => {
                if (u.uid !== bestSergei.uid) {
                  remove(ref(database, `users_list/${u.uid}`)).catch((err) =>
                    console.warn("Clean duplicate Sergei:", err),
                  );
                }
              });
              list = list.filter(
                (u) => u.name !== "Сергей" || u.uid === bestSergei.uid,
              );
            }
            callback(list);
          } else {
            // Sync default seed to Firebase
            DEFAULT_USERS.forEach((u) => {
              set(ref(database, `users_list/${u.uid}`), u).catch((e) =>
                console.warn("Seed users key lock: ", e),
              );
            });
            callback(DEFAULT_USERS);
          }
        },
        (err) => {
          console.warn(
            "Firebase users fetch failed (permission lock?), falling back to template users:",
            err,
          );
          const localUsers = getLocalStorageData<UserProfile[]>(
            "ratipa_users",
            DEFAULT_USERS,
          );
          callback(localUsers);
        },
      );
    } else {
      const localUsers = getLocalStorageData<UserProfile[]>(
        "ratipa_users",
        DEFAULT_USERS,
      );
      callback(localUsers);
      return () => {};
    }
  },

  getUsersOnce: (callback: (users: UserProfile[]) => void) => {
    if (catalogCache.users !== null) {
      callback(catalogCache.users);
      return () => {};
    }
    if (useFirebase) {
      return onceValue(
        ref(database, "users_list"),
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            let list = Object.keys(data).map((key) => ({
              uid: key,
              ...data[key],
            }));
            // Self-healing: Deduplicate "Сергей" entries to prevent multiple accounts in UI
            const sergeiList = list.filter((u) => u.name === "Сергей");
            if (sergeiList.length > 1) {
              const bestSergei =
                sergeiList.find((u) => u.uid === "sergei-ru-uid-112") ||
                sergeiList.find((u) => u.isRootAdmin) ||
                sergeiList[0];
              list = list.filter((u) => u.name !== "Сергей" || u.uid === bestSergei.uid);
            }
            catalogCache.users = list;
            callback(list);
          } else {
            catalogCache.users = DEFAULT_USERS;
            callback(DEFAULT_USERS);
          }
        },
        (err) => {
          console.warn("Once fetch users failure:", err);
          callback(getLocalStorageData<UserProfile[]>("ratipa_users", DEFAULT_USERS));
        }
      );
    } else {
      const localUsers = getLocalStorageData<UserProfile[]>("ratipa_users", DEFAULT_USERS);
      catalogCache.users = localUsers;
      callback(localUsers);
      return () => {};
    }
  },

  saveUsersBatch: (usersMap: Record<string, any>) => {
    catalogCache.users = null;
    if (useFirebase) {
      update(ref(database), usersMap).catch((err) => console.warn("Failed batch update:", err));
    }
  },
  saveUser: (user: UserProfile) => {
    catalogCache.users = null;
    if (useFirebase) {
      set(ref(database, `users_list/${user.uid}`), user).catch((err) => {
        console.warn("Failed live save user:", err);
        const users = getLocalStorageData<UserProfile[]>(
          "ratipa_users",
          DEFAULT_USERS,
        );
        const existingIdx = users.findIndex((u) => u.uid === user.uid);
        if (existingIdx >= 0) users[existingIdx] = user;
        else users.push(user);
        setLocalStorageData("ratipa_users", users);
      });
      // Legacy paths sync for ratipa.html compatibility
      if (user.name) {
        const key = userKey(user.name);
        set(ref(database, `ratipa_home_known_users/${key}`), user.name);
        set(ref(database, `ratipa_home_users/${key}`), {
          name: user.name,
          password: user.password || "",
        });
        if (user.role === "admin" || user.role === "root_admin") {
          set(ref(database, `ratipa_home_admins/${key}`), true);
        } else {
          remove(ref(database, `ratipa_home_admins/${key}`));
        }
      }
    } else {
      const users = getLocalStorageData<UserProfile[]>(
        "ratipa_users",
        DEFAULT_USERS,
      );
      const existingIdx = users.findIndex((u) => u.uid === user.uid);
      if (existingIdx >= 0) {
        users[existingIdx] = user;
      } else {
        users.push(user);
      }
      setLocalStorageData("ratipa_users", users);
    }
    dbService.logAction(
      "System",
      "Admin",
      "User Update",
      "Admin",
      user.uid,
      `User updated: ${user.name} (${user.role})`,
    );
  },

  deleteUser: (uid: string, name?: string) => {
    catalogCache.users = null;
    if (useFirebase) {
      remove(ref(database, `users_list/${uid}`)).catch((err) => {
        console.warn("Failed live remove user:", err);
        const users = getLocalStorageData<UserProfile[]>(
          "ratipa_users",
          DEFAULT_USERS,
        );
        const filtered = users.filter((u) => u.uid !== uid);
        setLocalStorageData("ratipa_users", filtered);
      });
      if (name) {
        const key = userKey(name);
        remove(ref(database, `ratipa_home_known_users/${key}`));
        remove(ref(database, `ratipa_home_users/${key}`));
        remove(ref(database, `ratipa_home_admins/${key}`));
      }
    } else {
      const users = getLocalStorageData<UserProfile[]>(
        "ratipa_users",
        DEFAULT_USERS,
      );
      const filtered = users.filter((u) => u.uid !== uid);
      setLocalStorageData("ratipa_users", filtered);
    }
    dbService.logAction(
      "System",
      "Admin",
      "User Delete",
      "Admin",
      uid,
      `User deleted: ${uid}`,
    );
  },

  // ACTIVE FLEET / VEHICLES (Baza)
  getVehicles: (callback: (vehicles: Vehicle[]) => void) => {
    return sharedGetVehicles(callback);
  },

  saveVehicle: (vehicle: Vehicle, user: string, role: string) => {
    const carNum = (vehicle.carNumber || vehicle.vehicleNumbers || "").trim().toUpperCase();
    const brand = vehicle.brandModel || vehicle.brands || "";
    const disp = vehicle.dispatcherName || vehicle.dispatcher || "";
    const phoneNum = vehicle.driverPhone || vehicle.phone || "";
    const normalized = {
      ...vehicle,
      carNumber: carNum,
      vehicleNumbers: carNum,
      brandModel: brand,
      brands: brand,
      dispatcherName: disp,
      dispatcher: disp,
      driverPhone: phoneNum,
      phone: phoneNum,
    };
    if (useFirebase) {
      set(ref(database, `vehicleFleet/${vehicle.id}`), normalized).catch((err) => {
        console.warn("Live write vehicle Fleet failed:", err);
      });
    } else {
      const local = getLocalStorageData<any[]>("ratipa_vehicle_fleet", []);
      const idx = local.findIndex((v) => v.id === vehicle.id);
      if (idx >= 0) local[idx] = normalized;
      else local.push(normalized);
      setLocalStorageData("ratipa_vehicle_fleet", local);
    }
    dbService.logAction(
      user,
      role,
      vehicle.status === "archive" ? "Архивирование ТС" : "Сохранение ТС",
      "Baza",
      vehicle.id,
      `ТС ${carNum} (${vehicle.driverName || ""}) обновлено/сохранено`,
    );
  },

  // ARCHIVE VEHICLES
  getArchiveVehicles: (callback: (vehicles: Vehicle[]) => void) => {
    return sharedGetVehicles((list) => {
      callback(list.filter((v) => v.status === "archive"));
    });
  },

  archiveVehicle: (vehicle: Vehicle, user: string, role: string) => {
    const archived: Vehicle = { ...vehicle, status: "archive" };
    dbService.saveVehicle(archived, user, role);
  },

  restoreVehicle: (vehicle: Vehicle, user: string, role: string) => {
    const restored: Vehicle = { ...vehicle, status: "base" };
    dbService.saveVehicle(restored, user, role);
  },

  // ROUTE CALCULATIONS (Dohod)
  getRouteCalculations: (
    callback: (calculations: RouteCalculation[]) => void,
    limitCount = 100,
  ) => {
    const parseRuDateTime = (str: string): number => {
      if (!str) return 0;
      try {
        const parts = str.split(",");
        const dateParts = parts[0].trim().split(".");
        if (dateParts.length !== 3) return 0;
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);

        let hours = 0,
          minutes = 0,
          seconds = 0;
        if (parts[1]) {
          const timeParts = parts[1].trim().split(":");
          hours = parseInt(timeParts[0] || "0", 10);
          minutes = parseInt(timeParts[1] || "0", 10);
          seconds = parseInt(timeParts[2] || "0", 10);
        }
        return new Date(year, month, day, hours, minutes, seconds).getTime();
      } catch (e) {
        return 0;
      }
    };

    if (useFirebase) {
      const dbRef = query(ref(database, "calculationsHistory"), limitToLast(limitCount));
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: RouteCalculation[] = Object.keys(data).map((key) => ({
              id: key,
              ...data[key],
            }));
            list.sort((a, b) => {
              const aTime = parseRuDateTime(a.datetime || "");
              const bTime = parseRuDateTime(b.datetime || "");
              if (aTime !== bTime) {
                return bTime - aTime;
              }
              const idA = a.id || "";
              const idB = b.id || "";
              return idA < idB ? 1 : idA > idB ? -1 : 0;
            });
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn("Calculations fetch error:", err);
          const local = getLocalStorageData<RouteCalculation[]>(
            "ratipa_calculations",
            [],
          );
          local.sort((a, b) => {
            const aTime = parseRuDateTime(a.datetime || "");
            const bTime = parseRuDateTime(b.datetime || "");
            if (aTime !== bTime) {
              return bTime - aTime;
            }
            const idA = a.id || "";
            const idB = b.id || "";
            return idA < idB ? 1 : idA > idB ? -1 : 0;
          });
          callback(local);
        },
      );
    } else {
      const local = getLocalStorageData<RouteCalculation[]>(
        "ratipa_calculations",
        [],
      );
      local.sort((a, b) => {
        const aTime = parseRuDateTime(a.datetime || "");
        const bTime = parseRuDateTime(b.datetime || "");
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        const idA = a.id || "";
        const idB = b.id || "";
        return idA < idB ? 1 : idA > idB ? -1 : 0;
      });
      callback(local);
      return () => {};
    }
  },

  saveRouteCalculation: (
    calc: RouteCalculation,
    user: string,
    role: string,
  ) => {
    if (useFirebase) {
      const dbRef = ref(database, "calculationsHistory");
      const newRef = push(dbRef);
      calc.id = newRef.key || calc.id;
      set(newRef, calc);
    } else {
      const local = getLocalStorageData<RouteCalculation[]>(
        "ratipa_calculations",
        [],
      );
      local.push(calc);
      setLocalStorageData("ratipa_calculations", local);
    }
    dbService.logAction(
      user,
      role,
      "Расчет маршрута",
      "Dohod",
      calc.id,
      `Рассчитан маршрут из ${calc.from} в ${calc.to} (${calc.totalKm} км)`,
    );
  },

  deleteRouteCalculation: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `calculationsHistory/${id}`));
    } else {
      const local = getLocalStorageData<RouteCalculation[]>(
        "ratipa_calculations",
        [],
      );
      const filtered = local.filter((c) => c.id !== id);
      setLocalStorageData("ratipa_calculations", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление расчета маршрута",
      "Dohod",
      id,
      `Запись истории расчета удалена`,
    );
  },

  updateRouteCalculation: (
    id: string,
    updates: Partial<RouteCalculation>,
    user: string,
    role: string,
  ) => {
    if (useFirebase) {
      update(ref(database, `calculationsHistory/${id}`), updates);
    } else {
      const local = getLocalStorageData<RouteCalculation[]>(
        "ratipa_calculations",
        [],
      );
      const idx = local.findIndex((c) => c.id === id);
      if (idx >= 0) {
        local[idx] = { ...local[idx], ...updates };
        setLocalStorageData("ratipa_calculations", local);
      }
    }
    dbService.logAction(
      user,
      role,
      "Обновление расчета маршрута",
      "Dohod",
      id,
      `Запись истории расчета обновлена`,
    );
  },

  // SALARY LOGS (Salary)
  getSalaries: (callback: (logs: SalaryLog[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "salaryHistory/flat");
      return firebaseOnValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: SalaryLog[] = Object.keys(data).map((key) => ({
              id: key,
              ...data[key],
            }));
            list.sort((a, b) => {
              const aTime = parseInt(a.id.replace(/\D/g, "")) || 0;
              const bTime = parseInt(b.id.replace(/\D/g, "")) || 0;
              return bTime - aTime;
            });
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn("Salary stream failed:", err);
          const local = getLocalStorageData<SalaryLog[]>("ratipa_salaries", []);
          local.sort((a, b) => {
            const aTime = parseInt(a.id.replace(/\D/g, "")) || 0;
            const bTime = parseInt(b.id.replace(/\D/g, "")) || 0;
            return bTime - aTime;
          });
          callback(local);
        },
      );
    } else {
      const local = getLocalStorageData<SalaryLog[]>("ratipa_salaries", []);
      local.sort((a, b) => {
        const aTime = parseInt(a.id.replace(/\D/g, "")) || 0;
        const bTime = parseInt(b.id.replace(/\D/g, "")) || 0;
        return bTime - aTime;
      });
      callback(local);
      return () => {};
    }
  },

  saveSalary: (log: SalaryLog, user: string, role: string) => {
    const getYearMonth = (item: SalaryLog): string => {
      if (item.datetime) {
        const parts = item.datetime.split('.');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1]}`;
        }
      }
      const timestamp = parseInt(item.id || "");
      if (!isNaN(timestamp)) {
        const d = new Date(timestamp);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}`;
      }
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${mm}`;
    };

    const sanitizeKey = (key: string) => {
      return String(key || "").trim().replace(/[.#$[\]\/]/g, "_");
    };

    if (useFirebase) {
      const dbRef = ref(database, "salaryHistory/flat");
      const newRef = push(dbRef);
      const logId = newRef.key || log.id || Date.now().toString();
      log.id = logId;

      const ym = getYearMonth(log);
      const dispatcher = sanitizeKey(log.logist || 'System');

      const updates: Record<string, any> = {
        [`salaryHistory/flat/${logId}`]: log,
        [`salaryHistory/months/${ym}/${logId}`]: log,
        [`salaryHistory/byDispatcher/${dispatcher}/${logId}`]: log,
        [`salaryHistory/${logId}`]: log
      };
      update(ref(database), updates);
    } else {
      const local = getLocalStorageData<SalaryLog[]>("ratipa_salaries", []);
      local.push(log);
      setLocalStorageData("ratipa_salaries", local);
    }
    dbService.logAction(
      user,
      role,
      "Расчет зарплаты",
      "Salary",
      log.id,
      `Рассчитана зарплата водителя ${log.driver} на ТС ${log.car} (${log.totalSalary} EUR)`,
    );
  },

  deleteSalary: (logOrId: any, user: string, role: string) => {
    const isObject = typeof logOrId === 'object' && logOrId !== null;
    const id = isObject ? logOrId.id : logOrId;

    const getYearMonth = (item: SalaryLog): string => {
      if (item.datetime) {
        const parts = item.datetime.split('.');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1]}`;
        }
      }
      const timestamp = parseInt(item.id || "");
      if (!isNaN(timestamp)) {
        const d = new Date(timestamp);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}`;
      }
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${mm}`;
    };

    const sanitizeKey = (key: string) => {
      return String(key || "").trim().replace(/[.#$[\]\/]/g, "_");
    };

    if (useFirebase) {
      if (isObject) {
        const ym = getYearMonth(logOrId);
        const dispatcher = sanitizeKey(logOrId.logist || 'System');
        const updates: Record<string, any> = {
          [`salaryHistory/flat/${id}`]: null,
          [`salaryHistory/months/${ym}/${id}`]: null,
          [`salaryHistory/byDispatcher/${dispatcher}/${id}`]: null,
          [`salaryHistory/${id}`]: null
        };
        update(ref(database), updates);
      } else {
        const updates: Record<string, any> = {
          [`salaryHistory/${id}`]: null,
          [`salaryHistory/flat/${id}`]: null
        };
        update(ref(database), updates);
      }
    } else {
      const local = getLocalStorageData<SalaryLog[]>("ratipa_salaries", []);
      const filtered = local.filter((s) => s.id !== id);
      setLocalStorageData("ratipa_salaries", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление расчета зарплаты",
      "Salary",
      id,
      `Запись о зарплате удалена`,
    );
  },

  updateSalary: (
    id: string,
    updates: any,
    user: string,
    role: string,
  ) => {
    const getYearMonth = (item: SalaryLog): string => {
      if (item.datetime) {
        const parts = item.datetime.split('.');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1]}`;
        }
      }
      const timestamp = parseInt(item.id || "");
      if (!isNaN(timestamp)) {
        const d = new Date(timestamp);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}`;
      }
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${mm}`;
    };

    const sanitizeKey = (key: string) => {
      return String(key || "").trim().replace(/[.#$[\]\/]/g, "_");
    };

    if (useFirebase) {
      const ym = getYearMonth(updates);
      const dispatcher = sanitizeKey(updates.logist || 'System');
      const payload = { ...updates, id };
      const dbUpdates: Record<string, any> = {
        [`salaryHistory/flat/${id}`]: payload,
        [`salaryHistory/months/${ym}/${id}`]: payload,
        [`salaryHistory/byDispatcher/${dispatcher}/${id}`]: payload,
        [`salaryHistory/${id}`]: payload
      };
      update(ref(database), dbUpdates);
    } else {
      const local = getLocalStorageData<SalaryLog[]>("ratipa_salaries", []);
      const idx = local.findIndex((s) => s.id === id);
      if (idx >= 0) {
        local[idx] = { ...local[idx], ...updates };
        setLocalStorageData("ratipa_salaries", local);
      }
    }
    dbService.logAction(
      user,
      role,
      "Обновление расчета зарплаты",
      "Salary",
      id,
      `Запись о зарплате обновлена`,
    );
  },

  // VEHICLE DRIVER DATA
  getVehicleDriverBlocks: (callback: (data: any[]) => void) => {
    const db = getDatabase(getApp());
    if (useFirebase) {
      return onValue(ref(db, 'vehicle_driver_data'), (snap) => {
        const val = snap.val() || {};
        callback(Object.keys(val).map((k) => ({ id: k, ...val[k] })));
      });
    } else {
      callback(getLocalStorageData<any[]>('ratipa_vehicle_driver_data', []));
      return () => {};
    }
  },
  getVehicleDriverData: (callback: (data: any[]) => void) => {
    return sharedGetVehicleDriverData(callback);
  },

  // Soft-link readers for CouplingCard / DriverCard (read only, no hard binding)
  getBazaRecords: (callback: (data: any[]) => void) => {
    if (useFirebase) {
      return onValue(ref(database, "baza"), (snap) => {
        const val = snap.val();
        if (!val) { callback([]); return; }
        const list = Object.keys(val).map((k) => ({ ...val[k], id: k }));
        callback(list);
      });
    }
    callback(getLocalStorageData<any[]>("ratipa_baza", []));
    return () => {};
  },

  getPlanDohod: (callback: (data: any[]) => void) => {
    if (useFirebase) {
      return onValue(ref(database, "planDohod"), (snap) => {
        const val = snap.val();
        if (!val) { callback([]); return; }
        const list = Object.keys(val).map((k) => ({ ...val[k], id: k }));
        callback(list);
      });
    }
    callback([]);
    return () => {};
  },

  getDriverSalaryLogs: (driverId: string, callback: (logs: any[]) => void) => {
    if (useFirebase && driverId) {
      return onValue(ref(database, `salaryHistory/flat/${driverId}`), (snap) => {
        const val = snap.val();
        if (!val) { callback([]); return; }
        const list = Array.isArray(val) ? val : Object.keys(val).map((k) => ({ ...val[k], id: k }));
        callback(list);
      });
    }
    callback([]);
    return () => {};
  },

  getVehicleBrands: (callback: (brands: string[]) => void) => {
    if (useFirebase) {
      let b1: string[] = [];
      let b2: string[] = [];
      const trigger = () => {
        const combined = Array.from(new Set([...b1, ...b2]));
        callback(combined);
      };
      const unsub1 = onValue(ref(database, "brands/vehicleBrands"), (snap) => {
        const val = snap.val();
        b1 = val ? Object.values(val).map(v => String(v)) : [];
        trigger();
      }, () => {});
      const unsub2 = onValue(ref(database, "vehicleBrands"), (snap) => {
        const val = snap.val();
        b2 = val ? Object.values(val).map(v => String(v)) : [];
        trigger();
      }, () => {});
      return () => {
        unsub1();
        unsub2();
      };
    } else {
      callback([]);
      return () => {};
    }
  },

  getTrailerBrands: (callback: (brands: string[]) => void) => {
    if (useFirebase) {
      let b1: string[] = [];
      let b2: string[] = [];
      const trigger = () => {
        const combined = Array.from(new Set([...b1, ...b2]));
        callback(combined);
      };
      const unsub1 = onValue(ref(database, "brands/trailerBrands"), (snap) => {
        const val = snap.val();
        b1 = val ? Object.values(val).map(v => String(v)) : [];
        trigger();
      }, () => {});
      const unsub2 = onValue(ref(database, "trailerBrands"), (snap) => {
        const val = snap.val();
        b2 = val ? Object.values(val).map(v => String(v)) : [];
        trigger();
      }, () => {});
      return () => {
        unsub1();
        unsub2();
      };
    } else {
      callback([]);
      return () => {};
    }
  },

  saveVehicleDriverRecord: (rec: any, user: string, role: string): Promise<void> => {
    const carNum = (rec.vehicleNumbers || rec.carNumber || "").trim().toUpperCase();
    const brand = rec.brandModel || rec.brands || "";
    const trailer = rec.trailerMake || "";
    const disp = rec.dispatcher || rec.dispatcherName || "";
    const phoneNum = rec.phone || rec.driverPhone || "";
    const couplingId = rec.couplingId || null;
    const normalized = {
      ...rec,
      carNumber: carNum,
      vehicleNumbers: carNum,
      brandModel: brand,
      brands: brand,
      trailerMake: trailer,
      dispatcherName: disp,
      dispatcher: disp,
      driverPhone: phoneNum,
      phone: phoneNum,
    };
    
    let mainPromise: Promise<void>;
    
    if (useFirebase) {
      // Write block to module's own registry (independent of central fleet)
      mainPromise = set(ref(database, `vehicle_driver_data/${rec.id}`), normalized)
        .then(() => {
          // Sync brand/trailer ONLY to central fleet (soft link) if coupled
          if (couplingId) {
            const sync: any = {};
            if (brand) sync.brand = brand;
            if (trailer) sync.trailerBrand = trailer;
            if (Object.keys(sync).length) {
              update(ref(database, `vehicleFleet/${couplingId}`), sync).catch(() => {});
            }
          }
          // Save brand to master-nodes under brands / vehicleBrands / trailerBrands
          if (brand) {
            const brandKey = brand.trim().toUpperCase().replace(/[^A-Z0-9_\\-]/g, '_');
            if (brandKey) {
              set(ref(database, `brands/vehicleBrands/${brandKey}`), brand.trim()).catch(() => {});
              set(ref(database, `vehicleBrands/${brandKey}`), brand.trim()).catch(() => {});
              set(ref(database, `brands/${brandKey}`), brand.trim()).catch(() => {});
            }
          }
          if (trailer) {
            const trailerKey = trailer.trim().toUpperCase().replace(/[^A-Z0-9_\\-]/g, '_');
            if (trailerKey) {
              set(ref(database, `brands/trailerBrands/${trailerKey}`), trailer.trim()).catch(() => {});
              set(ref(database, `trailerBrands/${trailerKey}`), trailer.trim()).catch(() => {});
            }
          }
        });
    } else {
      const local = getLocalStorageData<any[]>("ratipa_vehicle_driver_data", []);
      const idx = local.findIndex((x) => x.id === rec.id);
      if (idx >= 0) local[idx] = normalized;
      else local.push(normalized);
      setLocalStorageData("ratipa_vehicle_driver_data", local);
      mainPromise = Promise.resolve();
    }
    
    dbService.logAction(
      user,
      role,
      "Сохранение данных авто и водителя",
      "Baza",
      rec.id,
      `Сохранены данные авто ${carNum} / водитель ${rec.driverNameRu || rec.driverName || ""}`,
    );
    
    return mainPromise;
  },

  deleteVehicleDriverRecord: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `vehicle_driver_data/${id}`)).catch((err) =>
        console.warn(err),
      );
    } else {
      const local = getLocalStorageData<any[]>("ratipa_vehicle_driver_data", []);
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_vehicle_driver_data", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление данных авто и водителя",
      "Baza",
      id,
      `Удалена запись данных авто и водителя`,
    );
  },

  // TRIP PLANS (Plan Dohod)
  getTrips: (callback: (trips: TripPlan[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "tripsdashboard");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: TripPlan[] = Object.keys(data).map((key) => ({
              id: key,
              ...data[key],
            }));
            callback(list);
          } else {
            INITIAL_TRIPS.forEach((t) => {
              set(ref(database, `tripsdashboard/${t.id}`), t).catch((err) =>
                console.warn(err),
              );
            });
            callback(INITIAL_TRIPS);
          }
        },
        (err) => {
          console.warn("Trip plans read lock:", err);
          const local = getLocalStorageData<TripPlan[]>(
            "ratipa_trips",
            INITIAL_TRIPS,
          );
          callback(local);
        },
      );
    } else {
      const local = getLocalStorageData<TripPlan[]>(
        "ratipa_trips",
        INITIAL_TRIPS,
      );
      callback(local);
      return () => {};
    }
  },

  saveTrip: (trip: TripPlan, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `tripsdashboard/${trip.id}`), trip);
    } else {
      const local = getLocalStorageData<TripPlan[]>(
        "ratipa_trips",
        INITIAL_TRIPS,
      );
      const idx = local.findIndex((t) => t.id === trip.id);
      if (idx >= 0) {
        local[idx] = trip;
      } else {
        local.push(trip);
      }
      setLocalStorageData("ratipa_trips", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение плана рейса",
      "PlanDohod",
      trip.id,
      `План рейса для ТС ${trip.carNumber} (${trip.direction}) сохранен/обновлен`,
    );
  },

  deleteTrip: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `tripsdashboard/${id}`));
    } else {
      const local = getLocalStorageData<TripPlan[]>(
        "ratipa_trips",
        INITIAL_TRIPS,
      );
      const filtered = local.filter((t) => t.id !== id);
      setLocalStorageData("ratipa_trips", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление плана рейса",
      "PlanDohod",
      id,
      `План рейса удален`,
    );
  },

  // PERMITS (Dozvola)
  getPermits: (callback: (permits: Permit[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "dozvolaPermits");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: Permit[] = Object.keys(data).map((key) => ({
              id: key,
              ...data[key],
            }));
            callback(list);
          } else {
            INITIAL_PERMITS.forEach((p) => {
              set(ref(database, `dozvolaPermits/${p.id}`), p).catch((err) =>
                console.warn(err),
              );
            });
            callback(INITIAL_PERMITS);
          }
        },
        (err) => {
          console.warn("Permits failed list:", err);
          const local = getLocalStorageData<Permit[]>(
            "ratipa_permits",
            INITIAL_PERMITS,
          );
          callback(local);
        },
      );
    } else {
      const local = getLocalStorageData<Permit[]>(
        "ratipa_permits",
        INITIAL_PERMITS,
      );
      callback(local);
      return () => {};
    }
  },

  savePermit: (permit: Permit, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `dozvolaPermits/${permit.id}`), permit);
    } else {
      const local = getLocalStorageData<Permit[]>(
        "ratipa_permits",
        INITIAL_PERMITS,
      );
      const idx = local.findIndex((p) => p.id === permit.id);
      if (idx >= 0) {
        local[idx] = permit;
      } else {
        local.push(permit);
      }
      setLocalStorageData("ratipa_permits", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение дозвола",
      "Dozvola",
      permit.id,
      `Дозвол ${permit.permitNumber} для ${permit.country} обновлен`,
    );
  },

  deletePermit: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `dozvolaPermits/${id}`));
    } else {
      const local = getLocalStorageData<Permit[]>(
        "ratipa_permits",
        INITIAL_PERMITS,
      );
      const filtered = local.filter((p) => p.id !== id);
      setLocalStorageData("ratipa_permits", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление дозвола",
      "Dozvola",
      id,
      `Дозвол удален`,
    );
  },

  // CHATS
  getChatMessages: (
    moduleId: string,
    callback: (msgs: ChatMessage[]) => void,
  ) => {
    if (useFirebase) {
      const dbRef = ref(database, `panelChat`);
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            // The old code stored author instead of username, and time instead of timestamp mostly. We map them.
            const list: ChatMessage[] = Object.keys(data)
              .filter(
                (key) =>
                  data[key].moduleId === moduleId ||
                  (!data[key].moduleId &&
                    (moduleId === "ai" ||
                      moduleId === "ai_dispatcher" ||
                      moduleId === "dohod")),
              ) // fallback for old chats? Or strictly check
              .map((key) => ({
                id: key,
                moduleId: data[key].moduleId || moduleId,
                text: data[key].text,
                username: data[key].author || data[key].username || "User",
                timestamp: data[key].timestamp || Date.now(),
                userId: data[key].owner || data[key].userId || "legacy",
                time: data[key].time,
              }));
            list.sort((a, b) => a.timestamp - b.timestamp);
            callback(list.slice(-50)); // max 50
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn("Chats failed feed stream:", err);
        },
      );
    } else {
      // LocalStorage local simulation
      const updateList = () => {
        const allChats = getLocalStorageData<any[]>("ratipa_chats", []);
        const filtered = allChats.filter(
          (c: any) =>
            c.moduleId === moduleId ||
            (!c.moduleId &&
              (moduleId === "ai" ||
                moduleId === "ai_dispatcher" ||
                moduleId === "dohod")),
        );

        filtered.sort((a, b) => a.timestamp - b.timestamp);
        callback(filtered.slice(-50));
      };

      updateList();
      window.addEventListener("storage", updateList);
      window.addEventListener("ratipa_chats_changed", updateList);

      return () => {
        window.removeEventListener("storage", updateList);
        window.removeEventListener("ratipa_chats_changed", updateList);
      };
    }
  },

  sendChatMessage: (
    moduleId: string,
    text: string,
    username: string,
    userId: string,
  ) => {
    if (useFirebase) {
      const dbRef = ref(database, `panelChat`);
      push(dbRef, {
        moduleId,
        author: username,
        owner: userId,
        text: text,
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp: Date.now(),
      });
    } else {
      const allChats = getLocalStorageData<any[]>("ratipa_chats", []);
      const newMsg = {
        id: "msg_" + Date.now(),
        moduleId,
        username,
        author: username,
        userId,
        owner: userId,
        text,
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp: Date.now(),
      };
      allChats.push(newMsg);
      setLocalStorageData("ratipa_chats", allChats);
      window.dispatchEvent(new Event("ratipa_chats_changed"));
    }
  },

  updateChatMessage: (id: string, text: string) => {
    if (useFirebase) {
      update(ref(database, `panelChat/${id}`), { text: text, isEdited: true });
    } else {
      const allChats = getLocalStorageData<any[]>("ratipa_chats", []);
      const updatedChats = allChats.map((m) =>
        m.id === id ? { ...m, text, isEdited: true } : m,
      );
      setLocalStorageData("ratipa_chats", updatedChats);
      window.dispatchEvent(new Event("ratipa_chats_changed"));
    }
  },

  deleteChatMessage: (id: string) => {
    if (useFirebase) {
      remove(ref(database, `panelChat/${id}`));
    } else {
      const allChats = getLocalStorageData<any[]>("ratipa_chats", []);
      const updatedChats = allChats.filter((m) => m.id !== id);
      setLocalStorageData("ratipa_chats", updatedChats);
      window.dispatchEvent(new Event("ratipa_chats_changed"));
    }
  },

  // ROUTE TEMPLATES
  getRouteTemplates: (callback: (templates: RouteTemplate[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "routeTemplates");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: RouteTemplate[] = Object.keys(data).map((key) => ({
              id: key,
              ...data[key],
            }));
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn("routeTemplates error:", err);
          callback([]);
        },
      );
    } else {
      callback([]);
      return () => {};
    }
  },

  saveRouteTemplate: (t: RouteTemplate, user: string, role: string) => {
    if (useFirebase) {
      const dbRef = ref(database, "routeTemplates");
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

    let sessionLoginTime = "";
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        let stored = sessionStorage.getItem("ratipa_session_login_time");
        if (!stored) {
          stored = new Date().toISOString();
          sessionStorage.setItem("ratipa_session_login_time", stored);
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
      loginTime: sessionLoginTime || new Date().toISOString(),
    };

    if (useFirebase) {
      const pRef = ref(database, `ratipapresence/${presenceId}`);
      set(pRef, item).catch((err) => {
        console.warn("Silent presence set fail:", err);
      });
      // Also update persistent lastActive on user profile
      update(ref(database, `users_list/${user.uid}`), {
        lastActive: item.lastActive,
      }).catch((err) => {
        console.warn("UserProfile lastActive update fail:", err);
      });

      // Cleanup of presence on unloading if possible
      const handleUnload = () => {
        remove(pRef);
      };
      window.addEventListener("beforeunload", handleUnload);

      return () => {
        remove(pRef);
        window.removeEventListener("beforeunload", handleUnload);
      };
    } else {
      const list = getLocalStorageData<any[]>("ratipa_presence", []);
      const filtered = list.filter((p) => p.uid !== user.uid);
      filtered.push(item);
      setLocalStorageData("ratipa_presence", filtered);

      const localUsers = getLocalStorageData<UserProfile[]>("ratipa_users", []);
      const idx = localUsers.findIndex((u) => u.uid === user.uid);
      if (idx !== -1) {
        localUsers[idx].lastActive = item.lastActive;
        setLocalStorageData("ratipa_users", localUsers);
      }

      return () => {
        const current = getLocalStorageData<any[]>("ratipa_presence", []);
        const clean = current.filter((p) => p.uid !== user.uid);
        setLocalStorageData("ratipa_presence", clean);
      };
    }
  },

  getOnlineUsers: (callback: (users: any[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "ratipapresence");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list = Object.keys(data).map((key) => ({
              presenceId: key,
              ...data[key],
            }));
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn("Online users read fail:", err);
          const current = getLocalStorageData<any[]>("ratipa_presence", []);
          callback(current);
        },
      );
    } else {
      // simulate online user changes
      const updateList = () => {
        const current = getLocalStorageData<any[]>("ratipa_presence", []);
        callback(current);
      };
      updateList();
      const interval = setInterval(updateList, 4000);
      return () => clearInterval(interval);
    }
  },

  // SYSTEM / APP SETTINGS (Google Sheets, etc.)
  getSettings: (callback: (settings: AppSettings) => void) => {
    return sharedGetSettings(callback);
  },

  getSettingsOnce: (callback: (settings: AppSettings) => void) => {
    if (catalogCache.settings !== null) {
      callback(catalogCache.settings);
      return () => {};
    }
    if (useFirebase) {
      return onceValue(
        ref(database, "appSettings"),
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            let updated = false;
            if (!data.highlight) {
              data.highlight = INITIAL_SETTINGS.highlight;
              updated = true;
            }
            if (!data.highlights || !Array.isArray(data.highlights) || data.highlights.length === 0) {
              data.highlights = data.highlight ? [{ ...data.highlight, id: data.highlight.id || "h1" }] : INITIAL_SETTINGS.highlights;
              updated = true;
            }
            const actualMonth = new Date().toISOString().substring(0, 7);
            if (!data.mapboxUsage) {
              data.mapboxUsage = {
                count: 0,
                limit: 100000,
                allowExceed: false,
                loadsCount: 0,
                loadsLimit: 50000,
                allowExceedLoads: false,
                currentMonth: actualMonth,
                lastReset: new Date().toISOString()
              };
              updated = true;
            } else {
              let innerUpdated = false;
              if (data.mapboxUsage.loadsCount === undefined) {
                data.mapboxUsage.loadsCount = 0;
                innerUpdated = true;
              }
              if (data.mapboxUsage.loadsLimit === undefined) {
                data.mapboxUsage.loadsLimit = 50000;
                innerUpdated = true;
              }
              if (data.mapboxUsage.allowExceedLoads === undefined) {
                data.mapboxUsage.allowExceedLoads = false;
                innerUpdated = true;
              }
              if (innerUpdated) updated = true;
            }
            catalogCache.settings = data;
            callback(data);
          } else {
            catalogCache.settings = INITIAL_SETTINGS;
            callback(INITIAL_SETTINGS);
          }
        },
        (err) => {
          console.warn("Once fetch settings failure:", err);
          callback(getLocalStorageData<AppSettings>("ratipa_settings", INITIAL_SETTINGS));
        }
      );
    } else {
      const local = getLocalStorageData<AppSettings>("ratipa_settings", INITIAL_SETTINGS);
      catalogCache.settings = local;
      callback(local);
      return () => {};
    }
  },

  saveSettings: (settings: AppSettings, user: string, role: string) => {
    catalogCache.settings = null;
    const cleanSettings = sanitizeFirebaseObject(settings);
    if (useFirebase) {
      set(ref(database, "appSettings"), cleanSettings);
    } else {
      setLocalStorageData("ratipa_settings", cleanSettings);
    }
    dbService.logAction(
      user,
      role,
      "Обновление настроек",
      "Settings",
      "global",
      "Изменены глобальные настройки / конфигурация Google Таблиц",
    );
  },

  // FERRY TEMPLATES
  getFerryTemplates: (callback: (templates: FerryTemplate[]) => void) => {
    return sharedGetFerryTemplates(callback);
  },

  saveFerryTemplate: (t: FerryTemplate, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `ferryTemplates/${t.id}`), t);
    } else {
      const local = getLocalStorageData<FerryTemplate[]>(
        "ratipa_ferry_templates",
        INITIAL_FERRY_TEMPLATES,
      );
      const idx = local.findIndex((x) => x.id === t.id);
      if (idx >= 0) local[idx] = t;
      else local.push(t);
      setLocalStorageData("ratipa_ferry_templates", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение шаблона парома",
      "Settings",
      t.id,
      `Шаблон парома ${t.name} с ценой ${t.price} EUR сохранен`,
    );
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
        .then(() =>
          console.log(`Ferry ${path} removed successfully by remove()`),
        )
        .catch((err) => console.error(`Error removing ferry ${path}:`, err));
    } else {
      const local = getLocalStorageData<FerryTemplate[]>(
        "ratipa_ferry_templates",
        INITIAL_FERRY_TEMPLATES,
      );
      console.log(
        `dbService: Local storage deletion, total was ${local.length}`,
      );
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_ferry_templates", filtered);
      console.log(`dbService: Local storage deletion, now ${filtered.length}`);
    }
    dbService.logAction(
      user,
      role,
      "Удаление шаблона парома",
      "Settings",
      id,
      `Шаблон парома удален`,
    );
  },

  // DISTANCES Presets
  getDistances: (callback: (presets: DistancePreset[]) => void) => {
    return sharedGetDistances(callback);
  },

  saveDistance: (d: DistancePreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `knownDistancesList/${d.id}`), d);
    } else {
      const local = getLocalStorageData<DistancePreset[]>(
        "ratipa_distances",
        INITIAL_DISTANCES,
      );
      const idx = local.findIndex((x) => x.id === d.id);
      if (idx >= 0) local[idx] = d;
      else local.push(d);
      setLocalStorageData("ratipa_distances", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение предустановки расстояния",
      "Settings",
      d.id,
      `Расстояние из ${d.from} в ${d.to} установлено в ${d.distance} км`,
    );
  },

  deleteDistance: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `knownDistancesList/${id}`));
    } else {
      const local = getLocalStorageData<DistancePreset[]>(
        "ratipa_distances",
        INITIAL_DISTANCES,
      );
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_distances", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление предустановки расстояния",
      "Settings",
      id,
      `Предустановка расстояния удалена`,
    );
  },

  // CURRENCIES Presets
  getCurrencies: (callback: (presets: CurrencyPreset[]) => void) => {
    return sharedGetCurrencies(callback);
  },

  saveCurrency: (c: CurrencyPreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `currenciesList/${c.id}`), c);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение валюты",
      "Settings",
      c.id,
      `Валюта сохранена: ${c.code}`,
    );
  },

  deleteCurrency: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `currenciesList/${id}`));
    }
    dbService.logAction(
      user,
      role,
      "Удаление валюты",
      "Settings",
      id,
      `Валюта удалена`,
    );
  },

  // CARS POOL (Тарифы по машинам)
  getCarRateGroups: (callback: (groups: CarRateGroup[]) => void) => {
    return sharedGetCarRateGroups(callback);
  },

  saveCarRateGroup: (g: CarRateGroup, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `carsPool/${g.id}`), {
        name: g.name,
        rate: g.rate,
        perDiemRate: g.perDiemRate || null,
        vehicles: g.vehicles,
        comment: g.comment || "",
      });
    } else {
      const local = getLocalStorageData<CarRateGroup[]>(
        "ratipa_cars_pool",
        INITIAL_CARS_POOL,
      );
      const idx = local.findIndex((x) => x.id === g.id);
      if (idx >= 0) local[idx] = g;
      else local.push(g);
      setLocalStorageData("ratipa_cars_pool", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение тарифной группы",
      "Settings",
      g.id,
      `Тарифная группа ТС ${g.name} сохранена`,
    );
  },

  deleteCarRateGroup: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `carsPool/${id}`));
    } else {
      const local = getLocalStorageData<CarRateGroup[]>(
        "ratipa_cars_pool",
        INITIAL_CARS_POOL,
      );
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_cars_pool", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление тарифной группы",
      "Settings",
      id,
      `Тарифная группа ТС удалена`,
    );
  },

  // DIRECTIONS POOL (Направления и коэффициенты)
  getDirections: (callback: (presets: DirectionPreset[]) => void) => {
    return sharedGetDirections(callback);
  },

  saveDirection: (d: DirectionPreset, user: string, role: string) => {
    if (useFirebase) {
      set(ref(database, `directionsPool/${d.id}`), {
        name: d.name,
        coeff: d.coeff,
      });
    } else {
      const local = getLocalStorageData<DirectionPreset[]>(
        "ratipa_directions",
        INITIAL_DIRECTIONS,
      );
      const idx = local.findIndex((x) => x.id === d.id);
      if (idx >= 0) local[idx] = d;
      else local.push(d);
      setLocalStorageData("ratipa_directions", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение направления",
      "Settings",
      d.id,
      `Коэффициент направления ${d.name} установлен в ${d.coeff}`,
    );
  },

  deleteDirection: (id: string, user: string, role: string) => {
    if (useFirebase) {
      remove(ref(database, `directionsPool/${id}`));
    } else {
      const local = getLocalStorageData<DirectionPreset[]>(
        "ratipa_directions",
        INITIAL_DIRECTIONS,
      );
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_directions", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление направления",
      "Settings",
      id,
      `Направление удалено`,
    );
  },

  // DRIVERS POOL (Справочник водителей)
  getDrivers: (callback: (drivers: Driver[]) => void) => {
    return sharedGetDrivers(callback);
  },

  getDriversOnce: (callback: (drivers: Driver[]) => void) => {
    if (catalogCache.drivers !== null) {
      callback(catalogCache.drivers);
      return () => {};
    }
    if (useFirebase) {
      return onceValue(
        ref(database, "driversPool"),
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list: Driver[] = Object.keys(data).map((key) => ({
              id: key,
              name: String(data[key].name || ""),
              lastNameRu: data[key].lastNameRu ? String(data[key].lastNameRu) : undefined,
              firstNameRu: data[key].firstNameRu ? String(data[key].firstNameRu) : undefined,
              middleNameRu: data[key].middleNameRu ? String(data[key].middleNameRu) : undefined,
              lastNameLat: data[key].lastNameLat ? String(data[key].lastNameLat) : undefined,
              firstNameLat: data[key].firstNameLat ? String(data[key].firstNameLat) : undefined,
              middleNameLat: data[key].middleNameLat ? String(data[key].middleNameLat) : undefined,
              shortNameRu: data[key].shortNameRu ? String(data[key].shortNameRu) : undefined,
              shortNameLat: data[key].shortNameLat ? String(data[key].shortNameLat) : undefined,
              phone: data[key].phone ? String(data[key].phone) : undefined,
              license: data[key].license ? String(data[key].license) : undefined,
              rateGroupId: data[key].rateGroupId ? String(data[key].rateGroupId) : undefined,
              comment: data[key].comment ? String(data[key].comment) : undefined,
            }));
            catalogCache.drivers = list;
            callback(list);
          } else {
            catalogCache.drivers = [];
            callback([]);
          }
        },
        (err) => {
          console.warn("Once fetch drivers failure:", err);
          callback(getLocalStorageData<Driver[]>("ratipa_drivers", []));
        }
      );
    } else {
      const local = getLocalStorageData<Driver[]>("ratipa_drivers", []);
      catalogCache.drivers = local;
      callback(local);
      return () => {};
    }
  },

  saveDriver: (d: Driver, user: string, role: string) => {
    catalogCache.drivers = null;
    const payload = {
      name: d.name,
      lastNameRu: d.lastNameRu || "",
      firstNameRu: d.firstNameRu || "",
      middleNameRu: d.middleNameRu || "",
      lastNameLat: d.lastNameLat || "",
      firstNameLat: d.firstNameLat || "",
      middleNameLat: d.middleNameLat || "",
      shortNameRu: d.shortNameRu || "",
      shortNameLat: d.shortNameLat || "",
      phone: d.phone || "",
      license: d.license || "",
      rateGroupId: d.rateGroupId || "",
      comment: d.comment || "",
    };
    if (useFirebase) {
      set(ref(database, `driversPool/${d.id}`), payload);
    } else {
      const local = getLocalStorageData<Driver[]>("ratipa_drivers", []);
      const idx = local.findIndex((x) => x.id === d.id);
      if (idx >= 0) local[idx] = { ...d, ...payload };
      else local.push({ ...d, ...payload });
      setLocalStorageData("ratipa_drivers", local);
    }
    dbService.logAction(
      user,
      role,
      "Сохранение водителя",
      "Settings",
      d.id,
      `Водитель ${d.name} сохранен`,
    );
  },

  deleteDriver: (id: string, user: string, role: string) => {
    catalogCache.drivers = null;
    if (useFirebase) {
      remove(ref(database, `driversPool/${id}`));
    } else {
      const local = getLocalStorageData<Driver[]>("ratipa_drivers", []);
      const filtered = local.filter((x) => x.id !== id);
      setLocalStorageData("ratipa_drivers", filtered);
    }
    dbService.logAction(
      user,
      role,
      "Удаление водителя",
      "Settings",
      id,
      `Водитель удален`,
    );
  },

  // BROADCAST PUSH NOTIFICATIONS
  getBroadcastNotifications: (callback: (notifications: any[]) => void) => {
    if (useFirebase) {
      const dbRef = ref(database, "broadcastNotifications");
      return onValue(
        dbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const list = Object.keys(data).map((key) => ({
              id: key,
              text: data[key].text,
              createdAt: data[key].createdAt,
              createdBy: data[key].createdBy,
              readBy: data[key].readBy || {},
            }));
            list.sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            );
            callback(list);
          } else {
            callback([]);
          }
        },
        (err) => {
          console.warn(
            "Broadcast notifications fail, falling back locally:",
            err,
          );
          const local = getLocalStorageData<any[]>(
            "ratipa_broadcast_notifications",
            [],
          );
          callback(local);
        },
      );
    } else {
      const local = getLocalStorageData<any[]>(
        "ratipa_broadcast_notifications",
        [],
      );
      callback(local);

      const updateList = () => {
        const current = getLocalStorageData<any[]>(
          "ratipa_broadcast_notifications",
          [],
        );
        callback(current);
      };
      window.addEventListener("storage", updateList);
      window.addEventListener(
        "ratipa_broadcast_notifications_changed",
        updateList,
      );
      return () => {
        window.removeEventListener("storage", updateList);
        window.removeEventListener(
          "ratipa_broadcast_notifications_changed",
          updateList,
        );
      };
    }
  },

  sendBroadcastNotification: (
    text: string,
    createdBy: string,
    user: string,
    role: string,
    targetRoles?: string[],
    notifType?: 'info' | 'warning' | 'success' | 'alert'
  ) => {
    const roles = targetRoles || [];
    const type = notifType || 'info';

    const newNotif = {
      text,
      createdAt: new Date().toISOString(),
      createdBy,
      readBy: {},
      targetRoles: roles,
      type: type
    };

    // Prepare system notification item
    const sysNotifId = "notif_push_" + Date.now();
    
    let title = "📢 Важное объявление";
    if (type === 'alert') title = "🚨 Срочное сообщение";
    else if (type === 'warning') title = "⚠️ Предупреждение системы";
    else if (type === 'success') title = "✅ Системное уведомление";

    const systemNotif = {
      title,
      text,
      type,
      date: new Date().toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(',', ''),
      dispatcher: createdBy,
      targetRoles: roles
    };

    if (useFirebase) {
      const dbRef = ref(database, "broadcastNotifications");
      const newRef = push(dbRef);
      set(newRef, newNotif);

      // Save to system notifications feed
      const sysRef = ref(database, `ratipa_notifications/${sysNotifId}`);
      set(sysRef, systemNotif);
    } else {
      const local = getLocalStorageData<any[]>(
        "ratipa_broadcast_notifications",
        [],
      );
      const withId = { id: "bn_" + Date.now(), ...newNotif };
      local.unshift(withId);
      setLocalStorageData("ratipa_broadcast_notifications", local);

      // Save to local system notifications feed
      const localSys = getLocalStorageData<any[]>("ratipa_notifications_local", []);
      const withIdSys = { id: sysNotifId, ...systemNotif };
      localSys.unshift(withIdSys);
      setLocalStorageData("ratipa_notifications_local", localSys);

      window.dispatchEvent(new Event("ratipa_broadcast_notifications_changed"));
    }
    dbService.logAction(
      user,
      role,
      "Отправка пуш-уведомления",
      "Admin",
      "push",
      `Отправлено пуш-уведомление (${type}, таргет: ${roles.join(',') || 'все'}): ${text}`,
    );
  },

  markBroadcastNotificationAsRead: (
    notifId: string,
    userUid: string,
    userName: string,
  ) => {
    if (useFirebase) {
      const dbRef = ref(
        database,
        `broadcastNotifications/${notifId}/readBy/${userUid}`,
      );
      set(dbRef, {
        username: userName,
        readAt: new Date().toISOString(),
      });
    } else {
      const local = getLocalStorageData<any[]>(
        "ratipa_broadcast_notifications",
        [],
      );
      const idx = local.findIndex((x) => x.id === notifId);
      if (idx >= 0) {
        if (!local[idx].readBy) local[idx].readBy = {};
        local[idx].readBy[userUid] = {
          username: userName,
          readAt: new Date().toISOString(),
        };
        setLocalStorageData("ratipa_broadcast_notifications", local);
        window.dispatchEvent(
          new Event("ratipa_broadcast_notifications_changed"),
        );
      }
    }
  },

  deleteBroadcastNotification: async (
    notifId: string,
    user: string,
    role: string,
  ) => {
    if (useFirebase) {
      try {
        await remove(ref(database, `broadcastNotifications/${notifId}`));
      } catch (err) {
        console.warn("Failed to delete from Firebase, removing locally:", err);
      }
    }

    // Always remove from local fallback array to update UI optimistically
    const local = getLocalStorageData<any[]>(
      "ratipa_broadcast_notifications",
      [],
    );
    const filtered = local.filter((x) => x.id !== notifId);
    setLocalStorageData("ratipa_broadcast_notifications", filtered);
    window.dispatchEvent(new Event("ratipa_broadcast_notifications_changed"));

    dbService.logAction(
      user,
      role,
      "Удаление пуш-уведомления",
      "Admin",
      notifId,
      `Пуш-уведомление удалено`,
    );
  },

  getVehicleStatuses: (callback: (data: Record<string, 'base' | 'trip'>) => void) => {
    return sharedGetVehicleStatuses(callback);
  },

  bulkUpdateCouplings: (ids: string[], patch: Record<string, any>): Promise<void> => {
    if (useFirebase) {
      const updates: Record<string, any> = {};
      for (const id of ids) {
        for (const [k, v] of Object.entries(patch)) {
          updates[`vehicleFleet/${id}/${k}`] = v;
        }
      }
      return update(ref(database), updates).catch((err) => console.warn("bulkUpdateCouplings failed:", err));
    } else {
      // localStorage fallback: update each local record
      const all = getLocalStorageData<any[]>("ratipa_vehicle_fleet", []);
      const set2 = new Set(ids);
      const updated = all.map((c) => (set2.has(c.id) ? { ...c, ...patch } : c));
      setLocalStorageData("ratipa_vehicle_fleet", updated);
      window.dispatchEvent(new Event("ratipa_vehicle_fleet_changed"));
      return Promise.resolve();
    }
  },

  setVehicleStatus: (id: string, status: 'base' | 'trip') => {
    if (useFirebase) {
      set(ref(database, `vehicle_statuses/${id}`), status).catch((err) =>
        console.warn(err),
      );
    } else {
      const local = getLocalStorageData<Record<string, 'base' | 'trip'>>(
        "ratipa_vehicle_statuses",
        {},
      );
      local[id] = status;
      setLocalStorageData("ratipa_vehicle_statuses", local);
      window.dispatchEvent(new Event("ratipa_vehicle_statuses_changed"));
    }
  },

  incrementMapboxUsage: async () => {
    if (useFirebase) {
      try {
        const dbRef = ref(database, "appSettings/mapboxUsage/count");
        const snapshot = await new Promise<any>((resolve) => {
          const unsub = onValue(dbRef, (snap) => {
            resolve(snap);
            unsub();
          }, () => {
            resolve(null);
          });
          setTimeout(() => {
            resolve(null);
            unsub();
          }, 2000);
        });
        const currentCount = snapshot && snapshot.exists() ? Number(snapshot.val() || 0) : 0;
        await set(dbRef, currentCount + 1);
      } catch (err) {
        console.warn("Failed to increment Mapbox usage in Firebase:", err);
      }
    } else {
      const local = getLocalStorageData<AppSettings>("ratipa_settings", INITIAL_SETTINGS);
      if (local.mapboxUsage) {
        local.mapboxUsage.count = (local.mapboxUsage.count || 0) + 1;
        setLocalStorageData("ratipa_settings", local);
      }
    }
  },

  incrementMapboxLoads: async () => {
    if (useFirebase) {
      try {
        const dbRef = ref(database, "appSettings/mapboxUsage/loadsCount");
        const snapshot = await new Promise<any>((resolve) => {
          const unsub = onValue(dbRef, (snap) => {
            resolve(snap);
            unsub();
          }, () => {
            resolve(null);
          });
          setTimeout(() => {
            resolve(null);
            unsub();
          }, 2000);
        });
        const currentCount = snapshot && snapshot.exists() ? Number(snapshot.val() || 0) : 0;
        await set(dbRef, currentCount + 1);
      } catch (err) {
        console.warn("Failed to increment Mapbox loads in Firebase:", err);
      }
    } else {
      const local = getLocalStorageData<AppSettings>("ratipa_settings", INITIAL_SETTINGS);
      if (local.mapboxUsage) {
        local.mapboxUsage.loadsCount = (local.mapboxUsage.loadsCount || 0) + 1;
        setLocalStorageData("ratipa_settings", local);
      }
    }
  },
};
