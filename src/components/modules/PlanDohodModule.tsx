import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react'
import {useToast} from '../ToastProvider'
import { formatToTitleCase } from '../../utils/format'
import {TripList} from './TripList'
import NotebookStatusPills from './NotebookStatusPills'
import {Virtuoso} from 'react-virtuoso'
import {
  UserProfile,
  TripPlan,
  LegPlan,
  DirectionPreset,
  DistancePreset,
  DISPATCHER_COLORS_PRESETS,
  PotentialLoad,
  CurrencyPreset,
} from "../../types";
import {calculateTripFinances} from '../../utils/financeCalculators'
import {dbService, directoryService} from '../../api';
import {pdService} from '../../api';
import CouplingPicker from "../common/CouplingPicker";
import {formatCoupling} from '../../utils/salaryAutofill'
import {
  Plus,
  Trash2,
  Save,
  MapPin,
  Calculator,
  TrendingUp,
  Archive,
  History,
  Check,
  X,
  BookOpen,
  Minus,
  Bot,
  Search,
Receipt, CircleDollarSign, MessageSquare, FileText} from "lucide-react";
import MapRouteModal from "../MapRouteModal";

interface PlanDohodModuleProps {
  user: UserProfile;
}

export default function PlanDohodModule({ user }: PlanDohodModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast: addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tableScale, setTableScale] = useState<number>(() => {
    const saved = localStorage.getItem(`pd_table_scale_${user.uid}`);
    return saved ? Number(saved) : 100;
  });
  const [activeTab, setActiveTab] = useState<"active" | "archive" | "history">(
    "active",
  );
  const [archiveMonth, setArchiveMonth] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Закрытие модалки редактирования по ESC (независимо от глобального хука)
  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsModalOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isModalOpen]);
  const [modalTab, setModalTab] = useState<"main" | "potential">("main");
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    dir: "asc" | "desc";
  } | null>(null);

  // Realtime Data
  const [activeTrips, setActiveTrips] = useState<TripPlan[]>([]);
  const [archiveTrips, setArchiveTrips] = useState<TripPlan[]>([]);
  const trips = useMemo(() => {
    return [...activeTrips, ...archiveTrips];
  }, [activeTrips, archiveTrips]);

  const [savedCars, setSavedCars] = useState<string[]>([]);
  const [carDispatcherMapping, setCarDispatcherMapping] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const unsub = pdService.subscribeDispatchersCarMapping(
      setCarDispatcherMapping,
    );
    return unsub;
  }, []);

  const handleCarNumberChange = (val: string) => {
    const up = val.toUpperCase();
    setCarNumber(up);
    if (up && carDispatcherMapping[up]) {
      setDispatcher(carDispatcherMapping[up]);
    }
  };
  const [directions, setDirections] = useState<Record<string, number>>({});
  const [distances, setDistances] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    useDistanceLookup: false,
    distanceLookupMode: "cities",
  });
  const [dispatchers, setDispatchers] = useState<string[]>([]);
  const [dispatchersOrder, setDispatchersOrder] = useState<string[]>([]);
  const [dispatchersColors, setDispatchersColors] = useState<
    Record<string, string>
  >({});
  const [currencies, setCurrencies] = useState<any[]>([]); // CurrencyPreset
  const [logs, setLogs] = useState<any[]>([]);
  const [manualTripsOrder, setManualTripsOrder] = useState<string[]>([]);

  // Current filter specific to dispatchers
  const [activeDispatcherTab, setActiveDispatcherTab] = useState<string>("All");
  const [activeDirectionTab, setActiveDirectionTab] = useState<string>("All");

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("ratipa_plan_trips_order") || "[]",
      );
      if (Array.isArray(saved)) setManualTripsOrder(saved);
    } catch (e) {}

    const unsubTrips = pdService.subscribeTrips(setActiveTrips, false);
    const unsubCars = directoryService.getCarsList(setSavedCars);
    const unsubDirs = directoryService.getDirectionsMap(setDirections);
    const unsubDist = pdService.subscribeKnownDistances(setDistances);
    const unsubCurrencies = dbService.getCurrencies(setCurrencies);
    const unsubSet = pdService.subscribePlanDohodSettings(setSettings);
    // Цвета диспетчеров — теперь из единой базы (directories/dispatchers[].color)
    const unsubColors = directoryService.getDispatchersObjects((list) => {
      const colors: Record<string, string> = {};
      (list || []).forEach((d) => { if (d.name) colors[d.name] = d.color || '#94a3b8'; });
      setDispatchersColors(colors);
    });
    const unsubDisp = directoryService.getDispatchersObjects((list) => {
      const objs = list || [];
      const names = objs.map((d) => d.name);
      // Гарантируем, что имя текущего пользователя присутствует среди диспетчеров,
      // иначе его рейсы (dispatcher = user.name) не попадают ни в одну вкладку.
      const withMe = names.includes(user.name) ? names : [...names, user.name];
      setDispatchers(withMe);
      setDispatchersOrder(withMe);
    });
    pdService.setPresence(user.name);

    return () => {
      unsubTrips();

      unsubCars();
      unsubDirs();
      unsubDist();
      unsubCurrencies();
      unsubSet();
      unsubDisp();
      unsubColors();
    };
  }, [user.name]);

  // Lazy-load Archive Trips
  useEffect(() => {
    if (activeTab !== "archive") {
      setArchiveTrips([]);
      return;
    }
    const unsubArchive = pdService.subscribeTrips(setArchiveTrips, true);
    return () => {
      unsubArchive();
    };
  }, [activeTab]);

  // Lazy-load Audit Logs
  useEffect(() => {
    if (activeTab !== "history") return;
    const unsubLogs = dbService.getAuditLogs((data) => {
      setLogs(data.filter((l) => l.module === "PlanDohod"));
    });
    return () => unsubLogs();
  }, [activeTab]);

  // --- NOTEBOOK STATE & EFFECTS ---
  const [isNotebookOpen, setIsNotebookOpen] = useState<boolean>(() => {
    return localStorage.getItem("ratipa_notebook_visible") !== "false";
  });
  const toggleNotebook = () => {
    setIsNotebookOpen((prev) => {
      const newVal = !prev;
      localStorage.setItem("ratipa_notebook_visible", String(newVal));
      if (newVal) {
        setIsNbMinimized(false);
        localStorage.setItem("ratipa_notebook_minimized", "false");
        setNbCoords((prevCoords) => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          let newX = prevCoords.x;
          let newY = prevCoords.y;
          if (newX > w - 100 || newX < 0) newX = w - 425 > 0 ? w - 425 : 10;
          if (newY > h - 100 || newY < 0) newY = 140;
          const updated = { ...prevCoords, x: newX, y: newY };
          localStorage.setItem(
            "ratipa_notebook_coords",
            JSON.stringify(updated),
          );
          return updated;
        });
      }
      return newVal;
    });
  };

  const [nbCoords, setNbCoords] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>(() => {
    const defaultCoords = {
      x: typeof window !== "undefined" ? window.innerWidth - 425 : 800,
      y: 140,
      w: 380,
      h: 540,
    };
    try {
      const saved = localStorage.getItem("ratipa_notebook_coords");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.w > 0 && parsed.h > 0) {
          if (typeof window !== "undefined") {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (parsed.x > w - 50 || parsed.x < -100)
              parsed.x = defaultCoords.x > 0 ? defaultCoords.x : 10;
            if (parsed.y > h - 50 || parsed.y < -100)
              parsed.y = defaultCoords.y;
          }
          return parsed;
        }
      }
    } catch (e) {}
    return defaultCoords;
  });

  const [isNbMinimized, setIsNbMinimized] = useState<boolean>(() => {
    return localStorage.getItem("ratipa_notebook_minimized") === "true";
  });

  const [nbDragging, setNbDragging] = useState(false);
  const [nbDragOffset, setNbDragOffset] = useState({ x: 0, y: 0 });

  const [nbResizing, setNbResizing] = useState<string | false>(false);
  const [nbResizeStartSize, setNbResizeStartSize] = useState({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    mouseX: 0,
    mouseY: 0,
  });

  const handleNbDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest("select") ||
      (e.target as HTMLElement).closest("input") ||
      (e.target as HTMLElement).closest("textarea")
    ) {
      return;
    }
    setNbDragging(true);
    setNbDragOffset({
      x: e.clientX - nbCoords.x,
      y: e.clientY - nbCoords.y,
    });
  };

  const nbCoordsRef = useRef(nbCoords);
  useEffect(() => {
    nbCoordsRef.current = nbCoords;
  }, [nbCoords]);

  useEffect(() => {
    if (!nbDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(
        10,
        Math.min(window.innerWidth - 100, e.clientX - nbDragOffset.x),
      );
      const newY = Math.max(
        10,
        Math.min(window.innerHeight - 100, e.clientY - nbDragOffset.y),
      );
      setNbCoords((prev) => {
        return { ...prev, x: newX, y: newY };
      });
    };
    const handleMouseUp = () => {
      setNbDragging(false);
      try {
        localStorage.setItem(
          "ratipa_notebook_coords",
          JSON.stringify(nbCoordsRef.current),
        );
      } catch (err) {}
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [nbDragging, nbDragOffset]);

  useEffect(() => {
    if (!nbResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - nbResizeStartSize.mouseX;
      const deltaY = e.clientY - nbResizeStartSize.mouseY;

      let newW = nbResizeStartSize.w;
      let newH = nbResizeStartSize.h;
      let newX = nbResizeStartSize.x;
      let newY = nbResizeStartSize.y;

      if (nbResizing.includes("e")) {
        newW = Math.max(280, nbResizeStartSize.w + deltaX);
      }
      if (nbResizing.includes("s")) {
        newH = Math.max(300, nbResizeStartSize.h + deltaY);
      }
      if (nbResizing.includes("w")) {
        newW = Math.max(280, nbResizeStartSize.w - deltaX);
        if (newW > 280) newX = nbResizeStartSize.x + deltaX;
      }
      if (nbResizing.includes("n")) {
        newH = Math.max(300, nbResizeStartSize.h - deltaY);
        if (newH > 300) newY = nbResizeStartSize.y + deltaY;
      }

      setNbCoords((prev) => {
        return { ...prev, x: newX, y: newY, w: newW, h: newH };
      });
    };
    const handleMouseUp = () => {
      setNbResizing(false);
      try {
        localStorage.setItem(
          "ratipa_notebook_coords",
          JSON.stringify(nbCoordsRef.current),
        );
      } catch (err) {}
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [nbResizing, nbResizeStartSize]);

  // Derived state for dispatchers
  const filterDispatchers = useMemo(() => dispatchersOrder.filter(
    (d) =>
      d &&
      d.trim() !== "Общая" &&
      d.trim() !== "All" &&
      d.trim() !== "Все" &&
      d.trim() !== "Все диспетчеры"
  ), [dispatchersOrder]);
  const activeDispatchers = useMemo(() => {
    return filterDispatchers.length > 0
      ? ["Все диспетчеры", ...filterDispatchers]
      : [];
  }, [filterDispatchers]);

  useEffect(() => {
    if (activeDispatchers.length > 0) {
      if (
        !activeDispatchers.includes(activeDispatcherTab) ||
        activeDispatcherTab === "All"
      ) {
        setActiveDispatcherTab(activeDispatchers[0]);
      }
    }
  }, [dispatchersOrder]);

  const [selectedNotebookUser, setSelectedNotebookUser] = useState<string>(
    user.name,
  );
  const [notebookNotes, setNotebookNotes] = useState<Record<string, string>>(
    {},
  );
  const [notebookStatuses, setNotebookStatuses] = useState<Record<string, "baza" | "reis" | "none">>({});
  const [addCarStatus, setAddCarStatus] = useState<"baza" | "reis" | "none">("none");
  const [notebookOrder, setNotebookOrder] = useState<string[]>([]);
  const [notebookCarInput, setNotebookCarInput] = useState<string>("");

  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isNotebookViewer, setIsNotebookViewer] = useState(false);
  const [highlightedCar, setHighlightedCar] = useState<string | null>(null);

  const [nbrbRates, setNbrbRates] = useState<
    Record<string, { scale: number; rate: number }>
  >({
    BYN: { scale: 1, rate: 1.0 },
    USD: { scale: 1, rate: 3.25 },
    EUR: { scale: 1, rate: 3.5 },
    RUB: { scale: 100, rate: 3.5 },
    KZT: { scale: 1000, rate: 7.2 },
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://api.nbrb.by/exrates/rates?periodicity=0", { signal: controller.signal })
      .then((res) => res.json())
      .then((data: any[]) => {
        const updated: Record<string, { scale: number; rate: number }> = {
          BYN: { scale: 1, rate: 1.0 },
          USD: { scale: 1, rate: 3.25 },
          EUR: { scale: 1, rate: 3.5 },
          RUB: { scale: 100, rate: 3.5 },
          KZT: { scale: 1000, rate: 7.2 },
        };
        const mapping: Record<string, string> = {
          USD: "USD",
          EUR: "EUR",
          RUB: "RUB",
          KZT: "KZT",
          PLN: "PLN",
          GBP: "GBP",
          TRY: "TRY",
          CNY: "CNY",
        };
        data.forEach((item) => {
          if (mapping[item.Cur_Abbreviation]) {
            updated[mapping[item.Cur_Abbreviation]] = {
              scale: item.Cur_Scale,
              rate: item.Cur_OfficialRate,
            };
          }
        });
        setNbrbRates(updated);
      })
      .catch(console.warn);
  }, []);

  function calculateEuroFreight(infoRateRaw: string, currency: string) {
    // Info rate might contain specific exchange rate like "80000 110"
    const parts = (infoRateRaw || "").trim().split(/\s+/);
    const infoRate = parseFloat(parts[0]) || 0;

    // Explicit exchange rate overrules typical NBRB rates
    if (parts.length > 1) {
      const explicitRate = parseFloat(parts[1]) || 0;
      if (explicitRate > 0) {
        if (currency === "RUB" || currency === "KZT") {
          return Math.round(infoRate / explicitRate);
        } else {
          return Math.round(infoRate * explicitRate);
        }
      }
    }

    if (!infoRate || currency === "EUR") return infoRate || 0;
    const rateX = nbrbRates[currency]
      ? nbrbRates[currency].rate / nbrbRates[currency].scale
      : 0;
    const rateEur = nbrbRates["EUR"] ? nbrbRates["EUR"].rate : 1;
    return rateEur > 0 ? Math.round((infoRate * rateX) / rateEur) : 0;
  }

  useEffect(() => {
    if (!isNotebookOpen) return;
    const unsubPermissions = pdService.subscribePermissions(
      user.name,
      (isAdmin, isNotebookViewer) => {
        setIsAdminUser(isAdmin);
        setIsNotebookViewer(isNotebookViewer);
      },
    );
    return () => unsubPermissions();
  }, [user.name, isNotebookOpen]);

  useEffect(() => {
    if (!isNotebookOpen) return;
    const unsubNotebook = pdService.subscribeNotebook(
      selectedNotebookUser,
      (notes, order) => {
        setNotebookNotes(notes || {});
        setNotebookOrder(order || []);
      },
    );
    return () => unsubNotebook();
  }, [selectedNotebookUser, isNotebookOpen]);

  useEffect(() => {
    if (!isNotebookOpen) return;
    const unsubStatuses = pdService.subscribeNotebookStatuses(
      selectedNotebookUser,
      (statuses) => {
        setNotebookStatuses(statuses || {});
      },
    );
    return () => unsubStatuses();
  }, [selectedNotebookUser, isNotebookOpen]);

  const handleNoteChange = (car: string, val: string) => {
    setNotebookNotes((prev) => ({ ...prev, [car]: val }));
    pdService.saveNotebookNote(selectedNotebookUser, car, val);
  };

  const handleAddPresetToNote = (car: string, preset: string) => {
    const currentVal = notebookNotes[car] || "";
    if (currentVal.startsWith(preset) || currentVal.includes(preset)) return;
    const newVal = preset + currentVal;
    handleNoteChange(car, newVal);
  };

  const handleAddCarToNotebook = () => {
    const car = notebookCarInput.trim().toUpperCase();
    if (!car) return;
    pdService.saveNotebookNote(selectedNotebookUser, car, "");
    pdService.saveNotebookStatus(selectedNotebookUser, car, addCarStatus);
    if (!notebookOrder.includes(car)) {
      const newOrder = [...notebookOrder, car];
      pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
    }
    setNotebookCarInput("");
  };

  const handleRemoveCarFromNotebook = (car: string) => {
    pdService.removeNotebookCar(selectedNotebookUser, car);
    const newOrder = notebookOrder.filter((c) => c !== car);
    pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
  };

  const handleAddMyCarsToNotebook = () => {
    const myCars: string[] = [];
    trips.forEach((trip) => {
      if (
        (trip.logist === user.name || trip.dispatcher === user.name) &&
        trip.carNumber
      ) {
        myCars.push(trip.carNumber.trim().toUpperCase());
      }
    });
    const uniqueCars = Array.from(new Set(myCars));
    if (uniqueCars.length === 0) {
      alert("У вас пока нет оформленных машин в текущем журнале.");
      return;
    }

    const newOrder = [...notebookOrder];
    let addedCount = 0;
    uniqueCars.forEach((car) => {
      if (notebookNotes[car] === undefined) {
        pdService.saveNotebookNote(selectedNotebookUser, car, "");
        pdService.saveNotebookStatus(selectedNotebookUser, car, "none");
        if (!newOrder.includes(car)) {
          newOrder.push(car);
        }
        addedCount++;
      }
    });

    if (addedCount === 0) {
      alert("Все ваши машины уже внесены в ваш блокнот.");
    } else {
      pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
      alert(`В блокнот добавлено машин: ${addedCount}`);
    }
  };

  const handleNotebookCarDrop = (e: React.DragEvent, targetCar: string) => {
    const sourceCar = e.dataTransfer.getData("notebookCarId");
    if (!sourceCar || sourceCar === targetCar) return;

    let newOrder = [...notebookOrder];
    if (!newOrder.includes(sourceCar)) newOrder.push(sourceCar);
    if (!newOrder.includes(targetCar)) newOrder.push(targetCar);

    newOrder = newOrder.filter((c) => c !== sourceCar);
    const targetIdx = newOrder.indexOf(targetCar);
    newOrder.splice(targetIdx >= 0 ? targetIdx : newOrder.length, 0, sourceCar);

    setNotebookOrder(newOrder);
    pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
  };

  const renderNotebookWidget = () => {
    if (!isNotebookOpen) {
      return null;
    }

    // All cars that are in order or have notes
    const cars = Array.from(
      new Set([...notebookOrder, ...Object.keys(notebookNotes)]),
    ).filter((car) => notebookNotes[car] !== undefined);

    // Compute status counters
    const countBaza = cars.filter((car) => notebookStatuses[car] === "baza").length;
    const countReis = cars.filter((car) => notebookStatuses[car] === "reis").length;
    const countNone = cars.filter((car) => !notebookStatuses[car] || notebookStatuses[car] === "none").length;

    if (isNbMinimized) {
      return (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => {
              setIsNbMinimized(false);
              localStorage.setItem("ratipa_notebook_minimized", "false");
            }}
            className="bg-amber-500 hover:bg-amber-600 font-sans text-white text-xs font-semibold py-2.5 px-5 rounded-full flex items-center gap-2 shadow-[0_8px_20px_rgba(245,158,11,0.25)] border border-amber-500 transition-all duration-150 transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            <BookOpen size={14} />
            <span>📋 Блокнот ({cars.length})</span>
          </button>
        </div>
      );
    }

    const permittedToSwitch =
      isAdminUser || isNotebookViewer || user.role === "root_admin";
    const notebookUsersList = Array.from(
      new Set([user.name, ...dispatchersOrder.filter((d) => d !== "All")]),
    );

    return (
      <div
        style={{
          position: "fixed",
          left: `${nbCoords.x}px`,
          top: `${nbCoords.y}px`,
          width: `${nbCoords.w}px`,
          height: `${nbCoords.h}px`,
          zIndex: 20000,
        }}
        className="bg-white rounded-[2rem] border border-slate-200 shadow-[0_15px_45px_rgba(0,0,0,0.1)] flex flex-col pointer-events-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header Drag Handle */}
        <div
          onMouseDown={handleNbDragStart}
          className="flex items-center justify-between border-b border-slate-100 p-4 bg-slate-50/80 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2">
            <span className="p-1 px-2.5 bg-amber-500/10 text-amber-600 font-medium text-[10px] rounded-full tracking-wider font-mono">
              Блокнот
            </span>
            <h3 className="text-sm font-semibold text-slate-800 tracking-tight">
              Блокнот по авто
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setIsNbMinimized(true);
                localStorage.setItem("ratipa_notebook_minimized", "true");
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
              title="Свернуть"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsNotebookOpen(false);
                localStorage.setItem("ratipa_notebook_visible", "false");
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
              title="Закрыть"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Inner Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3.5 custom-scrollbar pb-6">
          {/* Switcher selector */}
          {permittedToSwitch ? (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase font-sans">
                Выбор Блокнота
              </label>
              <select
                value={selectedNotebookUser}
                onChange={(e) => setSelectedNotebookUser(e.target.value)}
                className="p-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
              >
                {notebookUsersList.map((u) => (
                  <option key={u} value={u}>
                    {u === user.name ? `Мой блокнот (${u})` : u}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase font-sans">
                Ваш Блокнот
              </label>
              <div className="p-2 bg-slate-50 text-xs font-semibold text-slate-800 rounded-xl border border-slate-200 tracking-wide font-sans">
                📋{" "}
                {selectedNotebookUser === user.name
                  ? `Личный блокнот`
                  : `Блокнот: ${selectedNotebookUser}`}
              </div>
              <div className="grid grid-cols-1 gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => setSelectedNotebookUser(user.name)}
                  className="py-1 px-2 rounded-lg text-[10px] font-semibold tracking-wider transition bg-slate-900 text-white shadow-sm cursor-pointer"
                >
                  Мой
                </button>
              </div>
            </div>
          )}

          <div className="text-[10px] font-medium text-slate-500 text-center bg-blue-500/5 py-1.5 px-2.5 rounded-xl border border-blue-500/10">
            {selectedNotebookUser === user.name
              ? "Редактируется ваш личный блокнот"
              : `Просмотр блокнота: ${selectedNotebookUser}`}
          </div>

          {/* Status counters */}
          <div className="grid grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-xl border border-slate-100 select-none">
            <div className="text-center">
              <div className="text-[10px] text-slate-400 font-semibold tracking-tight">На базе</div>
              <div className="text-sm font-bold text-emerald-600 font-sans">{countBaza}</div>
            </div>
            <div className="text-center border-x border-slate-200/60">
              <div className="text-[10px] text-slate-400 font-semibold tracking-tight">В рейсе</div>
              <div className="text-sm font-bold text-sky-600 font-sans">{countReis}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-400/80 font-semibold tracking-tight">Без ст.</div>
              <div className="text-sm font-bold text-slate-500 font-sans">{countNone}</div>
            </div>
          </div>

          <div className="flex gap-1.5 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={handleAddMyCarsToNotebook}
              className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200/85 text-slate-800 rounded-xl text-[11px] font-semibold tracking-wide transition cursor-pointer text-center"
            >
              Внести свои авто
            </button>
          </div>

          {/* Status selector for adding */}
          <div className="flex flex-col gap-1 border-t border-slate-100 pt-2">
            <span className="text-[9px] font-bold text-slate-400/90 tracking-wider uppercase font-sans">
              Статус для добавления авто
            </span>
            <div className="flex bg-slate-100 p-0.5 rounded-lg text-[10px] font-semibold w-full">
              <button
                type="button"
                onClick={() => setAddCarStatus("baza")}
                className={`flex-1 py-1 text-center rounded-md transition cursor-pointer text-[9px] ${
                  addCarStatus === "baza"
                    ? "bg-emerald-500 text-white shadow-sm font-bold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                На базе
              </button>
              <button
                type="button"
                onClick={() => setAddCarStatus("reis")}
                className={`flex-1 py-1 text-center rounded-md transition cursor-pointer text-[9px] ${
                  addCarStatus === "reis"
                    ? "bg-sky-500 text-white shadow-sm font-bold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                В рейсе
              </button>
              <button
                type="button"
                onClick={() => setAddCarStatus("none")}
                className={`flex-1 py-1 text-center rounded-md transition cursor-pointer text-[9px] ${
                  addCarStatus === "none"
                    ? "bg-white text-slate-800 shadow-sm font-semibold"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Без статуса
              </button>
            </div>
          </div>

          {/* Input adding direct car */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Номер авто"
              list="notebook-vehicles-list"
              value={notebookCarInput}
              onChange={(e) => setNotebookCarInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCarToNotebook();
              }}
              className="flex-1 p-2 bg-white border border-slate-200 text-slate-800 rounded-xl text-xs font-medium outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all placeholder:text-slate-400 uppercase"
            />
            <datalist id="notebook-vehicles-list">
              {savedCars.map((car) => (
                <option key={car} value={car} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={handleAddCarToNotebook}
              className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium flex items-center justify-center rounded-xl transition cursor-pointer text-base leading-none"
            >
              +
            </button>
          </div>

          {/* Cars list */}
          <div className="space-y-2.5 overflow-y-auto pr-1 custom-scrollbar max-h-[calc(100%-250px)] flex-1">
            {cars.map((car) => {
              const valText = notebookNotes[car] || "";
              const isHighlighted = highlightedCar === car;

              return (
                <div
                  key={car}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("notebookCarId", car);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleNotebookCarDrop(e, car)}
                  className={`bg-white border rounded-xl p-2.5 flex flex-col space-y-1.5 transition group relative cursor-move ${isHighlighted ? "border-blue-300 ring-2 ring-blue-500/10 shadow-sm" : "border-slate-200/60 hover:border-slate-300"}`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setHighlightedCar(car === highlightedCar ? null : car);
                        setTimeout(() => {
                          const items = Array.from(
                             document.querySelectorAll(".car-strip-item"),
                          );
                          const matchingItem = items.find((el) =>
                            el.textContent?.includes(car),
                          );
                          if (matchingItem) {
                            matchingItem.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }
                        }, 100);
                      }}
                      className="flex-shrink-0 transition transform hover:scale-[1.01] active:scale-98 cursor-pointer text-left"
                      title="Нажмите, чтобы подсветить рейс"
                    >
                      <div className="px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 tracking-tight select-none">
                        {car}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveCarFromNotebook(car)}
                      className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
                      title="Удалить машину"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Status Selection Pill Group */}
                  <NotebookStatusPills
                    status={notebookStatuses[car]}
                    onChange={(s) => pdService.saveNotebookStatus(selectedNotebookUser, car, s)}
                  />

                  <textarea
                    value={valText}
                    onChange={(e) => handleNoteChange(car, e.target.value)}
                    onMouseUp={(e) => {
                      const el = e.target as HTMLTextAreaElement;
                      if (el.style.height) {
                        localStorage.setItem(
                          `ratipa_nb_height_${user.name}`,
                          el.style.height,
                        );
                      }
                    }}
                    placeholder="Заметка к авто..."
                    style={{
                      height:
                        localStorage.getItem(`ratipa_nb_height_${user.name}`) ||
                        "auto",
                    }}
                    className="w-full p-2 bg-white text-xs border border-slate-200 text-slate-800 rounded-xl focus:outline-none placeholder:text-[10px] font-medium leading-relaxed resize-y focus:border-slate-400 font-sans min-h-[48px] focus:ring-1 focus:ring-slate-400 transition-all"
                  />
                </div>
              );
            })}

            {cars.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs font-mono font-medium tracking-wide bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                Блокнот пуст. Внесите номера авто выше.
              </div>
            )}
          </div>
        </div>

        {/* Resize Handles */}
        {[
          {
            dir: "n",
            cursor: "ns-resize",
            className: "absolute top-0 left-3 right-3 h-2 z-50",
          },
          {
            dir: "s",
            cursor: "ns-resize",
            className: "absolute bottom-0 left-3 right-3 h-2 z-50",
          },
          {
            dir: "w",
            cursor: "ew-resize",
            className: "absolute top-3 bottom-3 left-0 w-2 z-50",
          },
          {
            dir: "e",
            cursor: "ew-resize",
            className: "absolute top-3 bottom-3 right-0 w-2 z-50",
          },
          {
            dir: "nw",
            cursor: "nwse-resize",
            className: "absolute top-0 left-0 w-4 h-4 z-50",
          },
          {
            dir: "ne",
            cursor: "nesw-resize",
            className: "absolute top-0 right-0 w-4 h-4 z-50",
          },
          {
            dir: "sw",
            cursor: "nesw-resize",
            className: "absolute bottom-0 left-0 w-4 h-4 z-50",
          },
          {
            dir: "se",
            cursor: "nwse-resize",
            className:
              "absolute bottom-0 right-0 w-5 h-5 flex items-end justify-end p-1.5 group z-50",
          },
        ].map((handle) => (
          <div
            key={handle.dir}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setNbResizing(handle.dir);
              setNbResizeStartSize({
                x: nbCoords.x,
                y: nbCoords.y,
                w: nbCoords.w,
                h: nbCoords.h,
                mouseX: e.clientX,
                mouseY: e.clientY,
              });
            }}
            className={handle.className}
            style={{ cursor: handle.cursor }}
            title={handle.dir === "se" ? "Растянуть блокнот" : ""}
          >
            {handle.dir === "se" && (
              <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-slate-400 group-hover:border-slate-700 transition-colors pointer-events-none" />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Form State
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [searchCarQuery, setSearchCarQuery] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [direction, setDirection] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [extraExpense, setExtraExpense] = useState<number>(0);
  const [extraExpenseNote, setExtraExpenseNote] = useState("");
  
  const [ferryCost, setFerryCost] = useState(0);
  const [referenceRate, setReferenceRate] = useState<number | undefined>(
    undefined,
  );
  const [referenceCurrency, setReferenceCurrency] = useState<
    "EUR" | "USD" | "RUB" | "BYN"
  >("EUR");
  const [tripNote, setTripNote] = useState("");
  const [stripColor, setStripColor] = useState("bg-blue-500");
  const [factKm, setFactKm] = useState<number | undefined>(undefined);
  const [dispatcher, setDispatcher] = useState("");
  const [currentMonth, setCurrentMonth] = useState("");

  const [activeLegIndex, setActiveLegIndex] = useState<number | undefined>(
    undefined,
  );
  const [legs, setLegs] = useState<LegPlan[]>([
    {
      from: "",
      to: "",
      km: 0,
      rate: 0,
      referenceRate: "",
      ferry: 0,
      coeff: 0,
    },
  ]);
  const [potentialLoads, setPotentialLoads] = useState<PotentialLoad[]>([]);

  // Map Route Modal States
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [mapLegIndex, setMapLegIndex] = useState<number | null>(null);
  const [mapOrigin, setMapOrigin] = useState("");
  const [mapDestination, setMapDestination] = useState("");
  const [mapKmResult, setMapKmResult] = useState<number>(0);
  const [mapIsCheckingPl, setMapIsCheckingPl] = useState(false);
  const [saveToDirectoryChecked, setSaveToDirectoryChecked] = useState(false);
  const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<"google" | "yandex">("google");

  const mapLeg = useMemo(() => {
    if (mapLegIndex === null) return null;
    return {
      from: mapOrigin,
      origin: mapOrigin,
      to: mapDestination,
      destination: mapDestination,
      waypoints: mapWaypoints,
      mapProvider: currentProvider,
      totalDistanceKm: mapKmResult,
      dist: mapKmResult,
      distance: mapKmResult,
    };
  }, [mapLegIndex, mapOrigin, mapDestination, mapWaypoints, currentProvider, mapKmResult]);

  // Potential Load Form States
  const [plEditingId, setPlEditingId] = useState<string | null>(null);
  const [plName, setPlName] = useState("");
  const [plLegs, setPlLegs] = useState<LegPlan[]>([
    { from: "", to: "", km: 0, rate: 0, referenceRate: "", ferry: 0, coeff: 0 },
  ]);
  const [plFerryCost, setPlFerryCost] = useState(0);
  const [plExtraExpense, setPlExtraExpense] = useState(0);
  const [plExtraExpenseNote, setPlExtraExpenseNote] = useState("");
  const [plReferenceRate, setPlReferenceRate] = useState<number | undefined>(
    undefined,
  );
  const [plReferenceCurrency, setPlReferenceCurrency] = useState("EUR");

  const getDispatcherColor = (disp: string) => {
    const colorKey = dispatchersColors[disp];
    if (!colorKey) {
      const idx = dispatchersOrder.indexOf(disp);
      if (idx === -1) return "bg-white border-slate-200/80";
      const legacyBgs = [
        "bg-[#F8FAFC] border-slate-200",
        "bg-[#EFF6FF] border-blue-200",
        "bg-[#ECFDF5] border-emerald-200",
        "bg-[#FFFBEB] border-amber-200",
        "bg-[#FAF5FF] border-[#e9d5ff]",
        "bg-[#FFF1F2] border-rose-200",
        "bg-[#F0FDFA] border-[#a5f3fc]",
        "bg-[#F5F3FF] border-[#c084fc]",
      ];
      return legacyBgs[idx % legacyBgs.length] || "bg-white border-slate-200";
    }
    const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
    return preset ? `${preset.bg}` : "bg-white border-slate-200/80";
  };

  const getDispatcherActiveTabStyle = (d: string) => {
    if (activeDispatcherTab !== d)
      return "bg-slate-50 text-slate-500 hover:bg-slate-100";
    if (d === "All" || d === "Все диспетчеры")
      return "bg-slate-900 text-white shadow-xs border-slate-900 font-semibold";

    const colorKey = dispatchersColors[d];
    const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
    if (preset) {
      return `${preset.bg} ${preset.darkText} border-b-2 border-slate-500`;
    }
    return "bg-blue-100 text-[#1e40af] border-b-2 border-blue-500";
  };

  const getActiveLegRowBg = (idx: number) => {
    if (activeLegIndex !== idx) return "";
    if (!dispatcher) return "bg-blue-500/10";

    const colorKey = dispatchersColors[dispatcher];
    if (!colorKey) return "bg-blue-500/10";

    const highlightBgs: Record<string, string> = {
      blue: "bg-blue-500/10",
      emerald: "bg-emerald-500/10",
      purple: "bg-purple-500/10",
      amber: "bg-amber-500/10",
      rose: "bg-rose-500/10",
      indigo: "bg-indigo-500/10",
      teal: "bg-teal-500/10",
      orange: "bg-orange-500/10",
      slate: "bg-slate-500/10",
      yellow: "bg-yellow-500/10",
    };
    return highlightBgs[colorKey] || "bg-blue-500/10";
  };

  const handleDirChange = (val: string) => {
    setDirection(val);
    const c = directions[val] || 0;
    setLegs(legs.map((l) => ({ ...l, coeff: c })));
  };

  const checkLegDistance = (idx: number, isPotentialList: boolean = false) => {
    const list = isPotentialList ? plLegs : legs;
    const leg = list[idx];
    if (leg.from && leg.to) {
      if (settings.useDistanceLookup) {
        const d = findDistance(leg.from, leg.to);
        if (d !== null && leg.km === 0) {
          if (isPotentialList) {
            const nl = [...plLegs];
            nl[idx].km = d;
            setPlLegs(nl);
          } else {
            updateLeg(idx, { km: d });
          }
        }
      }
    }
  };

  const openMapRouteModal = (
    idx: number,
    origin: string,
    destination: string,
    isPl: boolean,
  ) => {
    const sourceLegs = isPl ? plLegs : legs;
    const leg = sourceLegs[idx];

    setMapLegIndex(idx);
    setMapOrigin(origin || "");
    setMapDestination(destination || "");
    setMapKmResult(leg?.km || 0);
    setMapWaypoints(leg?.waypoints || []);
    setCurrentProvider(leg?.mapProvider || "google");
    setMapIsCheckingPl(isPl);
    setMapModalOpen(true);
  };

  const applyMapRoute = useCallback(() => {
    if (mapLegIndex !== null) {
      const cleanOrigin = mapOrigin.trim();
      const cleanDestination = mapDestination.trim();
      const cleanWaypoints = mapWaypoints.map(wp => wp.trim()).filter(wp => wp !== "");

      if (mapIsCheckingPl) {
        const nl = [...plLegs];
        nl[mapLegIndex].km = mapKmResult;
        nl[mapLegIndex].from = cleanOrigin;
        nl[mapLegIndex].to = cleanDestination;
        nl[mapLegIndex].waypoints = cleanWaypoints;
        nl[mapLegIndex].mapProvider = currentProvider;
        setPlLegs(nl);
      } else {
        updateLeg(mapLegIndex, {
          km: mapKmResult,
          from: cleanOrigin,
          to: cleanDestination,
          waypoints: cleanWaypoints,
          mapProvider: currentProvider,
        });
      }

      if (saveToDirectoryChecked) {
        dbService.saveDistance(
          {
            id: "dist_" + Date.now(),
            from: cleanOrigin,
            to: cleanDestination,
            distance: mapKmResult,
          },
          user.name,
          user.role,
        );
      }
    }
    setMapModalOpen(false);
    setSaveToDirectoryChecked(false);
  }, [mapLegIndex, mapOrigin, mapDestination, mapWaypoints, mapIsCheckingPl, plLegs, mapKmResult, currentProvider, saveToDirectoryChecked, user.name, user.role, updateLeg]);

  const handleUpdateLegRoute = useCallback((idx: number, updatedFields: any) => {
    if (updatedFields.from !== undefined) setMapOrigin(updatedFields.from);
    if (updatedFields.to !== undefined) setMapDestination(updatedFields.to);
    if (updatedFields.waypoints !== undefined) setMapWaypoints(updatedFields.waypoints);
    if (updatedFields.mapProvider !== undefined) setCurrentProvider(updatedFields.mapProvider);
    if (updatedFields.totalDistanceKm !== undefined) setMapKmResult(updatedFields.totalDistanceKm);
  }, []);

  const handleCloseMapModal = useCallback(() => setMapModalOpen(false), []);
  const handleApplyMapRoute = useCallback(() => applyMapRoute(), [applyMapRoute]);

  const addLeg = (idx: number) => {
    const newLegs = [...legs];
    newLegs.splice(idx + 1, 0, {
      from: "",
      to: "",
      km: 0,
      rate: 0,
      referenceRate: "",
      ferry: 0,
      coeff: directions[direction] || 0,
    });
    setLegs(newLegs);
  };

  const removeLeg = (idx: number) => {
    if (legs.length <= 1) return;
    setLegs(legs.filter((_, i) => i !== idx));
    if (activeLegIndex === idx) setActiveLegIndex(undefined);
  };

  function updateLeg(index: number, updatedFields: Partial<LegPlan>) {
    setLegs(prevLegs => 
      prevLegs.map((l, i) => {
        if (i === index) {
          const merged = { ...l, ...updatedFields };
          if (
            settings.useDistanceLookup &&
            (updatedFields.from !== undefined || updatedFields.to !== undefined)
          ) {
            const matchedDist = findDistance(merged.from || "", merged.to || "");
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.km === "undefined"
            ) {
              merged.km = matchedDist;
            }
          }

          // Auto convert infoRate -> rate
          if (
            updatedFields.referenceRate !== undefined ||
            updatedFields.referenceCurrency !== undefined
          ) {
            const newCurrency = merged.referenceCurrency || "EUR";
            const newFreight = calculateEuroFreight(
              merged.referenceRate || "",
              newCurrency,
            );
            if (newFreight > 0) {
              merged.rate = newFreight;
            }
          }

          return merged;
        }
        return l;
      })
    );
  }

  function findDistance(c1: string, c2: string) {
    if (!c1 || !c2) return null;
    const from = c1.trim().toLowerCase();
    const to = c2.trim().toLowerCase();
    const found = distances.find((d) => {
      const a = (d.from || "").trim().toLowerCase();
      const b = (d.to || "").trim().toLowerCase();
      return (a === from && b === to) || (a === to && b === from);
    });
    return found ? found.distance : null;
  }

  const getTripDays = () => {
    if (!dateStart || !dateEnd) return 1;
    const s = new Date(dateStart).getTime();
    const e = new Date(dateEnd).getTime();
    if (e >= s) {
      return Math.ceil((e - s) / (1000 * 3600 * 24)) + 1;
    }
    return 1;
  };

  const calculateTotals = () => {
    const fin = calculateTripFinances(legs, dateStart, dateEnd, Number(extraExpense), Number(ferryCost), Number(factKm));
    return {
      days: fin.days,
      daysPlan: fin.daysPlan,
      daysFact: fin.daysFact,
      totalKm: fin.totalKm,
      totalFreight: fin.totalFreight,
      totalExpensesPlan: fin.totalExpensesPlan,
      totalExpenses: fin.totalExpensesFact,
      profit: fin.profitPlan,
      profitFact: fin.profitFact,
      profitPerDay: fin.profitPerDay,
      profitPerDayPlan: fin.planProfitPerDay
    };
  };

  const resetForm = () => {
    setEditingTripId(null);
    setCarNumber("");
    const defaultDir = Object.keys(directions)[0] || "";
    setDirection(defaultDir);
    setDateStart("");
    setDateEnd("");
    setExtraExpense(0);
    setExtraExpenseNote("");
    
    setFerryCost(0);
    setReferenceRate(undefined);
    setReferenceCurrency("EUR");
    setTripNote("");
    setStripColor("bg-blue-500");
    setFactKm(undefined);
    setDispatcher(
      activeDispatcherTab !== "All" ? activeDispatcherTab : user.name,
    );
    setCurrentMonth("");
    setActiveLegIndex(undefined);
    const defaultLegs = [
      {
        from: "",
        to: "",
        km: 0,
        rate: 0,
        referenceRate: "",
        ferry: 0,
        coeff: directions[defaultDir] || 0,
      },
    ];
    setLegs(defaultLegs);
    setPlLegs(defaultLegs.map((l) => ({ ...l })));
    setPotentialLoads([]);
    setPlEditingId(null);
    setPlName("");
    setModalTab("main");
  };


  const parseSmartNumber = (val: string | undefined): number => {
    if (!val) return 0;
    return parseFloat(val.replace(/\s/g, "").replace(",", ".")) || 0;
  };


  const loadTripToForm = useCallback((trip: TripPlan) => {
    setEditingTripId(trip.id);
    setCarNumber(trip.carNumber || "");
    setDirection(trip.direction || "");
    setDateStart(trip.dateStart || "");
    setDateEnd(trip.dateEnd || "");
    setExtraExpense(trip.extraExpense || 0);
    setExtraExpenseNote(trip.extraExpenseNote || "");
    
    setFerryCost(trip.ferryCost || 0);
    setReferenceRate(trip.referenceRate);
    setReferenceCurrency(trip.referenceCurrency || "EUR");
    setTripNote(trip.tripNote || "");
    setStripColor(trip.stripColor || "bg-blue-500");
    setFactKm(trip.factKm || undefined);
    setDispatcher(trip.dispatcher || "");
    setCurrentMonth(trip.currentMonth || "");
    setActiveLegIndex(
      trip.activeLegIndex !== undefined ? trip.activeLegIndex : undefined,
    );
    setPotentialLoads(trip.potentialLoads || []);
    if (trip.legs && trip.legs.length > 0) {
      setLegs(trip.legs);
      setPlLegs(trip.legs.map((l) => ({ ...l })));
    } else {
      const initialLegs = [
        {
          from: "",
          to: "",
          km: 0,
          rate: 0,
          referenceRate: "",
          ferry: 0,
          coeff: directions[trip.direction] || 0,
        },
      ];
      setLegs(initialLegs);
      setPlLegs(initialLegs.map((l) => ({ ...l })));
    }
    setPlEditingId(null);
    setPlName("");
    setIsModalOpen(true);
  }, [directions]);

  const parseAiRouteClient = (
    raw: string,
    defaultDir: string,
    directionsMap: Record<string, number>,
  ): LegPlan[] => {
    const chunks = raw
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedRows = chunks
      .map((line) => {
        let from = "";
        let to = "";
        const routePatterns = [
          /(?:из|от)\s+([а-яёa-z\s.-]+?)\s+(?:в|на|до|—|->|→|-)\s+([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s*(?:—|->|→|-)\s*([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s+(?:в|на|до)\s+([а-яёa-z\s.-]+)/i,
        ];
        for (const pattern of routePatterns) {
          const match = line.match(pattern);
          if (match) {
            from = match[1]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            to = match[2]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            break;
          }
        }
        const rateMatch = line.match(
          /(?:ставка|фрахт|цена)?\D*?(\d[\d\s.,]*)\s*(?:€|евро|eur)\b/i,
        );
        const kmMatch = line.match(/(\d[\d\s.,]*)\s*(?:км|km)\b/i);
        const ferryMatch = line.match(/(?:паром|переправа)\D*?(\d[\d\s.,]*)/i);
        const coeffMatch = line.match(
          /(?:коэф|коэффициент)\D*?(\d+(?:[.,]\d+)?)/i,
        );

        return {
          from,
          to,
          km: kmMatch ? parseSmartNumber(kmMatch[1]) : 0,
          rate: rateMatch ? parseSmartNumber(rateMatch[1]) : 0,
          ferry: ferryMatch ? parseSmartNumber(ferryMatch[1]) : 0,
          coeff: coeffMatch
            ? parseSmartNumber(coeffMatch[1])
            : directionsMap[defaultDir] || 0,
          referenceRate: "",
        };
      })
      .filter((r) => r.from !== "" || r.to !== "" || r.km > 0 || r.rate > 0);
    return parsedRows;
  };


  const calculatePlTotals = () => {
    const fin = calculateTripFinances(plLegs, "", "", Number(plExtraExpense), Number(plFerryCost), 0);
    return { totalKm: fin.totalKm, totalFreight: fin.totalFreight, totalExpenses: fin.totalExpensesPlan, profit: fin.profitPlan };
  };

  const savePotentialLoad = () => {
    if (!plName.trim()) {
      alert("Укажите название просчета");
      return;
    }
    if (potentialLoads.length >= 3 && !plEditingId) {
      alert("Можно сохранить максимум 3 просчета");
      return;
    }

    const totals = calculatePlTotals();
    const newPl: PotentialLoad = {
      id: plEditingId || "pl_" + Date.now(),
      name: plName.trim(),
      legs: plLegs,
      totalKm: totals.totalKm,
      totalFreight: totals.totalFreight,
      totalExpenses: totals.totalExpenses,
      ferryCost: plFerryCost,
      extraExpense: plExtraExpense,
      extraExpenseNote: plExtraExpenseNote,
      referenceRate: plReferenceRate,
      referenceCurrency: plReferenceCurrency,
      profit: totals.profit,
      profitFact: totals.profit,
    };

    if (plEditingId) {
      setPotentialLoads(
        potentialLoads.map((p) => (p.id === plEditingId ? newPl : p)),
      );
    } else {
      setPotentialLoads([...potentialLoads, newPl]);
    }

    // Reset PL form, but copy current legs and reference rates
    setPlEditingId(null);
    setPlName("");
    setPlLegs(legs.map((l) => ({ ...l }))); // Deep copy to prevent reference mutation
    setPlFerryCost(0);
    setPlExtraExpense(0);
    setPlExtraExpenseNote("");
    setPlReferenceRate(undefined);
    setPlReferenceCurrency("EUR");
  };

  const editPotentialLoad = (pl: PotentialLoad) => {
    setPlEditingId(pl.id);
    setPlName(pl.name);
    setPlLegs(pl.legs);
    setPlFerryCost(pl.ferryCost);
    setPlExtraExpense(pl.extraExpense);
    setPlExtraExpenseNote(pl.extraExpenseNote);
    setPlReferenceRate(pl.referenceRate);
    setPlReferenceCurrency(pl.referenceCurrency || "EUR");
  };

  const deletePotentialLoad = (id: string) => {
    if (confirm("Удалить просчет?")) {
      setPotentialLoads(potentialLoads.filter((p) => p.id !== id));
      if (plEditingId === id) {
        // Stop editing if deleted
        setPlEditingId(null);
        setPlName("");
        setPlLegs([
          {
            from: "",
            to: "",
            km: 0,
            rate: 0,
            referenceRate: "",
            ferry: 0,
            coeff: 0,
          },
        ]);
      }
    }
  };

  const applyPlToMain = (pl: PotentialLoad) => {
    if (
      confirm(
        "Осторожно: Это заменит текущие плечи в основной форме. Продолжить?",
      )
    ) {
      setLegs(pl.legs);
      setFerryCost(pl.ferryCost);
      setExtraExpense(pl.extraExpense);
      setExtraExpenseNote(pl.extraExpenseNote);
      if (pl.referenceRate !== undefined) setReferenceRate(pl.referenceRate);
      if (pl.referenceCurrency)
        setReferenceCurrency(pl.referenceCurrency as any);
      setModalTab("main");
    }
  };

  const saveTrip = async () => {
    if (isSubmitting) return;
    const trimmedCar = carNumber.trim().toUpperCase();
    if (!trimmedCar) {
      addToast("Укажите номер автомобиля", "error");
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (!savedCars.includes(trimmedCar)) {
        dbService.saveVehicle({ id: trimmedCar, carNumber: trimmedCar } as any, user.name, user.role);
      }

      const totals = calculateTotals();
      const tripObj: TripPlan = {
        driverName: undefined,
        id: editingTripId || "",
        carNumber: trimmedCar,
        logist: user.name,
        direction,
        dateStart,
        dateEnd,
        days: totals.days,
        totalKm: totals.totalKm,
        totalFreight: totals.totalFreight,
        totalExpenses: totals.totalExpenses,
        extraExpense: Number(extraExpense || 0),
        extraExpenseNote,
        ferryCost: Number(ferryCost || 0),
        referenceRate,
        referenceCurrency,
        profit: totals.profit,
        factKm: Number(factKm || 0),
        profitFact: totals.profitFact,
        tripNote,
        stripColor: stripColor || "bg-blue-500",
        legs,
        potentialLoads,
        activeLegIndex: activeLegIndex !== undefined ? activeLegIndex : -1,
        dispatcher: dispatcher || carDispatcherMapping[trimmedCar] || user.name,
        currentMonth,
        isArchived: editingTripId
          ? trips.find((t) => t.id === editingTripId)?.isArchived || false
          : false,
      };

      if (editingTripId) {
        await pdService.updateTrip(editingTripId, tripObj, user.name, user.role);
        addToast("План рейса обновлен", "success");
      } else {
        await pdService.createTrip(tripObj, user.name, user.role);
        addToast("План рейса создан", "success");
      }

      const finalDispatcher = dispatcher || user.name;
      if (
        trimmedCar &&
        finalDispatcher &&
        finalDispatcher !== "Все диспетчеры" &&
        finalDispatcher !== "Общая" &&
        finalDispatcher !== "All" &&
        finalDispatcher !== "Все"
      ) {
        const updatedMapping = {
          ...carDispatcherMapping,
          [trimmedCar]: finalDispatcher,
        };
        pdService.updateDispatchersCarMapping(updatedMapping);
      }

      resetForm();
      setIsModalOpen(false);
    } catch (error: any) {
      console.error("Save error:", error);
      addToast("Ошибка при сохранении: " + (error.message || "Unknown error"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const finishTripToArchive = useCallback((trip: TripPlan, isModal: boolean = false) => {
    let month = "";
    if (trip.dateEnd) {
      const date = new Date(trip.dateEnd);
      if (!isNaN(date.getTime())) {
        const raw = date.toLocaleString("ru-RU", { month: "long", year: "numeric" });
        let formatted = raw.replace(/\s*г\.?$/, "");
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        month = formatted;
      }
    }
    if (!month) {
      const fallbackMonth = trip.currentMonth || new Date().toLocaleString("ru-RU", { month: "long", year: "numeric" });
      let formatted = fallbackMonth.replace(/\s*г\.?$/, "");
      formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
      month = formatted;
    }
    pdService.archiveTrip(trip.id, month, user.name, user.role);
    if (isModal) setIsModalOpen(false);
  }, [user.name, user.role]);

  const deleteTrip = async (id: string, isModal: boolean = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await pdService.deleteTrip(id, user.name, user.role);
      addToast("План рейса удален", "info");
      if (isModal) setIsModalOpen(false);
    } catch (error: any) {
      console.error("Delete error:", error);
      addToast("Ошибка при удалении", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const {
    totalKm,
    totalFreight,
    totalExpenses,
    totalExpensesPlan,
    profit,
    profitFact,
    profitPerDay: rawProfitPerDay,
    profitPerDayPlan: rawProfitPerDayPlan,
    daysPlan,
    daysFact,
  } = calculateTotals();

  const renderCurrentFormModal = () => {
    if (!isModalOpen) return null;
    const isEditing = !!editingTripId;
    const currentEditingTrip = isEditing
      ? trips.find((t) => t.id === editingTripId)
      : null;


    const profitPerDay = Math.round(rawProfitPerDay);
    const profitPerDayPlan = Math.round(rawProfitPerDayPlan);

    return (
      <div className="fixed inset-0 z-[100] flex items-start md:items-center justify-center p-2 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl w-full max-w-full sm:max-w-[1400px] mx-2 sm:mx-4 shadow-2xl overflow-visible flex flex-col relative max-h-none">
          
          {/* Header */}
          <div className="bg-white px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row md:items-center justify-between sticky top-0 z-10 border-b border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <Calculator className="w-5 h-5 text-slate-400" />
                <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
                  {editingTripId ? "Редактирование плана" : "Новый план"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-500 ml-0 mt-1.5 gap-y-1">
                <span className="text-blue-600 font-semibold">Авто: {carNumber || "—"}</span>
                <span>Направление: {direction || "—"}</span>
                <span>Диспетчер: {dispatcher || "—"}</span>
                <span>Сроки: {dateStart ? new Date(dateStart).toLocaleDateString('ru-RU') : "—"} — {dateEnd ? new Date(dateEnd).toLocaleDateString('ru-RU') : "—"}</span>
              </div>
            </div>

            <div className="flex items-center gap-6 mt-4 md:mt-0">
              <div className="flex bg-slate-100 rounded-full p-1 gap-1 border border-slate-200/50">
                <button
                  type="button"
                  onClick={() => setModalTab("main")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${modalTab === "main" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Форма
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("potential")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${modalTab === "potential" ? "bg-white shadow-sm text-purple-700" : "text-slate-500 hover:text-slate-800"}`}
                >
                  Потенциал. грузы
                  {potentialLoads.length > 0 && (
                    <span className="ml-1.5 bg-purple-500 text-white rounded-full px-1.5 py-0.5 text-[8px] font-bold">
                      {potentialLoads.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 md:overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 space-y-6">
            {modalTab === "main" ? (
              <>
                <div className="grid grid-cols-1 gap-6">
                  {/* Основные реквизиты */}
                  <div className="bg-white/50 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 flex flex-col">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-5">
                      <FileText className="w-4 h-4 text-slate-400"/>
                      Основные реквизиты
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Автомобиль</label>
                        <CouplingPicker
                          onSelect={(rec) => {
                            if (rec) handleCarNumberChange(formatCoupling((rec.carNumber || rec.vehicleNumbers || '').toUpperCase()));
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Направление</label>
                        <select
                          value={direction}
                          onChange={(e) => handleDirChange(e.target.value)}
                          className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all appearance-none min-h-[44px]"
                        >
                          {Object.keys(directions).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Диспетчер</label>
                        <select
                          value={dispatcher}
                          onChange={(e) => setDispatcher(e.target.value)}
                          className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all appearance-none min-h-[44px]"
                        >
                          <option value="">Не выбран</option>
                          {dispatchers.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 mb-1.5 block">Дата старта</label>
                        <input
                          type="date"
                          value={dateStart}
                          onChange={(e) => setDateStart(e.target.value)}
                          className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Дата финиша</label>
                        <input
                          type="date"
                          value={dateEnd}
                          onChange={(e) => setDateEnd(e.target.value)}
                          className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all min-h-[44px]"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Плечи маршрута */}
                <div className="bg-white rounded-2xl p-6 border border-slate-100">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-400"/>
                      Плечи маршрута
                    </h3>
                    <span className="text-[11px] text-slate-400 hover:text-slate-600 transition font-medium cursor-pointer">Маршрутная сетка</span>
                  </div>

                  

                  <div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">
                    <table className="w-full w-full flex-wrap border-collapse relative">
                      <thead>
                        <tr>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center w-12">Акт.</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left w-8">#</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Откуда</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Куда</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Км</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Доезд (км)</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Фрахт €</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Инфо ставка (Доп)</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Паром € (Доп)</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-left">Коэфф.</th>
                          <th className="pb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="space-y-2">
                        {legs.map((leg, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setActiveLegIndex(idx === activeLegIndex ? undefined : idx)}
                                className={`w-5 h-5 rounded flex items-center justify-center border transition mx-auto cursor-pointer ${activeLegIndex === idx ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-300 text-transparent"}`}
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="py-1.5 text-xs font-semibold text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-1.5 pr-2">
                              <input
                                list="cities-db-pl"
                                value={leg.from}
                                onChange={(e) => updateLeg(idx, { from: e.target.value })}
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full text-left px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                list="cities-db-pl"
                                value={leg.to}
                                onChange={(e) => updateLeg(idx, { to: e.target.value })}
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full text-left px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2 relative">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.km || ""}
                                onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                                className="w-full text-left pl-3 pr-8 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                              <button
                                type="button"
                                onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.emptyRunKm || ""}
                                onChange={(e) => updateLeg(idx, { emptyRunKm: Number(e.target.value) })}
                                className="w-full text-left px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.rate || ""}
                                onChange={(e) => updateLeg(idx, { rate: Number(e.target.value) })}
                                className="w-full text-left px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <div className="flex bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg overflow-hidden focus-within:bg-white focus-within:border-slate-400 transition">
                                <input
                                  type="text"
                                  value={leg.referenceRate || ""}
                                  onChange={(e) => updateLeg(idx, { referenceRate: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-transparent text-xs font-medium outline-none"
                                />
                                <select
                                  value={leg.referenceCurrency || ""}
                                  onChange={(e) => updateLeg(idx, { referenceCurrency: e.target.value })}
                                  className="bg-transparent border-l border-slate-200 text-slate-500 text-[10px] font-semibold outline-none px-1 cursor-pointer"
                                >
                                  <option value=""></option>
                                  {currencies.map((c) => (
                                    <option key={c.id} value={c.code}>{c.code}</option>
                                  ))}
                                </select>
                              </div>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.ferry || ""}
                                onChange={(e) => updateLeg(idx, { ferry: Number(e.target.value) })}
                                className="w-full text-left px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                step="0.01"
                                value={leg.coeff}
                                onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                                className="w-full px-3 py-1.5 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 transition"
                              />
                            </td>
                            <td className="py-1.5 text-right whitespace-nowrap space-x-1">
                              <button
                                type="button"
                                onClick={() => addLeg(idx)}
                                className="w-6 h-6 inline-flex items-center justify-center text-slate-400 hover:text-slate-800 transition"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLeg(idx)}
                                disabled={legs.length <= 1}
                                className="w-6 h-6 inline-flex items-center justify-center text-slate-400 hover:text-rose-500 transition disabled:opacity-30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View for Legs */}
                  <div className="block lg:hidden space-y-4 pr-1 pb-4">
                    {legs.map((leg, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-4 relative shadow-sm">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-md">#{idx + 1}</span>
                            <button
                              type="button"
                              onClick={() => setActiveLegIndex(idx === activeLegIndex ? undefined : idx)}
                              className={`w-6 h-6 rounded flex items-center justify-center border transition cursor-pointer ${activeLegIndex === idx ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-300 text-transparent"}`}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => addLeg(idx)}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeLeg(idx)}
                              disabled={legs.length <= 1}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Откуда</span>
                            <input
                              list="cities-db-pl"
                              value={leg.from}
                              onChange={(e) => updateLeg(idx, { from: e.target.value })}
                              onBlur={() => checkLegDistance(idx)}
                              className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Куда</span>
                            <input
                              list="cities-db-pl"
                              value={leg.to}
                              onChange={(e) => updateLeg(idx, { to: e.target.value })}
                              onBlur={() => checkLegDistance(idx)}
                              className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[10px] uppercase font-black text-slate-400">Км</span>
                            <input
                              type="number"
                              value={leg.km || ""}
                              onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                              className="w-full pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                              className="absolute right-2 bottom-1.5 text-slate-400 hover:text-slate-600 p-1"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[10px] uppercase font-black text-slate-400">Доезд (км)</span>
                            <input
                              type="number"
                              value={leg.emptyRun || ""}
                              onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                              className="w-full pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, true)}
                              className="absolute right-2 bottom-1.5 text-slate-400 hover:text-slate-600 p-1"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Фрахт</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.freight || ""}
                                onChange={(e) => updateLeg(idx, { freight: Number(e.target.value) })}
                                className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                              />
                              <select
                                value={leg.freightCurrency}
                                onChange={(e) => updateLeg(idx, { freightCurrency: e.target.value })}
                                className="w-16 px-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold"
                              >
                                {currencies.map((c) => (
                                  <option key={c.id} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Инфо ставка</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.infoRate || ""}
                                onChange={(e) => updateLeg(idx, { infoRate: Number(e.target.value) })}
                                className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                              />
                              <select
                                value={leg.infoRateCurrency || "EUR"}
                                onChange={(e) => updateLeg(idx, { infoCurrency: e.target.value })}
                                className="w-16 px-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold"
                              >
                                <option value=""></option>
                                {currencies.map((c) => (
                                  <option key={c.id} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Паром €</span>
                            <input
                              type="number"
                              value={leg.ferry || ""}
                              onChange={(e) => updateLeg(idx, { ferry: Number(e.target.value) })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Коэфф.</span>
                            <input
                              type="number"
                              step="0.01"
                              value={leg.coeff}
                              onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                            />
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>

                  <datalist id="cities-db-pl">
                    {Array.from(new Set(distances.flatMap((d) => [d.from, d.to]))).map((c) => c && <option key={c} value={c} />)}
                  </datalist>
                </div>

                {/* Financial Params & Comment */}
                <div className="bg-white rounded-2xl p-6 border border-slate-100 flex flex-col gap-6">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-5">
                      <CircleDollarSign className="w-4 h-4 text-slate-400"/>
                      Финансовые параметры
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Доп расходы €</label>
                        <input
                          type="number"
                          value={extraExpense || ""}
                          onChange={(e) => setExtraExpense(Number(e.target.value))}
                          className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Коммент расходов</label>
                        <input
                          type="text"
                          value={extraExpenseNote}
                          onChange={(e) => setExtraExpenseNote(e.target.value)}
                          className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Факт км</label>
                        <input
                          type="number"
                          placeholder="Введите факт км"
                          value={factKm || ""}
                          onChange={(e) => setFactKm(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-sm font-medium font-mono tabular-nums outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 block">Цвет плашки рейса</label>
                        <div className="flex gap-2">
                          {[
                            "bg-slate-200",
                            "bg-blue-300",
                            "bg-blue-500",
                            "bg-[#70FC8E]",
                            "bg-amber-300",
                            "bg-rose-300",
                            "bg-purple-500",
                            "bg-slate-800",
                          ].map((cc) => (
                            <button
                              type="button"
                              key={cc}
                              onClick={() => setStripColor(cc)}
                              className={`w-6 h-6 rounded-full border-2 ${stripColor === cc ? "border-slate-800 scale-110" : "border-transparent"} ${cc} transition`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-6">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
                      <MessageSquare className="w-4 h-4 text-slate-400"/>
                      Комментарий к рейсу
                    </h3>
                    <input
                      type="text"
                      value={tripNote}
                      onChange={(e) => setTripNote(e.target.value)}
                      placeholder="Введите дополнительные примечания к рейсу..."
                      className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                    />
                  </div>
                </div>


              </>
            ) : modalTab === "potential" ? (

              <div className="bg-slate-50 border border-slate-200/50 rounded-[2rem] p-6 lg:p-8 flex flex-col xl:flex-row gap-6 min-h-[500px]">
                {/* Left side: List of saved Potential Loads */}
                <div className="flex-1 w-full xl:w-1/3 xl:max-w-[400px] bg-white rounded-2xl p-5 border border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col gap-4">
                  <h3 className="text-sm font-semibold text-purple-700 tracking-tight border-b border-slate-100 pb-3 flex items-center justify-between">
                    <span>Сохраненные просчеты</span>
                    <span className="text-xs bg-purple-50 text-purple-700 font-mono font-semibold px-2 py-0.5 rounded-full">{potentialLoads.length}/3</span>
                  </h3>

                  <div className="space-y-3.5 overflow-y-auto max-h-[380px] pr-1.5 custom-scrollbar">
                    {potentialLoads.map((pl) => {
                      const days = pl.totalKm
                        ? Math.max(1, Math.round(pl.totalKm / 500))
                        : 1;
                      const profitPerDay = Math.round(pl.profit / days);
                      return (
                        <div
                          key={pl.id}
                          className={`p-3.5 rounded-2xl border ${plEditingId === pl.id ? "border-purple-400 bg-purple-50/30 shadow-sm" : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"} transition cursor-pointer flex flex-col gap-2.5 relative`}
                          onClick={() => editPotentialLoad(pl)}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-xs text-slate-800 tracking-tight truncate max-w-[170px]">
                              {pl.name}
                            </span>
                            <div
                              className="flex gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="p-1.5 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/80 rounded-lg transition"
                                title="Перенести в основную форму"
                                onClick={() => applyPlToMain(pl)}
                              >
                                <Calculator className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                title="Удалить"
                                onClick={() => deletePotentialLoad(pl.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white p-2 rounded-xl border border-slate-100/80 flex flex-col justify-center items-center text-center">
                              <span className="text-[9px] uppercase tracking-wider font-medium text-slate-400">
                                Прибыль
                              </span>
                              <span
                                className={`text-xs font-semibold font-mono tabular-nums ${pl.profit < 0 ? "text-rose-600" : "text-emerald-600"}`}
                              >
                                {Math.round(pl.profit).toLocaleString("ru-RU")} €
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-slate-100/80 flex flex-col justify-center items-center text-center">
                              <span className="text-[9px] uppercase tracking-wider font-medium text-slate-400">
                                В день
                              </span>
                              <span
                                className={`text-xs font-semibold font-mono tabular-nums ${profitPerDay < 0 ? "text-rose-600" : "text-blue-600"}`}
                              >
                                {profitPerDay.toLocaleString("ru-RU")} €
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-slate-100/80 flex flex-col justify-center items-center text-center">
                              <span className="text-[9px] uppercase tracking-wider font-medium text-slate-400">
                                Дней в пути
                              </span>
                              <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums">
                                {days}
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-slate-100/80 flex flex-col justify-center items-center text-center">
                              <span className="text-[9px] uppercase tracking-wider font-medium text-slate-400">
                                Пробег
                              </span>
                              <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums">
                                {Math.round(pl.totalKm).toLocaleString("ru-RU")} км
                              </span>
                            </div>
                          </div>

                          <div className="mt-0.5 bg-white rounded-xl p-2.5 border border-slate-100">
                            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-2 font-sans">
                              Маршрут (Плечи)
                            </div>
                            <div className="space-y-1 border-l border-dashed border-slate-200 ml-1 pl-2.5 relative">
                              {pl.legs.map((leg, idx) => (
                                <div key={idx} className="relative">
                                  <div className="absolute -left-[13px] top-1.5 w-1.5 h-1.5 bg-slate-300 rounded-full border border-white"></div>
                                  <div className="flex justify-between items-center text-[10px]">
                                    <span className="font-medium text-slate-600 truncate mr-2">
                                      {leg.from || "?"}{" "}
                                      <span className="text-slate-300 mx-1">
                                        →
                                      </span>{" "}
                                      {leg.to || "?"}
                                    </span>
                                    <div className="flex gap-2 font-mono whitespace-nowrap text-slate-400">
                                      <span>
                                        {leg.km} км
                                      </span>
                                      <span className="text-blue-600 font-semibold">
                                        {leg.rate}€
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {potentialLoads.length === 0 && (
                      <span className="text-xs text-slate-400 font-medium font-mono text-center block py-10">
                        Нет сохраненных просчетов
                      </span>
                    )}
                  </div>

                  {potentialLoads.length < 3 && plEditingId === null && (
                    <div className="w-full mt-auto py-2 px-3 bg-purple-50 text-purple-700 border border-purple-100 font-semibold text-[11px] rounded-xl text-center shadow-none cursor-default font-sans">
                      Можно создать еще {3 - potentialLoads.length}
                    </div>
                  )}
                  {plEditingId !== null && (
                    <button
                      className="w-full mt-auto py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition cursor-pointer text-center"
                      onClick={() => {
                        setPlEditingId(null);
                        setPlName("");
                        setPlLegs(legs.map((l) => ({ ...l })));
                      }}
                    >
                      Создать новый
                    </button>
                  )}
                </div>

                {/* Right side: Editor */}
                <div className="flex-[2] bg-white rounded-2xl p-6 border border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col gap-5">
                  <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
                    <input
                      type="text"
                      placeholder="Название (напр: Груз на Москву)..."
                      value={plName}
                      onChange={(e) => setPlName(e.target.value)}
                      className="flex-1 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-xl px-3.5 py-2 text-xs font-medium outline-none focus:bg-white focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition-all placeholder:text-slate-400"
                    />
                    <button
                      onClick={savePotentialLoad}
                      className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold shadow-sm shadow-purple-600/10 transition tracking-wide min-w-[120px] cursor-pointer"
                    >
                      {plEditingId ? "Обновить" : "Сохранить"}
                    </button>
                  </div>


                  <div className="hidden lg:block overflow-x-auto pb-2">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="p-2 text-[10px] uppercase font-semibold text-slate-400 tracking-wider font-sans">
                            Откуда
                          </th>
                          <th className="p-2 text-[10px] uppercase font-semibold text-slate-400 tracking-wider font-sans">
                            Куда
                          </th>
                          <th className="p-2 text-[10px] uppercase font-semibold text-slate-400 tracking-wider font-sans w-24">
                            КМ
                          </th>
                          <th className="p-2 text-[10px] uppercase font-semibold text-slate-400 tracking-wider font-sans w-24">
                            Доезд (КМ)
                          </th>
                          <th className="p-2 text-[10px] uppercase font-semibold text-slate-400 tracking-wider font-sans w-28">
                            Ставка €
                          </th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {plLegs.map((leg, i) => (
                          <tr key={i} className="border-b border-slate-100/60 last:border-b-0">
                            <td className="p-1">
                              <input
                                type="text"
                                value={leg.from}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].from = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onBlur={() => checkLegDistance(i, true)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all font-sans"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="text"
                                value={leg.to}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].to = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onBlur={() => checkLegDistance(i, true)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all font-sans"
                              />
                            </td>
                            <td className="p-1 relative">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.km || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].km = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all tabular-nums font-mono"
                              />
                              <button
                                onClick={() =>
                                  openMapRouteModal(i, leg.from, leg.to, true)
                                }
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition cursor-pointer"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="p-1 relative">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.emptyRunKm || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].emptyRunKm = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all tabular-nums font-mono"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.rate || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].rate = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-white hover:bg-slate-50/50 border border-slate-200 text-blue-600 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all tabular-nums font-mono"
                              />
                            </td>
                            <td className="p-1 w-20 text-right">
                              <div className="flex gap-1 justify-end">
                                <button
                                  onClick={() => {
                                    const nl = [...plLegs];
                                    nl.splice(i + 1, 0, {
                                      from: "",
                                      to: "",
                                      km: 0,
                                      rate: 0,
                                      ferry: 0,
                                      coeff: directions[direction] || 0,
                                    });
                                    setPlLegs(nl);
                                  }}
                                  className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (plLegs.length > 1) {
                                      const nl = [...plLegs];
                                      nl.splice(i, 1);
                                      setPlLegs(nl);
                                    }
                                  }}
                                  className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-100 transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {/* UNIFIED STICKY FOOTER: stats + actions, always visible */}
          <div className="shrink-0 bg-white border-t border-slate-200/60 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] z-20 sticky bottom-0 md:static">
            {/* Light stats block — single layer, app style */}
            <div className="px-4 sm:px-6 lg:px-8 py-4 bg-slate-50/40">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Прибыль общая — green */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-emerald-400">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Прибыль общая</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{Math.round(profit).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-emerald-500">€</span>
                  </div>
                </div>
                {/* Прибыль в день — blue */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-blue-400">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Прибыль в день</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{Math.round(rawProfitPerDay).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-blue-500">€</span>
                  </div>
                </div>
                {/* Количество дней — orange */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-orange-400">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Количество дней</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{daysPlan || daysFact || 0}</span>
                    <span className="text-sm font-semibold text-orange-500">дн.</span>
                  </div>
                </div>
                {/* План км */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-slate-300">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{factKm && factKm > 0 ? "Километраж" : "План км"}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{Math.round(factKm && factKm > 0 ? factKm : totalKm).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-slate-500">км</span>
                    {factKm && factKm > 0 && <span className="text-[9px] uppercase tracking-wider text-emerald-500 ml-1.5 font-semibold">Факт</span>}
                  </div>
                </div>
                {/* Фрахт — blue */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-blue-400">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Фрахт</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{Math.round(totalFreight).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-blue-500">€</span>
                  </div>
                </div>
                {/* Расходы — orange */}
                <div className="bg-white rounded-2xl border border-slate-200/60 px-4 py-3 flex flex-col gap-0.5 border-l-4 border-orange-400">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{factKm && factKm > 0 ? "Расходы" : "Расходы (План)"}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-slate-800 font-mono tabular-nums">{Math.round(factKm && factKm > 0 ? totalExpenses : totalExpensesPlan).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-orange-500">€</span>
                    {factKm && factKm > 0 && <span className="text-[9px] uppercase tracking-wider text-emerald-500 ml-1.5 font-semibold">Факт</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons row */}
            <div className="bg-white px-3 md:px-6 py-2 md:py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isEditing && currentEditingTrip && (
                  <button
                    onClick={() => deleteTrip(editingTripId!, true)}
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-tight transition flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" /> Удалить
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {isEditing && currentEditingTrip && (
                  currentEditingTrip.isArchived ? (
                    <button
                      onClick={() => {
                        pdService.restoreTrip(editingTripId, user.name, user.role);
                        setIsModalOpen(false);
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2.5 rounded-xl font-black text-sm uppercase tracking-tight transition"
                    >
                      Из архива
                    </button>
                  ) : (
                    <button
                      onClick={() => finishTripToArchive(currentEditingTrip, true)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2.5 rounded-xl font-black text-sm uppercase tracking-tight transition flex items-center gap-2"
                    >
                      <Archive className="w-4 h-4" /> В архив
                    </button>
                  )
                )}
                <button
                  onClick={saveTrip}
                  disabled={isSubmitting}
                  className={`${isSubmitting ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500"} text-white px-8 py-2.5 rounded-xl font-black text-sm uppercase tracking-tight transition flex items-center gap-2 shadow-sm`}
                >
                  <Save className="w-4 h-4" /> {isSubmitting ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleTripDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("tripId");
    if (!sourceId || sourceId === targetId) return;

    const visibleIds = document.querySelectorAll(".car-strip-item");
    const idsInView = Array.from(visibleIds).map(
      (el) => (el as HTMLElement).dataset.tripId!,
    );

    let order = manualTripsOrder.filter((id) => idsInView.includes(id));
    idsInView.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });

    order = order.filter((id) => id !== sourceId);
    const targetIndex = order.indexOf(targetId);
    order.splice(targetIndex >= 0 ? targetIndex : order.length, 0, sourceId);

    const hiddenIds = manualTripsOrder.filter(
      (id) => !idsInView.includes(id) && id !== sourceId,
    );
    const newOrder = [...order, ...hiddenIds];

    setManualTripsOrder(newOrder);
    localStorage.setItem("ratipa_plan_trips_order", JSON.stringify(newOrder));
  };

  const activeTripsComputed = useMemo(() => {
    const normTab = (activeDispatcherTab || '').toString().trim().toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
    let list = trips.filter((t) => !t.isArchived);
    if (activeDispatcherTab) {
      if (activeDispatcherTab === 'Все диспетчеры') {
        // «Все диспетчеры» = показать ВСЕ записи (без фильтра по справочнику),
        // иначе рейсы с dispatcher = user.name (не из справочника) невидимы.
      } else if (activeDispatcherTab !== 'All') {
        list = list.filter((t) => {
          const td = (t.dispatcher || '').toString().trim().toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
          return td === normTab;
        });
      }
    }
    if (activeDirectionTab !== "All") {
      list = list.filter((t) => t.direction === activeDirectionTab);
    }
    if (searchCarQuery.trim()) {
      const q = searchCarQuery.trim().toLowerCase();
      list = list.filter((t) => String(t.carNumber || '').toLowerCase().includes(q));
    }

    // Sort logic
    if (sortConfig) {
      list.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;
        if (sortConfig.key === "carNumber") {
          valA = a.carNumber;
          valB = b.carNumber;
        } else if (sortConfig.key === "dateStart") {
          valA = a.dateStart;
          valB = b.dateStart;
        } else if (sortConfig.key === "km") {
          valA = a.factKm || a.totalKm || 0;
          valB = b.factKm || b.totalKm || 0;
        } else if (sortConfig.key === "freight") {
          valA = a.totalFreight || 0;
          valB = b.totalFreight || 0;
        } else if (sortConfig.key === "expenses") {
          valA = a.totalExpenses || 0;
          valB = b.totalExpenses || 0;
        } else if (sortConfig.key === "profit") {
          valA = a.profitFact || 0;
          valB = b.profitFact || 0;
        } else if (sortConfig.key === "profitDay") {
          valA = (a.profitFact || 0) / (a.days || 1);
          valB = (b.profitFact || 0) / (b.days || 1);
        }

        if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
        return 0;
      });
    } else {
      list.sort((a, b) => {
        const idxA = manualTripsOrder.indexOf(a.id);
        const idxB = manualTripsOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return b.id.localeCompare(a.id);
        if (idxA === -1) return -1; // New trips go to the top
        if (idxB === -1) return 1;  // New trips go to the top
        return idxA - idxB;
      });
    }
    return list;
  }, [trips, activeDispatcherTab, filterDispatchers, activeDirectionTab, searchCarQuery, sortConfig, manualTripsOrder]);

  const archiveTripsMonths = useMemo(() => {
    return Array.from(
      new Set(
        trips
          .filter((t) => t.isArchived && t.currentMonth)
          .map((t) => t.currentMonth as string),
      ),
    ).sort();
  }, [trips]);

  const archiveTripsComputed = useMemo(() => {
    let list = trips.filter((t) => !!t.isArchived);
    if (searchCarQuery.trim()) {
      const q = searchCarQuery.trim().toLowerCase();
      list = list.filter((t) => String(t.carNumber || '').toLowerCase().includes(q));
    }
    let targetMonth = archiveMonth;
    if (!targetMonth && archiveTripsMonths.length > 0) {
      targetMonth = archiveTripsMonths[0];
    }
    if (targetMonth) {
      list = list.filter((t) => t.currentMonth === targetMonth);
    }

    // Sort logic
    if (sortConfig) {
      list.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;
        if (sortConfig.key === "carNumber") {
          valA = a.carNumber;
          valB = b.carNumber;
        } else if (sortConfig.key === "dateStart") {
          valA = a.dateStart;
          valB = b.dateStart;
        } else if (sortConfig.key === "km") {
          valA = a.factKm || a.totalKm || 0;
          valB = b.factKm || b.totalKm || 0;
        } else if (sortConfig.key === "freight") {
          valA = a.totalFreight || 0;
          valB = b.totalFreight || 0;
        } else if (sortConfig.key === "expenses") {
          valA = a.totalExpenses || 0;
          valB = b.totalExpenses || 0;
        } else if (sortConfig.key === "profit") {
          valA = a.profitFact || 0;
          valB = b.profitFact || 0;
        }

        if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
        return 0;
      });
    } else {
      list.sort((a, b) => b.id.localeCompare(a.id));
    }
    return list;
  }, [trips, searchCarQuery, archiveMonth, archiveTripsMonths, sortConfig, manualTripsOrder]);

  const renderTripsGrid = (archived: boolean) => {
    const list = archived ? archiveTripsComputed : activeTripsComputed;

    if (list.length === 0) {
      return (
        <div className="text-center font-medium text-slate-400 py-12 font-mono text-sm border border-dashed border-slate-200/50 rounded-2xl">
          Список пуст
        </div>
      );
    }

    // Сводка
    let sumProfit = 0;
    let sumFreight = 0;
    let sumExpenses = 0;
    let sumKm = 0;
    let sumDays = 0;
    let profitableCount = 0;
    let factKmCount = 0;

    list.forEach((t) => {
      const profit =
        t.factKm && t.factKm > 0 ? t.profitFact || 0 : t.profit || 0;
      const freight = t.totalFreight || 0;
      const expenses = freight - profit;

      sumProfit += profit;
      sumFreight += freight;
      sumExpenses += expenses;
      sumKm += t.factKm && t.factKm > 0 ? t.factKm : t.totalKm || 0;
      sumDays += t.days || 1;
      if (profit > 0) profitableCount++;
      if (t.factKm && t.factKm > 0) factKmCount++;
    });

    const handleSort = (key: string) => {
      setSortConfig((prev) => {
        if (!prev || prev.key !== key) return { key, dir: "desc" };
        if (prev.dir === "desc") return { key, dir: "asc" };
        return null; // toggle off
      });
    };

    const renderSortIndicator = (sortKey: string) => {
      if (sortConfig?.key !== sortKey) return null;
      return (
        <span className="text-slate-500 ml-1">
          {sortConfig.dir === "asc" ? "↑" : "↓"}
        </span>
      );
    };

    const marginRate = sumFreight > 0 ? Math.round((sumProfit / sumFreight) * 100) : 0;
    const profitPerDayValue = sumDays > 0 ? Math.round(sumProfit / sumDays) : 0;
    const listQuality = list.length > 0 ? Math.round((profitableCount / list.length) * 100) : 0;

    const renderKpiSummary = (isBottom: boolean) => {
      return (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6 bg-slate-50/40 border border-slate-200/50 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] ${isBottom ? "mt-4" : "mb-2"}`}>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              Общая прибыль
            </span>
            <span className={`text-2xl lg:text-3xl font-bold tracking-tight font-sans tabular-nums ${sumProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {Math.round(sumProfit).toLocaleString("ru-RU")} <span className="text-sm font-medium text-slate-400">€</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              Маржинальность
            </span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans tabular-nums">
              {marginRate}%
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              Прибыль в день
            </span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans tabular-nums">
              {profitPerDayValue.toLocaleString("ru-RU")} <span className="text-sm font-medium text-slate-400">€</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              Общий пробег
            </span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans tabular-nums">
              {Math.round(sumKm).toLocaleString("ru-RU")} <span className="text-xs font-medium text-slate-400">км</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6 col-span-2 lg:col-span-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
              Качество списка
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans tabular-nums">
                {listQuality}%
              </span>
              <span className="text-xs font-semibold text-emerald-600 font-sans">
                +{profitableCount} в плюс
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium mt-0.5">
              Всего: {profitableCount} из {list.length}
            </span>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-4 relative w-full overflow-x-auto transition-all duration-150" style={{ zoom: tableScale / 100 } as any}>
        
        {/* KPI Summary Dashboard Panel - ABOVE for Archive */}
        {archived && renderKpiSummary(false)}

        {/* Table Headers */}
        <div className="hidden lg:flex px-6 pb-3 border-b border-slate-200/40 text-xs font-medium text-slate-400 self-start w-full cursor-pointer select-none tracking-normal">
          <div
            className="min-w-[200px] hover:text-slate-700 transition flex items-center gap-1"
            onClick={() => handleSort("carNumber")}
          >
            Автомобиль {renderSortIndicator("carNumber")}
          </div>
          <div
            className="min-w-[140px] hover:text-slate-700 transition flex items-center gap-1"
            onClick={() => handleSort("dateStart")}
          >
            Даты {renderSortIndicator("dateStart")}
          </div>
          <div className="flex-1 min-w-[220px]">Маршрут</div>
          <div className="min-w-[480px] flex gap-4 pl-6 justify-end">
            <span
              className="w-20 hover:text-slate-700 transition flex items-center gap-1 justify-end"
              onClick={() => handleSort("km")}
            >
              Км {renderSortIndicator("km")}
            </span>
            <span
              className="w-20 hover:text-slate-700 transition flex items-center gap-1 justify-end"
              onClick={() => handleSort("freight")}
            >
              Фрахт {renderSortIndicator("freight")}
            </span>
            <span
              className="w-20 hover:text-slate-700 transition flex items-center gap-1 justify-end"
              onClick={() => handleSort("expenses")}
            >
              Расходы {renderSortIndicator("expenses")}
            </span>
            <span
              className="w-24 hover:text-slate-700 transition flex items-center gap-1 justify-end"
              onClick={() => handleSort("profit")}
            >
              Прибыль {renderSortIndicator("profit")}
            </span>
            <span className="w-12 text-right">Дни</span>
            <span className="w-20 text-right">В день</span>
          </div>
        </div>

        {/* Pure Map List instead of Virtuoso (solves ResizeObserver infinite loops under CSS zoom) */}
        <div className="flex flex-col gap-3 w-full">
          {list.map((trip) => {
            const firstLeg = trip.legs?.[0];
            const lastLeg = trip.legs?.[trip.legs.length - 1];
            const routeTitle =
              firstLeg?.from && lastLeg?.to
                ? `${firstLeg.from} ➔ ${lastLeg.to}`
                : "Плечи маршрута";

            const isHighlighted =
              trip.carNumber &&
              highlightedCar === trip.carNumber.trim().toUpperCase();

            // Set up clean direction badge colors
            const getDirectionBadgeClass = (dir: string) => {
              const d = (dir || "").toLowerCase();
              if (d.includes("китай")) return "bg-amber-50 text-amber-700 border-amber-200/40";
              if (d.includes("турция")) return "bg-blue-50 text-blue-700 border-blue-200/40";
              return "bg-slate-50 text-slate-600 border-slate-200/40";
            };

            // Set up clean dispatcher badges
            const dispatcherName = trip.dispatcher || trip.logist || "—";
            const colorKey = dispatchersColors[dispatcherName];
            const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
            const dispBadgeStyle = preset
              ? `${preset.bg} ${preset.darkText} border-slate-200/40`
              : "bg-slate-50 text-slate-600 border-slate-200/40";

            return (
              <div
                key={trip.id}
                data-trip-id={trip.id}
                onClick={() => loadTripToForm(trip)}
                className={`car-strip-item bg-white rounded-2xl p-4.5 border hover:shadow-[0_8px_30px_rgba(15,23,42,0.04)] hover:border-slate-350 transition-all duration-200 group relative flex flex-col xl:flex-row gap-5 items-start xl:items-center cursor-pointer ${isHighlighted ? "border-amber-500 ring-2 ring-amber-500/25 shadow-[0_10px_25px_rgba(245,158,11,0.06)] scale-[1.002]" : "border-slate-200/60"}`}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData("tripId", trip.id);
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  handleTripDrop(e, trip.id);
                  e.stopPropagation();
                }}
              >
                {/* Main Accent Block: Plate & Direction */}
                <div className="flex flex-col gap-2 min-w-[200px] shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-900 tracking-tight font-sans">
                      {trip.carNumber}
                    </span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${getDirectionBadgeClass(trip.direction || "")}`}>
                      {trip.direction || "—"}
                    </span>
                  </div>
                  
                  {/* Meta layer: Dispatcher & Actions */}
                  <div className="flex flex-col gap-1 mt-0.5 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 font-sans">Диспетчер:</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${dispBadgeStyle}`}>
                        {formatToTitleCase(dispatcherName)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-1 opacity-100 xl:opacity-0 group-hover:opacity-100 transition-all duration-150">
                    {!archived && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          finishTripToArchive(trip);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition"
                        title="В архив"
                      >
                        <Archive className="w-3.5 h-3.5 stroke-[1.8]" />
                      </button>
                    )}
                    {user.role === "root_admin" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTrip(trip.id);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5 stroke-[1.8]" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Meta block: Dates */}
                <div className="flex flex-col gap-1 min-w-[140px] shrink-0 text-xs text-slate-500 font-sans">
                  <div className="flex justify-between gap-4 items-center">
                    <span className="text-slate-400 text-[10px] font-medium uppercase tracking-wider">Старт</span>
                    <span className="text-slate-800 font-semibold font-mono">
                      {trip.dateStart
                        ? new Date(trip.dateStart).toLocaleDateString("ru-RU")
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 items-center">
                    <span className="text-slate-400 text-[10px] font-medium uppercase tracking-wider">Финиш</span>
                    <span className="text-slate-800 font-semibold font-mono">
                      {trip.dateEnd
                        ? new Date(trip.dateEnd).toLocaleDateString("ru-RU")
                        : "—"}
                    </span>
                  </div>
                  {trip.currentMonth && archived && (
                    <div className="mt-1">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                        Архив: {trip.currentMonth}
                      </span>
                    </div>
                  )}
                </div>

                {/* Itinerary Section: Full & Readable */}
                <div className="flex-1 w-full bg-slate-50/20 rounded-xl p-3 border border-slate-200/40 min-w-[220px]">
                  <div className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="tracking-tight text-slate-800 font-semibold">{routeTitle}</span>
                  </div>
                  {trip.legs && trip.legs.length > 0 ? (
                    <div className="flex flex-col gap-1.5 pl-1 border-l-2 border-slate-200/30 ml-1.5">
                      {trip.legs.map((leg, i) => {
                        const isActive = trip.activeLegIndex === i;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-2 text-xs p-1 -ml-2 rounded-md ${isActive ? "bg-slate-900/5 text-slate-900 font-medium" : "text-slate-500"}`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full border flex-shrink-0 -ml-[10px] ${isActive ? "bg-slate-900 border-white shadow-xs scale-110" : "bg-slate-200 border-white"}`}
                            />
                            <span className="truncate">
                              {leg.from || "?"} ➔ {leg.to || "?"}
                            </span>
                            {leg.ferry > 0 ? (
                              <span
                                className="text-blue-500 text-[9px] font-medium bg-blue-50/50 px-1 py-0.5 rounded border border-blue-100"
                                title={`Ферри: €${leg.ferry}`}
                              >
                                ⛴ Ferry
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400 italic">
                      Маршрут не задан
                    </div>
                  )}
                </div>

                {/* Aligned Grid for Metrics & Finances - aligned EXACTLY with table headers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:flex xl:items-center gap-4 w-full xl:w-[480px] xl:pl-6 justify-between xl:justify-end border-t xl:border-t-0 border-slate-100 pt-3.5 xl:pt-0 shrink-0">
                  <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                    <span className="text-[10px] font-medium text-slate-400">Км</span>
                    <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums whitespace-nowrap">
                      {Math.round(trip.factKm || trip.totalKm || 0).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                    <span className="text-[10px] font-medium text-slate-400">Фрахт</span>
                    <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums whitespace-nowrap">
                      {Math.round(trip.totalFreight || 0).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                    <span className="text-[10px] font-medium text-slate-400">Расходы</span>
                    <span className="text-xs font-semibold text-rose-600/90 font-mono tabular-nums whitespace-nowrap">
                      {Math.round(trip.totalExpenses !== undefined ? trip.totalExpenses : (trip.totalFreight - (trip.profit || 0))).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 w-24 xl:text-right">
                    <span className="text-[10px] font-medium text-slate-400">Прибыль</span>
                    <span className={`text-sm font-bold font-mono tabular-nums whitespace-nowrap ${ (trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {Math.round(trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 w-12 text-right">
                    <span className="text-[10px] font-medium text-slate-400">Дни</span>
                    <span className="text-xs font-semibold font-mono text-slate-600 tabular-nums">
                      {trip.days || "—"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 w-20 text-right">
                    <span className="text-[10px] font-medium text-slate-400">В день</span>
                    <span className={`text-xs font-semibold font-mono tabular-nums ${Math.round((trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) / (trip.days || 1)) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {Math.round((trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) / (trip.days || 1)).toLocaleString("ru-RU")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {list.length === 0 && (
            <div className="text-sm text-slate-400 font-medium py-12 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200/50">
              Список планирования пуст
            </div>
          )}
        </div>

        {/* KPI Summary Dashboard Panel - BELOW for Active */}
        {!archived && renderKpiSummary(true)}
      </div>
    );
  };

  const renderHistory = () => {
    return (
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <h2 className="text-sm font-semibold text-slate-800 tracking-tight mb-6 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-500" /> История изменений
        </h2>
        <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {[...logs]
            .sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            )
            .map((log, idx) => (
              <div
                key={`${log.id || 'log'}_${idx}`}
                className="p-3.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-800">
                    {log.actionType}
                  </span>
                  <span className="text-[11px] text-slate-500 leading-relaxed font-sans">
                    {log.details}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-slate-400 font-sans">
                  <div className="flex flex-col text-right">
                    <span className="font-semibold text-slate-600">{log.user}</span>
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider font-mono">{log.role}</span>
                  </div>
                  <div className="text-right whitespace-nowrap font-mono text-slate-400">
                    {new Date(log.date).toLocaleString("ru-RU", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
          {logs.length === 0 && (
            <div className="text-xs text-slate-400 font-medium py-10 text-center bg-slate-50/50 border border-dashed border-slate-200 rounded-2xl font-mono">
              История пуста
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-5">
        
        {/* Page Header Area */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
              Модуль План Firebase
            </span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <TrendingUp className="w-7 h-7 text-slate-800" /> План дохода
            </h1>
          </div>

          {/* Navigation Tabs segment */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto max-w-full custom-scrollbar items-center">
              <button
                onClick={() => setActiveTab("active")}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${activeTab === "active" ? "bg-white text-slate-900 shadow-xs border border-slate-200/40" : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/30"} min-h-[44px]`}
              >
                <Calculator className="w-3.5 h-3.5 text-slate-400" /> Активные
              </button>
              <button
                onClick={() => setActiveTab("archive")}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${activeTab === "archive" ? "bg-white text-slate-900 shadow-xs border border-slate-200/40" : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/30"} min-h-[44px]`}
              >
                <Archive className="w-3.5 h-3.5 text-slate-400" /> Архив
              </button>
              <button
                type="button"
                onClick={toggleNotebook}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${isNotebookOpen ? "bg-amber-50 text-amber-900 border-amber-200/30 shadow-xs" : "text-slate-500 border-transparent hover:text-slate-900 hover:bg-slate-200/30"} min-h-[44px]`}
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-500" /> Блокнот
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${activeTab === "history" ? "bg-white text-slate-900 shadow-xs border border-slate-200/40" : "text-slate-500 border-transparent hover:text-slate-900 hover:bg-slate-200/30"} min-h-[44px]`}
              >
                <History className="w-3.5 h-3.5 text-slate-400" /> История
              </button>
            </div>

            <button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 bg-slate-900 text-white hover:bg-slate-800 shadow-sm border border-slate-800 min-h-[44px]"
            >
              <Plus className="w-4 h-4 shrink-0" /> Новый план
            </button>
          </div>
        </div>

        {/* Filter Groups Segment */}
        <div className={activeTab === "active" ? "block" : "hidden"}>
          {activeDispatchers.length > 0 && (
            <div className="flex flex-col gap-3 pb-1">
              
              {/* Dispatchers Row */}
              <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest shrink-0 mr-1.5">
                  Диспетчеры:
                </span>
                <div className="flex items-center gap-1.5">
                  {activeDispatchers.map((d) => (
                    <button
                      key={d}
                      draggable={d !== "Все диспетчеры"}
                      onDragStart={(e) => {
                        if (d === "Все диспетчеры") return;
                        e.dataTransfer.setData("dispatcher", d);
                      }}
                      onClick={() => setActiveDispatcherTab(d)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 flex items-center gap-1 whitespace-nowrap border ${getDispatcherActiveTabStyle(d)}`}
                    >
                      {d === "All" || d === "Все диспетчеры" ? "Все диспетчеры" : formatToTitleCase(d)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Directions Row */}
              {Object.keys(directions).length > 0 && (
                <div className="flex items-center gap-1.5 border-t border-slate-100/70 pt-2.5 overflow-x-auto custom-scrollbar pb-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest shrink-0 mr-1.5">
                    Направления:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {["All", ...Object.keys(directions)].map((dir) => (
                      <button
                        key={dir}
                        onClick={() => setActiveDirectionTab(dir)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 border ${
                          activeDirectionTab === dir
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "bg-slate-50 text-slate-500 border-slate-200/50 hover:bg-slate-100 hover:text-slate-800"
                        }`}
                      >
                        {dir === "All" ? "Все направления" : dir}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={activeTab === "archive" ? "" : "hidden"}>
          <div className="flex items-center gap-1.5 border-t border-slate-100 pt-3 overflow-x-auto custom-scrollbar pb-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest shrink-0 mr-1.5">
              Месяцы архива:
            </span>
            <div className="flex gap-1.5">
              {archiveTripsMonths.map((month) => (
                <button
                  key={month}
                  onClick={() => setArchiveMonth(month)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const tripId = e.dataTransfer.getData("tripId");
                    if (tripId) {
                      pdService.updateTrip(
                        tripId,
                        { currentMonth: month },
                        user.name,
                        user.role,
                      );
                    }
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap min-w-max ${
                    archiveMonth === month
                      ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                      : "bg-slate-50 text-slate-500 border-slate-200/50 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  📅 {month}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {(activeTab === "active" || activeTab === "archive") && (
          <div className="bg-slate-50/50 border border-slate-200 rounded-2xl p-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.01)]">
            <div className="flex items-center gap-3 flex-1 min-w-0 bg-white border border-slate-200/60 rounded-xl px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Быстрый поиск автомобиля по номеру в таблице..."
                value={searchCarQuery}
                onChange={(e) => setSearchCarQuery(e.target.value)}
                className="w-full bg-transparent text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 min-h-[44px]"
              />
              {searchCarQuery && (
                <button
                  onClick={() => setSearchCarQuery("")}
                  className="text-xs hover:bg-slate-100 p-1 rounded-lg text-slate-400 hover:text-slate-700 transition"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 px-2 shrink-0 self-end md:self-auto">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Масштаб:</span>
              <div className="flex items-center bg-white border border-slate-200/60 rounded-lg p-0.5 gap-1 shadow-2xs">
                <button 
                  onClick={() => {
                    const newScale = Math.max(50, tableScale - 10);
                    setTableScale(newScale);
                    localStorage.setItem(`pd_table_scale_${user.uid}`, String(newScale));
                  }}
                  className="w-6 h-6 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-600 rounded text-xs font-bold transition select-none cursor-pointer"
                  title="Уменьшить масштаб таблицы"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-[11px] font-bold font-mono text-slate-750 min-w-[32px] text-center select-none">{tableScale}%</span>
                <button 
                  onClick={() => {
                    const newScale = Math.min(150, tableScale + 10);
                    setTableScale(newScale);
                    localStorage.setItem(`pd_table_scale_${user.uid}`, String(newScale));
                  }}
                  className="w-6 h-6 flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-600 rounded text-xs font-bold transition select-none cursor-pointer"
                  title="Увеличить масштаб таблицы"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              {tableScale !== 100 && (
                <button 
                  onClick={() => {
                    setTableScale(100);
                    localStorage.setItem(`pd_table_scale_${user.uid}`, "100");
                  }}
                  className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 hover:underline pl-1 transition cursor-pointer"
                  title="Сбросить к 100%"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>
        )}
        <div className={activeTab === "active" ? "" : "hidden"}>
          {renderTripsGrid(false)}
        </div>
        <div className={activeTab === "archive" ? "" : "hidden"}>
          {renderTripsGrid(true)}
        </div>
        <div className={activeTab === "history" ? "" : "hidden"}>
          {renderHistory()}
        </div>
      </div>

      {renderNotebookWidget()}
      {renderCurrentFormModal()}

      <MapRouteModal
        isOpen={mapModalOpen}
        onClose={handleCloseMapModal}
        legIndex={mapLegIndex !== null ? mapLegIndex : 0}
        leg={mapLeg}
        presets={distances}
        onUpdateLegRoute={handleUpdateLegRoute}
        saveToDirectoryChecked={saveToDirectoryChecked}
        setSaveToDirectoryChecked={setSaveToDirectoryChecked}
        onApply={handleApplyMapRoute}
      />
    </div>
  );
}