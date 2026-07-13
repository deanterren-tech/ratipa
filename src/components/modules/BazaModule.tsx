import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UserProfile } from '../../types';
import { dbService, onValue } from '../../firebase';
import { pdService } from '../../firebase/planDohodService';
import { getDatabase, ref, set, push, remove, update, serverTimestamp, onDisconnect, query, limitToLast } from 'firebase/database';
import { getApp } from 'firebase/app';
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
import { motion, AnimatePresence } from 'motion/react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { formatDriverShortName } from '../../utils/driverSync';
import { applySharedCarToBazaRecord, applySharedDriverToBazaRecord, normalizePlate } from '../../utils/bazaSync';
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
      // vehicleFleet is the single source of truth (center of data).
      // baza/baza_cars are legacy mirrors kept only for backward-compat reads.
      const all = [...fleetVehicles, ...vehicleDriverLegacy, ...archiveLegacy, ...bazaLegacy, ...bazaCarsLegacy];
      // Deduplicate by carNumber
      const unique: any[] = [];
      const seen = new Set<string>();
      all.forEach(car => {
          const plate = normalizePlate(car.carNumber);
          if (!seen.has(plate)) {
              seen.add(plate);
              unique.push(car);
          }
      });
      return unique;
  }, [bazaLegacy, bazaCarsLegacy, vehicleDriverLegacy, archiveLegacy]);

  const [globalHistory, setGlobalHistory] = useState<any[]>([]);
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});

  const allVehicles = useMemo(() => {
    const bazaIds = new Set(bazaVehicles.map(v => normalizePlate(v.carNumber)));
    const fleetOnly = fleetVehicles.filter(v => !bazaIds.has(normalizePlate(v.carNumber))).map(v => ({
      ...v,
      isLegacyBaza: false,
      status: v.status || 'base'
    }));
    return [...bazaVehicles, ...fleetOnly];
  }, [bazaVehicles, fleetVehicles]);

  const cars = useMemo(() => {
    const active = allVehicles.filter(v => v.status !== 'archive');
    console.log(`[Diagnostic] Baza UI Active Cars: ${active.length}`);
    return active.map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [allVehicles, fleetVehicles, drivers]);

  const archiveCars = useMemo(() => {
    const archived = allVehicles.filter(v => v.status === 'archive');
    console.log(`[Diagnostic] Baza UI Archive Cars: ${archived.length}`);
    return archived.map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [allVehicles, fleetVehicles, drivers]);

  // Local state
  const [selectedDispatcher, setSelectedDispatcher] = useState<string>("Все автомобили");
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<string>('default');
  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(100);
  
  // Form State
  const [formData, setFormData] = useState<Record<string, string>>({
    carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: ''
  });

  // Modal State
  const [modalData, setModalData] = useState<any>({});
  const [bazaUndoStack, setBazaUndoStack] = useState<{ id: string; field: string; oldValue: any; rootBranch?: string }[]>([]);

  // Keyboard Navigation & Actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCarModalOpen(false);
        setIsAdminModalOpen(false);
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCarModalOpen, isAdminModalOpen, bazaUndoStack, currentTab, modalData]);

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
        console.log(`[Diagnostic] VehicleFleet (new) records loaded: ${list.length}`);
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
    
    // Auto-fill driver when car number changes and driver is not yet set
    if (field === 'carNumber') {
      updates[field] = val.toUpperCase();
      const normPlate = updates[field].replace(/[^А-ЯA-Z0-9]/g, '');
      const masterCar = fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === normPlate);
      
      if (masterCar && masterCar.driverId) {
        const mappedDriver = drivers.find(d => d.id === masterCar.driverId);
        if (mappedDriver && !formData.driverName) {
          updates.driverName = mappedDriver.shortNameRu || formatDriverShortName(mappedDriver);
        }
      }
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
      if (await showConfirm(`Обнаружен новый автомобиль [${cNum}].\nСохранить в постоянную базу автопарка?`)) {
        push(ref(db, 'known_fleet'), cNum);
      }
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
        if (await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`)) {
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
        }
      } else {
        driverId = existingDriver.id;
        driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
        migrationStatus = 'matched';
      }
    }

    // Write to vehicleFleet (center of data) — no duplicate in baza.
    const newRef = push(ref(db, 'vehicleFleet'));
    const normPlate = cNum.replace(/[^А-ЯA-Z0-9]/g, '');
    const masterCar = fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === normPlate);
    const carId = masterCar ? masterCar.id : newRef.key;

    const carData = {
      carId: carId,
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
       setFormData({ carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: '' });
    });
  };

  const openCarModal = (car: any) => {
    setModalData(car);
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
          const confirmAdd = await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`);
          if (confirmAdd) {
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
          }
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
        val = driverShortNameRu || trimmedDriver;
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

  const moveCarToArchive = async () => {
      if (isMechanic || !modalData) return;
      if (!(await showConfirm(`Отправить автомобиль [${modalData.carNumber}] в рейс?\nЗапись переместится во вкладку Архив.`))) return;

      const db = getDatabase(getApp());
      const nowStr = new Date().toISOString().split('T')[0];
      
      const updatedDeparture = modalData.dateDeparture || nowStr;
      
      const archiveCarData = {
          ...modalData,
          dateDeparture: updatedDeparture,
          status: 'archive'
      };

      const rootBranch = modalData.isLegacyBaza ? "baza" : "vehicleFleet";
      set(ref(db, `${rootBranch}/${modalData.id}`), archiveCarData).then(() => {
          logHistory(modalData.id, rootBranch, "Статус", "На базе", "Выехал в рейс (Перенесено в архив)", modalData.carNumber);
          setIsCarModalOpen(false);
      });
  };

  const deleteCarRecord = async (id: string, carNumber: string, e: React.MouseEvent) => {
      console.log("Delete called");
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
          // Only remove from vehicleFleet (center of data). Never touch vehicle_driver_data
          // (passport/driver records must survive deletion from Учёт выезда).
          const rootBranch = "vehicleFleet";
          remove(ref(db, `${rootBranch}/${id}`));
          
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

  // --- Admin ---
  const [adminForm, setAdminForm] = useState({ name: '', role: 'Диспетчер', password: '' });
  const [adminPerms, setAdminPerms] = useState<Record<string, boolean>>(() => {
     let p: any = {}; allFields.forEach(f => p[f] = true); return p;
  });

  const handleAddUser = () => {
    if(!adminForm.name || !adminForm.password) return;
    const db = getDatabase(getApp());
    push(ref(db, 'users_list'), {
       name: adminForm.name,
       role: adminForm.role,
       password: adminForm.password,
       permissions: adminPerms,
       isRootAdmin: false
    }).then(() => {
       setAdminForm({ name: '', role: 'Диспетчер', password: '' });
       let p: any = {}; allFields.forEach(f => p[f] = true); setAdminPerms(p);
    });
  };

  const deleteUser = async (id: string, name: string) => {
     if(await showConfirm(`Удалить пользователя ${name}?`)) {
       dbService.deleteUser(id, name);
     }
  };

  const toggleUserPerm = (userId: string, field: string, val: boolean) => {
     update(ref(getDatabase(getApp()), `users_list/${userId}/permissions`), { [field]: val });
  };
  
  const updateUserName = (userId: string, newName: string) => {
     update(ref(getDatabase(getApp()), `users_list/${userId}`), { name: newName });
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
     }).map(c => ({...c, _status: calculateCarStatus(c)})).sort((a,b) => {
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
    <div className="w-full space-y-4 flex flex-col font-sans">
      
      {/* Top Internal Tab Navigation for Baza module */}
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 border border-slate-200/40 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-9 h-9 rounded-xl bg-[#3765F6]/10 border border-[#3765F6]/20 flex items-center justify-center shrink-0">
            <Truck className="h-4.5 w-4.5 text-[#3765F6]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-950 font-sans tracking-tight">
                Учёт выезда
              </h1>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium hidden sm:block font-sans">
              Контроль нахождения автомобилей на базе
            </p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto justify-start sm:justify-end">
          <div className="flex items-center bg-slate-100/75 border border-slate-200/30 p-1 rounded-xl gap-1 shrink-0">
            <button 
              onClick={() => setCurrentTab('base')} 
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'base' 
                  ? 'bg-white text-slate-950 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/20'
              }`}
            >
              На базе
            </button>
            <button 
              onClick={() => setCurrentTab('archive')} 
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'archive' 
                  ? 'bg-white text-slate-950 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/20'
              }`}
            >
              Архив
            </button>
            <button 
              onClick={() => setCurrentTab('history')} 
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'history' 
                  ? 'bg-white text-slate-950 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/20'
              }`}
            >
              История
            </button>
          </div>
          
          {isRootAdmin && (
            <button 
              onClick={() => setIsAdminModalOpen(true)} 
              className="px-3.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200/60 hover:border-slate-300 text-slate-700 hover:text-slate-900 rounded-xl text-[11px] font-bold tracking-tight transition duration-150 cursor-pointer flex items-center gap-1.5 shadow-3xs shrink-0"
            >
              <Settings className="h-3.5 w-3.5 text-slate-400"/> Админка
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Counter widgets on top (Full width) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4.5">
         {/* Всего на базе */}
         <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4.5 border border-slate-200/40 shadow-3xs flex justify-between items-center transition-all hover:scale-[1.01]">
            <div className="flex flex-col">
               <span className="text-[11px] font-medium tracking-tight text-slate-400 font-sans">Всего на базе ТС</span>
               <span className="text-2xl font-bold text-slate-950 mt-1 font-sans tracking-tight">{wTotal}</span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[#3765F6]/10 flex items-center justify-center border border-[#3765F6]/10">
               <Truck className="h-5 w-5 text-[#3765F6]" />
            </div>
         </div>
         {/* В ремонте */}
         <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4.5 border border-slate-200/40 shadow-3xs flex justify-between items-center transition-all hover:scale-[1.01]">
            <div className="flex flex-col">
               <span className="text-[11px] font-medium tracking-tight text-slate-400 font-sans">В ремонте ТС</span>
               <span className="text-2xl font-bold text-rose-600 mt-1 font-sans tracking-tight">{wRepair}</span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center border border-rose-500/10">
               <Wrench className="h-5 w-5 text-rose-600" />
            </div>
         </div>
         {/* Готовы к рейсу */}
         <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4.5 border border-slate-200/40 shadow-3xs flex justify-between items-center transition-all hover:scale-[1.01]">
            <div className="flex flex-col">
               <span className="text-[11px] font-medium tracking-tight text-slate-400 font-sans">Готовы к рейсу ТС</span>
               <span className="text-2xl font-bold text-emerald-600 mt-1 font-sans tracking-tight">{wReady}</span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/10">
               <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
         </div>
      </div>

      <div className="space-y-6">
          
          <div className={currentTab === 'base' ? '' : 'hidden'}>
             <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-5 lg:p-6 border border-slate-200/40 shadow-xs">
                 <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100/50 pb-3 mb-5 flex items-center gap-2 font-sans tracking-tight">
                    <Plus className="h-4 w-4 text-[#3765F6]" />
                    Добавить новый автомобиль
                 </h2>
                 <form onSubmit={handleAddNewCar}>
                    {/* Quick coupling picker — pulls a coupling (tractor+trailer+driver) from the shared center */}
                    <div className="mb-4">
                      <label className="text-xs font-semibold text-slate-600 block font-sans mb-1">Быстрый выбор из общей базы</label>
                      <CouplingPicker
                        onSelect={(rec) => {
                          if (!rec) return;
                          const updates: Record<string, string> = {
                            carNumber: (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                          };
                          const drv = rec.driverNameRu || rec.driverName || rec.driverShortNameRu || '';
                          if (drv) updates.driverName = drv;
                          setFormData((f) => ({ ...f, ...updates }));
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans">Госномер авто *</label>
                            <input 
                              list="known-fleet-dl" 
                              required 
                              disabled={!canEditField('carNumber')} 
                              value={formData.carNumber} 
                              onChange={e => handleFormChange(e, 'carNumber')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-bold uppercase disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                              placeholder="АВ 1234-5" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans">ФИО Водителя</label>
                            <input 
                              disabled={!canEditField('driverName')} 
                              list="baza-drivers-dl" 
                              value={formData.driverName} 
                              onChange={e => handleFormChange(e, 'driverName')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                              placeholder="Опционально" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans">Прибыл на базу</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateArrival')} 
                              value={formData.dateArrival} 
                              onChange={e => handleFormChange(e, 'dateArrival')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans truncate" title="Срок готовности">Срок готовности</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateLoading')} 
                              value={formData.dateLoading} 
                              onChange={e => handleFormChange(e, 'dateLoading')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans truncate">Заявка на ремонт</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateRepairStart')} 
                              value={formData.dateRepairStart} 
                              onChange={e => handleFormChange(e, 'dateRepairStart')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans truncate">Завершение ремонта</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateRepairEnd')} 
                              value={formData.dateRepairEnd} 
                              onChange={e => handleFormChange(e, 'dateRepairEnd')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans">Фактический выезд</label>
                            <input 
                              type="date" 
                              disabled={!canEditField('dateDeparture')} 
                              value={formData.dateDeparture} 
                              onChange={e => handleFormChange(e, 'dateDeparture')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                            />
                         </div>
                         <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-600 block font-sans">Примечание</label>
                            <input 
                              disabled={!canEditField('comment')} 
                              value={formData.comment} 
                              onChange={e => handleFormChange(e, 'comment')} 
                              className="w-full bg-white/60 hover:bg-white/90 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50 outline-none focus:border-[#3765F6] focus:bg-white transition-all duration-150" 
                              placeholder="..." 
                            />
                         </div>
                     </div>
                     <button 
                       type="submit" 
                       disabled={!allFields.some(f => canEditField(f))} 
                       className="bg-[#3765F6] hover:bg-[#3765F6]/90 font-sans text-white text-xs font-semibold tracking-tight py-2.5 px-5 rounded-xl transition-all duration-150 active:scale-95 shadow-md shadow-[#3765F6]/10 border border-[#3765F6]/10 disabled:opacity-40 cursor-pointer mt-2"
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
             <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/40 shadow-xs flex flex-col">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                    <h2 className="text-base font-bold text-slate-900 font-sans tracking-tight">
                       {currentTab === 'base' ? 'Автомобили на базе' : 'Архив выехавших автомобилей'}
                    </h2>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                       <input 
                         value={searchQuery} 
                         onChange={e => setSearchQuery(e.target.value)} 
                         type="text" 
                         className="w-full sm:w-64 bg-white/60 hover:bg-white/90 border border-slate-200/60 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:border-[#3765F6] transition-all" 
                         placeholder="Быстрый поиск..." 
                       />
                       <select
                         value={selectedDispatcher}
                         onChange={e => setSelectedDispatcher(e.target.value)}
                         className="bg-white/60 hover:bg-white/90 border border-slate-200/60 text-xs font-medium px-3.5 py-2 rounded-xl outline-none transition-all cursor-pointer"
                       >
                          <option value="Все автомобили">Все диспетчеры</option>
                          {dispatcherList.map(disp => (
                             <option key={disp} value={disp}>{disp}</option>
                          ))}
                       </select>
                       <select 
                         value={sortMode} 
                         onChange={e => setSortMode(e.target.value)} 
                         className="bg-white/60 hover:bg-white/90 border border-slate-200/60 text-xs font-medium px-3.5 py-2 rounded-xl outline-none min-w-[170px] max-w-[250px] transition-all"
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
                     
<table className="w-full text-left min-w-[1250px] border-separate border-spacing-y-2">
  <thead>
    <tr>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Госномер</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Водитель</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Прибыл на базу</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Срок готовности</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Заявка на ремонт</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Завершение ремонта</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Фактический выезд</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Примечание</th>
      <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 pb-2 px-4 font-sans">Действия</th>
    </tr>
  </thead>
  <tbody>
    {filteredList.map((v) => (
      <tr key={`${v.id}-${normalizePlate(v.carNumber)}`} className="group cursor-pointer">
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-l border-slate-200/30 rounded-l-xl px-4 py-3.5 group-hover:bg-white/80 transition duration-150">
          <span className="font-bold text-xs bg-white text-slate-900 border border-slate-200/60 shadow-3xs px-2.5 py-1.5 rounded-xl font-mono tracking-wider inline-block select-all group-hover:border-[#3765F6]/40 transition-colors">{v.carNumber}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-sm font-semibold text-slate-800 group-hover:bg-white/80 transition">{v.driverShortNameRu || v.driverName || '—'}</td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs font-medium text-slate-600 group-hover:bg-white/80 transition">
          <span className="bg-white/60 border border-slate-200/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap font-sans">{v.dateArrival ? v.dateArrival.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs font-medium text-slate-600 group-hover:bg-white/80 transition">
          <span className="bg-white/60 border border-slate-200/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap font-sans">{v.dateLoading ? v.dateLoading.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs font-medium text-slate-600 group-hover:bg-white/80 transition">
          <span className="bg-white/60 border border-slate-200/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap font-sans">{v.dateRepairStart ? v.dateRepairStart.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs font-medium text-slate-600 group-hover:bg-white/80 transition">
          <span className="bg-white/60 border border-slate-200/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap font-sans">{v.dateRepairEnd ? v.dateRepairEnd.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs font-medium text-slate-600 group-hover:bg-white/80 transition">
          <span className={`px-2.5 py-1.5 rounded-lg border whitespace-nowrap font-sans ${
            v.dateDeparture
                ? 'bg-emerald-500/10 border-emerald-500/15 text-emerald-800 font-semibold' 
                : 'bg-white/60 border-slate-200/40 text-slate-500'
          }`}>
            {v.dateDeparture ? v.dateDeparture.split('-').reverse().join('.') : '—'}
          </span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-white/40 border-y border-slate-200/30 px-4 py-3.5 text-xs text-slate-500 group-hover:bg-white/80 transition max-w-[180px] truncate">{v.comment || v.notes || '—'}</td>
        <td className="bg-white/40 border-y border-r border-slate-200/30 rounded-r-xl px-4 py-3.5 group-hover:bg-white/80 transition">
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
                       className="bg-white/60 hover:bg-white/90 border border-slate-200/40 rounded-2xl p-4 shadow-3xs transition-all cursor-pointer flex flex-col gap-3"
                     >
                       <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs bg-white text-slate-900 border border-slate-200/60 shadow-3xs px-2.5 py-1.5 rounded-xl font-mono tracking-wider">{v.carNumber}</span>
                            <span className="text-xs font-semibold text-slate-800">{v.driverShortNameRu || v.driverName || "—"}</span>
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
                         <div className="bg-white/40 p-2.5 rounded-xl border border-slate-200/20">
                           <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Прибыл на базу</span>
                           <span className="font-medium text-slate-700">{v.dateArrival ? v.dateArrival.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-white/40 p-2.5 rounded-xl border border-slate-200/20">
                           <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Срок готовности</span>
                           <span className="font-medium text-slate-700">{v.dateLoading ? v.dateLoading.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-white/40 p-2.5 rounded-xl border border-slate-200/20">
                           <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Заявка на ремонт</span>
                           <span className="font-medium text-slate-700">{v.dateRepairStart ? v.dateRepairStart.split("-").reverse().join(".") : "—"}</span>
                         </div>
                         <div className="bg-white/40 p-2.5 rounded-xl border border-slate-200/20">
                           <span className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Завершение ремонта</span>
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
                     <div className="text-center p-8 text-slate-400 font-medium bg-white/40 rounded-2xl border border-slate-200/30">
                       Нет записей
                     </div>
                   )}
                 </div>
             </div>
          </div>

          <div className={currentTab === 'history' ? '' : 'hidden'}>
             <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-5 lg:p-6 border border-slate-200/40 shadow-xs flex flex-col">
                 <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100/50 pb-4 mb-4 font-sans tracking-tight flex items-center gap-2">
                    <History className="h-4 w-4 text-[#3765F6]" />
                    История всех действий в системе
                 </h2>
                 <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
                    {[...globalHistory].reverse().slice(0, historyLimit).map(h => (
                       <div key={h.id} className="bg-white border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-3 shadow-3xs hover:border-[#3765F6]/10 transition-all">
                          <div className="flex items-center flex-wrap gap-3">
                             <span className="text-xs font-semibold text-slate-400 font-mono">{h.date}</span>
                             <span className="text-xs font-bold bg-white px-2.5 py-1 rounded-xl border border-slate-200/60 shadow-3xs font-mono">{h.carNumber}</span>
                             <span className="text-xs font-semibold text-slate-700 bg-[#3765F6]/5 text-[#3765F6] border border-[#3765F6]/10 px-2.5 py-1 rounded-xl">{h.user}</span>
                          </div>
                          <div className="text-xs text-slate-700 bg-slate-50/50 p-3 rounded-xl border border-slate-200/30 flex flex-wrap items-center gap-2">
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
                          className="w-full py-3 bg-white/65 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl transition duration-150 cursor-pointer text-center tracking-tight border border-slate-200/50 active:scale-95"
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
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{y:30, scale:0.96}} animate={{y:0, scale:1}} exit={{y:20, opacity:0, scale:0.96}} className="bg-white text-slate-900 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-[0_24px_70px_rgba(0,0,0,0.12)] border border-slate-200/50 overflow-hidden font-sans">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                       <h2 className="text-sm font-bold text-slate-800 tracking-tight">Карточка автомобиля</h2>
                       {modalData.carNumber && (
                          <span className="font-bold text-[11px] bg-white text-slate-950 border border-slate-200 shadow-3xs px-2.5 py-1 rounded-lg font-mono tracking-wider">
                             {modalData.carNumber}
                          </span>
                       )}
                       {modalData.id && (
                          getStatusBadge(calculateCarStatus(modalData).code, calculateCarStatus(modalData).text)
                       )}
                    </div>
                    <div className="flex items-center gap-2">
                       {currentTab === 'base' && !isMechanic && (
                         <button 
                           onClick={moveCarToArchive} 
                           className="px-4 py-2 bg-[#3765F6] hover:bg-[#3765F6]/90 text-white text-xs font-semibold rounded-xl transition-all duration-150 shadow-sm shadow-[#3765F6]/10 hover:shadow-[#3765F6]/25 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                         >
                            Выехал в рейс
                         </button>
                       )}
                       <button 
                         onClick={() => setIsCarModalOpen(false)} 
                         className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold rounded-xl transition duration-150 active:scale-95 cursor-pointer"
                       >
                          Закрыть
                       </button>
                    </div>
                 </div>

                 <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6 custom-scrollbar">
                    {/* Summary Widgets */}
                    <div className="bg-slate-50/70 border border-slate-200/40 rounded-2xl p-4 lg:p-5">
                       <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3 block">Аналитика простоя по записи</h3>
                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-white border border-slate-200/40 rounded-xl p-3 text-center shadow-3xs hover:border-[#3765F6]/20 transition-all">
                             <div className="text-[10px] font-semibold text-slate-400 mb-1">Дни отдыха водит.</div>
                             <div className="text-lg font-bold text-slate-800">{getDaysBetween(modalData.dateArrival, modalData.dateLoading)}</div>
                          </div>
                          <div className="bg-white border border-slate-200/40 rounded-xl p-3 text-center shadow-3xs hover:border-[#3765F6]/20 transition-all">
                             <div className="text-[10px] font-semibold text-slate-400 mb-1">Ожидание ремонта</div>
                             <div className="text-lg font-bold text-rose-500">{getDaysBetween(modalData.dateArrival, modalData.dateRepairStart)}</div>
                          </div>
                          <div className="bg-white border border-slate-200/40 rounded-xl p-3 text-center shadow-3xs hover:border-[#3765F6]/20 transition-all">
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
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1">Госномер автомобиля</label>
                          <input 
                            disabled={!canEditField('carNumber')} 
                            value={modalData.carNumber||''} 
                            onChange={e=>{ const newCar = e.target.value.toUpperCase(); const updates: any = { carNumber: newCar }; const mappedDriverId = driversMap[newCar.trim()]; if (mappedDriverId) { const mappedDriver = drivers.find(d => d.id === mappedDriverId); if (mappedDriver && !modalData.driverName) { updates.driverName = mappedDriver.shortNameRu || formatDriverShortName(mappedDriver); } } setModalData({...modalData, ...updates}); }} 
                            onBlur={e=>updateCarField(modalData.id, 'carNumber', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-semibold uppercase disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                        <div className="space-y-1">
                           <label className="text-[11px] font-semibold text-slate-500 block mb-1">ФИО Водителя</label>
                          <input 
                            disabled={!canEditField('driverName')} 
                            list="baza-drivers-dl" 
                            value={modalData.driverName||''} 
                            onChange={e=>setModalData({...modalData, driverName: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'driverName', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                       <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1 truncate" title="Прибыл на базу">Прибыл на базу</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateArrival')} 
                            value={modalData.dateArrival||''} 
                            onChange={e=>setModalData({...modalData, dateArrival: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'dateArrival', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1 truncate text-[#3765F6]" title="К какому числу должна быть готова машина">Срок готовности</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateLoading')} 
                            value={modalData.dateLoading||''} 
                            onChange={e=>setModalData({...modalData, dateLoading: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'dateLoading', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1 truncate" title="Дата подачи заявки на ремонт">Заявка на ремонт</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateRepairStart')} 
                            value={modalData.dateRepairStart||''} 
                            onChange={e=>setModalData({...modalData, dateRepairStart: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'dateRepairStart', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1 truncate" title="Дата окончания ремонта">Завершение ремонта</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateRepairEnd')} 
                            value={modalData.dateRepairEnd||''} 
                            onChange={e=>setModalData({...modalData, dateRepairEnd: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'dateRepairEnd', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-500 block mb-1 truncate" title="Фактический выезд">Фактический выезд</label>
                          <input 
                            type="date" 
                            disabled={!canEditField('dateDeparture')} 
                            value={modalData.dateDeparture||''} 
                            onChange={e=>setModalData({...modalData, dateDeparture: e.target.value})} 
                            onBlur={e=>updateCarField(modalData.id, 'dateDeparture', e.target.value)} 
                            onKeyDown={handleInputKeyDown} 
                            className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                          />
                       </div>
                    </div>

                    <div className="space-y-1">
                       <label className="text-[11px] font-semibold text-slate-500 block mb-1">Примечание</label>
                       <input 
                         disabled={!canEditField('comment')} 
                         value={modalData.comment||''} 
                         onChange={e=>setModalData({...modalData, comment: e.target.value})} 
                         onBlur={e=>updateCarField(modalData.id, 'comment', e.target.value)} 
                         onKeyDown={handleInputKeyDown} 
                         className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200/50 text-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-semibold disabled:opacity-50 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" 
                       />
                    </div>

                    <div className="bg-slate-50/70 border border-slate-200/40 rounded-2xl p-4 lg:p-5">
                       <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-3 block">ЖУРНАЛ ИЗМЕНЕНИЙ ЗАПИСИ</h3>
                       <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                           {modalData.history && Object.keys(modalData.history).reverse().map(hk => {
                              const h = modalData.history[hk];
                              return (
                                 <div key={hk} className="bg-white border border-slate-200/40 rounded-xl p-3 flex flex-col gap-1 shadow-3xs">
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
              </motion.div>
           </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Users Management Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-[0_24px_70px_rgba(0,0,0,0.12)] border border-slate-200/50 overflow-hidden font-sans">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h2 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2">Права доступа модуля</h2>
                    <button 
                      onClick={() => setIsAdminModalOpen(false)} 
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold rounded-xl transition duration-150 active:scale-95 cursor-pointer"
                    >
                       Закрыть
                    </button>
                 </div>
                 
                 <div className="p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
                    <div className="bg-[#3765F6]/5 border border-[#3765F6]/10 rounded-2xl p-4.5 text-xs font-medium text-slate-600 leading-relaxed">
                       Администраторы Ratipa (root_admin) имеют полный доступ автоматически. <br/>Здесь вы можете заводить локальных пользователей Базы для ограничения их прав по конкретным полям. При входе в Ratipa с тем же именем, локальные права применятся к сотруднику.
                    </div>

                    <div className="bg-slate-50/60 border border-slate-200/40 rounded-2xl p-5">
                       <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 block">Добавить сотрудника (Локальная роль)</h3>
                       <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                          <div className="space-y-1">
                             <label className="text-[11px] font-semibold text-slate-500 mb-1.5 block">Имя (в Ratipa)</label>
                             <input value={adminForm.name} onChange={e=>setAdminForm({...adminForm, name: e.target.value})} className="w-full bg-white border border-slate-200/60 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 transition-all" placeholder="Aleksey" />
                          </div>
                          <div className="space-y-1">
                             <label className="text-[11px] font-semibold text-slate-500 mb-1.5 block">Роль</label>
                             <select value={adminForm.role} onChange={e=>setAdminForm({...adminForm, role: e.target.value})} className="w-full bg-white border border-slate-200/60 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 transition-all">
                                <option value="Диспетчер">Диспетчер </option>
                                <option value="Механик">Механик</option>
                             </select>
                          </div>
                          <div className="space-y-1">
                             <label className="text-[11px] font-semibold text-slate-500 mb-1.5 block">Пароль (legacy)</label>
                             <input value={adminForm.password} onChange={e=>setAdminForm({...adminForm, password: e.target.value})} className="w-full bg-white border border-slate-200/60 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 transition-all" placeholder="12345" />
                          </div>
                       </div>
                       <div className="mb-5">
                          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-3">Что может редактировать:</label>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                             {allFields.map(f => (
                                <label key={f} className="flex items-center gap-2.5 bg-white hover:bg-slate-100 px-3.5 py-2 rounded-xl border border-slate-200/50 cursor-pointer text-xs font-semibold text-slate-700 hover:border-[#3765F6]/30 transition-all">
                                   <input type="checkbox" checked={adminPerms[f]} onChange={(e) => setAdminPerms({...adminPerms, [f]: e.target.checked})} className="accent-[#3765F6] w-3.5 h-3.5 rounded" />
                                   {fieldLabels[f]}
                                </label>
                             ))}
                          </div>
                       </div>
                       <button 
                         onClick={handleAddUser} 
                         className="px-5 py-2.5 bg-[#3765F6] hover:bg-[#3765F6]/90 text-white text-xs font-semibold rounded-xl tracking-tight transition shadow-sm shadow-[#3765F6]/10 hover:shadow-[#3765F6]/25 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                       >
                          Создать
                       </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-200/50 rounded-2xl custom-scrollbar">
                       <table className="w-full text-left min-w-[900px] border-collapse bg-white">
                          <thead className="bg-slate-50 border-b border-slate-200/50">
                             <tr>
                                <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 p-4 w-[20%]">Сотрудник</th>
                                <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 p-4 w-[15%]">Роль</th>
                                <th className="text-[11px] font-bold uppercase tracking-wider text-slate-400 p-4 w-[60%]">Матрица разрешений</th>
                                <th className="p-4 w-[5%]"></th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {systemUsers.map(u => {
                                const isRoot = u.isRootAdmin || u.name === 'Сергей';
                                return (
                                   <tr key={u.id}>
                                      <td className="p-4 align-top">
                                         <input value={u.name} onChange={e=>updateUserName(u.id, e.target.value)} className="bg-slate-50 border border-slate-200/60 px-3 py-1.5 text-xs font-semibold rounded-lg w-full outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/5 focus:bg-white transition-all" />
                                         {isRoot && <div className="text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-700 border border-emerald-500/15 px-2 py-0.5 rounded-lg mt-1.5 inline-block">Root Admin</div>}
                                      </td>
                                      <td className="p-4 align-top">
                                         <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200/40 whitespace-nowrap inline-block mt-1">{u.role}</span>
                                      </td>
                                      <td className="p-4 align-top">
                                         {isRoot ? (
                                           <div className="mt-1">
                                             <span className="text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-700 px-2.5 py-1.5 rounded-xl border border-emerald-500/15">Полный доступ (Безлимит)</span>
                                           </div>
                                         ) : (
                                           <div className="grid grid-cols-2 gap-2 mt-1">
                                              {allFields.map(f => {
                                                 const isChecked = (u.permissions && u.permissions[f] !== false);
                                                 return (
                                                   <label key={f} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer hover:text-[#3765F6] transition-colors">
                                                      <input type="checkbox" checked={isChecked} onChange={(e)=>toggleUserPerm(u.id, f, e.target.checked)} className="accent-[#3765F6] w-3.5 h-3.5 rounded" /> {fieldLabels[f]}
                                                   </label>
                                                 );
                                              })}
                                           </div>
                                         )}
                                      </td>
                                      <td className="p-4 text-right align-top">
                                         {!isRoot && (
                                           <button 
                                             onClick={() => deleteUser(u.id, u.name)} 
                                             className="w-8 h-8 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl flex items-center justify-center border border-rose-100 transition-all active:scale-90 cursor-pointer"
                                           >
                                             <Trash2 className="w-3.5 h-3.5"/>
                                           </button>
                                         )}
                                      </td>
                                   </tr>
                                );
                             })}
                          </tbody>
                       </table>
                    </div>

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
