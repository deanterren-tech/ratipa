// Фабрики общих подписок и кэширующие обёртки (sharedGet*/sharedDir*).
// Вынесено из firebase.ts для уменьшения монолита.
// Импортируем примитивы из firebase.ts (live bindings: database/useFirebase — let).
import { set, update } from "firebase/database";
import { ref } from "firebase/database";
import {
  database,
  useFirebase,
  getLocalStorageData,
  onValue,
} from "../firebase";
import type {
  Driver,
  CarRateGroup,
  DirectionPreset,
  FerryTemplate,
  DistancePreset,
  CurrencyPreset,
  AppSettings,
} from "../types";
import {
  INITIAL_CARS_POOL,
  INITIAL_DIRECTIONS,
  INITIAL_FERRY_TEMPLATES,
  INITIAL_DISTANCES,
  INITIAL_SETTINGS,
} from "../db/seed";
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

export const sharedGetDrivers = createSharedSubscription<Driver[]>(
  (onData, onError) => {
    const dbRef = ref(database, "drivers");
    return onValue(
      dbRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list: Driver[] = Object.keys(data).map((key) => ({
            id: key,
            ...data[key],
            name: String(data[key].name || ""),
            lastNameRu: data[key].lastNameRu ? String(data[key].lastNameRu) : undefined,
            firstNameRu: data[key].firstNameRu ? String(data[key].firstNameRu) : undefined,
            middleNameRu: data[key].middleNameRu ? String(data[key].middleNameRu) : undefined,
            lastNameLat: data[key].lastNameLat ? String(data[key].lastNameLat) : undefined,
            firstNameLat: data[key].firstNameLat ? String(data[key].firstNameLat) : undefined,
            middleNameLat: data[key].middleNameLat ? String(data[key].middleNameLat) : undefined,
            shortNameRu: data[key].shortNameRu
              ? String(data[key].shortNameRu)
              : [data[key].lastNameRu, (data[key].firstNameRu || "")[0], (data[key].middleNameRu || "")[0]]
                  .filter(Boolean)
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim() || undefined,
            shortNameLat: data[key].shortNameLat
              ? String(data[key].shortNameLat)
              : [data[key].lastNameLat, (data[key].firstNameLat || "")[0], (data[key].middleNameLat || "")[0]]
                  .filter(Boolean)
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim() || undefined,
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

// === ЕДИНАЯ БАЗА (portal-схема): tractors / trailers / couplings ===
export const sharedGetTractors = createSharedSubscription<any[]>(
  (onData, onError) => {
    const dbRef = ref(database, "tractors");
    return onValue(
      dbRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.keys(val).map((key) => ({ id: key, ...val[key] }));
          onData(list);
        } else {
          onData([]);
        }
      },
      onError
    );
  },
  (onData) => onData([])
);

export const sharedGetTrailers = createSharedSubscription<any[]>(
  (onData, onError) => {
    const dbRef = ref(database, "trailers");
    return onValue(
      dbRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.keys(val).map((key) => ({ id: key, ...val[key] }));
          onData(list);
        } else {
          onData([]);
        }
      },
      onError
    );
  },
  (onData) => onData([])
);

export const sharedGetCouplings = createSharedSubscription<any[]>(
  (onData, onError) => {
    const dbRef = ref(database, "couplings");
    return onValue(
      dbRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.keys(val).map((key) => ({ id: key, ...val[key] }));
          onData(list);
        } else {
          onData([]);
        }
      },
      onError
    );
  },
  (onData) => onData([])
);




export const sharedGetCarRateGroups = createSharedSubscription<CarRateGroup[]>(
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

export const sharedGetDirections = createSharedSubscription<DirectionPreset[]>(
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

export const sharedGetFerryTemplates = createSharedSubscription<FerryTemplate[]>(
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

export const sharedGetDistances = createSharedSubscription<DistancePreset[]>(
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

export const sharedGetCurrencies = createSharedSubscription<CurrencyPreset[]>(
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

export const sharedGetSettings = createSharedSubscription<AppSettings>(
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
          // Чтение — НЕ перезаписываем узел целиком (риск стереть menuStructure и другие поля).
          // Дописывание служебных полей (highlight/mapboxUsage) происходит в saveSettings при явном сохранении.
          onData(data);
        } else {
          // БД пуста: не перезаписываем узел (риск стереть поля при гонке).
          // Отдаём INITIAL_SETTINGS локально; реальная запись — при явном saveSettings.
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

export const sharedGetVehicleStatuses = createSharedSubscription<Record<string, 'base' | 'trip'>>(
  (onData, onError) => {
    return onValue(ref(database, "vehicle_statuses"), (snapshot) => {
      onData(snapshot.val() || {});
    }, onError);
  },
  (onData) => {
    onData(getLocalStorageData<Record<string, 'base' | 'trip'>>("ratipa_vehicle_statuses", {}));
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

export const sharedDirVehicleBrands = createDirSub<any[]>("directories/vehicleBrands");
export const sharedDirTrailerBrands = createDirSub<any[]>("directories/trailerBrands");
export const sharedDirDispatchers = createDirSub<any[]>("directories/dispatchers");
export const sharedDirRateGroups = createDirSub<any[]>("directories/rateGroups");
export const sharedDirStatusTypes = createDirSub<any[]>("directories/statusTypes");
export const sharedDirDirections = createDirSub<any[]>("directories/directions");

