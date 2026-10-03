import React, {useState, useEffect, useRef, useMemo, useCallback} from 'react'
import {useToast} from '../ToastProvider'
import { formatToTitleCase } from '../../utils/format'
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
import { buildDispatcherDirectory, dispatcherFieldsFor, resolvePersonName, DispatcherRef } from '../../utils/dispatcher'
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
  Archive,
  History,
  X,
  BookOpen,
  Minus,
  Calendar,
  Loader2,
  SlidersHorizontal,
  Truck,
  Lightbulb,
  CircleDollarSign, MessageSquare, FileText, Pencil, PenLine} from "lucide-react";
import MapRouteModal from "../MapRouteModal";
import { UI } from "../../ui/kit";
import { ModuleShell, SectionHeader, SearchField, FoundCount, EmptyState, ModalShell } from "../../ui/components";

interface PlanDohodModuleProps {
  user: UserProfile;
}

export default function PlanDohodModule({ user }: PlanDohodModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast: addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tableScale, setTableScale] = useState<number>(() => {
    const scaleKey = `pd_table_scale_${user.uid || user.name || 'default'}`;
    const saved = localStorage.getItem(scaleKey);
    return saved ? Number(saved) : 100;
  });
  const scaleKey = `pd_table_scale_${user.uid || user.name || 'default'}`;
  useEffect(() => {
    localStorage.setItem(scaleKey, String(tableScale));
  }, [tableScale, scaleKey]);
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

  // Announce popup — один раз для каждого пользователя
  const [showAnnounce, setShowAnnounce] = useState(false);
  const announceCheckedRef = useRef(false);

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
  /** Диспетчеры с идентификаторами учётных записей — для связи записей с пользователями */
  const [dispatcherRefs, setDispatcherRefs] = useState<DispatcherRef[]>([]);
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
    const unsubCp = dbService.getCheckpoints ? dbService.getCheckpoints((list: any) => setAllCheckpoints(list || [])) : undefined;
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
      setDispatcherRefs(
        objs
          .map((d: any) => ({ id: String(d.id || ''), name: String(d.name || '') }))
          .filter((d: any) => d.id && d.name),
      );
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
  const [archiveListLoaded, setArchiveListLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "archive") {
      setArchiveTrips([]);
      setArchiveListLoaded(false);
      return;
    }
    setArchiveListLoaded(false);
    const unsubArchive = pdService.subscribeTrips((list) => {
      setArchiveTrips(list);
      setArchiveListLoaded(true);
    }, true);
    return () => {
      unsubArchive();
    };
  }, [activeTab]);

  // Lazy-load Audit Logs
  const [logsLoaded, setLogsLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "history") return;
    setLogsLoaded(false);
    const unsubLogs = dbService.getAuditLogs((data) => {
      setLogs(data.filter((l) => l.module === "PlanDohod"));
      setLogsLoaded(true);
    });
    return () => unsubLogs();
  }, [activeTab]);

  // Announce popup — один раз для каждого пользователя
  useEffect(() => {
    if (announceCheckedRef.current) return;
    announceCheckedRef.current = true;
    const seenKey = `pl_dohod_announce_${user.uid || user.name || 'default'}`;
    const seen = localStorage.getItem(seenKey);
    if (!seen) {
      setShowAnnounce(true);
    }
  }, [user.uid]);

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

  /** Справочник диспетчеров: идентификатор учётной записи ↔ имя */
  const dispatcherDirectory = useMemo(() => buildDispatcherDirectory(dispatcherRefs), [dispatcherRefs]);

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
      addToast("У вас пока нет оформленных машин в текущем журнале.", 'info');
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
      addToast("Все ваши машины уже внесены в ваш блокнот.", 'info');
    } else {
      pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
      addToast(`В блокнот добавлено машин: ${addedCount}`, 'success');
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
        <div className="fixed bottom-20 right-4 z-50">
          <button
            type="button"
            onClick={() => {
              setIsNbMinimized(false);
              localStorage.setItem("ratipa_notebook_minimized", "false");
            }}
            className="bg-[#121316] hover:bg-black text-white text-xs font-semibold py-2.5 px-5 min-h-[44px] rounded-full flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            <BookOpen size={14} />
            <span>Блокнот ({cars.length})</span>
          </button>
        </div>
      );
    }

    const permittedToSwitch =
      isAdminUser || isNotebookViewer || user.role === "root_admin";
    const notebookUsersList = Array.from(
      new Set([user.name, ...dispatchersOrder.filter((d) => d !== "All")]),
    );

    // Mobile: full-screen modal, Desktop: floating widget
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    return (
      <div
        style={{
          position: isMobile ? "fixed" : "fixed",
          left: isMobile ? "0" : `${nbCoords.x}px`,
          top: isMobile ? "0" : `${nbCoords.y}px`,
          width: isMobile ? "100%" : `${nbCoords.w}px`,
          height: isMobile ? "100%" : `${nbCoords.h}px`,
          zIndex: 20000,
        }}
        className={`bg-white ${isMobile ? "" : "rounded-2xl"} border border-[#E5E7EB] shadow-sm flex flex-col pointer-events-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
      >
        {/* Header Drag Handle */}
        <div
          onMouseDown={handleNbDragStart}
          className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3 bg-[#F8F9FA] cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-white border border-[#E5E7EB] text-[#4B5563] font-medium text-[10px] rounded-md tracking-wider font-mono">
              Блокнот
            </span>
            <h3 className="text-sm font-semibold text-[#121316] tracking-tight">
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
              className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
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
              className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
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
              <label className="text-[11px] font-medium text-[#6B7280] font-sans">
                Выбор Блокнота
              </label>
              <select
                value={selectedNotebookUser}
                onChange={(e) => setSelectedNotebookUser(e.target.value)}
                className={`${UI.select} w-full`}
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
              <label className="text-[11px] font-medium text-[#6B7280] font-sans">
                Ваш Блокнот
              </label>
              <div className="p-2 bg-[#F8F9FA] text-xs font-semibold text-[#121316] rounded-xl border border-[#E5E7EB] tracking-wide font-sans">
                {selectedNotebookUser === user.name
                  ? `Личный блокнот`
                  : `Блокнот: ${selectedNotebookUser}`}
              </div>
              <div className="grid grid-cols-1 gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => setSelectedNotebookUser(user.name)}
                  className="inline-flex w-full items-center justify-center min-h-[44px] md:min-h-0 py-1 px-2 rounded-lg text-[10px] font-semibold tracking-wider transition-colors bg-[#121316] text-white shadow-sm hover:bg-black cursor-pointer"
                >
                  Мой
                </button>
              </div>
            </div>
          )}

          <div className="text-[10px] font-medium text-[#6B7280] text-center bg-[#F8F9FA] py-1.5 px-2.5 rounded-xl border border-[#E5E7EB]">
            {selectedNotebookUser === user.name
              ? "Редактируется ваш личный блокнот"
              : `Просмотр блокнота: ${selectedNotebookUser}`}
          </div>

          {/* Status counters */}
          <div className="grid grid-cols-3 gap-1.5 bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] select-none">
            <div className="text-center">
              <div className="text-[10px] text-[#9CA3AF] font-semibold tracking-tight">На базе</div>
              <div className="text-sm font-bold text-emerald-600 font-sans">{countBaza}</div>
            </div>
            <div className="text-center border-x border-[#E5E7EB]">
              <div className="text-[10px] text-[#9CA3AF] font-semibold tracking-tight">В рейсе</div>
              <div className="text-sm font-bold text-sky-600 font-sans">{countReis}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-[#9CA3AF] font-semibold tracking-tight">Без ст.</div>
              <div className="text-sm font-bold text-[#6B7280] font-sans">{countNone}</div>
            </div>
          </div>

          <div className="flex gap-1.5 border-t border-[#E5E7EB] pt-2">
            <button
              type="button"
              onClick={handleAddMyCarsToNotebook}
              className="flex-1 min-h-[44px] md:min-h-0 py-2 px-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#121316] rounded-xl text-[11px] font-semibold tracking-wide transition-colors cursor-pointer text-center"
            >
              Внести свои авто
            </button>
          </div>

          {/* Status selector for adding */}
          <div className="flex flex-col gap-1 border-t border-[#E5E7EB] pt-2">
            <span className="text-[11px] font-semibold text-[#6B7280] font-sans">
              Статус для добавления авто
            </span>
            <div className="flex bg-[#F3F4F6] p-0.5 rounded-lg text-[10px] font-semibold w-full">
              <button
                type="button"
                onClick={() => setAddCarStatus("baza")}
                className={`flex-1 py-1 min-h-[44px] md:min-h-0 text-center rounded-md transition-colors cursor-pointer text-[10px] ${
                  addCarStatus === "baza"
                    ? "bg-emerald-500 text-white shadow-sm font-bold"
                    : "text-[#6B7280] hover:text-[#121316]"
                }`}
              >
                На базе
              </button>
              <button
                type="button"
                onClick={() => setAddCarStatus("reis")}
                className={`flex-1 py-1 min-h-[44px] md:min-h-0 text-center rounded-md transition-colors cursor-pointer text-[10px] ${
                  addCarStatus === "reis"
                    ? "bg-sky-500 text-white shadow-sm font-bold"
                    : "text-[#6B7280] hover:text-[#121316]"
                }`}
              >
                В рейсе
              </button>
              <button
                type="button"
                onClick={() => setAddCarStatus("none")}
                className={`flex-1 py-1 min-h-[44px] md:min-h-0 text-center rounded-md transition-colors cursor-pointer text-[10px] ${
                  addCarStatus === "none"
                    ? "bg-white text-[#121316] shadow-sm font-semibold"
                    : "text-[#6B7280] hover:text-[#121316]"
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
              className="flex-1 px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] text-[#121316] rounded-xl text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors placeholder:text-[#9CA3AF] uppercase"
            />
            <datalist id="notebook-vehicles-list">
              {savedCars.map((car) => (
                <option key={car} value={car} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={handleAddCarToNotebook}
              className="min-h-[44px] min-w-[44px] bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] font-medium flex items-center justify-center rounded-xl transition-colors cursor-pointer text-base leading-none"
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
                  className={`bg-white border rounded-xl p-2.5 flex flex-col space-y-1.5 transition-colors group relative cursor-move ${isHighlighted ? "border-[var(--accent-ui)] ring-2 ring-[var(--accent-20)]" : "border-[#E5E7EB] hover:border-[#D1D5DB]"}`}
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
                      className="flex-shrink-0 flex items-center min-h-[44px] md:min-h-0 transition-colors cursor-pointer text-left"
                      title="Нажмите, чтобы подсветить рейс"
                    >
                      <div className="px-2.5 py-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg text-xs font-bold text-[#4B5563] tracking-tight select-none">
                        {car}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveCarFromNotebook(car)}
                      className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center p-1 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
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
                    className="w-full p-2 bg-white text-xs border border-[#E5E7EB] text-[#121316] rounded-xl focus:outline-none placeholder:text-[10px] font-medium leading-relaxed resize-y focus:border-[var(--accent)] font-sans min-h-[48px] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                  />
                </div>
              );
            })}

            {cars.length === 0 && (
              <div className="text-center py-8 text-[#9CA3AF] text-xs font-mono font-medium tracking-wide bg-[#F8F9FA] rounded-2xl border border-dashed border-[#E5E7EB]">
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
              <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-[#D1D5DB] group-hover:border-[#6B7280] transition-colors pointer-events-none" />
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
  const [showAddDistModal, setShowAddDistModal] = useState(false);
  const [addDistFrom, setAddDistFrom] = useState('');
  const [addDistTo, setAddDistTo] = useState('');
  const [addDistKm, setAddDistKm] = useState(0);
  const [addDistCountryFrom, setAddDistCountryFrom] = useState('');
  const [addDistCountryTo, setAddDistCountryTo] = useState('');
  const [addDistCheckpoints, setAddDistCheckpoints] = useState('');
  const [addDistCpInput, setAddDistCpInput] = useState('');
  const [allCheckpoints, setAllCheckpoints] = useState<any[]>([]);
  const [cityDropdown, setCityDropdown] = useState<{idx: number; field: 'from'|'to'; isPl: boolean; rect?: DOMRect} | null>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!cityDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(e.target as Node)) {
        setCityDropdown(null);
      }
    };
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (cityDropdownRef.current && cityDropdownRef.current.contains(target)) return;
      setCityDropdown(null);
    };
    const handleResize = () => setCityDropdown(null);
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [cityDropdown]);

const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<"google" | "yandex">("google");

  const cityOptions = useMemo(() => Array.from(new Set(distances.flatMap((d) => [d.from, d.to]))).filter(Boolean).sort(), [distances]);

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
  const [plDateStart, setPlDateStart] = useState("");
  const [plDateEnd, setPlDateEnd] = useState("");

  const getDispatcherActiveTabStyle = (d: string) => {
    if (activeDispatcherTab !== d)
      return "bg-white border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316]";
    if (d === "All" || d === "Все диспетчеры")
      return "bg-[#121316] border-[#121316] text-white font-semibold";

    const colorKey = dispatchersColors[d];
    const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
    if (preset) {
      return `${preset.bg} ${preset.darkText} border-[#E5E7EB]`;
    }
    return "bg-blue-50 text-[#1e40af] border-[#E5E7EB]";
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
    setPotentialLoads(trip.potentialLoads || []);
    setPlDateStart(trip.dateStart || "");
    setPlDateEnd(trip.dateEnd || "");
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
    addToast("Сравните варианты во вкладке «Потенц. грузы» и выберите наиболее выгодный маршрут.", 'info');
    setIsModalOpen(true);
  }, [directions]);



  const calculatePlTotals = () => {
    const fin = calculateTripFinances(plLegs, plDateStart, plDateEnd, Number(plExtraExpense), Number(plFerryCost), 0);
    return { totalKm: fin.totalKm, totalFreight: fin.totalFreight, totalExpenses: fin.totalExpensesPlan, profit: fin.profitPlan, days: fin.days };
  };

  const savePotentialLoad = () => {
    if (!plName.trim()) {
      addToast("Укажите название просчета", 'info');
      return;
    }
    if (potentialLoads.length >= 3 && !plEditingId) {
      addToast("Можно сохранить максимум 3 просчета", 'info');
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
                        setPlDateStart(dateStart);
                        setPlDateEnd(dateEnd);
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
      if (pl.dateStart) setDateStart(pl.dateStart);
      if (pl.dateEnd) setDateEnd(pl.dateEnd);
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
      // Диспетчер рейса: храним идентификатор учётной записи и имя с фамилией
      const tripDispatcherFields = dispatcherFieldsFor(
        dispatcher || carDispatcherMapping[trimmedCar] || user.name,
        dispatcherDirectory,
      );
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
        dispatcher: tripDispatcherFields.dispatcher,
        dispatcherName: tripDispatcherFields.dispatcherName,
        dispatcherId: tripDispatcherFields.dispatcherId,
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
 <div data-scroll-lock="modal" className="fixed inset-0 z-[100] flex items-start md:items-center justify-center bg-black/40 backdrop-blur-[2px] animate-fade-in overflow-y-auto overscroll-contain">
 <div className="bg-white w-full md:max-w-[1400px] mx-0 md:mx-4 md:border md:border-[#E5E7EB] shadow-[0_25px_60px_rgba(0,0,0,0.12)] rounded-2xl flex flex-col relative min-h-[100dvh] md:min-h-0 md:max-h-[calc(100vh-2rem)] overflow-hidden">
          
          {/* Header */}
          <div className="bg-white px-4 md:px-6 py-3 md:py-4 flex flex-col md:flex-row md:items-center gap-4 md:gap-10 sticky top-0 z-10 border-b border-[#E5E7EB] shrink-0">
            {/* Close button — top-right corner */}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-3 right-3 z-30 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:w-9 md:h-9 flex items-center justify-center text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
            <div className="flex flex-col min-w-0 pr-10">  <div className="flex items-center gap-3">
                <Calculator className="w-5 h-5 text-[#9CA3AF] shrink-0" />
                <h2 className="text-base md:text-lg font-semibold text-[#121316] tracking-tight truncate">
                  {editingTripId ? "Редактирование плана" : "Новый план"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-[#6B7280] ml-0 mt-1.5">
                <span className="text-[var(--accent-ink)] font-semibold">Авто: {carNumber || "—"}</span>
                <span>Направление: {direction || "—"}</span>
                <span>Диспетчер: {dispatcher || "—"}</span>
                <span>Сроки: {dateStart ? new Date(dateStart).toLocaleDateString('ru-RU').replace(/\./g, '/') : "—"} — {dateEnd ? new Date(dateEnd).toLocaleDateString('ru-RU').replace(/\./g, '/') : "—"}</span>
              </div>
              {/* Metadata: кто обновил */}
              {(currentEditingTrip as any)?.updatedBy && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-flex items-center gap-1 bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1 rounded-lg font-semibold text-[#4B5563] shadow-sm text-[11px]">
                    <PenLine className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                    {resolvePersonName((currentEditingTrip as any).updatedBy, dispatcherDirectory)}
                    {(currentEditingTrip as any).updatedAt && (
                      <span className="font-medium text-[#9CA3AF] font-mono">
                        · {(currentEditingTrip as any).updatedAt}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-start mt-3 md:mt-0 md:justify-end">
              <div className="flex bg-[#F3F4F6] rounded-xl p-0.5 gap-0.5 border border-[#E5E7EB] shrink-0" role="tablist" aria-label="Разделы формы рейса">
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "main"}
                  onClick={() => setModalTab("main")}
                  className={`min-h-[44px] md:min-h-0 px-3 md:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${modalTab === "main" ? "bg-white shadow-sm text-[#121316]" : "text-[#6B7280] hover:text-[#121316]"}`}
                >
                  Форма
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "potential"}
                  onClick={() => setModalTab("potential")}
                  className={`min-h-[44px] md:min-h-0 px-3 md:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${modalTab === "potential" ? "bg-white shadow-sm text-[#121316]" : "text-[#6B7280] hover:text-[#121316]"}`}
                >
                  Потенц. грузы
                  {potentialLoads.length > 0 && (
                    <span className="ml-1.5 bg-[var(--accent-ui)] text-[var(--accent-on)] rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                      {potentialLoads.length}
                    </span>
                  )}
                </button>
              </div>

            </div>
          </div>

          <div className="flex-1 w-full md:overflow-y-auto custom-scrollbar p-3 sm:p-6 lg:p-8 space-y-6">
            {modalTab === "main" ? (
              <>
                <div className="grid grid-cols-1 gap-6">
                  {/* Основные реквизиты */}
 <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] flex flex-col">
                    <h3 className="text-sm font-semibold text-[#6B7280] flex items-center gap-2 mb-5">
                      <FileText className="w-4 h-4 text-[#9CA3AF]"/>
                      Основные реквизиты
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Автомобиль</label>
                        <CouplingPicker
                          value={carNumber}
                          onSelect={(rec) => {
                            if (!rec) { handleCarNumberChange(''); return; }
                            handleCarNumberChange(formatCoupling((rec.carNumber || rec.vehicleNumbers || '').toUpperCase()));
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Направление</label>
                        <select
                          value={direction}
                          onChange={(e) => handleDirChange(e.target.value)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors appearance-none min-h-[44px]"
                        >
                          {Object.keys(directions).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Диспетчер</label>
                        <select
                          value={dispatcher}
                          onChange={(e) => setDispatcher(e.target.value)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors appearance-none min-h-[44px]"
                        >
                          <option value="">Не выбран</option>
                          {dispatchers.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[var(--accent-ink)] mb-1.5 block">Дата старта</label>
                        <input
                          type="date"
                          value={dateStart}
                          onChange={(e) => setDateStart(e.target.value)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Дата финиша</label>
                        <input
                          type="date"
                          value={dateEnd}
                          onChange={(e) => setDateEnd(e.target.value)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors min-h-[44px]"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Плечи маршрута */}
                <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB]">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-sm font-semibold text-[#6B7280] flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#9CA3AF]"/>
                      Плечи маршрута
                    </h3>
                    <span className="text-[11px] text-[#9CA3AF] hover:text-[#121316] transition-colors font-medium cursor-pointer">Маршрутная сетка</span>
                  </div>

                  

                  <div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">
                    <table className="w-full w-full flex-wrap border-collapse relative">
                      <thead>
                        <tr>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left w-8">#</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Откуда</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Куда</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Км</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Доезд (км)</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Фрахт €</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Инфо ставка (Доп)</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Паром € (Доп)</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-left">Коэфф.</th>
                          <th className="pb-2.5 text-[11px] font-semibold tracking-normal text-[#9CA3AF] text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="space-y-2">
                        {legs.map((leg, idx) => (
                          <tr key={idx}>

                            <td className="py-1.5 text-xs font-semibold text-[#9CA3AF] font-mono">{idx + 1}</td>
                            <td className="py-1.5 pr-2">
                              <input
                                autoComplete="off"
                                value={leg.from}
                                onChange={(e) => updateLeg(idx, { from: e.target.value })}
                                onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx, field: 'from', isPl: false, rect}); }}
                                onBlur={() => { checkLegDistance(idx); }}
                                className="w-full text-left px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                autoComplete="off"
                                value={leg.to}
                                onChange={(e) => updateLeg(idx, { to: e.target.value })}
                                onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx, field: 'to', isPl: false, rect}); }}
                                onBlur={() => { checkLegDistance(idx); }}
                                className="w-full text-left px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 pr-2 relative">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                onBlur={(e) => {
                                  const kmVal = Number(e.currentTarget.value);
                                  if (!findDistance(leg.from, leg.to) && kmVal > 0 && leg.from && leg.to) {
                                    setAddDistFrom(leg.from);
                                    setAddDistTo(leg.to);
                                    setAddDistKm(kmVal);
                                    setShowAddDistModal(true);
                                  }
                                }}
                                value={leg.km || ""}
                                onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                                className="w-full text-left pl-3 pr-8 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                              <button
                                type="button"
                                onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#D1D5DB] hover:text-[#4B5563] transition-colors"
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
                                className="w-full text-left px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.rate || ""}
                                onChange={(e) => updateLeg(idx, { rate: Number(e.target.value) })}
                                className="w-full text-left px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <div className="flex bg-white border border-[#E5E7EB] rounded-xl overflow-hidden focus-within:border-[var(--accent)] transition-colors">
                                <input
                                  type="text"
                                  value={leg.referenceRate || ""}
                                  onChange={(e) => updateLeg(idx, { referenceRate: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-transparent text-xs font-medium outline-none"
                                />
                                <select
                                  value={leg.referenceCurrency || ""}
                                  onChange={(e) => updateLeg(idx, { referenceCurrency: e.target.value })}
                                  className="bg-transparent border-l border-[#E5E7EB] text-[#6B7280] text-[10px] font-semibold outline-none px-1 cursor-pointer"
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
                                className="w-full text-left px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                step="0.01"
                                value={leg.coeff}
                                onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                                className="w-full px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="py-1.5 text-right whitespace-nowrap space-x-1">
                              <button
                                type="button"
                                onClick={() => addLeg(idx)}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLeg(idx)}
                                disabled={legs.length <= 1}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40 cursor-pointer"
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
                      <div key={idx} className="bg-white border border-[#E5E7EB] rounded-xl p-4 flex flex-col gap-4 relative shadow-sm">
                        <div className="flex justify-between items-center pb-2 border-b border-[#E5E7EB]">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-[#6B7280] bg-[#F3F4F6] px-2 py-1 rounded-md">#{idx + 1}</span>

                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => addLeg(idx)}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] hover:text-[#121316] transition-colors cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeLeg(idx)}
                              disabled={legs.length <= 1}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition-colors disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-[#6B7280]">Откуда</span>
                            <input
                              autoComplete="off"
                              value={leg.from}
                              onChange={(e) => updateLeg(idx, { from: e.target.value })}
                              onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx, field: 'from', isPl: false, rect}); }}
                              onBlur={() => { checkLegDistance(idx); }}
                              className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-[#6B7280]">Куда</span>
                            <input
                              autoComplete="off"
                              value={leg.to}
                              onChange={(e) => updateLeg(idx, { to: e.target.value })}
                              onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx, field: 'to', isPl: false, rect}); }}
                              onBlur={() => { checkLegDistance(idx); }}
                              className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[11px] font-medium text-[#6B7280]">Км</span>
                            <input
                              type="number"
                              value={leg.km || ""}
                              onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                              onBlur={(e) => {
                                const kmVal = Number(e.currentTarget.value);
                                if (!findDistance(leg.from, leg.to) && kmVal > 0 && leg.from && leg.to) {
                                  setAddDistFrom(leg.from);
                                  setAddDistTo(leg.to);
                                  setAddDistKm(kmVal);
                                  setShowAddDistModal(true);
                                }
                              }}
                              className="w-full pl-3 pr-12 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#9CA3AF] hover:text-[var(--accent-ink)] rounded-lg transition-colors"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[11px] font-medium text-[#6B7280]">Доезд (км)</span>
                            <input
                              type="number"
                              value={leg.emptyRun || ""}
                              onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                              className="w-full pl-3 pr-12 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, true)}
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#9CA3AF] hover:text-[var(--accent-ink)] rounded-lg transition-colors"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-[#6B7280]">Фрахт</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.rate ?? ""}
                                placeholder="0"
                                onChange={(e) => updateLeg(idx, { rate: Number(e.target.value) })}
                                className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                              <select
                                value={leg.freightCurrency}
                                onChange={(e) => updateLeg(idx, { freightCurrency: e.target.value })}
                                className="w-16 px-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg text-[10px] font-bold"
                              >
                                {currencies.map((c) => (
                                  <option key={c.id} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-[#6B7280]">Инфо ставка</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.referenceRate ?? ""}
                                placeholder="0"
                                onChange={(e) => updateLeg(idx, { referenceRate: e.target.value })}
                                className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums text-[#121316] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                              <select
                                value={leg.referenceCurrency || "EUR"}
                                onChange={(e) => updateLeg(idx, { referenceCurrency: e.target.value })}
                                className="w-16 px-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg text-[10px] font-bold"
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
                            <span className="text-[11px] font-medium text-[#6B7280]">Паром €</span>
                            <input
                              type="number"
                              value={leg.ferry || ""}
                              onChange={(e) => updateLeg(idx, { ferry: Number(e.target.value) })}
                              className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-[#6B7280]">Коэфф.</span>
                            <input
                              type="number"
                              step="0.01"
                              value={leg.coeff}
                              onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                              className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                            />
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>

                  
                </div>

                {/* Financial Params & Comment */}
                <div className="bg-white rounded-2xl p-6 border border-[#E5E7EB] flex flex-col gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[#6B7280] flex items-center gap-2 mb-5">
                      <CircleDollarSign className="w-4 h-4 text-[#9CA3AF]"/>
                      Финансовые параметры
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Доп расходы €</label>
                        <input
                          type="number"
                          value={extraExpense || ""}
                          onChange={(e) => setExtraExpense(Number(e.target.value))}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 min-h-[44px] text-sm font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Коммент расходов</label>
                        <input
                          type="text"
                          value={extraExpenseNote}
                          onChange={(e) => setExtraExpenseNote(e.target.value)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 min-h-[44px] text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Факт км</label>
                        <input
                          type="number"
                          placeholder="Введите факт км"
                          value={factKm || ""}
                          onChange={(e) => setFactKm(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 min-h-[44px] text-sm font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-2 block">Цвет плашки рейса</label>
                        <div className="flex flex-wrap gap-2">
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
                              className={`shrink-0 w-11 h-11 md:w-7 md:h-7 rounded-full border-2 ${stripColor === cc ? "border-[#121316] scale-110" : "border-transparent"} ${cc} transition-colors cursor-pointer`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[#E5E7EB] pt-6">
                    <h3 className="text-sm font-semibold text-[#6B7280] flex items-center gap-2 mb-4">
                      <MessageSquare className="w-4 h-4 text-[#9CA3AF]"/>
                      Комментарий к рейсу
                    </h3>
                    <input
                      type="text"
                      value={tripNote}
                      onChange={(e) => setTripNote(e.target.value)}
                      placeholder="Введите дополнительные примечания к рейсу..."
                      className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2.5 min-h-[44px] text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                    />
                  </div>
                </div>


              </>
            ) : modalTab === "potential" ? (

              <div className="flex flex-col gap-6">
                {/* Left side: List of saved Potential Loads */}
                <div className="bg-white rounded-2xl p-5 border border-[#E5E7EB] flex flex-col gap-4">
                  <SectionHeader
                    icon={<Lightbulb className="w-4 h-4" aria-hidden="true" />}
                    tone="accent"
                    title="Расчеты возможных рейсов"
                  >
                    <span className={UI.countBadge}>{potentialLoads.length}/10</span>
                  </SectionHeader>
                  <p className="text-[10px] text-[#9CA3AF] leading-relaxed flex items-center gap-1">
                    <Lightbulb className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                    Здесь вы можете создать несколько вариантов маршрута. Выберите наиболее выгодный (где прибыль больше) и нажмите «Как основной».
                  </p>

                  <div className="space-y-3.5 pr-1.5">
                    {potentialLoads.map((pl) => {
                      const _plTotals = pl.dateStart && pl.dateEnd ? (() => { const dd = Math.max(1, Math.ceil((new Date(pl.dateEnd).getTime() - new Date(pl.dateStart).getTime()) / (1000*60*60*24)) + 1); return { profit: pl.profit, totalKm: pl.totalKm, totalFreight: pl.totalFreight, totalExpenses: pl.totalExpenses, days: dd }; })() : { profit: pl.profit, totalKm: pl.totalKm, totalFreight: pl.totalFreight, totalExpenses: pl.totalExpenses, days: pl.totalKm ? Math.max(1, Math.round(pl.totalKm / 500)) : 1 };
                      const days = _plTotals.days;
                      const profitPerDay = days > 0 ? Math.round(_plTotals.profit / days) : 0;
                      return (
                        <div
                          key={pl.id}
                          className={`p-4 rounded-2xl border transition-colors cursor-pointer flex flex-col gap-3 relative ${plEditingId === pl.id ? "border-[var(--accent-ui)] bg-[#F8F9FA] ring-2 ring-[var(--accent-20)]" : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB] shadow-xs"}`}
                          onClick={() => editPotentialLoad(pl)}
                        >
                          <div className="flex justify-between items-center">
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-sm text-[#121316] tracking-tight truncate block max-w-full">
                                {pl.name}
                              </span>
                              {pl.dateStart && pl.dateEnd && (
                                <span className="text-[10px] text-[#9CA3AF] font-mono mt-0.5 block">
                                  {pl.dateStart.split('-').reverse().join('/')} → {pl.dateEnd.split('-').reverse().join('/')} · {days} дн.
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1.5 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="min-h-[44px] md:min-h-0 px-3 py-1.5 text-[10px] font-semibold bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                                title="Перенести этот маршрут в основную форму"
                                onClick={() => applyPlToMain(pl)}
                              >
                                <Calculator className="w-3.5 h-3.5" />
                                Как основной
                              </button>
                              <button
                                className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:w-8 md:h-8 flex items-center justify-center rounded-lg bg-[#F3F4F6] hover:bg-rose-50 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Удалить"
                                onClick={() => deletePotentialLoad(pl.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="bg-[#F8F9FA] rounded-xl border border-[#E5E7EB] p-2.5">
                            <div className="text-[11px] font-semibold tracking-normal text-[#6B7280] mb-2">Маршрут</div>
                            {pl.legs && pl.legs.length > 0 ? (
                              <div className="space-y-1.5">
                                {pl.legs.slice(0, 5).map((leg, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs">
                                    <span className="text-[#6B7280] font-mono w-5 shrink-0 text-[10px]">{idx + 1}.</span>
                                    <span className="text-[#4B5563] font-medium truncate min-w-0 flex-[1.5]">{leg.from || "?"}</span>
                                    <span className="text-[#D1D5DB] shrink-0">→</span>
                                    <span className="text-[#4B5563] font-medium truncate min-w-0 flex-[1.5]">{leg.to || "?"}</span>
                                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                                      <span className="text-[#6B7280]">{leg.km} <span className="text-[10px] text-[#9CA3AF]">км</span></span>
                                      <span className="text-[#121316] font-semibold">{leg.rate || 0} <span className="text-[10px] text-[#9CA3AF]">€</span></span>
                                      {leg.referenceRate && <span className="text-[#9CA3AF] text-[10px]">({leg.referenceRate} {leg.referenceCurrency})</span>}
                                    </div>
                                  </div>
                                ))}
                                {pl.legs.length > 5 && (
                                  <div className="text-[10px] text-[#9CA3AF] font-mono pl-7">+{pl.legs.length - 5} плеч</div>
                                )}
                              </div>
                            ) : (
                              <div className="text-[10px] text-[#9CA3AF]">Нет маршрута</div>
                            )}
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">Прибыль</span>
                              <span className={`text-sm font-bold font-mono tabular-nums ${pl.profit < 3000 ? "text-rose-600" : "text-emerald-600"}`}>
                                {Math.round(pl.profit).toLocaleString("ru-RU")} <span className="text-[10px] font-semibold">€</span>
                              </span>
                            </div>
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">В день</span>
                              <span className={`text-sm font-bold font-mono tabular-nums ${profitPerDay < 100 ? "text-rose-600" : "text-[#121316]"}`}>
                                {profitPerDay.toLocaleString("ru-RU")} <span className="text-[10px] font-semibold">€</span>
                              </span>
                            </div>
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">Фрахт</span>
                              <span className="text-sm font-bold text-[#4B5563] font-mono tabular-nums">
                                {Math.round(pl.totalFreight).toLocaleString("ru-RU")} <span className="text-[10px] font-semibold">€</span>
                              </span>
                            </div>
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">Расходы</span>
                              <span className="text-sm font-bold text-[#4B5563] font-mono tabular-nums">
                                {Math.round(pl.totalExpenses).toLocaleString("ru-RU")} <span className="text-[10px] font-semibold">€</span>
                              </span>
                            </div>
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">Пробег</span>
                              <span className="text-sm font-bold text-[#4B5563] font-mono tabular-nums">
                                {Math.round(pl.totalKm).toLocaleString("ru-RU")} <span className="text-[10px] font-semibold">км</span>
                              </span>
                            </div>
                            <div className="bg-[#F8F9FA] p-2 rounded-xl border border-[#E5E7EB] flex flex-col">
                              <span className="text-[11px] font-semibold text-[#9CA3AF] mb-0.5">Дней в пути</span>
                              <span className="text-sm font-bold text-[#4B5563] font-mono tabular-nums">{days}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {potentialLoads.length === 0 && (
                      <span className="text-xs text-[#9CA3AF] font-medium font-mono text-center block py-6">
                        Нет сохраненных просчетов
                      </span>
                    )}
                  </div>

                  {potentialLoads.length < 10 && plEditingId === null && (
                    <div className="w-full mt-auto py-2 px-3 bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] font-semibold text-[11px] rounded-xl text-center cursor-default font-sans">
                      Можно создать еще {10 - potentialLoads.length}
                    </div>
                  )}
                  {plEditingId !== null && (
                    <button
                      className="w-full mt-auto min-h-[44px] py-2 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] font-semibold text-xs rounded-xl transition-colors cursor-pointer text-center"
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
                <div className="bg-white rounded-2xl p-5 border border-[#E5E7EB] flex flex-col gap-5">
                  <div className="flex items-center gap-4 border-b border-[#E5E7EB] pb-4">
                    <input
                      type="text"
                      placeholder="Название (напр: Груз на Москву)..."
                      value={plName}
                      onChange={(e) => setPlName(e.target.value)}
                      className="flex-1 bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors placeholder:text-[#9CA3AF]"
                    />
                    <button
                      onClick={savePotentialLoad}
                      className="inline-flex items-center justify-center gap-1.5 px-5 py-2 min-h-[44px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] rounded-xl text-xs font-semibold shadow-sm transition-colors min-w-[120px] cursor-pointer"
                    >
                      {plEditingId ? "Обновить" : "Сохранить"}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-b border-[#E5E7EB] pb-4">
                    <div>
                      <label className="text-[11px] font-semibold tracking-normal text-[var(--accent-ink)] mb-1.5 block">Дата старта</label>
                      <input type="date" value={plDateStart} onChange={(e) => setPlDateStart(e.target.value)} className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors min-h-[44px]" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold tracking-normal text-[#9CA3AF] mb-1.5 block">Дата финиша</label>
                      <input type="date" value={plDateEnd} onChange={(e) => setPlDateEnd(e.target.value)} className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-xl px-3.5 py-2 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors min-h-[44px]" />
                    </div>
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block overflow-x-auto pb-2">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="border-b border-[#E5E7EB]">
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Откуда</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Куда</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Км</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Доезд (км)</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Фрахт €</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Инфо ставка (Доп)</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Паром € (Доп)</th>
                          <th className="p-2 text-[11px] font-medium text-[#6B7280] tracking-wider font-sans">Коэфф.</th>
                          <th className="p-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {plLegs.map((leg, i) => (
                          <tr key={i} className="border-b border-[#E5E7EB] last:border-b-0">
                            <td className="p-1">
                              <input
                                type="text"
                                autoComplete="off"
                                value={leg.from}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].from = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx: i, field: 'from', isPl: true, rect}); }}
                                onBlur={() => { checkLegDistance(i, true); }}
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors font-sans"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="text"
                                autoComplete="off"
                                value={leg.to}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].to = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx: i, field: 'to', isPl: true, rect}); }}
                                onBlur={() => { checkLegDistance(i, true); }}
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors font-sans"
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
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg pl-2.5 pr-8 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors tabular-nums font-mono"
                              />
                              <button
                                onClick={() => openMapRouteModal(i, leg.from, leg.to, true)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[var(--accent-ink)] transition-colors cursor-pointer"
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
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors tabular-nums font-mono"
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
                                className="w-full bg-white hover:bg-[#F8F9FA] border border-[#E5E7EB] text-[#4B5563] rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors tabular-nums font-mono"
                              />
                            </td>
                            <td className="p-1">
                              <div className="flex bg-white border border-[#E5E7EB] rounded-xl overflow-hidden focus-within:border-[var(--accent)] transition-colors">
                                <input type="text" value={leg.referenceRate || ""}
                                  onChange={(e) => {
                                    const nl = [...plLegs];
                                    nl[i].referenceRate = e.target.value;
                                    const eur = calculateEuroFreight(e.target.value, nl[i].referenceCurrency || 'EUR');
                                    if (eur > 0) nl[i].rate = eur;
                                    setPlLegs(nl);
                                  }}
                                  className="w-full px-2.5 py-1.5 bg-transparent text-xs font-medium outline-none"
                                />
                                <select value={leg.referenceCurrency || ""}
                                  onChange={(e) => {
                                    const nl = [...plLegs];
                                    nl[i].referenceCurrency = e.target.value;
                                    const eur = calculateEuroFreight(nl[i].referenceRate || '', e.target.value);
                                    if (eur > 0) nl[i].rate = eur;
                                    setPlLegs(nl);
                                  }}
                                  className="bg-transparent border-l border-[#E5E7EB] text-[#6B7280] text-[10px] font-semibold outline-none px-1 cursor-pointer"
                                >
                                  <option value=""></option>
                                  {currencies.map((c) => (
                                    <option key={c.id} value={c.code}>{c.code}</option>
                                  ))}
                                </select>
                              </div>
                            </td>
                            <td className="p-1">
                              <input type="number" onFocus={(e) => e.target.select()} value={leg.ferry || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].ferry = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
                              />
                            </td>
                            <td className="p-1">
                              <input type="number" step="0.01" onFocus={(e) => e.target.select()} value={leg.coeff}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].coeff = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-white border border-[#E5E7EB] text-[#121316] rounded-lg px-2.5 py-1.5 text-xs font-medium font-mono tabular-nums outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors"
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
                                  className="w-7 h-7 rounded-lg bg-[#F3F4F6] text-[#4B5563] flex items-center justify-center hover:bg-[#E5E7EB] transition-colors cursor-pointer"
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
                                  className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-100 transition-colors cursor-pointer"
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

                  {/* Mobile: Cards for Legs */}
                  <div className="block lg:hidden space-y-3">
                    {plLegs.map((leg, i) => (
                      <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-3.5 flex flex-col gap-3 relative shadow-sm">
                        <div className="flex justify-between items-center pb-2 border-b border-[#E5E7EB]">
                          <span className="text-xs font-bold text-[#6B7280] bg-[#F3F4F6] px-2 py-1 rounded-md">#{i + 1}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const nl = [...plLegs];
                                nl.splice(i + 1, 0, { from: "", to: "", km: 0, rate: 0, ferry: 0, coeff: directions[direction] || 0 });
                                setPlLegs(nl);
                              }}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] transition-colors cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (plLegs.length > 1) {
                                  const nl = [...plLegs];
                                  nl.splice(i, 1);
                                  setPlLegs(nl);
                                }
                              }}
                              disabled={plLegs.length <= 1}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-500 transition-colors disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-medium text-[#6B7280]">Откуда</span>
                            <input type="text" autoComplete="off" value={leg.from} onChange={(e) => { const nl = [...plLegs]; nl[i].from = e.target.value; setPlLegs(nl); }} onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx: i, field: 'from', isPl: true, rect}); }} onBlur={() => { checkLegDistance(i, true); }} className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-medium text-[#6B7280]">Куда</span>
                            <input type="text" autoComplete="off" value={leg.to} onChange={(e) => { const nl = [...plLegs]; nl[i].to = e.target.value; setPlLegs(nl); }} onFocus={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setCityDropdown({idx: i, field: 'to', isPl: true, rect}); }} onBlur={() => { checkLegDistance(i, true); }} className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1 relative">
                            <span className="text-[11px] font-medium text-[#6B7280]">Км</span>
                            <input type="number" value={leg.km || ""} onChange={(e) => { const nl = [...plLegs]; nl[i].km = Number(e.target.value); setPlLegs(nl); }} onBlur={(e) => { const kmVal = Number(e.currentTarget.value); if (leg.from && leg.to && kmVal > 0 && !findDistance(leg.from, leg.to)) { setAddDistFrom(leg.from); setAddDistTo(leg.to); setAddDistKm(kmVal); setShowAddDistModal(true); } }} className="w-full pl-3 pr-12 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors" />
                            <button onClick={() => openMapRouteModal(i, leg.from, leg.to, true)} className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#9CA3AF] hover:text-[var(--accent-ink)] transition-colors"><MapPin className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-medium text-[#6B7280]">Доезд (км)</span>
                            <input type="number" value={leg.emptyRunKm || ""} onChange={(e) => { const nl = [...plLegs]; nl[i].emptyRunKm = Number(e.target.value); setPlLegs(nl); }} className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-medium font-mono outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors" />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-medium text-[#6B7280]">Ставка €</span>
                          <input type="number" value={leg.rate || ""} onChange={(e) => { const nl = [...plLegs]; nl[i].rate = Number(e.target.value); setPlLegs(nl); }} className="w-full px-3 py-2 min-h-[44px] bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold font-mono text-[#4B5563] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {/* UNIFIED STICKY FOOTER: stats + actions, always visible */}
          <div className="shrink-0 bg-white border-t border-[#E5E7EB] z-20 md:sticky md:bottom-0">
            {/* Light stats block — single layer, app style */}
            <div className="px-4 sm:px-6 lg:px-8 py-4 bg-[#F8F9FA]">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                {/* Прибыль общая — green */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">Прибыль общая</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-lg font-bold font-mono tabular-nums ${Math.round(modalTab === "potential" ? calculatePlTotals().profit : profit) < 3000 ? "text-rose-600" : "text-emerald-600"}`}>{Math.round(modalTab === "potential" ? calculatePlTotals().profit : profit).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">€</span>
                  </div>
                </div>
                {/* Прибыль в день — blue */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">Прибыль в день</span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-lg font-bold font-mono tabular-nums ${Math.round(modalTab === "potential" ? (calculatePlTotals().days > 0 ? Math.round(calculatePlTotals().profit / calculatePlTotals().days) : 0) : rawProfitPerDay) < 100 ? "text-rose-600" : "text-emerald-600"}`}>{Math.round(rawProfitPerDay).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">€</span>
                  </div>
                </div>
                {/* Количество дней — orange */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">Количество дней</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-[#121316] font-mono tabular-nums">{modalTab === "potential" ? (calculatePlTotals().days > 0 ? calculatePlTotals().days : 1) : (daysPlan || daysFact || 0)}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">дн.</span>
                  </div>
                </div>
                {/* План км */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">{factKm && factKm > 0 ? "Километраж" : "План км"}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-[#121316] font-mono tabular-nums">{Math.round(modalTab === "potential" ? calculatePlTotals().totalKm : (factKm && factKm > 0 ? factKm : totalKm)).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">км</span>
                    {factKm && factKm > 0 && <span className="text-[11px] text-emerald-600 ml-1.5 font-semibold">Факт</span>}
                  </div>
                </div>
                {/* Фрахт — blue */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">Фрахт</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-[#121316] font-mono tabular-nums">{Math.round(modalTab === "potential" ? calculatePlTotals().totalFreight : totalFreight).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">€</span>
                  </div>
                </div>
                {/* Расходы */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] px-4 py-3 flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-[#6B7280]">{factKm && factKm > 0 ? "Расходы" : "Расходы (План)"}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold text-[#121316] font-mono tabular-nums">{Math.round(modalTab === "potential" ? calculatePlTotals().totalExpenses : totalExpenses).toLocaleString("ru-RU")}</span>
                    <span className="text-sm font-semibold text-[#9CA3AF]">€</span>
                    {factKm && factKm > 0 && <span className="text-[11px] text-emerald-600 ml-1.5 font-semibold">Факт</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons row */}
            <div className="bg-white px-3 md:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-2 shrink-0">
                {isEditing && currentEditingTrip && (
                  <button
                    onClick={() => deleteTrip(editingTripId!, true)}
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 md:px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold tracking-tight transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" /> Удалить
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2.5 w-full md:w-auto">
                {isEditing && currentEditingTrip && (
                  currentEditingTrip.isArchived ? (
                    <button
                      onClick={() => {
                        pdService.restoreTrip(editingTripId, user.name, user.role);
                        setIsModalOpen(false);
                      }}
                      className="bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] px-4 py-2.5 min-h-[44px] rounded-xl font-bold text-sm tracking-tight transition-colors flex-1 md:flex-none cursor-pointer"
                    >
                      Из архива
                    </button>
                  ) : (
                    <button
                      onClick={() => finishTripToArchive(currentEditingTrip, true)}
                      className="bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] px-4 py-2.5 min-h-[44px] rounded-xl font-bold text-sm tracking-tight transition-colors flex items-center justify-center gap-2 flex-1 md:flex-none cursor-pointer"
                    >
                      <Archive className="w-4 h-4 hidden md:block" /> В архив
                    </button>
                  )
                )}
                <button
                  onClick={saveTrip}
                  disabled={isSubmitting}
                  className={`${isSubmitting ? "bg-[var(--accent)] opacity-50 cursor-not-allowed" : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] cursor-pointer"} text-[var(--accent-on)] px-6 py-2.5 min-h-[44px] rounded-xl font-bold text-sm tracking-tight transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none`}
                >
                  <Save className="w-4 h-4 hidden md:block" /> {isSubmitting ? "Сохранение..." : "Сохранить"}
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
                  valA = ((a.profitFact !== undefined ? a.profitFact : a.profit) || 0) / (a.days || 1);
                  valB = ((b.profitFact !== undefined ? b.profitFact : b.profit) || 0) / (b.days || 1);
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

    if (archived && !archiveListLoaded) {
      return (
        <div className={UI.loading} role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Загрузка архива…</span>
        </div>
      );
    }

    if (list.length === 0) {
      const isFiltering =
        searchCarQuery.trim().length > 0 ||
        (!archived &&
          ((activeDispatcherTab !== "Все диспетчеры" && activeDispatcherTab !== "All") ||
            activeDirectionTab !== "All"));
      return (
        <EmptyState
          kind={isFiltering ? "no-results" : "empty"}
          title={isFiltering ? undefined : archived ? "Архив пуст" : "Список планирования пуст"}
          hint={
            isFiltering
              ? archived
                ? "Измените номер в поиске."
                : "Измените номер в поиске или снимите фильтры по диспетчеру и направлению."
              : archived
                ? "Рейсы появятся здесь после завершения — на карточке нажмите «В архив»."
                : "Создайте первый рейс кнопкой «Новый план» — карточка появится в этом списке."
          }
          query={searchCarQuery.trim() || undefined}
        />
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
        <span className="text-[#9CA3AF] ml-1">
          {sortConfig.dir === "asc" ? "↑" : "↓"}
        </span>
      );
    };

    const marginRate = sumFreight > 0 ? Math.round((sumProfit / sumFreight) * 100) : 0;
    const profitPerDayValue = sumDays > 0 ? Math.round(sumProfit / sumDays) : 0;
    const listQuality = list.length > 0 ? Math.round((profitableCount / list.length) * 100) : 0;

    const renderKpiSummary = (isBottom: boolean) => {
      return (
        <div className={`grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-4 sm:p-5 ${isBottom ? "mt-4" : "mb-2"}`}>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-[#6B7280] mb-1.5">
              Общая прибыль
            </span>
            <span className={`text-2xl lg:text-3xl font-bold tracking-tight font-sans tabular-nums ${sumProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {Math.round(sumProfit).toLocaleString("ru-RU")} <span className="text-sm font-medium text-[#9CA3AF]">€</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-[#E5E7EB] lg:pl-6">
            <span className="text-[10px] font-semibold text-[#6B7280] mb-1.5">
              Маржинальность
            </span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-[#121316] font-sans tabular-nums">
              {marginRate}%
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-[#E5E7EB] lg:pl-6">
            <span className="text-[10px] font-semibold text-[#6B7280] mb-1.5">
              Прибыль в день
            </span>
            <span className={`text-2xl lg:text-3xl font-bold tracking-tight font-sans tabular-nums ${profitPerDayValue < 100 ? "text-rose-600" : "text-[#121316]"}`}>
              {profitPerDayValue.toLocaleString("ru-RU")} <span className="text-sm font-medium text-[#9CA3AF]">€</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-[#E5E7EB] lg:pl-6">
            <span className="text-[10px] font-semibold text-[#6B7280] mb-1.5">
              Общий пробег
            </span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-[#121316] font-sans tabular-nums">
              {Math.round(sumKm).toLocaleString("ru-RU")} <span className="text-xs font-medium text-[#9CA3AF]">км</span>
            </span>
          </div>
          <div className="flex flex-col lg:border-l lg:border-[#E5E7EB] lg:pl-6 col-span-2 lg:col-span-1">
            <span className="text-[10px] font-semibold text-[#6B7280] mb-1.5">
              Качество списка
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl lg:text-3xl font-bold tracking-tight text-[#121316] font-sans tabular-nums">
                {listQuality}%
              </span>
              <span className="text-xs font-semibold text-emerald-600 font-sans">
                +{profitableCount} в плюс
              </span>
            </div>
            <span className="text-[10px] text-[#6B7280] font-medium mt-0.5">
              Всего: {profitableCount} из {list.length}
            </span>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-4 relative w-full overflow-visible transition-all duration-150" style={{ zoom: tableScale / 100 } as any}>
        
        {/* KPI Summary Dashboard Panel - ABOVE for Archive */}
        {archived && renderKpiSummary(false)}

        {/* Table Headers */}
        <div className="hidden lg:flex px-6 pb-3 border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider self-start w-full cursor-pointer select-none tracking-normal">
          <div
            className="min-w-[200px] hover:text-[#121316] transition-colors flex items-center gap-1"
            onClick={() => handleSort("carNumber")}
          >
            Автомобиль {renderSortIndicator("carNumber")}
          </div>
          <div
            className="min-w-[140px] hover:text-[#121316] transition-colors flex items-center gap-1"
            onClick={() => handleSort("dateStart")}
          >
            Даты {renderSortIndicator("dateStart")}
          </div>
          <div className="flex-1 min-w-[220px]">Маршрут</div>
          <div className="min-w-[480px] flex gap-4 pl-6 justify-end">
            <span
              className="w-20 hover:text-[#121316] transition-colors flex items-center gap-1 justify-end"
              onClick={() => handleSort("km")}
            >
              Км {renderSortIndicator("km")}
            </span>
            <span
              className="w-20 hover:text-[#121316] transition-colors flex items-center gap-1 justify-end"
              onClick={() => handleSort("freight")}
            >
              Фрахт {renderSortIndicator("freight")}
            </span>
            <span
              className="w-20 hover:text-[#121316] transition-colors flex items-center gap-1 justify-end"
              onClick={() => handleSort("expenses")}
            >
              Расходы {renderSortIndicator("expenses")}
            </span>
            <span
              className="w-24 hover:text-[#121316] transition-colors flex items-center gap-1 justify-end"
              onClick={() => handleSort("profit")}
            >
              Прибыль {renderSortIndicator("profit")}
            </span>
            <span className="w-12 text-right">Дни</span>
            <span
              className="w-20 text-right hover:text-[#121316] transition-colors flex items-center gap-1 justify-end"
              onClick={() => handleSort("profitDay")}
            >
              В день {renderSortIndicator("profitDay")}
            </span>
          </div>
        </div>

        {/* Pure Map List instead of Virtuoso (solves ResizeObserver infinite loops under CSS zoom) */}
        <div className="flex flex-col gap-3 w-full">
          {list.map((trip) => {
            const firstLeg = trip.legs?.[0];
            const lastLeg = trip.legs?.[trip.legs.length - 1];
            const routeTitle =
              firstLeg?.from && lastLeg?.to
                ? `${firstLeg.from} → ${lastLeg.to}`
                : "Плечи маршрута";
            // Короткие даты «дд/мм» — та же форма, что была в карточке до редизайна
            const fmtShortDate = (value?: string) =>
              value
                ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }).replace(/\./g, "/")
                : "—";
            const dateStartFmt = fmtShortDate(trip.dateStart);
            const dateEndFmt = fmtShortDate(trip.dateEnd);

            const isHighlighted =
              trip.carNumber &&
              highlightedCar === trip.carNumber.trim().toUpperCase();

            // Цвет точки направления (те же цвета, что были у бейджа)
            const getDirectionDotClass = (dir: string) => {
              const d = (dir || "").toLowerCase();
              if (d.includes("китай")) return "bg-amber-400";
              if (d.includes("турция")) return "bg-blue-400";
              return "bg-[#9CA3AF]";
            };

            // Диспетчер: имя из записи, иначе — по автору, с полным именем из учётной записи.
            // Точка у имени окрашена цветом диспетчера из пресетов (аккуратная подача вместо бейджа).
            const dispatcherName = trip.dispatcher || resolvePersonName(trip.logist, dispatcherDirectory) || "—";
            const colorKey = dispatchersColors[dispatcherName];
            const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
            const dispDotColor = preset?.colorCode || "#9CA3AF";

            return (
              <div
                key={trip.id}
                data-trip-id={trip.id}
                onClick={() => loadTripToForm(trip)}
                className={`car-strip-item bg-white rounded-2xl p-4 border shadow-xs transition-colors duration-150 group relative hover:border-[#D1D5DB] hover:bg-[#F9FAFB] flex flex-col gap-3.5 cursor-pointer w-full ${isHighlighted ? "border-amber-400 ring-2 ring-amber-400/20" : "border-[#E5E7EB]"}`}
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
                {/* Блок 1: автомобиль и направление — сверху и крупно */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                    <span className="text-lg font-bold tracking-tight text-[#121316] break-words">{trip.carNumber}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-[#F8F9FA] px-2.5 py-1 text-[11px] font-medium text-[#4B5563]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getDirectionDotClass(trip.direction || "")}`} aria-hidden="true" />
                      {trip.direction || "—"}
                    </span>
                    {archived && trip.currentMonth && (
                      <span className="inline-flex items-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#4B5563]">
                        {trip.currentMonth}
                      </span>
                    )}
                  </div>
                  {/* Действия: клик по ним не открывает форму */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => loadTripToForm(trip)}
                      className={`${UI.buttonIcon} w-11 h-11 shrink-0`}
                      title="Редактировать"
                      aria-label="Редактировать"
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                    {!archived ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); finishTripToArchive(trip); }}
                        className={`${UI.buttonIcon} w-11 h-11 shrink-0`}
                        title="В архив"
                        aria-label="В архив"
                      >
                        <Archive className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ) : user.role === "root_admin" ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteTrip(trip.id); }}
                        className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                        title="Удалить"
                        aria-label="Удалить"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Блок 2: диспетчер и даты старт/финиш */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] text-[#9CA3AF]">Диспетчер</span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dispDotColor }} aria-hidden="true" />
                    <span className="text-xs font-medium text-[#121316] break-words">{formatToTitleCase(dispatcherName)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] text-[#9CA3AF]">Старт</span>
                    <span className="text-xs font-semibold text-[#121316] font-mono tabular-nums">{dateStartFmt}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[11px] text-[#9CA3AF]">Финиш</span>
                    <span className="text-xs font-semibold text-[#121316] font-mono tabular-nums">{dateEndFmt}</span>
                  </span>
                  {(trip as any).updatedBy && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F8F9FA] px-2 py-1 text-[11px] text-[#6B7280] max-w-full">
                      <PenLine className="w-3 h-3 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                      <span className="truncate min-w-0 max-w-[160px] font-medium text-[#4B5563]" title={resolvePersonName((trip as any).updatedBy, dispatcherDirectory)}>
                        {resolvePersonName((trip as any).updatedBy, dispatcherDirectory)}
                      </span>
                      {(trip as any).updatedAt && (
                        <span className="text-[#9CA3AF] font-mono shrink-0">· {(trip as any).updatedAt}</span>
                      )}
                    </span>
                  )}
                </div>

                {/* Блок 3: маршрут — пункты переносятся, важные названия не обрезаются */}
                <div className="w-full rounded-xl border border-[#E5E7EB] bg-[#F8F9FA] p-3">
                  <div className="flex items-center gap-1.5 mb-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                    <span className="text-xs font-semibold tracking-tight text-[#121316] break-words">{routeTitle}</span>
                  </div>
                  {trip.legs && trip.legs.length > 0 ? (
                    <div className="flex flex-col gap-1.5 pl-1 ml-1.5 border-l-2 border-[#E5E7EB]">
                      {trip.legs.map((leg, i) => {
                        const isActive = trip.activeLegIndex === i;
                        return (
                          <div
                            key={i}
                            className={`flex items-start gap-2 text-xs p-1 -ml-2 rounded-md ${isActive ? "bg-[#F3F4F6] text-[#121316] font-medium" : "text-[#6B7280]"}`}
                          >
                            <div className={`w-2 h-2 mt-0.5 rounded-full border flex-shrink-0 -ml-[10px] ${isActive ? "bg-[#121316] border-white shadow-xs scale-110" : "bg-[#D1D5DB] border-white"}`} />
                            <span className="min-w-0 break-words leading-snug">
                              {leg.from || "?"} <span className="text-[#D1D5DB]">→</span> {leg.to || "?"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#9CA3AF] italic">Маршрут не задан</div>
                  )}
                </div>

                {/* Блок 4: показатели — главное в карточке */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-3 border-t border-[#E5E7EB] pt-3 w-full">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">Км</span>
                    <span className="text-sm font-semibold text-[#4B5563] font-mono tabular-nums whitespace-nowrap">{Math.round(trip.factKm || trip.totalKm || 0).toLocaleString("ru-RU")}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">Фрахт</span>
                    <span className="text-sm font-semibold text-[#4B5563] font-mono tabular-nums whitespace-nowrap">{Math.round(trip.totalFreight || 0).toLocaleString("ru-RU")}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">Расходы</span>
                    <span className="text-sm font-semibold text-rose-600/90 font-mono tabular-nums whitespace-nowrap">{Math.round(trip.totalExpenses !== undefined ? trip.totalExpenses : (trip.totalFreight - (trip.profit || 0))).toLocaleString("ru-RU")}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">Прибыль</span>
                    <span className={`text-base font-bold font-mono tabular-nums whitespace-nowrap ${(trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) < 0 ? "text-rose-600" : "text-[var(--accent-ink)]"}`}>
                      {Math.round(trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">Дни</span>
                    <span className="text-sm font-semibold text-[#6B7280] font-mono tabular-nums whitespace-nowrap">{trip.days || "—"}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] text-[#6B7280] leading-tight">В день</span>
                    <span className={`text-sm font-semibold font-mono tabular-nums whitespace-nowrap ${Math.round((trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) / (trip.days || 1)) < 0 ? "text-rose-600" : "text-[var(--accent-ink)]"}`}>
                      {Math.round((trip.profitFact !== undefined ? trip.profitFact : (trip.profit || 0)) / (trip.days || 1)).toLocaleString("ru-RU")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* KPI Summary Dashboard Panel - BELOW for Active */}
        {!archived && renderKpiSummary(true)}
      </div>
    );
  };

  const renderHistory = () => {
    return (
      <div className="pt-5 flex flex-col gap-4">
        <SectionHeader
          icon={<History className="w-4 h-4" aria-hidden="true" />}
          title="История изменений"
          subtitle="Кто и когда менял планы рейсов"
        />
        {!logsLoaded ? (
          <div className={UI.loading} role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span>Загрузка истории…</span>
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            kind="empty"
            title="История пуста"
            hint="Действия по планам рейсов появятся здесь."
          />
        ) : (
          <div className="flex flex-col max-h-[700px] overflow-y-auto custom-scrollbar pr-1">
            {[...logs]
              .sort(
                (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
              )
              .map((log, idx) => (
                <div
                  key={`${log.id || 'log'}_${idx}`}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-3.5 border-b border-[#E5E7EB] last:border-0"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-[#121316]">
                      {log.actionType}
                    </span>
                    <span className="text-[11px] text-[#4B5563] leading-relaxed font-sans">
                      {log.details}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-[#9CA3AF] font-sans">
                    <div className="flex flex-col text-right">
                      <span className="font-semibold text-[#121316]">{log.user}</span>
                      <span className="text-[10px] text-[#9CA3AF] font-mono">{log.role}</span>
                    </div>
                    <div className="text-right whitespace-nowrap font-mono text-[#6B7280]">
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
          </div>
        )}
      </div>
    );
  };

  // Announcement popup — один раз для пользователя
  const dismissAnnounce = () => {
    setShowAnnounce(false);
    const seenKey = `pl_dohod_announce_${user.uid || user.name || 'default'}`;
    localStorage.setItem(seenKey, '1');
    // Сохраняем в Firebase для синхронизации между устройствами
    import('firebase/database').then(({ref: fbRef, set}) => {
      const {database} = require('../../firebase');
      set(fbRef(database, `users_list/${user.uid}/plDohodAnnounceSeen`), true).catch(() => {});
    }).catch(() => {});
  };

  const announceModal = showAnnounce ? (
    <ModalShell
      isOpen={showAnnounce}
      onClose={dismissAnnounce}
      title="Потенциальные грузы"
      subtitle="Новая возможность в Плане дохода"
      icon={<Calculator className="w-4 h-4" aria-hidden="true" />}
      iconTone="accent"
      ariaLabel="Потенциальные грузы"
      footer={
        <button
          onClick={dismissAnnounce}
          className={`${UI.buttonPrimary} w-full`}
        >
          Понятно, спасибо!
        </button>
      }
    >
      <div className="space-y-4 text-sm text-[#4B5563] leading-relaxed">
        <p>
          <strong className="text-[#121316]">Теперь вы можете сохранять потенциальные грузы</strong> прямо в Плане дохода, чтобы просчитывать их рентабельность и сравнивать с текущими рейсами.
        </p>

        <div className="bg-[#F8F9FA] rounded-xl p-4 border border-[#E5E7EB] space-y-3">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-lg bg-[#121316] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <div>
              <span className="font-semibold text-[#121316]">Добавьте груз</span>
              <p className="text-[12px] text-[#6B7280]">В модалке редактирования рейса переключитесь на вкладку «Потенц. грузы» и нажмите «+ Добавить».</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-lg bg-[#121316] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <div>
              <span className="font-semibold text-[#121316]">Заполните маршрут</span>
              <p className="text-[12px] text-[#6B7280]">Укажите плечи (откуда→куда), километраж, фрахт — система сама посчитает прибыль, расходы и рентабельность.</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-lg bg-[#121316] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <div>
              <span className="font-semibold text-[#121316]">Примените к рейсу</span>
              <p className="text-[12px] text-[#6B7280]">Нажмите «Вставить в форму» — маршрут и расчёты скопируются в основную форму рейса.</p>
            </div>
          </div>
        </div>

        <div className="border-t border-[#E5E7EB] pt-3 mt-3">
          <p className="text-[12px] text-[#9CA3AF]">
            Можно сохранить до <strong className="text-[#4B5563]">10 потенциальных грузов</strong> на один рейс.
            Данные хранятся в вашем браузере и не теряются при обновлении страницы.
          </p>
        </div>
      </div>
    </ModalShell>
  ) : null;

  return (
    <div className="w-full">
      {announceModal}
      <ModuleShell
        title="План дохода"
        tabs={[
          { key: "active", label: "Активные" },
          { key: "archive", label: "Архив" },
          { key: "history", label: "История" },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as "active" | "archive" | "history")}
        tabsAriaLabel="Вкладки модуля «План дохода»"
        actions={
          <>
            <button
              type="button"
              onClick={toggleNotebook}
              aria-pressed={isNotebookOpen}
              className={`${UI.buttonGhost} ${isNotebookOpen ? "border-[#D1D5DB] bg-[#F3F4F6] text-[#121316]" : ""}`}
            >
              <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
              Блокнот
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              className={UI.buttonPrimary}
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              Новый план
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <span className={UI.caption}>Модуль План Firebase</span>

          {/* Отбор рейсов (вкладка «Активные») */}
          <div className={activeTab === "active" ? "flex flex-col gap-3" : "hidden"}>
            {activeDispatchers.length > 0 && (
              <>
                <SectionHeader
                  icon={<SlidersHorizontal className="w-4 h-4" aria-hidden="true" />}
                  title="Отбор рейсов"
                  subtitle="Фильтры по диспетчеру и направлению"
                />

                {/* Dispatchers Row */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={UI.caption}>Диспетчеры:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeDispatchers.map((d) => (
                      <button
                        key={d}
                        type="button"
                        draggable={d !== "Все диспетчеры"}
                        onDragStart={(e) => {
                          if (d === "Все диспетчеры") return;
                          e.dataTransfer.setData("dispatcher", d);
                        }}
                        onClick={() => setActiveDispatcherTab(d)}
                        aria-pressed={activeDispatcherTab === d}
                        className={`${UI.filterPill} border flex items-center gap-1 truncate max-w-[160px] ${getDispatcherActiveTabStyle(d)}`}
                      >
                        {d === "All" || d === "Все диспетчеры" ? "Все диспетчеры" : formatToTitleCase(d)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Directions Row */}
                {Object.keys(directions).length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#E5E7EB] pt-3">
                    <span className={UI.caption}>Направления:</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {["All", ...Object.keys(directions)].map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setActiveDirectionTab(dir)}
                          aria-pressed={activeDirectionTab === dir}
                          className={`${UI.filterPill} border truncate max-w-[160px] ${
                            activeDirectionTab === dir
                              ? "bg-[#121316] text-white border-[#121316]"
                              : "bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316]"
                          }`}
                        >
                          {dir === "All" ? "Все направления" : dir}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Месяцы архива (вкладка «Архив») */}
          <div className={activeTab === "archive" ? "flex flex-col gap-3" : "hidden"}>
            <SectionHeader
              icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
              title="Месяцы архива"
              subtitle="Рейсы сгруппированы по месяцу завершения"
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {archiveTripsMonths.map((month) => (
                  <button
                    key={month}
                    type="button"
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
                    aria-pressed={archiveMonth === month}
                    className={`${UI.filterPill} border whitespace-nowrap min-w-max flex items-center gap-1.5 ${
                      archiveMonth === month
                        ? "bg-[#121316] text-white border-[#121316]"
                        : "bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316]"
                    }`}
                  >
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {month}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Список рейсов: поиск, масштаб, результаты */}
          <div className="flex flex-col gap-4">
            {(activeTab === "active" || activeTab === "archive") && (
              <SectionHeader
                icon={activeTab === "archive"
                  ? <Archive className="w-4 h-4" aria-hidden="true" />
                  : <Truck className="w-4 h-4" aria-hidden="true" />}
                title={activeTab === "archive" ? "Рейсы в архиве" : "Список рейсов"}
                subtitle={activeTab === "archive"
                  ? "Выбранный месяц архива"
                  : "Нажмите на карточку, чтобы открыть план"}
              />
            )}

            {(activeTab === "active" || activeTab === "archive") && (
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <SearchField
                  value={searchCarQuery}
                  onChange={setSearchCarQuery}
                  placeholder="Быстрый поиск автомобиля по номеру в таблице..."
                  ariaLabel="Быстрый поиск по автомобилям"
                />
                {activeTab === "archive" && !archiveListLoaded ? null : (
                  <FoundCount
                    count={activeTab === "archive" ? archiveTripsComputed.length : activeTripsComputed.length}
                    onReset={
                      searchCarQuery.trim() ||
                      (activeTab === "active"
                        ? (activeDispatcherTab !== "Все диспетчеры" && activeDispatcherTab !== "All") || activeDirectionTab !== "All"
                        : archiveMonth !== null)
                        ? () => {
                            setSearchCarQuery("");
                            if (activeTab === "active") {
                              setActiveDirectionTab("All");
                              setActiveDispatcherTab(activeDispatchers[0] || "Все диспетчеры");
                            } else {
                              setArchiveMonth(null);
                            }
                          }
                        : undefined
                    }
                  />
                )}
                <div className="flex items-center gap-2 lg:ml-auto shrink-0">
                  <span className={UI.caption}>Масштаб:</span>
                  <div className="flex items-center bg-white border border-[#E5E7EB] rounded-xl p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const newScale = Math.max(50, tableScale - 10);
                        setTableScale(newScale);
                        localStorage.setItem(scaleKey, String(newScale));
                      }}
                      className={`${UI.buttonIcon} w-8 h-8`}
                      title="Уменьшить масштаб таблицы"
                      aria-label="Уменьшить масштаб таблицы"
                    >
                      <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <span className="text-[11px] font-semibold font-mono text-[#121316] min-w-[36px] text-center select-none">{tableScale}%</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newScale = Math.min(150, tableScale + 10);
                        setTableScale(newScale);
                        localStorage.setItem(scaleKey, String(newScale));
                      }}
                      className={`${UI.buttonIcon} w-8 h-8`}
                      title="Увеличить масштаб таблицы"
                      aria-label="Увеличить масштаб таблицы"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {tableScale !== 100 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTableScale(100);
                        localStorage.setItem(scaleKey, "100");
                      }}
                      className={UI.buttonLink}
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
        </div>
      </ModuleShell>

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

      {/* Global City Dropdown Portal */}
      {cityDropdown?.rect && (
        <div
          ref={cityDropdownRef}
          className="fixed z-[200] bg-white border border-[#E5E7EB] rounded-xl shadow-sm max-h-40 overflow-y-auto"
          style={{
            top: cityDropdown.rect.bottom + 4 + 'px',
            left: cityDropdown.rect.left + 'px',
            width: cityDropdown.rect.width + 'px',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {cityOptions.filter(c => {
            const val = cityDropdown.isPl
              ? (cityDropdown.field === 'from'
                ? (plLegs[cityDropdown.idx]?.from || '')
                : (plLegs[cityDropdown.idx]?.to || ''))
              : (cityDropdown.field === 'from'
                ? (legs[cityDropdown.idx]?.from || '')
                : (legs[cityDropdown.idx]?.to || ''));
            return !val || c.toLowerCase().includes(val.toLowerCase());
          }).slice(0, 30).map(c => (
            <div
              key={c}
              className="px-3 py-2 text-xs cursor-pointer hover:bg-[#F3F4F6] text-[#4B5563] font-medium truncate"
              onMouseDown={(e) => {
                e.preventDefault();
                if (cityDropdown.isPl) {
                  const nl = [...plLegs];
                  if (cityDropdown.field === 'from') nl[cityDropdown.idx].from = c;
                  else nl[cityDropdown.idx].to = c;
                  setPlLegs(nl);
                } else {
                  updateLeg(cityDropdown.idx, { [cityDropdown.field]: c });
                }
                setCityDropdown(null);
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}

      {/* Add Distance to DB Modal */}
      {showAddDistModal && (
        <ModalShell
          isOpen={showAddDistModal}
          onClose={() => setShowAddDistModal(false)}
          title="Добавить маршрут в базу"
          subtitle={`Маршрут «${addDistFrom} → ${addDistTo}» не найден в базе расстояний. Добавить?`}
          icon={<MapPin className="w-4 h-4" aria-hidden="true" />}
          iconTone="graphite"
          ariaLabel="Добавить маршрут в базу"
          maxWidth="max-w-md"
          footer={
            <>
              <button onClick={() => setShowAddDistModal(false)} className={UI.buttonGhost}>Отмена</button>
              <button onClick={() => { const [a, b] = [addDistFrom.trim(), addDistTo.trim()].sort((x, y) => x.localeCompare(y)); const id = 'dist_' + Date.now().toString(); const checkpoints = addDistCheckpoints.split(',').filter(Boolean).map(s => s.trim()); dbService.saveDistance({ id, from: a, to: b, distance: addDistKm || 0, countryFrom: addDistCountryFrom, countryTo: addDistCountryTo, checkpoints: checkpoints.length > 0 ? checkpoints : undefined, }, user.name, user.role); setShowAddDistModal(false); addToast('Маршрут добавлен в базу расстояний', 'success'); }} className={UI.buttonPrimary}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Добавить
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs text-amber-800 font-medium">
              <strong>Самостоятельный расчёт:</strong> Вносите расстояния, которые вы считаете/знаете сами (карты, опыт), а не только из путевых листов водителей. Это общая база для всех.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-[#6B7280]">Город A</label>
                <input type="text" value={addDistFrom} onChange={(e) => setAddDistFrom(e.target.value)}
                  className={`${UI.input} mt-1`} />
                <div className="mt-1">
                  <select value={addDistCountryFrom} onChange={(e) => setAddDistCountryFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-[10px] font-semibold rounded-lg border border-[#E5E7EB] outline-none focus:border-[var(--accent)] bg-white transition-colors cursor-pointer text-[#4B5563]">
                    <option value="">Страна A</option>
                    {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                      <option key={c} value={c}>{c === 'BY' ? '🇧🇾' : c === 'RUS' ? '🇷🇺' : c === 'KZ' ? '🇰🇿' : c === 'UZ' ? '🇺🇿' : c === 'TJ' ? '🇹🇯' : c === 'KG' ? '🇰🇬' : c === 'MN' ? '🇲🇳' : c === 'CN' ? '🇨🇳' : c === 'TR' ? '🇹🇷' : c === 'IR' ? '🇮🇷' : c === 'GE' ? '🇬🇪' : c === 'AM' ? '🇦🇲' : c === 'AZ' ? '🇦🇿' : ''} {c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#6B7280]">Город B</label>
                <input type="text" value={addDistTo} onChange={(e) => setAddDistTo(e.target.value)}
                  className={`${UI.input} mt-1`} />
                <div className="mt-1">
                  <select value={addDistCountryTo} onChange={(e) => setAddDistCountryTo(e.target.value)}
                    className="w-full px-2 py-1.5 text-[10px] font-semibold rounded-lg border border-[#E5E7EB] outline-none focus:border-[var(--accent)] bg-white transition-colors cursor-pointer text-[#4B5563]">
                    <option value="">Страна B</option>
                    {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                      <option key={c} value={c}>{c === 'BY' ? '🇧🇾' : c === 'RUS' ? '🇷🇺' : c === 'KZ' ? '🇰🇿' : c === 'UZ' ? '🇺🇿' : c === 'TJ' ? '🇹🇯' : c === 'KG' ? '🇰🇬' : c === 'MN' ? '🇲🇳' : c === 'CN' ? '🇨🇳' : c === 'TR' ? '🇹🇷' : c === 'IR' ? '🇮🇷' : c === 'GE' ? '🇬🇪' : c === 'AM' ? '🇦🇲' : c === 'AZ' ? '🇦🇿' : ''} {c}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[#6B7280]">Расстояние (км)</label>
              <input type="number" min="1" value={addDistKm || ''} onChange={(e) => setAddDistKm(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className={`${UI.input} mt-1`} />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[#6B7280] flex items-center gap-1">
                <MapPin className="w-3 h-3" aria-hidden="true" /> Погранпереходы (через запятую)
              </label>
              <div className="flex flex-wrap gap-1 mt-1 mb-1.5">
                {addDistCheckpoints.split(',').filter(Boolean).map((cp, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] font-semibold bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] rounded-lg flex items-center gap-1">
                    {cp.trim()}
                    <button type="button" onClick={() => { const list = addDistCheckpoints.split(',').filter(Boolean); list.splice(i, 1); setAddDistCheckpoints(list.join(', ')); }} className="text-[#9CA3AF] hover:text-rose-500 cursor-pointer p-1 -m-1" aria-label="Удалить погранпереход">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input list="add-dist-cp-list" type="text" value={addDistCpInput}
                  onChange={(e) => setAddDistCpInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = addDistCpInput.trim();
                      if (val) {
                        const existing = addDistCheckpoints.split(',').filter(Boolean).map(s => s.trim());
                        if (!existing.includes(val)) {
                          setAddDistCheckpoints([...existing, val].join(', '));
                          setAddDistCpInput('');
                        }
                      }
                    }
                  }}
                  placeholder="КПП..."
                  className={`${UI.input} flex-1`} />
                <button type="button" onClick={() => { const val = addDistCpInput.trim(); if (val) { const existing = addDistCheckpoints.split(',').filter(Boolean).map(s => s.trim()); if (!existing.includes(val)) { setAddDistCheckpoints([...existing, val].join(', ')); setAddDistCpInput(''); } } }} className={`${UI.buttonGhost} shrink-0 min-w-[44px] px-3`}>+</button>
              </div>
              <datalist id="add-dist-cp-list">
                {allCheckpoints.filter((c: any) => { const existing = addDistCheckpoints.split(',').filter(Boolean).map(s => s.trim().toLowerCase()); return !existing.includes(c.name.toLowerCase()); }).map((c: any) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
