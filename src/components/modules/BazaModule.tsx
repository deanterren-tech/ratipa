import React, {useState, useEffect, useMemo} from 'react'
import {UserProfile} from '../../types'
import {dbService, onValue} from '../../api'
import {pdService} from '../../api'
import {getDatabase, ref, set, push, remove, update, query, limitToLast} from 'firebase/database'
import {getApp} from 'firebase/app'
import { 
  Trash2, 
  Search, 
  Archive, 
  History, 
  Clock, 
  Settings, 
  CheckCircle2, 
  Wrench, 
  Truck,
  FileSpreadsheet,
  X,
  Users,
  Plus
} from 'lucide-react';
import {motion, AnimatePresence} from 'motion/react'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {formatDriverShortName} from '../../utils/driverSync'
import {applySharedCarToBazaRecord, applySharedDriverToBazaRecord, normalizePlate} from '../../utils/bazaSync'
import CouplingPicker from '../common/CouplingPicker';

interface BazaModuleProps {
  user: UserProfile;
}

const allFields = ['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'] as const;
type FieldType = typeof allFields[number];

const fieldLabels: Record<FieldType, string> = {
  carNumber: "Госномер",
  driverName: "Водитель",
  dateArrival: "Прибыл на базу",
  dateLoading: "Срок готовности",
  dateRepairStart: "Заявка на ремонт",
  dateRepairEnd: "Завершение ремонта",
  dateDeparture: "Фактический выезд",
  comment: "Примечание"
};

const getNormalizedFieldLabel = (field: string) => {
  if (field === "К какому числу должна быть готова машина" || field === "Срок готовности") return "Срок готовности";
  if (field === "Дата подачи заявки на ремонт" || field === "Заявка на ремонт") return "Заявка на ремонт";
  if (field === "Дата окончания ремонта" || field === "Завершение ремонта") return "Завершение ремонта";
  return field;
};



export default function BazaModule({ user: ratipaUser }: BazaModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [currentTab, setCurrentTab] = useState<'base' | 'archive' | 'history'>('base');
  
  // Data State
  const [fleetVehicles, setFleetVehicles] = useState<any[]>([]);
  const [bazaLegacy, setBazaLegacy] = useState<any[]>([]);
  const [bazaCarsLegacy, setBazaCarsLegacy] = useState<any[]>([]);
  const [vehicleDriverLegacy, setVehicleDriverLegacy] = useState<any[]>([]);
  const [archiveLegacy, setArchiveLegacy] = useState<any[]>([]);
  const bazaVehicles = useMemo(() => {
      // Учёт выезда = РУЧНОЙ журнал (baza + baza_cars) + archive + центр (vehicle_driver_data, для архива).
      const all = [...bazaLegacy, ...bazaCarsLegacy, ...archiveLegacy, ...vehicleDriverLegacy];
      const unique: any[] = [];
      const seen = new Set<string>();
      all.forEach(car => {
          const plate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
          if (!seen.has(plate)) {
              seen.add(plate);
              unique.push(car);
          }
      });
      return unique;
  }, [bazaLegacy, bazaCarsLegacy, archiveLegacy, vehicleDriverLegacy]);

  const [globalHistory, setGlobalHistory] = useState<any[]>([]);
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});

  const allVehicles = useMemo(() => {
    return [...bazaVehicles];
  }, [bazaVehicles]);

  // РУЧНОЙ журнал (для "На базе"): baza + baza_cars (без archive/trip)
  const manualVehicles = useMemo(() => {
    const all = [...bazaLegacy, ...bazaCarsLegacy];
    const unique: any[] = [];
    const seen = new Set<string>();
    all.forEach(car => {
      const plate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
      if (!seen.has(plate)) { seen.add(plate); unique.push(car); }
    });
    return unique;
  }, [bazaLegacy, bazaCarsLegacy]);

  const cars = useMemo(() => {
    const active = manualVehicles.filter(v => v.status !== 'archive');
    return active.map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [manualVehicles, fleetVehicles, drivers]);

  // АРХИВ (выехавшие): ТОЛЬКО ручной журнал (baza archive + ветка archive).
  // Центр (vehicleFleet/vehicle_driver_data) не имеет дат журнала → не показываем (пустые).
  const archiveCars = useMemo(() => {
    const archived = allVehicles.filter(v =>
      v.status === 'archive' ||
      v.sourcePath === 'archive' ||
      v.isArchived === true
    );
    return archived.map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [allVehicles, fleetVehicles, drivers]);

  // Local state
  const [selectedDispatcher, setSelectedDispatcher] = useState<string>("Все автомобили");
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<string>('default');
  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(100);
  
  // Form State
  const [formData, setFormData] = useState<Record<string, string>>({
    carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: ''
  });

  // Modal State
  const [modalData, setModalData] = useState<any>({});
  // Tracks which fields the user actually edited in the modal. Only touched fields
  // are written to the DB on save — this guarantees untouched dates/comment can NEVER
  // be wiped (e.g. when the car coupling is changed).
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [bazaUndoStack, setBazaUndoStack] = useState<{ id: string; field: string; oldValue: any; rootBranch?: string }[]>([]);

  // Keyboard Navigation & Actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCarModalOpen(false);
      }

      // Ctrl + Z : Revert last change in the modal database updates
      if (e.ctrlKey && (e.key === 'z' || e.key === 'я' || e.key === 'Z')) {
        if (bazaUndoStack.length > 0) {
          e.preventDefault();
          const lastChange = bazaUndoStack[bazaUndoStack.length - 1];
          setBazaUndoStack(prev => prev.slice(0, -1));

          const rootBranch = lastChange.rootBranch || "vehicleFleet";
          const db = getDatabase(getApp());
          update(ref(db, `${rootBranch}/${lastChange.id}`), { [lastChange.field]: lastChange.oldValue }).then(() => {
            logHistory(lastChange.id, rootBranch, `${fieldLabels[lastChange.field as FieldType] || lastChange.field} (Отмена)`, "[Измененное]", lastChange.oldValue || "[Пусто]", modalData.carNumber || "Неизвестно");
            if (modalData && modalData.id === lastChange.id) {
              setModalData((prev: any) => ({ ...prev, [lastChange.field]: lastChange.oldValue }));
            }
          });
        }
      }
    };

    // Capture-фаза (true) — чтобы ESC срабатывал даже когда фокус в input/select внутри модалки
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isCarModalOpen, bazaUndoStack, currentTab, modalData]);

  // DB Sync for active fleet data, catalog & user listings
  useEffect(() => {
    try {
      const db = getDatabase(getApp());
      const unsubs: any[] = [];
      
      // Load legacy "baza" records
      unsubs.push(onValue(ref(db, 'baza'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'baza',
          status: data[key].status || 'base'
        }));
        setBazaLegacy(list);
      }));

      // Load legacy "baza_cars" records
      unsubs.push(onValue(ref(db, 'baza_cars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'baza_cars',
          status: data[key].status || 'base'
        }));
        setBazaCarsLegacy(list);
      }));

      // Load legacy "vehicle_driver_data" records
      unsubs.push(onValue(ref(db, 'vehicle_driver_data'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'vehicle_driver_data',
          status: data[key].status || 'base'
        }));
        setVehicleDriverLegacy(list);
      }));

      // Load legacy "archive" records
      unsubs.push(onValue(ref(db, 'archive'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          sourcePath: 'archive',
          status: 'archive'
        }));
        setArchiveLegacy(prev => [...prev.filter(i => i.sourcePath !== 'archive'), ...list]);
      }));

      // Load legacy "archivecars" records
      unsubs.push(onValue(ref(db, 'archivecars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          sourcePath: 'archivecars',
          status: 'archive'
        }));
        setArchiveLegacy(prev => [...prev.filter(i => i.sourcePath !== 'archivecars'), ...list]);
      }));

      unsubs.push(dbService.getVehicles(list => {
        setFleetVehicles(list.map(l => ({...l, sourcePath: 'vehicleFleet'})));
      }));

      unsubs.push(onValue(ref(db, 'known_fleet'), snap => {
        const data = snap.val() || {};
        setKnownFleet(Object.values(data));
      }));

      // Highly-optimized pooled drivers catalog loading
      unsubs.push(dbService.getDrivers(setDrivers));
    unsubs.push(pdService.subscribeDriversCarMapping((m) => setDriversMap(m)));

      unsubs.push(onValue(ref(db, 'users_list'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setSystemUsers(list);
      }));

      return () => {
        unsubs.forEach(u => u());
      };
    } catch(e) {
      console.warn("DB Error", e);
    }
  }, []);

  // Lazy-load extremely heavy history branch only when the user selects the 'history' tab
  useEffect(() => {
    if (currentTab !== 'history') {
      return;
    }
    try {
      const db = getDatabase(getApp());
      const unsub = onValue(query(ref(db, 'global_history'), limitToLast(100)), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setGlobalHistory(list);
      });
      return unsub;
    } catch (e) {
      console.warn("DB Error", e);
    }
  }, [currentTab]);

  // Auth mapping: figure out our internal role & perms based on users_list mapped to ratipaUser.name
  const matchedUser = systemUsers.find(u => String(u.name || '').toLowerCase() === String(ratipaUser?.name || '').toLowerCase() || u.id === ratipaUser?.uid) || {
    name: ratipaUser.name,
    role: ratipaUser.role === 'root_admin' ? 'Диспетчер' : 'Механик',
    permissions: {},
    isRootAdmin: ratipaUser.role === 'root_admin'
  };

  const isRootAdmin = matchedUser.isRootAdmin || matchedUser.name === 'Сергей';
  const currentUserRole = matchedUser.role; // "Диспетчер" | "Механик"
  const currentUserPermissions = matchedUser.permissions || {};

  const canEditField = (fieldName: string) => {
     if (isRootAdmin) return true;
     return currentUserPermissions[fieldName] === true;
  };

  const isMechanic = currentUserRole === 'Механик';

  // --- Logic Helpers ---
  const calculateCarStatus = (car: any) => {
      const todayStr = new Date().toISOString().split('T')[0];
      if (car.dateDeparture && car.dateDeparture <= todayStr) {
          return { code: 'transit', text: 'В рейсе', class: 'bg-slate-900 text-slate-100', icon: <Truck className="h-3 w-3"/> };
      }
      if (car.dateRepairStart) {
          if (!car.dateRepairEnd || todayStr < car.dateRepairEnd) {
              if (todayStr >= car.dateRepairStart) {
                  return { code: 'repair', text: 'В ремонте', class: 'bg-amber-50 text-amber-700 border-amber-100', icon: <Wrench className="h-3 w-3"/> };
              }
          }
      }
      if (car.dateRepairEnd && todayStr >= car.dateRepairEnd) {
          if (!car.dateDeparture || car.dateDeparture > todayStr) {
              return { code: 'ready', text: 'Готов к рейсу', class: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: <CheckCircle2 className="h-3 w-3"/> };
          }
      }
      return { code: 'base', text: 'На базе', class: 'bg-[#c3fb12]/20 text-[#2f4201] border-[#c3fb12]/40', icon: <CheckCircle2 className="h-3 w-3 opacity-60"/> };
  };

  const getDaysBetween = (date1: string, date2: string) => {
      if (!date1 || !date2) return "—";
      const d1 = new Date(date1).getTime();
      const d2 = new Date(date2).getTime();
      if (isNaN(d1) || isNaN(d2)) return "—";
      const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 ? `${diffDays} дн.` : "—";
  };

  const logHistory = async (carId: string, rootBranch: string, fieldLabel: string, was: string, became: string, carNum: string) => {
      const db = getDatabase(getApp());
      const now = new Date();
      const timestampStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
      
      const eventData = {
          date: timestampStr, 
          user: `${matchedUser.name} (${matchedUser.role})`, 
          field: fieldLabel, 
          old: was || "[Пусто]", 
          new: became || "[Пусто]"
      };
      
      push(ref(db, `${rootBranch}/${carId}/history`), eventData);
      push(ref(db, `global_history`), {
          ...eventData,
          carNumber: carNum || "Неизвестно",
          actionType: fieldLabel === "Запись создана" ? "create" : (became === "[Запись стерта]" ? "delete" : "update")
      });
  };

  // --- Actions ---
  const handleFormChange = (e: any, field: string) => {
    const val = e.target.value;
    const updates: any = { [field]: val };
    
    // Учёт выезда = ручной ввод. Автоматически из базы НИЧЕГО не подцепляется
    // при наборе текста. Машина выбирается вручную через CouplingPicker (выпадающий
    // список базы) — это сознательный выбор, не авто-подстановка.
    if (field === 'carNumber') {
      updates[field] = val.toUpperCase();
    }
    setFormData({...formData, ...updates});
  };

  const handleAddNewCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRootAdmin && !currentUserPermissions['carNumber']) {
      toast("У вас нет прав на добавление автомобилей!", 'error'); return;
    }
    const db = getDatabase(getApp());
    const cNum = formData.carNumber.trim().toUpperCase();
    if (!cNum) return;

    if (!knownFleet.includes(cNum)) {
      push(ref(db, 'known_fleet'), cNum);
    }

    const trimmedDriver = formData.driverName.trim();
    let driverId = '';
    let driverShortNameRu = '';
    let migrationStatus = 'unmatched';

    if (trimmedDriver) {
      const existingDriver = drivers.find(d => 
        d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
        (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
      );
      if (!existingDriver) {
        const parts = trimmedDriver.split(/\s+/);
          const last = parts[0] || '';
          const first = parts[1] || '';
          const middle = parts[2] || '';
          const computedShort = formatDriverShortName(last, first, middle);

          const newDriverId = "dr_" + Date.now();
          const newDriver = {
            id: newDriverId,
            name: trimmedDriver,
            lastNameRu: last,
            firstNameRu: first,
            middleNameRu: middle,
            shortNameRu: computedShort || trimmedDriver,
          };
          dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
          
          driverId = newDriverId;
          driverShortNameRu = newDriver.shortNameRu;
          migrationStatus = 'matched';
      } else {
        driverId = existingDriver.id;
        driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
        migrationStatus = 'matched';
      }
    }

    // Write to 'baza' (manual Учёт выезда journal). Center (vehicleFleet) is NOT
    // modified — it's the reference base, selected via CouplingPicker. If the car was
    // picked from the center, keep its center id as couplingId for traceability.
    const newRef = push(ref(db, 'baza'));
    // carNumber may be a full coupling "TRACTOR / TRAILER" — use only tractor part for center match
    const tractorPlate = cNum.split(' / ')[0].trim();
    const normPlate = tractorPlate.replace(/[^А-ЯA-Z0-9]/g, '');
    const masterCar = fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === normPlate);
    const couplingId = masterCar ? masterCar.id : null;

    const carData = {
      carId: newRef.key,
      couplingId: couplingId,
      ...formData,
      carNumber: cNum,
      driverName: driverShortNameRu || trimmedDriver,
      driverId: driverId || null,
      driverRaw: trimmedDriver,
      driverShortNameRu: driverShortNameRu || null,
      migrationStatus,
      status: 'base'
    };
    set(newRef, carData).then(() => {
       logHistory(newRef.key as string, "baza", "Запись создана", "", `Госномер: ${cNum}`, cNum);
       // Auto-status: car now appears in Учёт выезда → it's on base.
       if (couplingId) {
         dbService.setVehicleStatus(couplingId, 'base');
         set(ref(db, `vehicleFleet/${couplingId}/status`), 'base').catch(() => {});
       }
       setFormData({ carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: '' });
    });
  };

  const openCarModal = (car: any) => {
    // Подтянуть ПОЛНУЮ сцепку (тягач / прицеп) именно из единой базы сцепок (vehicleFleet / fleetVehicles).
    const tractor = normalizePlate(car.carNumber);
    const findIn = (src: any[]) => (src || []).find(c =>
      normalizePlate(c.vehicleNumbers || c.carNumber) === tractor ||
      normalizePlate(c.carNumber) === tractor
    );
    const coupling = findIn(fleetVehicles || []) || findIn(vehicleDriverLegacy);
    const fullCoupling = coupling
      ? [coupling.vehicleNumbers || coupling.carNumber, coupling.trailerNumber || coupling.trailerPlate]
          .filter(Boolean).join(' / ')
      : car.carNumber;
    const fullNameRu = (coupling && (coupling.driverNameRu || coupling.driverName)) || car.driverNameRu || car.driverName || '';
    setModalData({ ...car, carNumber: fullCoupling, driverName: fullNameRu, driverNameRu: (coupling && coupling.driverNameRu) || car.driverNameRu || '' });
    setTouchedFields({});
    setIsCarModalOpen(true);
  };

  const updateCarField = async (id: string, field: string, newValue: string) => {
      if (!isRootAdmin && !currentUserPermissions[field]) {
          toast("Действие отклонено: У вас нет прав на редактирование этого поля!", 'error');
          return;
      }
      
      const sourceList = [...cars, ...archiveCars];
      const targetCar = sourceList.find(c => c.id === id);
      
      if (!targetCar) return;
      const rootBranch = targetCar.isLegacyBaza ? "baza" : "vehicleFleet";
      
      let oldValue = targetCar[field] || "";
      let val = newValue;
      if (field === 'carNumber') val = val.toUpperCase();
      if (oldValue === val) return;

      let extraUpdates: any = {};
      if (field === 'driverName' && val.trim() !== '') {
        const trimmedDriver = val.trim();
        let driverId = '';
        let driverShortNameRu = '';
        let migrationStatus = 'unmatched';

        const existingDriver = drivers.find(d => 
          d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
          (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
        );

        if (!existingDriver) {
          const parts = trimmedDriver.split(/\s+/);
            const last = parts[0] || '';
            const first = parts[1] || '';
            const middle = parts[2] || '';
            const computedShort = formatDriverShortName(last, first, middle);

            const newDriverId = "dr_" + Date.now();
            const newDriver = {
              id: newDriverId,
              name: trimmedDriver,
              lastNameRu: last,
              firstNameRu: first,
              middleNameRu: middle,
              shortNameRu: computedShort || trimmedDriver,
            };
            dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
            toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');

            driverId = newDriverId;
            driverShortNameRu = newDriver.shortNameRu;
            migrationStatus = 'matched';
        } else {
          driverId = existingDriver.id;
          driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
          migrationStatus = 'matched';
        }

        extraUpdates = {
          driverId: driverId || null,
          driverRaw: trimmedDriver,
          driverShortNameRu: driverShortNameRu || null,
          migrationStatus
        };
        // Keep the displayed driver name as typed/picked (preserve full initials); pool link is stored in driverShortNameRu below
      }

      // Track change for Undo logic
      setBazaUndoStack(prev => [...prev, { id, field, oldValue, rootBranch }]);

      const db = getDatabase(getApp());
      const updates: any = { [field]: val, ...extraUpdates };
      
      update(ref(db, `${rootBranch}/${id}`), updates).then(() => {
         logHistory(id, rootBranch, fieldLabels[field as FieldType] || field, oldValue, val, targetCar.carNumber || "Неизвестно");
         // Optimistically update modalData
         setModalData((prev: any) => {
           return { ...prev, [field]: val, ...extraUpdates };
         });
      });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const saveCarModal = async () => {
    if (!modalData) return;
    const id = modalData.id;
    if (!id) return;

    const sourceList = [...cars, ...archiveCars];
    const targetCar = sourceList.find(c => c.id === id);
    if (!targetCar) return;
    // Write back to the SAME branch the record came from (baza / baza_cars / vehicle_driver_data),
    // never to 'baza' for a record whose real id lives in another branch — that creates a stray/empty card.
    const rootBranch = targetCar.sourcePath || 'baza';
    const db = getDatabase(getApp());

    const fields: string[] = ['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'];
    const updates: any = {};
    const historyEntries: { field: string; old: string; val: string }[] = [];

    for (const field of fields) {
      // Only write fields the user actually edited. Untouched date/comment fields are NEVER
      // written, so changing the car coupling can never wipe existing dates.
      if (!touchedFields[field]) continue;
      if (!isRootAdmin && !currentUserPermissions[field]) continue;
      let oldValue = targetCar[field] || '';
      let val = (modalData as any)[field] || '';
      if (field === 'carNumber') val = val.toUpperCase();
      if (oldValue === val) continue;

      if (field === 'driverName' && val.trim() !== '') {
        const trimmedDriver = val.trim();
        let driverId = '';
        let driverShortNameRu = '';
        let migrationStatus = 'unmatched';
        const existingDriver = drivers.find(d =>
          d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
          (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
        );
        if (!existingDriver) {
          const parts = trimmedDriver.split(/\s+/);
            const last = parts[0] || '';
            const first = parts[1] || '';
            const middle = parts[2] || '';
            const computedShort = formatDriverShortName(last, first, middle);
            const newDriverId = 'dr_' + Date.now();
            const newDriver = {
              id: newDriverId,
              name: trimmedDriver,
              lastNameRu: last,
              firstNameRu: first,
              middleNameRu: middle,
              shortNameRu: computedShort || trimmedDriver,
            };
            dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
            toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
            driverId = newDriverId;
            driverShortNameRu = newDriver.shortNameRu;
            migrationStatus = 'matched';
        } else {
          driverId = existingDriver.id;
          driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
          migrationStatus = 'matched';
        }
        updates.driverId = driverId || null;
        updates.driverRaw = trimmedDriver;
        updates.driverShortNameRu = driverShortNameRu || null;
        updates.migrationStatus = migrationStatus;
        // Keep the displayed driver name as typed/picked (preserve full initials); pool link is stored in driverShortNameRu above
      }

      updates[field] = val;
      historyEntries.push({ field, old: oldValue, val });
      setBazaUndoStack(prev => [...prev, { id, field, oldValue, rootBranch }]);
    }

    // Full driver name from CouplingPicker (kept separate so it isn't truncated to initials)
    if ((modalData as any).driverNameRu && (modalData as any).driverNameRu !== (targetCar.driverNameRu || '')) {
      updates.driverNameRu = (modalData as any).driverNameRu;
    }

    if (Object.keys(updates).length === 0) {
      toast('Нет изменений для сохранения', 'info');
      return;
    }

    await update(ref(db, `${rootBranch}/${id}`), updates);
    const carNum = modalData.carNumber || targetCar.carNumber || 'Неизвестно';
    for (const h of historyEntries) {
      await logHistory(id, rootBranch, fieldLabels[h.field as FieldType] || h.field, h.old, h.val, carNum);
    }
    toast('Изменения сохранены', 'success');
    setIsCarModalOpen(false);
  };

  const moveCarToArchive = async () => {
      if (isMechanic || !modalData) return;
      if (!(await showConfirm(`Отправить автомобиль [${modalData.carNumber}] в рейс?\nЗапись переместится во вкладку Архив.`))) return;

      const db = getDatabase(getApp());
      const nowStr = new Date().toISOString().split('T')[0];
      const updatedDeparture = modalData.dateDeparture || nowStr;

      // Use the REAL record from the loaded list (more reliable than modalData spread)
      const rec = (cars.find(c => c.id === modalData.id) || modalData) as any;

      const archiveCarData = {
          ...rec,
          dateDeparture: updatedDeparture,
          status: 'archive',
          isArchived: true
      };

      // Manual journal branch where the record actually lives
      const srcPath = (rec.sourcePath === 'baza_cars' || rec.sourcePath === 'baza') ? rec.sourcePath : 'baza';

      const writes: Record<string, any> = {};
      // 1) Mark the original manual-journal record as archived in place
      writes[`${srcPath}/${rec.id}`] = archiveCarData;
      // 2) Mirror into the dedicated 'archive' branch so the Archive tab always sees it
      writes[`archive/${rec.id}`] = { ...archiveCarData, sourcePath: 'archive' };

      Promise.all([
          set(ref(db, `${srcPath}/${rec.id}`), archiveCarData),
          set(ref(db, `archive/${rec.id}`), { ...archiveCarData, sourcePath: 'archive' })
      ]).then(() => {
          logHistory(rec.id, srcPath, "Статус", "На базе", "Выехал в рейс (Перенесено в архив)", rec.carNumber);
          setIsCarModalOpen(false);
          toast("Автомобиль перемещён в Архив", 'success');
      }).catch(err => {
          console.error('[Archive] moveCarToArchive FAILED', err);
          toast("Ошибка при перемещении в архив: " + (err?.message || err), 'error');
      });
  };

  const deleteCarRecord = async (id: string, carNumber: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentTab === "archive" && !isRootAdmin) {
          toast("Удаление записей из архива разрешено только администратору!", 'error');
          return;
      }
      if (isMechanic) return;

      if (await showConfirm(`Вы уверены, что хотите окончательно удалить запись автомобиля ${carNumber}?`)) {
          const db = getDatabase(getApp());
          const sourceList = [...cars, ...archiveCars];
          const targetCar = sourceList.find(c => c.id === id);
          const branch = targetCar?.sourcePath || 'baza';
          // Remove from the SAME branch the record lives in (baza / baza_cars / archive / vehicle_driver_data).
          // The reference base (vehicleFleet) must NOT be modified — it's the single source of truth.
          remove(ref(db, `${branch}/${id}`));

          // Auto-status: if this car is no longer in Учёт выезда → it's in trip.
          const cid = targetCar?.couplingId
            || (fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === (carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '')) || {}).id;
          if (cid) {
            // check if any other baza record still references this car
            const stillInBaza = cars.some(c => c.id !== id && (c.couplingId === cid || (c.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === (carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '')));
            if (!stillInBaza) {
              dbService.setVehicleStatus(cid, 'trip');
              set(ref(db, `vehicleFleet/${cid}/status`), 'trip').catch(() => {});
            }
          }

          const timestampStr = new Date().toLocaleDateString("ru-RU") + " " + new Date().toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
          push(ref(db, `global_history`), {
              date: timestampStr,
              user: `${matchedUser.name} (${matchedUser.role})`,
              field: "Удаление карточки ТС",
              old: `Удалена запись из раздела: ${currentTab === 'base' ? 'На базе' : 'Архив'}`,
              new: "[Запись стерта]",
              carNumber: carNumber || "Неизвестно",
              actionType: "delete"
          });
      }
  };

  const couplingByPlate = useMemo(() => {
    const m = new Map<string, any>();
    const add = (src: any[]) => (src || []).forEach(c => {
      const keys = [c.vehicleNumbers || c.carNumber, c.carNumber].filter(Boolean).map(normalizePlate);
      keys.forEach(k => { if (k && !m.has(k)) m.set(k, c); });
    });
    add(fleetVehicles);
    add(vehicleDriverLegacy);
    return m;
  }, [fleetVehicles, vehicleDriverLegacy]);

  const resolveDriverName = (car: any) => {
    const tractor = normalizePlate((car.carNumber || '').split('/')[0]);
    const coupling = couplingByPlate.get(tractor);
    const full = coupling
      ? (coupling.driverNameRu || coupling.driverName)
      : (car.driverNameRu || car.driverName || car.driverShortNameRu);
    return formatDriverShortName(full || '');
  };

  const filteredList = useMemo(() => {
     return (currentTab === 'base' ? cars : archiveCars).filter(c => {
        // Dispatcher filtering
        if (selectedDispatcher !== "Все автомобили") {
          const disp = (c.dispatcherName || c.dispatcher || "").trim().toLowerCase();
          if (disp !== selectedDispatcher.toLowerCase()) return false;
        }

        const q = searchQuery.toLowerCase();
        if (q && !(String(c.carNumber||'').toLowerCase().includes(q) || String(c.driverName||'').toLowerCase().includes(q) || String(c.comment||'').toLowerCase().includes(q))) return false;
        return true;
     }).map(c => ({...c, _status: calculateCarStatus(c), displayDriver: resolveDriverName(c)})).sort((a,b) => {
        if (sortMode === 'car_asc') return (a.carNumber||'').localeCompare(b.carNumber||'');
        if (sortMode === 'car_desc') return (b.carNumber||'').localeCompare(a.carNumber||'');
        if (sortMode === 'arrival_desc') return (b.dateArrival||'0000').localeCompare(a.dateArrival||'0000');
        if (sortMode === 'arrival_asc') return (a.dateArrival||'9999').localeCompare(b.dateArrival||'9999');
        if (sortMode === 'departure_desc') return (b.dateDeparture||'0000').localeCompare(a.dateDeparture||'0000');
        if (sortMode === 'departure_asc') return (a.dateDeparture||'9999').localeCompare(a.dateDeparture||'9999');
        
        // default smart sort
        if (currentTab === 'archive') {
            return (b.dateDeparture||'0000').localeCompare(a.dateDeparture||'0000');
        }
        return (b.dateArrival||'0000').localeCompare(a.dateArrival||'0000');
     });
  }, [currentTab, cars, archiveCars, searchQuery, sortMode, selectedDispatcher]);

  const dispatcherList = useMemo(() => {
     const set = new Set<string>();
     systemUsers.forEach(u => {
        if (u.role === 'Диспетчер' && u.name) {
           set.add(u.name);
        }
     });
     cars.forEach(c => {
        const d = (c.dispatcherName || c.dispatcher || "").trim();
        if (d) set.add(d);
     });
     archiveCars.forEach(c => {
        const d = (c.dispatcherName || c.dispatcher || "").trim();
        if (d) set.add(d);
     });
     return Array.from(set).filter(Boolean).sort();
  }, [systemUsers, cars, archiveCars]);


  const wTotal = useMemo(() => {
     return cars.filter(c => ['base','repair','ready'].includes(calculateCarStatus(c).code)).length;
  }, [cars]);

  const wRepair = useMemo(() => {
     return cars.filter(c => calculateCarStatus(c).code === 'repair').length;
  }, [cars]);

  const wReady = useMemo(() => {
     return cars.filter(c => calculateCarStatus(c).code === 'ready').length;
  }, [cars]);

  const getStatusBadge = (code: string, text: string) => {
    switch (code) {
      case 'transit':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-sans">
            <Truck size={12} className="stroke-[2.5]" />
            <span>В рейсе</span>
          </span>
        );
      case 'repair':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-600 border border-rose-500/10 font-sans">
            <Wrench size={12} className="stroke-[2.5]" />
            <span>В ремонте</span>
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/10 font-sans">
            <CheckCircle2 size={12} className="stroke-[2.5]" />
            <span>Готов к рейсу</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-500/10 text-slate-600 border border-slate-500/10 font-sans">
            <CheckCircle2 size={12} className="opacity-60 stroke-[2.5]" />
            <span>На базе</span>
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
      
      {/* Top Internal Tab Navigation for Baza module */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 select-none pb-5 border-b border-slate-200/60">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Truck className="w-7 h-7 text-slate-800" /> Учёт выезда
          </h1>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto justify-start sm:justify-end">
          <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50">
            <button 
              onClick={() => setCurrentTab('base')} 
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                currentTab === 'base' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
              }`}
            >
              На базе
            </button>
            <button 
              onClick={() => setCurrentTab('archive')} 
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                currentTab === 'archive' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
              }`}
            >
              Архив
            </button>
            <button 
              onClick={() => setCurrentTab('history')} 
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                currentTab === 'history' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
              }`}
            >
              История
            </button>
          </div>

        </div>
      </div>

      {/* Dynamic Counter widgets on top (Full width) — PlanDohod KPI style */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-slate-50/40 border border-slate-200/50 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] mt-6">
         {/* Всего на базе */}
         <div className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Всего на базе ТС</span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-sans tabular-nums">{wTotal}</span>
         </div>
         {/* В ремонте */}
         <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">В ремонте ТС</span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-rose-600 font-sans tabular-nums">{wRepair}</span>
         </div>
         {/* Готовы к рейсу */}
         <div className="flex flex-col lg:border-l lg:border-slate-200/60 lg:pl-6">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">Готовы к рейсу ТС</span>
            <span className="text-2xl lg:text-3xl font-bold tracking-tight text-emerald-600 font-sans tabular-nums">{wReady}</span>
         </div>
      </div>

      <div className="space-y-6">
          
          <div className={currentTab === 'base' ? '' : 'hidden'}>
             <div className="pt-6">
                 <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-[#3765F6]" />
                    Добавить новый автомобиль
                 </h2>
                 <form onSubmit={handleAddNewCar}>
                    {/* Quick coupling picker — pulls a coupling (tractor+trailer+driver) from the shared center */}
                    <div className="mb-4">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Быстрый выбор из общей базы</label>
                      <CouplingPicker
                        onSelect={(rec) => {
                          if (!rec) return;
                          const coupling = [
                            (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                            rec.trailerNumber ? rec.trailerNumber.toUpperCase() : ''
                          ].filter(Boolean).join(' / ');
                          const updates: Record<string, string> = {
                            carNumber: coupling,
                          };
                          const fullName = rec.driverNameRu || rec.driverName || rec.driverShortNameRu || '';
                          if (fullName) {
                            const parts = fullName.trim().split(/\s+/);
                            if (parts.length >= 2) {
                              const initials = parts.slice(1).map(p => p[0].toUpperCase() + '.').join('');
                              updates.driverName = `${parts[0]} ${initials}`;
                            } else {
                              updates.driverName = fullName;
                            }
                          }
                          setFormData((f) => ({ ...f, ...updates }));
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Госномер авто *</label>
                            <div className="text-xs font-semibold uppercase py-2 px-1 text-slate-800">
                              {formData.carNumber || <span className="text-slate-400 font-normal">выберите сцепку выше</span>}
                            </div>
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">ФИО Водителя</label>
                            <input type="text"
                              value={formData.driverName || ''}
                              onChange={(e) => setFormData((f) => ({ ...f, driverName: e.target.value }))}
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full focus:border-[#3765F6]"
                              placeholder="—"
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Прибыл на базу</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateArrival')} 
                              value={formData.dateArrival} 
                              onChange={e => handleFormChange(e, 'dateArrival')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="Срок готовности">Срок готовности</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateLoading')} 
                              value={formData.dateLoading} 
                              onChange={e => handleFormChange(e, 'dateLoading')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate">Заявка на ремонт</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateRepairStart')} 
                              value={formData.dateRepairStart} 
                              onChange={e => handleFormChange(e, 'dateRepairStart')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate">Завершение ремонта</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateRepairEnd')} 
                              value={formData.dateRepairEnd} 
                              onChange={e => handleFormChange(e, 'dateRepairEnd')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Фактический выезд</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateDeparture')} 
                              value={formData.dateDeparture} 
                              onChange={e => handleFormChange(e, 'dateDeparture')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Примечание</label>
                            <input 
                              disabled={!canEditField('comment')} 
                              value={formData.comment} 
                              onChange={e => handleFormChange(e, 'comment')} 
                              className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                              placeholder="..." 
                            />
                         </div>
                     </div>
                     <button 
                       type="submit" 
                       disabled={!allFields.some(f => canEditField(f))} 
                       className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold px-4 py-2.5 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-40 mt-2"
                     >
                        Добавить в контроль
                     </button>
                     <datalist id="known-fleet-dl">
                        {knownFleet.map(k => <option key={k} value={k} />)}
                     </datalist>
                 </form>
             </div>
          </div>

          <div className={currentTab !== 'history' ? '' : 'hidden'}>
             <div className="pt-6 flex flex-col">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                    <h2 className="text-base font-semibold text-slate-800 tracking-tight">
                       {currentTab === 'base' ? 'Автомобили на базе' : 'Архив выехавших автомобилей'}
                    </h2>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                       <input 
                         value={searchQuery} 
                         onChange={e => setSearchQuery(e.target.value)} 
                         type="text" 
                         className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full sm:w-64 focus:border-[#3765F6]" 
                         placeholder="Быстрый поиск..." 
                       />
                       <select
                         value={selectedDispatcher}
                         onChange={e => setSelectedDispatcher(e.target.value)}
                         className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none px-3 py-2 cursor-pointer"
                       >
                          <option value="Все автомобили">Все диспетчеры</option>
                          {dispatcherList.map(disp => (
                             <option key={disp} value={disp}>{disp}</option>
                          ))}
                       </select>
                       <select 
                         value={sortMode} 
                         onChange={e => setSortMode(e.target.value)} 
                         className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold outline-none px-3 py-2 min-w-[170px] max-w-[250px]"
                       >
                          <option value="default">Умная сортировка</option>
                          <optgroup label="По номеру авто">
                             <option value="car_asc">А–Я По номеру авто</option>
                             <option value="car_desc">Я–А По номеру авто</option>
                          </optgroup>
                          <optgroup label="Фактический выезд">
                             <option value="departure_desc">Вначале недавно выехавшие</option>
                             <option value="departure_asc">Вначале давно выехавшие</option>
                          </optgroup>
                          <optgroup label="Прибытие на базу">
                             <option value="arrival_desc">Вначале недавно прибывшие</option>
                             <option value="arrival_asc">Вначале давно прибывшие</option>
                          </optgroup>
                       </select>
                    </div>
                 </div>

                 {/* Swipe Help Badge for Mobile */}
                 

                 <div className="hidden lg:block overflow-x-auto custom-scrollbar">
                     
<table className="w-full text-left border-separate border-spacing-y-2">
  <thead>
    <tr>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Госномер</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Водитель</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Прибыл на базу</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Срок готовности</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Заявка на ремонт</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Завершение ремонта</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Фактический выезд</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Примечание</th>
      <th className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Действия</th>
    </tr>
  </thead>
  <tbody>
    {filteredList.map((v) => (
      <tr key={`${v.id}-${normalizePlate(v.carNumber)}`} data-nav-item className="group cursor-pointer">
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 group-hover:bg-slate-50 transition duration-150">
          <span className="font-semibold text-sm text-slate-800 font-mono tracking-wider inline-block select-all">{v.carNumber}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-slate-700 group-hover:bg-slate-50 transition">{v.displayDriver || '—'}</td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-slate-500 group-hover:bg-slate-50 transition">
          {v.dateArrival ? v.dateArrival.split('-').reverse().join('.') : '—'}
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-slate-500 group-hover:bg-slate-50 transition">
          {v.dateLoading ? v.dateLoading.split('-').reverse().join('.') : '—'}
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-slate-500 group-hover:bg-slate-50 transition">
          {v.dateRepairStart ? v.dateRepairStart.split('-').reverse().join('.') : '—'}
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium text-slate-500 group-hover:bg-slate-50 transition">
          {v.dateRepairEnd ? v.dateRepairEnd.split('-').reverse().join('.') : '—'}
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm font-medium group-hover:bg-slate-50 transition">
          <span className={`whitespace-nowrap font-sans ${
            v.dateDeparture
                ? 'text-emerald-700 font-semibold' 
                : 'text-slate-500'
          }`}>
            {v.dateDeparture ? v.dateDeparture.split('-').reverse().join('.') : '—'}
          </span>
        </td>
        <td onClick={() => openCarModal(v)} className="border-t border-slate-100 px-4 py-3.5 text-sm text-slate-400 group-hover:bg-slate-50 transition max-w-[180px] truncate">{v.comment || v.notes || '—'}</td>
        <td className="border-t border-slate-100 px-4 py-3.5 group-hover:bg-slate-50 transition">
          <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={(e) => { e.stopPropagation(); openCarModal(v); }} 
              className="p-1.5 text-slate-400 hover:text-[#3765F6] bg-white hover:bg-[#3765F6]/5 border border-slate-200/60 hover:border-[#3765F6]/20 rounded-lg shadow-3xs transition-all active:scale-90 cursor-pointer" 
              title="Редактировать"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
            <button 
              disabled={isMechanic}
              onClick={(e) => { e.stopPropagation(); deleteCarRecord(v.id, v.carNumber, e); }} 
              className="p-1.5 text-slate-400 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200/60 hover:border-rose-200 rounded-lg shadow-3xs transition-all active:scale-90 disabled:opacity-30 cursor-pointer" 
              title="Удалить"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    ))}
  </tbody>
</table>
                 </div>

                 {/* Mobile Cards View */}
                 <div className="block lg:hidden space-y-3 pb-10">
                   {filteredList.map(v => (
                     <div 
                       key={`${v.id}-${normalizePlate(v.carNumber)}`} 
                       onClick={() => openCarModal(v)}
                       className="bg-slate-50 rounded-2xl p-4 border border-slate-200/50 transition-all cursor-pointer flex flex-col gap-3"
                     >
                       <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs bg-white text-slate-800 border border-slate-200/60 shadow-3xs px-2.5 py-1.5 rounded-xl font-mono tracking-wider">{v.carNumber}</span>
                            <span className="text-xs font-semibold text-slate-800">{v.displayDriver || "—"}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {getStatusBadge(v._status.code, v._status.text)}
                            <button 
                              disabled={(currentTab === "archive" && !isRootAdmin) || isMechanic}
                              onClick={(e) => { e.stopPropagation(); deleteCarRecord(v.id, v.carNumber, e); }} 
                              className="w-8 h-8 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30 transition-all active:scale-90 border border-rose-100 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4"/>
                            </button>
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-2 gap-2 text-[11px]">
                         <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200/50">
                           <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Прибыл на базу</span>
                           <span className="font-medium text-slate-700">{v.dateArrival ? v.dateArrival.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200/50">
                           <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Срок готовности</span>
                           <span className="font-medium text-slate-700">{v.dateLoading ? v.dateLoading.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200/50">
                           <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Заявка на ремонт</span>
                           <span className="font-medium text-slate-700">{v.dateRepairStart ? v.dateRepairStart.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200/50">
                           <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Завершение ремонта</span>
                           <span className="font-medium text-slate-700">{v.dateRepairEnd ? v.dateRepairEnd.split("-").reverse().join(".") : "—"}</span>
                         </div>
                       </div>
                       
                       <div className="flex justify-between items-center gap-2 pt-3 border-t border-slate-100/50 mt-1">
                         <div className="flex-1">
                           <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1.5 tracking-wider">Фактический выезд</span>
                           <span className={`px-2 py-1 inline-block rounded-lg border text-[11px] font-semibold ${v.dateDeparture ? "bg-emerald-500/10 border-emerald-500/15 text-emerald-800" : "bg-white/60 border-slate-200/40 text-slate-500"}`}>
                             {v.dateDeparture ? v.dateDeparture.split("-").reverse().join(".") : "—"}
                           </span>
                         </div>
                         <div className="flex-1 text-right">
                            <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1.5 tracking-wider">Примечание</span>
                            <span className="text-[11px] text-slate-600 truncate max-w-[120px] inline-block font-medium">{v.comment || v.notes || "—"}</span>
                         </div>
                       </div>
                     </div>
                   ))}
                   {filteredList.length === 0 && (
                     <div className="text-center p-8 text-slate-400 font-medium bg-slate-50 rounded-2xl border border-slate-200/50">
                       Нет записей
                     </div>
                   )}
                 </div>
             </div>
          </div>

          <div className={currentTab === 'history' ? '' : 'hidden'}>
             <div className="pt-6 flex flex-col">
                 <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-4 mb-4 flex items-center gap-2">
                    <History className="h-4 w-4 text-[#3765F6]" />
                    История всех действий в системе
                 </h2>
                 <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
                    {[...globalHistory].reverse().slice(0, historyLimit).map(h => (
                       <div key={h.id} className="bg-slate-50 rounded-2xl p-4 border border-slate-200/50 flex flex-col gap-3 hover:border-[#3765F6]/20 transition-all">
                          <div className="flex items-center flex-wrap gap-3">
                             <span className="text-xs font-semibold text-slate-400 font-mono">{h.date}</span>
                             <span className="text-xs font-semibold bg-white px-2.5 py-1 rounded-xl border border-slate-200/60 shadow-3xs font-mono text-slate-800">{h.carNumber}</span>
                             <span className="text-xs font-semibold text-slate-700 bg-[#3765F6]/5 text-[#3765F6] border border-[#3765F6]/10 px-2.5 py-1 rounded-xl">{h.user}</span>
                          </div>
                          <div className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200/30 flex flex-wrap items-center gap-2">
                             <span className="font-bold text-slate-800 border-r border-slate-200/60 pr-2">{getNormalizedFieldLabel(h.field)}:</span>
                             <span className={`text-rose-500 font-semibold ${h.actionType==='delete'?'line-through-none':''}`}>{h.old}</span>
                             {h.actionType !== 'delete' && (
                                <>
                                 <span className="text-slate-300">➔</span>
                                 <span className="text-emerald-600 font-semibold">{h.new}</span>
                                </>
                             )}
                          </div>
                       </div>
                    ))}
                    
                    {globalHistory.length > historyLimit && (
                       <button 
                          onClick={() => setHistoryLimit(prev => prev + 100)}
                          className="w-full py-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer text-center tracking-tight border border-slate-200/50 active:scale-95 shadow-sm"
                       >
                          Загрузить еще (Показано {historyLimit} из {globalHistory.length})
                       </button>
                    )}
                    
                    {globalHistory.length === 0 && <div className="text-slate-400 italic font-medium py-4 text-center">История пуста.</div>}
                 </div>
             </div>
          </div>

      </div>

      {/* Car Editor Modal */}
      <AnimatePresence>
        {isCarModalOpen && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
              <motion.div initial={{y:30, scale:0.96}} animate={{y:0, scale:1}} exit={{y:20, opacity:0, scale:0.96}} className="bg-white text-slate-900 rounded-[2rem] w-full max-w-4xl max-h-[92vh] flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 overflow-hidden">
                 <div className="p-5 border-b border-slate-200/50 flex justify-between items-center bg-white shrink-0">
                    <div className="flex items-center gap-3">
                       <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Карточка автомобиля</h2>
                       {modalData.carNumber && (
                          <span className="font-semibold text-[11px] bg-white text-slate-800 border border-slate-200 shadow-3xs px-2.5 py-1 rounded-lg font-mono tracking-wider">
                             {modalData.carNumber}
                          </span>
                       )}
                       {modalData.id && (
                          getStatusBadge(calculateCarStatus(modalData).code, calculateCarStatus(modalData).text)
                       )}
                    </div>
                    <button 
                      onClick={() => setIsCarModalOpen(false)} 
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition duration-150 cursor-pointer"
                      title="Закрыть"
                    >
                      <X size={18} />
                    </button>
                 </div>

                 <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6 custom-scrollbar">
                    {/* Summary Widgets */}
                    <div className="bg-slate-50 rounded-2xl p-4 lg:p-5 border border-slate-200/50">
                       <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3 block">Аналитика простоя по записи</h3>
                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-white rounded-xl p-3 text-center border border-slate-200/50 hover:border-[#3765F6]/20 transition-all">
                             <div className="text-[10px] font-semibold text-slate-400 mb-1">Дни отдыха водит.</div>
                             <div className="text-lg font-bold text-slate-800">{getDaysBetween(modalData.dateArrival, modalData.dateLoading)}</div>
                          </div>
                          <div className="bg-white rounded-xl p-3 text-center border border-slate-200/50 hover:border-[#3765F6]/20 transition-all">
                             <div className="text-[10px] font-semibold text-slate-400 mb-1">Ожидание ремонта</div>
                             <div className="text-lg font-bold text-rose-500">{getDaysBetween(modalData.dateArrival, modalData.dateRepairStart)}</div>
                          </div>
                          <div className="bg-white rounded-xl p-3 text-center border border-slate-200/50 hover:border-[#3765F6]/20 transition-all">
                             <div className="text-[10px] font-semibold text-slate-400 mb-1">Дни ремонта</div>
                             <div className="text-lg font-bold text-[#3765F6]">{getDaysBetween(modalData.dateRepairStart, modalData.dateRepairEnd)}</div>
                          </div>
                          <div className="bg-[#3765F6]/5 border border-[#3765F6]/10 rounded-xl p-3 text-center">
                             <div className="text-[10px] font-bold text-[#3765F6] mb-1">Общий простой</div>
                             <div className="text-lg font-bold text-[#3765F6]">{getDaysBetween(modalData.dateArrival, modalData.dateDeparture)}</div>
                          </div>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Госномер автомобиля</label>
                          <CouplingPicker
                            onSelect={(rec) => {
                              if (!rec) return;
                              const coupling = [
                                (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                                rec.trailerNumber ? rec.trailerNumber.toUpperCase() : ''
                              ].filter(Boolean).join(' / ');
                              const fullName = rec.driverNameRu || rec.driverName || rec.driverShortNameRu || '';
                              const driverName = fullName ? formatDriverShortName(fullName) : '';
                              // Changing the car edits carNumber + driverName; mark them touched so they save,
                              // but NEVER touch the date/comment fields (they must survive the change).
                              setTouchedFields(prev => ({ ...prev, carNumber: true, driverName: true, driverNameRu: true }));
                              setModalData((m) => ({ ...m, carNumber: coupling, driverName, driverNameRu: fullName || '' }));
                            }}
                          />
                          <div className="text-xs font-bold uppercase py-1 px-1 text-slate-800">
                            {modalData.carNumber || <span className="text-slate-400 font-normal">выберите сцепку</span>}
                          </div>
                       </div>
                        <div className="space-y-1">
                           <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">ФИО Водителя</label>
                           <div className="text-xs font-semibold py-2 px-1 text-slate-800">
                             {modalData.driverName || <span className="text-slate-400 font-normal">—</span>}
                           </div>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="Прибыл на базу">Прибыл на базу</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateArrival')} 
                            value={modalData.dateArrival||''} 
                            onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateArrival: true})); setModalData((mm) => ({...mm, dateArrival: e.target.value})); }}
                            onKeyDown={handleInputKeyDown} 
                            className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="К какому числу должна быть готова машина">Срок готовности</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateLoading')} 
                            value={modalData.dateLoading||''} 
                            onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateLoading: true})); setModalData((mm) => ({...mm, dateLoading: e.target.value})); }}
                            onKeyDown={handleInputKeyDown} 
                            className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="Дата подачи заявки на ремонт">Заявка на ремонт</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateRepairStart')} 
                            value={modalData.dateRepairStart||''} 
                            onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateRepairStart: true})); setModalData((mm) => ({...mm, dateRepairStart: e.target.value})); }}
                            onKeyDown={handleInputKeyDown} 
                            className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="Дата окончания ремонта">Завершение ремонта</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateRepairEnd')} 
                            value={modalData.dateRepairEnd||''} 
                            onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateRepairEnd: true})); setModalData((mm) => ({...mm, dateRepairEnd: e.target.value})); }}
                            onKeyDown={handleInputKeyDown} 
                            className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block truncate" title="Фактический выезд">Фактический выезд</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateDeparture')} 
                            value={modalData.dateDeparture||''} 
                            onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateDeparture: true})); setModalData((mm) => ({...mm, dateDeparture: e.target.value})); }}
                            onKeyDown={handleInputKeyDown} 
                            className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                          />
                       </div>
                    </div>

                    <div className="space-y-1">
                       <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Примечание</label>
                       <input 
                         disabled={!canEditField('comment')} 
                         value={modalData.comment||''} 
                         onChange={(e)=>{ setTouchedFields(prev => ({...prev, comment: true})); setModalData((mm) => ({...mm, comment: e.target.value})); }}
                         onKeyDown={handleInputKeyDown} 
                         className="bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none px-3 py-2 w-full disabled:opacity-50 focus:border-[#3765F6]" 
                       />
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-4 lg:p-5 border border-slate-200/50">
                       <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3 block">ЖУРНАЛ ИЗМЕНЕНИЙ ЗАПИСИ</h3>
                       <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                           {modalData.history && Object.keys(modalData.history).reverse().map(hk => {
                              const h = modalData.history[hk];
                              return (
                                 <div className="bg-white rounded-xl p-3 flex flex-col gap-1 border border-slate-200/50">
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold font-sans">
                                       <span>{h.date}</span> • <span className="text-[#3765F6]">{h.user}</span>
                                    </div>
                                    <div className="text-xs text-slate-700 font-medium leading-relaxed">
                                       «{getNormalizedFieldLabel(h.field)}»: <span className="line-through text-slate-400 mx-1">{h.old}</span> ➔ <span className="text-slate-900 font-semibold mx-1">{h.new}</span>
                                    </div>
                                 </div>
                              );
                           })}
                           {(!modalData.history || Object.keys(modalData.history).length === 0) && <div className="text-xs text-slate-400 italic font-medium">Изменений еще нет</div>}
                       </div>
                    </div>
                 </div>

                 <div className="p-4 border-t border-slate-200/50 flex justify-end items-center gap-2 bg-white shrink-0">
                    {currentTab === 'base' && !isMechanic && (
                      <button 
                        onClick={moveCarToArchive} 
                        className="bg-[#3765F6] hover:bg-[#2555E5] text-white rounded-xl text-xs font-semibold px-4 py-2.5 transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1.5"
                      >
                         Выехал в рейс
                      </button>
                    )}
                    <button 
                      onClick={saveCarModal} 
                      className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold px-4 py-2.5 transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1.5"
                    >
                       Сохранить
                    </button>
                 </div>
              </motion.div>
           </motion.div>
        )}
      </AnimatePresence>

      <datalist id="baza-drivers-dl">
         {drivers.map((drv: any) => (
            <option key={drv.id} value={drv.shortNameRu || formatDriverShortName(drv)} />
         ))}
      </datalist>

    </div>
  );
}